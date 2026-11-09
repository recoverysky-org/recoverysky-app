import { act, renderHook } from "@testing-library/react-native"

import type { SkyMeeting } from "@/utils/agentMeetingsLogic"

import { useSkyMeetingPopup } from "./useSkyMeetingPopup"

// One log of the calls whose order matters: the reconcile has to come before the projection.
const mockOrder: string[] = []

const mockGetSchedule = jest.fn()
jest.mock("@/services/api", () => ({
  api: {
    getScheduleByMeetingId: (mid: string, venueType: string) => mockGetSchedule(mid, venueType),
  },
}))

const mockReconcile = jest.fn()
jest.mock("@/db", () => ({
  feedbackCache: {
    reconcileSchedules: (schedules: unknown) => {
      mockOrder.push("reconcile")
      mockReconcile(schedules)
    },
  },
}))

// The real projection pulls the whole provider module in; what it does is its own test's business.
jest.mock("@/context/MeetingContext", () => ({
  toMeetingWithTrex: (s: { sid: string; meeting: { id: string; name: string } }) => {
    mockOrder.push("project")
    return { ...s.meeting, sid: s.sid, projected: true }
  },
}))

let mockMaintenance = false
jest.mock("@/models", () => ({
  useConfigStore: () => ({
    get maintenanceMode() {
      return mockMaintenance
    },
  }),
}))

let mockFocused = true
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }))

const mockShowToast = jest.fn()
jest.mock("@/components/Toast", () => ({ useToast: () => ({ showToast: mockShowToast }) }))

const mockWarn = jest.fn()
jest.mock("@/utils/logger", () => ({
  logger: { child: () => ({ warn: (...args: unknown[]) => mockWarn(...args) }) },
}))

const skyMeeting = (overrides: Partial<SkyMeeting> = {}): SkyMeeting => ({
  id: "m1",
  name: "Sunrise Serenity",
  fellowship: "AA",
  language: "en",
  venue: "online",
  hybrid: false,
  continuous: false,
  startsAt: 0,
  favorite: false,
  venueName: null,
  distanceM: null,
  scheduled: true,
  ...overrides,
})

const schedule = (venueType: string, id = "m1") => ({
  sid: "s1",
  meeting: { id, name: "Sunrise Serenity", venueType },
  millis: 0,
  duration_ms: 0,
  data: [],
})

const OK = { kind: "ok", schedule: schedule("online") }

/** A lookup answer the test resolves when it likes */
function deferred() {
  let resolve: (value: unknown) => void = () => {}
  const promise = new Promise((done) => (resolve = done))
  return { promise, resolve }
}

const FAILED_TOAST = { tx: "agentScreen:meetingOpenFailed", type: "error" }
const NOT_SCHEDULED_TOAST = { tx: "agentScreen:meetingNotScheduled", type: "error" }

