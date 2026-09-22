import { autorun, computed } from "mobx"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// react-native can't load under Vitest; the clock only needs AppState's
// listener, which we capture so the test can "foreground" the app.
const appStateListeners: ((state: string) => void)[] = []
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_: string, fn: (state: string) => void) => {
      appStateListeners.push(fn)
      return {
        remove: () => appStateListeners.splice(appStateListeners.indexOf(fn), 1),
      }
    },
  },
}))

const { getLocalDay } = await import("./localDay")

describe("getLocalDay", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 22, 23, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("re-runs observers when local midnight passes", () => {
    const seen: string[] = []
    const dispose = autorun(() => seen.push(getLocalDay()))

    vi.advanceTimersByTime(60 * 60 * 1000 + 1_000) // past midnight + slack
    dispose()

    expect(seen.at(-1)).toBe("2026-09-23")
  })

  it("resyncs on foreground after timers were suspended", () => {
    const seen: string[] = []
    const dispose = autorun(() => seen.push(getLocalDay()))

    // Simulate iOS suspending JS: the clock jumps two days, no timers fire.
    vi.setSystemTime(new Date(2026, 8, 24, 9, 0, 0))
    appStateListeners.forEach((fn) => fn("active"))
    dispose()

    expect(seen.at(-1)).toBe("2026-09-24")
  })

  it("does not recompute derived values within the same day", () => {
    let runs = 0
    const days = computed(() => {
      runs++
      return getLocalDay()
    })
    const dispose = autorun(() => days.get())
    const before = runs

    appStateListeners.forEach((fn) => fn("active")) // same-day foreground
    dispose()

    expect(runs).toBe(before)
  })

  it("stops its clock when nothing observes it", () => {
    const dispose = autorun(() => getLocalDay())
    expect(appStateListeners.length).toBe(1)
    dispose()
    expect(appStateListeners.length).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
