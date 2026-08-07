/**
 * Pure decision logic for the proactive token freshness gate.
 *
 * PURE MODULE — no `@/` runtime imports, no React, no native modules. Vitest
 * cannot resolve the `@/` alias (see CLAUDE.md "Test Runner Split"), so
 * anything we want covered has to stay import-free. The I/O that composes these
 * helpers lives in tokenFreshness.ts, which is deliberately untested — same
 * split as syncLogic.ts vs services/sync/index.ts.
 */

/** Whether a failed credential renewal can plausibly succeed later. */
export type RefreshFailureKind = "transient" | "permanent"

/**
 * Auth0 `CredentialsManagerError.type` codes meaning the stored refresh token
 * can never work again — the user must sign in interactively.
 *
 * Everything NOT in this list is treated as transient, including codes we've
 * never seen. That default is load-bearing, not laziness: the two
 * misclassifications cost very different amounts. Calling a transient failure
 * permanent logs a real user out for nothing; calling a permanent failure
 * transient just keeps them signed in until the next attempt. RENEW_FAILED is
 * deliberately absent — the SDK uses it for network-ish renewal failures as
 * well as genuine rejections, and it is not worth ejecting someone over an
 * ambiguous code.
 */
export const PERMANENT_REFRESH_ERROR_CODES: readonly string[] = [
  "NO_REFRESH_TOKEN",
  "NO_CREDENTIALS",
  "INVALID_CREDENTIALS",
  "DPOP_KEY_MISSING",
  "DPOP_KEY_MISMATCH",
]

/**
 * Whether a token expiring at `expiresAt` should be refreshed now, given a
 * safety margin of `skewMs`.
 *
 * A missing expiry counts as "refresh" — we cannot prove the token is good, and
 * an unnecessary refresh is far cheaper than a request that 401s.
 */
export function shouldRefresh(expiresAt: number | undefined, now: number, skewMs: number): boolean {
  if (expiresAt === undefined) return true
  return expiresAt - skewMs <= now
}

/** Map an unknown throw from the Auth0 credentials manager to a retry verdict. */
export function classifyRefreshError(error: unknown): RefreshFailureKind {
  const code =
    typeof error === "object" && error !== null && "type" in error
      ? (error as { type: unknown }).type
      : undefined

  if (typeof code !== "string") return "transient"
  return PERMANENT_REFRESH_ERROR_CODES.includes(code) ? "permanent" : "transient"
}

/**
 * Wrap an async fn so concurrent callers share one in-flight execution.
 *
 * This is what stops the foreground attestation warm-up and the request-gate
 * from each kicking off their own multi-second Apple/Play round trip. The slot
 * is cleared once the promise settles (success OR failure) so a later call
 * retries rather than replaying a stale rejection forever.
 */
export function createSingleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null

  return () => {
    if (inFlight) return inFlight

    // Call fn() directly and synchronously (not deferred) so concurrent callers
    // within the same JS tick all receive the same promise, and so a caller can
    // resolve the returned promise synchronously after calling flight(). Deferring
    // via Promise.resolve().then(fn) would run fn on the next microtask, breaking
    // that: the caller's sync code runs first, but fn hasn't been called yet, so
    // the resolve function isn't assigned yet.
    // CHANGED 2026-08-06: The deferred form (Promise.resolve().then(fn)) was tried
    // and breaks concurrent tests because it schedules fn past the caller's sync
    // continuation, making it impossible for the caller to invoke the inner promise's
    // resolve before awaiting. Synchronous call + try/catch achieves the same goal
    // (synchronous throws become rejections that clear the slot) without the timing break.
    let basePromise: Promise<T>
    try {
      basePromise = fn()
    } catch (e) {
      basePromise = Promise.reject(e)
    }

    const promise = basePromise.finally(() => {
      if (inFlight === promise) inFlight = null
    })

    inFlight = promise
    return promise
  }
}

/** Escalating hold-off between failed refresh attempts. See createFailureBackoff. */
export interface FailureBackoff {
  /** Whether a new refresh attempt is allowed at `now`. */
  shouldAttempt: (now: number) => boolean
  /** Record a failed attempt; blocks further attempts per the delay ladder. */
  recordFailure: (now: number) => void
  /** Record a successful attempt; resets the ladder entirely. */
  recordSuccess: () => void
}

/**
 * Escalating backoff for refresh failures.
 *
 * ADDED 2026-08-07. The request gate made token refresh *request-driven*, and
 * nothing recorded that a refresh had just failed — so every request started a
 * brand-new attempt. On the device lane that meant an unbounded re-attestation
 * storm during any post-init backend failure: the 60 s /config poll alone
 * (4 fetchConfig retries per cycle) drove up to 16 Apple App Attest key
 * generations a minute, against Apple's rate limit — a throttled device then
 * fails *initial* attestation on the next cold start and lands on the fatal
 * blocking alert. On the user lane it meant a dead-but-transient-classified
 * refresh token (RENEW_FAILED — the SDK's bucket for invalid_grant, i.e. the
 * ordinary revoked-token case) re-attempted a full renewal on every request,
 * forever.
 *
 * Consecutive failures walk `delaysMs` left to right and stay parked on the
 * last entry; one success resets everything. Callers pass `now` explicitly —
 * same pattern as shouldRefresh — so this stays clock-free and testable.
 */
export function createFailureBackoff(delaysMs: readonly number[]): FailureBackoff {
  let failures = 0
  let blockedUntil = 0

  return {
    shouldAttempt: (now) => now >= blockedUntil,
    recordFailure: (now) => {
      // An empty ladder means "no backoff" — never block. Guarded because
      // indexing [-1] below would set blockedUntil to NaN, and `now >= NaN`
      // is false: an empty array would silently block FOREVER, the exact
      // opposite of what it reads as.
      if (delaysMs.length === 0) return
      failures += 1
      blockedUntil = now + delaysMs[Math.min(failures, delaysMs.length) - 1]
    },
    recordSuccess: () => {
      failures = 0
      blockedUntil = 0
    },
  }
}

/**
 * Resolve `fallback` if `promise` hasn't settled within `ms`.
 *
 * Every API call waits on the refreshers, so one hung refresh would stall the
 * entire app — a worse failure than the stale token we're replacing. A
 * rejection still propagates: only *slowness* yields the fallback, because the
 * caller needs to see a real failure to classify it.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
