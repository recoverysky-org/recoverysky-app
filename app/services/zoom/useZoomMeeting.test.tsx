import { Linking } from "react-native"
import { act, renderHook } from "@testing-library/react-native"

import { useZoomMeeting } from "./useZoomMeeting"
import type { ZoomJoinConfig } from "./zoomTypes"

// Plain objects stand in for the MST stores so the test never loads the models
// graph (ConfigStore → api → db …). Both mocks are built inside their factories
// (jest.mock is hoisted above the imports) and reached through jest.requireMock
// below.
// CHANGED 2026-10-11: the hook reads no store now that join links carry no
// name. The @/models mock stays on purpose. The cases give the profile a
// display name and flip the guest flag, showing that neither reaches the URL,
// and a store read added back later still cannot load the models graph.
jest.mock("@/models", () => {
  const auth = { isGuest: false }
  const profile = { displayName: "" }
  return {
    __auth: auth,
    __profile: profile,
    useAuthenticationStore: () => auth,
    useProfileStore: () => profile,
  }
})

jest.mock("@/utils/logger", () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  return { __log: log, logger: { child: () => log } }
})

const models = jest.requireMock("@/models") as {
  __auth: { isGuest: boolean }
  __profile: { displayName: string }
}
const { __log: log } = jest.requireMock("@/utils/logger") as {
  __log: Record<"info" | "warn" | "error" | "debug", jest.Mock>
}

const JOIN_LOG = "Join meeting request (external Zoom)"

// A display name the device owner's profile can hold: the short name plus the
// clean-time toggle's suffix. Every case has it in the profile, so a link with
// no name in it shows the name was left out, not that there was none to send.
const OWNER_DISPLAY_NAME = "Jen (12d)"

const config: ZoomJoinConfig = {
  meetingId: "m1",
  meetingNumber: "123456789",
  passwordEnc: "abc",
}

let openURL: jest.SpyInstance

async function join(c: ZoomJoinConfig): Promise<string> {
  const { result } = renderHook(() => useZoomMeeting())
  await act(async () => {
    await result.current.joinMeeting(c)
  })
  expect(openURL).toHaveBeenCalledTimes(1)
  return openURL.mock.calls[0][0] as string
}

function joinLogPayload(): Record<string, unknown> {
  const call = log.info.mock.calls.find(([message]) => message === JOIN_LOG)
  if (!call) throw new Error("the join request was not logged")
  return call[1] as Record<string, unknown>
}

describe("useZoomMeeting.joinMeeting", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    models.__auth.isGuest = false
    models.__profile.displayName = OWNER_DISPLAY_NAME
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
  })

  afterEach(() => openURL.mockRestore())

  // ADDED 2026-10-11: the display-name prefill (Zoom's `un` query parameter)
  // is removed (Zoom never applied it). No join link carries a name, for a
  // guest or anyone else.
  describe("no join URL carries a name", () => {
    it("gives a signed-in user whose profile has a name the passcode link alone", async () => {
      expect(await join(config)).toBe("https://zoom.us/j/123456789?pwd=abc")
    })

    it("gives a guest the same link", async () => {
      models.__auth.isGuest = true
      expect(await join(config)).toBe("https://zoom.us/j/123456789?pwd=abc")
    })

    it("ignores a name a caller still passes (plain JS, or a cast)", async () => {
      const withName = { ...config, userName: "Jen" } as ZoomJoinConfig
      expect(await join(withName)).toBe("https://zoom.us/j/123456789?pwd=abc")
    })

    it("is the bare join URL, with no query, when there is no passcode and no meetingUrl", async () => {
      expect(await join({ meetingId: "m1", meetingNumber: "123456789" })).toBe(
        "https://zoom.us/j/123456789",
      )
    })

    // A webinar link has no `/j/<number>` path, so the caller has no meeting
    // number. Its own query must come back untouched, with nothing appended.
    it("is the meetingUrl unchanged when there is no meeting number", async () => {
      const meetingUrl = "https://us02web.zoom.us/w/98765?tk=abc"
      expect(await join({ meetingId: "m1", meetingNumber: "", meetingUrl })).toBe(meetingUrl)
    })
  })

  // The passcode and fallback rules are exactly as they were before the
  // removal; these cases hold them in place.
  describe("the passcode and the fallbacks", () => {
    it("prefers passwordEnc over the plaintext password", async () => {
      expect(await join({ ...config, password: "123" })).toBe("https://zoom.us/j/123456789?pwd=abc")
    })

    it("falls back to the plaintext password, percent-encoded", async () => {
      expect(await join({ meetingId: "m1", meetingNumber: "123456789", password: "a b+c" })).toBe(
        "https://zoom.us/j/123456789?pwd=a%20b%2Bc",
      )
    })

    // With no passcode, a meeting number wins over meetingUrl. That order came
    // in with the name prefill (April 2026) and the removal keeps it; preferring
    // meetingUrl here would change which link opens (see buildExternalZoomUrl).
    it("opens the bare join URL, not meetingUrl, when there is a meeting number but no passcode", async () => {
      const meetingUrl = "https://us02web.zoom.us/j/123456789"
      expect(await join({ meetingId: "m1", meetingNumber: "123456789", meetingUrl })).toBe(
        "https://zoom.us/j/123456789",
      )
    })
  })

  describe("the request log line", () => {
    // The exact shape, so no name field of any kind (the name itself, or a
    // flag saying one was passed) can come back without failing here.
    it("carries no name field, even when a caller passes a name", async () => {
      await join({ ...config, userName: "Jen" } as ZoomJoinConfig)
      expect(joinLogPayload()).toEqual({ mid: "m1", zid: "123456789", ts: expect.any(Number) })
    })
  })
})
