import { Linking } from "react-native"
import { act, renderHook } from "@testing-library/react-native"

import { useZoomMeeting } from "./useZoomMeeting"
import type { ZoomJoinConfig } from "./zoomTypes"

// The hook reads two stores and logs. Plain objects stand in for the MST nodes
// so the test never loads the models graph (ConfigStore → api → db …). Both
// mocks are built inside their factories (jest.mock is hoisted above the
// imports) and reached through jest.requireMock below.
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

const config: ZoomJoinConfig = {
  meetingId: "m1",
  meetingNumber: "123456789",
  passwordEnc: "abc",
  userName: "Jen",
}

// ZoomJoinConfig.userName is a required string, so a TypeScript caller can't
// omit it. The hook still falls back to the profile name for a caller that
// does (plain JS, or a cast), and that fallback is the path under test.
const withoutUserName = { ...config, userName: undefined } as unknown as ZoomJoinConfig

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
    models.__profile.displayName = ""
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
  })

  afterEach(() => openURL.mockRestore())

  describe("the name prefill (`un=`)", () => {
    it("is the caller's name for a signed-in user", async () => {
      expect(await join(config)).toBe("https://zoom.us/j/123456789?pwd=abc&un=SmVu")
    })

    it("falls back to the profile display name for a signed-in user who supplies none", async () => {
      models.__profile.displayName = "Jen (12d)"
      const url = await join(withoutUserName)
      expect(url).toBe(`https://zoom.us/j/123456789?pwd=abc&un=${btoa("Jen (12d)")}`)
    })

    // THE REGRESSION. The guest rule used to sit on the profile fallback
    // only (`config.userName ?? zoomPrefillName(…)`), and a caller-supplied
    // name short-circuited it, so a guest joined under whatever name the
    // caller passed. The rule has to run on whichever name wins.
    it("is none for a guest, even when the caller supplies a name", async () => {
      models.__auth.isGuest = true
      expect(await join(config)).toBe("https://zoom.us/j/123456789?pwd=abc")
    })

    // The profile is not empty for a guest. ProfileStore.displayName appends the
    // owner's saved clean-time toggles (MMKV props, so they persist into guest
    // mode) even when shortName is empty, and an owner profile already in
    // memory still carries the name too. The rule is the protection, not a backup.
    it.each([" (12d)", "Jen (12d)"])(
      "is none for a guest whose profile display name is %p",
      async (displayName) => {
        models.__auth.isGuest = true
        models.__profile.displayName = displayName
        expect(await join(withoutUserName)).toBe("https://zoom.us/j/123456789?pwd=abc")
      },
    )
  })

  describe("the request log line", () => {
    it("records whether a name was supplied, not the name", async () => {
      await join(config)
      const payload = joinLogPayload()
      expect(payload).toMatchObject({ mid: "m1", zid: "123456789", hasUserName: true })
      expect(payload).not.toHaveProperty("userName")
      expect(JSON.stringify(payload)).not.toContain("Jen")
    })

    it("records that no name was supplied", async () => {
      await join(withoutUserName)
      expect(joinLogPayload()).toMatchObject({ hasUserName: false })
    })
  })
})
