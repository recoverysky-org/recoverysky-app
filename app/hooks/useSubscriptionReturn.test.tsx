import { renderHook, act } from "@testing-library/react-native"

import { SUBSCRIPTION_RETURN_KEY, useSubscriptionReturn } from "./useSubscriptionReturn"

// The real module is MMKV-backed; a Map keeps these tests off the native
// module while still exercising the persist/clear contract the login
// round-trip depends on.
jest.mock("@/utils/storage", () => {
  const store = new Map<string, string>()
  return {
    __store: store,
    loadString: (key: string) => store.get(key) ?? null,
    saveString: (key: string, value: string) => {
      store.set(key, value)
      return true
    },
    remove: (key: string) => {
      store.delete(key)
    },
  }
})

const storage = jest.requireMock("@/utils/storage") as { __store: Map<string, string> }

describe("useSubscriptionReturn", () => {
  beforeEach(() => storage.__store.clear())

  it("consumes a returnTo present at mount", () => {
    const { result } = renderHook(() => useSubscriptionReturn("Attendance:new", jest.fn()))
    expect(result.current.consume()).toBe("Attendance:new")
  })

  // THE REGRESSION. SettingsScreen lives in a bottom-tab navigator, so it stays
  // mounted after its first focus — every later "Subscribe" tap from another tab
  // delivers returnTo as a param UPDATE, not a mount. The old inline
  // `useRef(route.params?.returnTo ?? ...)` only read params in its (once-only)
  // initializer, so the value was persisted but never consumable, and a paying
  // user was stranded on Settings instead of being sent back.
  it("consumes a returnTo that arrives after mount", () => {
    const { result, rerender } = renderHook(
      ({ returnTo }: { returnTo?: string }) => useSubscriptionReturn(returnTo, jest.fn()),
      { initialProps: { returnTo: undefined } as { returnTo?: string } },
    )

    expect(result.current.consume()).toBeNull()

    act(() => rerender({ returnTo: "Attendance:new" }))

    expect(result.current.consume()).toBe("Attendance:new")
  })

  // The paywall can bounce an anonymous user through Auth0, which restarts the
  // navigator and remounts this screen with no params — MMKV is what carries
  // the destination across that gap.
  it("falls back to the persisted value when no param is present", () => {
    storage.__store.set(SUBSCRIPTION_RETURN_KEY, "Meetings:inperson:meetingId:m1")
    const { result } = renderHook(() => useSubscriptionReturn(undefined, jest.fn()))
    expect(result.current.consume()).toBe("Meetings:inperson:meetingId:m1")
  })

  it("persists the param and clears it off the route", () => {
    const clearParam = jest.fn()
    renderHook(() => useSubscriptionReturn("Attendance:new", clearParam))
    expect(storage.__store.get(SUBSCRIPTION_RETURN_KEY)).toBe("Attendance:new")
    expect(clearParam).toHaveBeenCalledTimes(1)
  })

  it("consumes once — a second call yields nothing and storage is cleared", () => {
    const { result } = renderHook(() => useSubscriptionReturn("Attendance:new", jest.fn()))
    expect(result.current.consume()).toBe("Attendance:new")
    expect(result.current.consume()).toBeNull()
    expect(storage.__store.has(SUBSCRIPTION_RETURN_KEY)).toBe(false)
  })
})
