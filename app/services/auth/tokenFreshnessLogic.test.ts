import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

import {
  classifyRefreshError,
  createFailureBackoff,
  createSingleFlight,
  shouldRefresh,
  withTimeout,
  UnusableTokenError,
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

  // A refreshed token that is not a JWT for our audience cannot be fixed by
  // refreshing again — the refresh token itself is bound to the wrong
  // audience. Only a new login helps, so this must eject.
  it("classifies UnusableTokenError as permanent", () => {
    expect(classifyRefreshError(new UnusableTokenError("not-jwt"))).toBe("permanent")
    expect(classifyRefreshError(new UnusableTokenError("wrong-audience"))).toBe("permanent")
  })

  it("carries the reason on the error", () => {
    const err = new UnusableTokenError("no-expiry")
    expect(err.reason).toBe("no-expiry")
    expect(err.name).toBe("UnusableTokenError")
    expect(err).toBeInstanceOf(Error)
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

describe("createFailureBackoff", () => {
  const DELAYS = [1000, 2000, 5000]
  const NOW = 1_000_000

  it("allows the first attempt", () => {
    const backoff = createFailureBackoff(DELAYS)
    expect(backoff.shouldAttempt(NOW)).toBe(true)
  })

  it("blocks after a failure until the first delay elapses", () => {
    const backoff = createFailureBackoff(DELAYS)
    backoff.recordFailure(NOW)
    expect(backoff.shouldAttempt(NOW)).toBe(false)
    expect(backoff.shouldAttempt(NOW + 999)).toBe(false)
    expect(backoff.shouldAttempt(NOW + 1000)).toBe(true)
  })

  it("escalates through the ladder on consecutive failures", () => {
    const backoff = createFailureBackoff(DELAYS)
    backoff.recordFailure(NOW)
    backoff.recordFailure(NOW + 1000)
    // Second failure uses the second delay: blocked until NOW+1000+2000.
    expect(backoff.shouldAttempt(NOW + 2999)).toBe(false)
    expect(backoff.shouldAttempt(NOW + 3000)).toBe(true)
  })

  it("parks on the last delay once the ladder is exhausted", () => {
    const backoff = createFailureBackoff(DELAYS)
    backoff.recordFailure(NOW)
    backoff.recordFailure(NOW)
    backoff.recordFailure(NOW)
    backoff.recordFailure(NOW) // fourth failure — beyond the ladder
    expect(backoff.shouldAttempt(NOW + 4999)).toBe(false)
    expect(backoff.shouldAttempt(NOW + 5000)).toBe(true)
  })

  it("resets the ladder on success", () => {
    const backoff = createFailureBackoff(DELAYS)
    backoff.recordFailure(NOW)
    backoff.recordFailure(NOW)
    backoff.recordSuccess()
    expect(backoff.shouldAttempt(NOW)).toBe(true)
    // And the next failure starts back at the FIRST delay.
    backoff.recordFailure(NOW)
    expect(backoff.shouldAttempt(NOW + 1000)).toBe(true)
  })

  // Indexing an empty ladder would compute blockedUntil = NaN, and
  // `now >= NaN` is false — silently blocking forever. Guard must hold.
  it("never blocks with an empty delay ladder", () => {
    const backoff = createFailureBackoff([])
    backoff.recordFailure(NOW)
    backoff.recordFailure(NOW)
    expect(backoff.shouldAttempt(NOW)).toBe(true)
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
