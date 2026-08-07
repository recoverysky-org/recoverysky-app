import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

import {
  classifyRefreshError,
  createSingleFlight,
  shouldRefresh,
  withTimeout,
} from "./tokenFreshnessLogic"

describe("shouldRefresh", () => {
  const NOW = 1_000_000
  const SKEW = 60_000

  it("refreshes when we have no expiry at all", () => {
    expect(shouldRefresh(undefined, NOW, SKEW)).toBe(true)
  })

  it("refreshes exactly at the skew boundary", () => {
    expect(shouldRefresh(NOW + SKEW, NOW, SKEW)).toBe(true)
  })

  it("does not refresh one ms outside the skew boundary", () => {
    expect(shouldRefresh(NOW + SKEW + 1, NOW, SKEW)).toBe(false)
  })

  it("refreshes one ms inside the skew boundary", () => {
    expect(shouldRefresh(NOW + SKEW - 1, NOW, SKEW)).toBe(true)
  })

  it("refreshes an already-expired token", () => {
    expect(shouldRefresh(NOW - 1, NOW, SKEW)).toBe(true)
  })

  it("does not refresh a token expiring far in the future", () => {
    expect(shouldRefresh(NOW + 86_400_000, NOW, SKEW)).toBe(false)
  })
})

describe("classifyRefreshError", () => {
  const permanent = [
    "NO_REFRESH_TOKEN",
    "NO_CREDENTIALS",
    "INVALID_CREDENTIALS",
    "DPOP_KEY_MISSING",
    "DPOP_KEY_MISMATCH",
  ]

  it.each(permanent)("classifies %s as permanent", (type) => {
    expect(classifyRefreshError({ type })).toBe("permanent")
  })

  const transient = [
    "NO_NETWORK",
    "RENEW_FAILED",
    "API_ERROR",
    "STORE_FAILED",
    "CRYPTO_EXCEPTION",
    "UNKNOWN_ERROR",
    "BIOMETRICS_FAILED",
    "LARGE_MIN_TTL",
  ]

  it.each(transient)("classifies %s as transient", (type) => {
    expect(classifyRefreshError({ type })).toBe("transient")
  })

  // This is the decision most likely to be "cleaned up" by a future
  // contributor. Misclassifying a transient failure as permanent logs a real
  // user out for nothing; the reverse merely keeps them signed in longer.
  it("defaults an unrecognized code to transient", () => {
    expect(classifyRefreshError({ type: "SOME_FUTURE_SDK_CODE" })).toBe("transient")
  })

  it("defaults a plain Error to transient", () => {
    expect(classifyRefreshError(new Error("boom"))).toBe("transient")
  })

  it("defaults a non-object throw to transient", () => {
    expect(classifyRefreshError("boom")).toBe("transient")
    expect(classifyRefreshError(null)).toBe("transient")
    expect(classifyRefreshError(undefined)).toBe("transient")
  })

  it("defaults a non-string type field to transient", () => {
    expect(classifyRefreshError({ type: 42 })).toBe("transient")
  })
})

describe("createSingleFlight", () => {
  it("invokes the underlying fn once for concurrent callers", async () => {
    let resolveInner: (value: string) => void = () => {}
    const inner = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveInner = resolve
        }),
    )
    const flight = createSingleFlight(inner)

    const a = flight()
    const b = flight()
    const c = flight()
    resolveInner("token")

    expect(await a).toBe("token")
    expect(await b).toBe("token")
    expect(await c).toBe("token")
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it("re-invokes after the previous call settles", async () => {
    const inner = vi.fn(async () => "token")
    const flight = createSingleFlight(inner)

    await flight()
    await flight()

    expect(inner).toHaveBeenCalledTimes(2)
  })

  it("clears the slot on rejection so the next call retries", async () => {
    const inner = vi.fn(async () => {
      throw new Error("nope")
    })
    const flight = createSingleFlight(inner)

    await expect(flight()).rejects.toThrow("nope")
    await expect(flight()).rejects.toThrow("nope")

    expect(inner).toHaveBeenCalledTimes(2)
  })

  it("does not leak a synchronous throw past the slot", async () => {
    const inner = vi.fn(() => {
      throw new Error("sync boom")
    }) as unknown as () => Promise<string>
    const flight = createSingleFlight(inner)

    await expect(flight()).rejects.toThrow("sync boom")
    await expect(flight()).rejects.toThrow("sync boom")
  })
})

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves through when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve("fresh"), 1000, "stale")).resolves.toBe("fresh")
  })

  it("returns the fallback when the timeout wins", async () => {
    const never = new Promise<string>(() => {})
    const raced = withTimeout(never, 1000, "stale")
    await vi.advanceTimersByTimeAsync(1000)
    await expect(raced).resolves.toBe("stale")
  })

  it("clears its timer when the promise wins", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout")
    await withTimeout(Promise.resolve("fresh"), 1000, "stale")
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it("propagates a rejection instead of returning the fallback", async () => {
    await expect(withTimeout(Promise.reject(new Error("bad")), 1000, "stale")).rejects.toThrow(
      "bad",
    )
  })
})