describe("useSkyMeetingPopup", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOrder.length = 0
    mockMaintenance = false
    mockFocused = true
  })

  async function openWith(meeting: SkyMeeting, answer: unknown) {
    mockGetSchedule.mockResolvedValueOnce(answer)
    const hook = renderHook(() => useSkyMeetingPopup())
    await act(async () => {
      hook.result.current.openMeeting(meeting, "call-1")
    })
    return hook
  }

  // The MCP Meeting has no schedule, password or grid, so the popup needs the real one.
  it("opens an online meeting's schedule, looked up in its own pool", async () => {
    const { result } = await openWith(skyMeeting(), OK)

    expect(mockGetSchedule).toHaveBeenCalledWith("m1", "online")
    expect(result.current.popup).toEqual({
      venue: "online",
      toolCallId: "call-1",
      meeting: expect.objectContaining({ id: "m1", sid: "s1", projected: true }),
    })
  })

  it("opens an in-person meeting's schedule in the in-person pool", async () => {
    const { result } = await openWith(skyMeeting({ venue: "in_person" }), {
      kind: "ok",
      schedule: schedule("in_person"),
    })

    expect(mockGetSchedule).toHaveBeenCalledWith("m1", "in_person")
    expect(result.current.popup?.venue).toBe("in_person")
  })

  // Same order as the deep links: schedule-wide hearts and stars before the row snapshots them.
  it("reconciles the schedule's hearts before it projects the row", async () => {
    await openWith(skyMeeting(), OK)
    expect(mockReconcile).toHaveBeenCalledWith([OK.schedule])
    expect(mockOrder).toEqual(["reconcile", "project"])
  })

  // The id comes from a tool's answer and goes into the path as it stands.
  it("encodes the id into the lookup's path", async () => {
    await openWith(skyMeeting({ id: "a/b?c#d" }), OK)
    expect(mockGetSchedule).toHaveBeenCalledWith("a%2Fb%3Fc%23d", "online")
  })

  // A server that ignores venueType answers from the online pool, and InPersonPopup on an online
  // record is a dead end (the deep links' rule, InPersonScreen and LiveScreen).
  it.each([
    ["an in-person card answered from the online pool", "in_person", "online"],
    ["an online card answered from the in-person pool", "online", "in_person"],
  ])("refuses %s", async (_name, venue, answered) => {
    const { result } = await openWith(skyMeeting({ venue: venue as SkyMeeting["venue"] }), {
      kind: "ok",
      schedule: schedule(answered),
    })
    expect(result.current.popup).toBeNull()
    expect(mockShowToast).toHaveBeenCalledWith(NOT_SCHEDULED_TOAST)
  })

  // A 404 is the meeting in no active schedule (api `GET /schedules/meeting/:mid`). "Check your
  // connection" would be false, and each retry another 404 to the api.
  it("says a meeting not found is not on the schedule, and logs only why", async () => {
    const { result } = await openWith(skyMeeting(), { kind: "not-found" })
    expect(result.current.popup).toBeNull()
    expect(mockShowToast).toHaveBeenCalledWith(NOT_SCHEDULED_TOAST)
    expect(mockWarn).toHaveBeenCalledWith(expect.any(String), { reason: "not-found" })
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain("m1")
  })

  it.each([["not-found"], ["bad-data"]])(
    "asks no more for a meeting whose lookup answered %s",
    async (kind) => {
      const { result } = await openWith(skyMeeting(), { kind })
      await act(async () => {
        result.current.openMeeting(skyMeeting(), "call-2")
      })
      expect(mockGetSchedule).toHaveBeenCalledTimes(1)
      expect(mockShowToast).toHaveBeenNthCalledWith(2, NOT_SCHEDULED_TOAST)
    },
  )

  it("still looks up the same id in the other pool", async () => {
    const { result } = await openWith(skyMeeting(), { kind: "not-found" })
    mockGetSchedule.mockResolvedValueOnce({ kind: "ok", schedule: schedule("in_person") })
    await act(async () => {
      result.current.openMeeting(skyMeeting({ venue: "in_person" }), "call-2")
    })
    expect(mockGetSchedule).toHaveBeenLastCalledWith("m1", "in_person")
    expect(result.current.popup?.venue).toBe("in_person")
  })

  // find_favorite_meetings already said this favorite is in no active schedule.
  it("sends nothing for a meeting the answer says has no schedule", async () => {
    const { result } = renderHook(() => useSkyMeetingPopup())
    await act(async () => {
      result.current.openMeeting(skyMeeting({ scheduled: false }), "call-1")
    })
    expect(mockGetSchedule).not.toHaveBeenCalled()
    expect(mockShowToast).toHaveBeenCalledWith(NOT_SCHEDULED_TOAST)
  })

  // A failure that may pass asks for a retry, and the retry is sent.
  it.each([["timeout"], ["cannot-connect"], ["server"], ["unauthorized"]])(
    "asks for a retry after %s, and sends the retry",
    async (kind) => {
      const { result } = await openWith(skyMeeting(), { kind })
      expect(mockShowToast).toHaveBeenCalledWith(FAILED_TOAST)

      mockGetSchedule.mockResolvedValueOnce(OK)
      await act(async () => {
        result.current.openMeeting(skyMeeting(), "call-1")
      })
      expect(mockGetSchedule).toHaveBeenCalledTimes(2)
      expect(result.current.popup?.meeting.id).toBe("m1")
    },
  )

  it("says so when the lookup throws", async () => {
    mockGetSchedule.mockRejectedValueOnce(new Error("boom"))
    const { result } = renderHook(() => useSkyMeetingPopup())
    await act(async () => {
      result.current.openMeeting(skyMeeting(), "call-1")
    })
    expect(result.current.popup).toBeNull()
    expect(mockShowToast).toHaveBeenCalledWith(FAILED_TOAST)
  })

  // CLAUDE.md "Features that self-disable under maintenanceMode": any API-dependent feature needs one.
  it("sends nothing in maintenance mode", async () => {
    mockMaintenance = true
    const { result } = renderHook(() => useSkyMeetingPopup())
    await act(async () => {
      result.current.openMeeting(skyMeeting(), "call-1")
    })
    expect(mockGetSchedule).not.toHaveBeenCalled()
    expect(mockShowToast).toHaveBeenCalledWith(FAILED_TOAST)
  })

  it("opens the last card tapped when two lookups overlap", async () => {
    const first = deferred()
    const second = deferred()
    mockGetSchedule.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useSkyMeetingPopup())

    act(() => {
      result.current.openMeeting(skyMeeting({ id: "m1" }), "call-1")
      result.current.openMeeting(skyMeeting({ id: "m2" }), "call-2")
    })
    await act(async () => {
      second.resolve({ kind: "ok", schedule: schedule("online", "m2") })
      first.resolve({ kind: "ok", schedule: schedule("online", "m1") })
    })

    expect(result.current.popup?.meeting.id).toBe("m2")
    expect(result.current.popup?.toolCallId).toBe("call-2")
  })

  // A row shows no spinner, so a person taps again while it loads.
  it("sends nothing for a second tap on the row that is loading", async () => {
    const pending = deferred()
    mockGetSchedule.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useSkyMeetingPopup())

    act(() => {
      result.current.openMeeting(skyMeeting(), "call-1")
      result.current.openMeeting(skyMeeting(), "call-1")
    })
    await act(async () => {
      pending.resolve(OK)
    })

    expect(mockGetSchedule).toHaveBeenCalledTimes(1)
    expect(result.current.popup?.meeting.id).toBe("m1")
  })

  it.each([
    ["a meeting found", OK],
    ["a meeting not found", { kind: "not-found" }],
  ])("drops %s after the popup was closed", async (_name, answer) => {
    const pending = deferred()
    mockGetSchedule.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useSkyMeetingPopup())

    act(() => {
      result.current.openMeeting(skyMeeting(), "call-1")
      result.current.closePopup()
    })
    await act(async () => {
      pending.resolve(answer)
    })

    expect(result.current.popup).toBeNull()
    expect(mockShowToast).not.toHaveBeenCalled()
  })

  // Bottom tabs stay mounted. An answer set on a hidden screen drew the Modal over the other tab,
  // then the popup's own blur effect closed it, and the close collapsed the card.
  it.each([
    ["a meeting found", OK],
    ["a failed lookup", { kind: "timeout" }],
  ])("drops %s that lands after the tab lost focus", async (_name, answer) => {
    const pending = deferred()
    mockGetSchedule.mockReturnValueOnce(pending.promise)
    const { result, rerender } = renderHook(() => useSkyMeetingPopup())

    act(() => {
      result.current.openMeeting(skyMeeting(), "call-1")
    })
    mockFocused = false
    rerender({})
    await act(async () => {
      pending.resolve(answer)
    })

    expect(result.current.popup).toBeNull()
    expect(mockShowToast).not.toHaveBeenCalled()
  })

  it("opens a tap made after the tab came back", async () => {
    const { result, rerender } = renderHook(() => useSkyMeetingPopup())
    mockFocused = false
    rerender({})
    mockFocused = true
    rerender({})

    mockGetSchedule.mockResolvedValueOnce(OK)
    await act(async () => {
      result.current.openMeeting(skyMeeting(), "call-1")
    })
    expect(result.current.popup?.meeting.id).toBe("m1")
  })

  it("closes the popup", async () => {
    const { result } = await openWith(skyMeeting(), OK)
    act(() => result.current.closePopup())
    expect(result.current.popup).toBeNull()
  })
})
