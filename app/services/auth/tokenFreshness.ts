/**
 * The two token refreshers behind the proactive request gate.
 *
 * ORCHESTRATOR — intentionally has no automated coverage: it imports
 * `@/utils/logger` and drives native SDKs, so vitest can't load it. Every
 * decision it makes is delegated to tokenFreshnessLogic.ts, which IS covered.
 * Same split as syncLogic.ts vs services/sync/index.ts. Verify changes here
 * against the manual checklist in the design spec.
 * CHANGED 2026-09-10: the user lane itself is now covered too — see
 * userTokenRefresher.ts, which takes its I/O by injection. Only the device
 * lane below remains orchestrator-only.
 *
 * Dependencies arrive by injection rather than import so this module never
 * reaches into MST or app.tsx, and so app/services/api/ can consume the result
 * without gaining an import edge that would make depcruise see a cycle.
 */

import {
  establishDeviceToken,
  getDeviceJwt,
  isDeviceAuthInitialized,
  isJwtExpiredOrNearExpiry,
  isUsingApiKeyFallback,
} from "@/services/attestation/deviceToken"
import type { EstablishOutcome } from "@/services/attestation/deviceTokenLogic"
import { logger } from "@/utils/logger"

import { AUTH0_CONFIG } from "./auth0"
import { getFreshCredentials } from "./auth0Client"
import { saveAuthCredentials } from "./secureStorage"
import { createFailureBackoff, createSingleFlight, withTimeout } from "./tokenFreshnessLogic"
import {
  buildUserTokenRefresher,
  type UserRefresherDeps,
  type UserTokenRefresher,
} from "./userTokenRefresher"

const log = logger.child({ module: "tokenFreshness" })

/** Caps so one hung refresh can't stall every request behind it. */
export const DEVICE_REFRESH_TIMEOUT_MS = 15 * 1000

/**
 * Hold-off ladders after failed refreshes (see createFailureBackoff for the
 * failure modes these exist to stop). ADDED 2026-08-07: without them, refresh
 * was retried at REQUEST rate — the gate runs on every API call, so a backend
 * hiccup drove attestation (Apple-rate-limited Secure Enclave key generation
 * on every attempt) as fast as requests went out. CHANGED 2026-09-09: the App
 * Attest key IS persisted now and a re-attestation asserts against it, so the
 * ordinary failure no longer generates a key — but the assert fall-through
 * still can, and each attempt is a real Apple/Play round trip, so the ladder
 * stays.
 *
 * Device starts higher because each attempt is a multi-second Apple/Play
 * round trip and Apple throttles key generation; user attempts are one cheap
 * network hop. Both park at 15 min — the AppState foreground warm-up and the
 * next successful attempt are the recovery paths, and a stale token in the
 * meantime yields clean 401s, not thrown requests.
 */
export const DEVICE_REFRESH_BACKOFF_MS: readonly number[] = [30_000, 60_000, 300_000, 900_000]

export interface DeviceRefresherDeps {
  /** Device id, or null before cold-start init has resolved one. */
  getDeviceId: () => string | null
  /**
   * ADDED 2026-09-09: told the result of every background attempt so the
   * caller can flip ConfigStore.deviceAuthDegraded on/off (the "Connecting…"
   * banner). Optional: tests and the API-key lanes never care.
   */
  onOutcome?: (outcome: EstablishOutcome) => void
}

export {
  USER_REFRESH_BACKOFF_MS,
  USER_REFRESH_TIMEOUT_MS,
  USER_TOKEN_SKEW_MS,
  type UserRefresherDeps,
  type UserRefresherStore,
  type UserTokenRefresher,
} from "./userTokenRefresher"

/**
 * Refresher for the Auth0 access token (`Authorization: Bearer`).
 *
 * CHANGED 2026-09-10: the body lives in userTokenRefresher.ts with its I/O
 * injected so it can be unit-tested; this binds the real SDK call, the
 * SecureStore write, the logger and the configured audience. The public
 * shape is unchanged apart from the new markRejected().
 */
export function createUserTokenRefresher(deps: UserRefresherDeps): UserTokenRefresher {
  return buildUserTokenRefresher({
    ...deps,
    getFreshCredentials,
    persistCredentials: saveAuthCredentials,
    log,
    audience: AUTH0_CONFIG.audience,
  })
}

/**
 * Refresher for the device attestation token (`X-Device-Token`).
 *
 * Returns null when we're on the X-API-Key fallback (simulator, web, Android
 * dev build) — the gate stamps the API key instead.
 *
 * Deliberately NOT symmetric with the user lane: a permanent failure here logs
 * fatal and returns the stale token rather than ejecting anyone. Interrupting
 * someone mid-meeting because Apple's attestation service is having a bad day
 * is a worse outcome than a few failed background fetches.
 *
 * CHANGED 2026-09-09: cold-start failure is no longer fatal either. A
 * temporary failure now degrades (app opens on the "Connecting…" banner and
 * this refresher keeps trying); only a `blocked` outcome — unsupported
 * hardware, or a 401/403 on `POST /attest` — still raises the alert in
 * app.tsx.
 */
export function createDeviceTokenRefresher(deps: DeviceRefresherDeps): {
  getToken: () => Promise<string | null>
  noteColdStartFailure: (now?: number) => void
} {
  const { getDeviceId, onOutcome } = deps

  /**
   * ADDED 2026-08-07: hold-off between failed re-attestations. Without it a
   * failed attestation recorded NOTHING — jwtExpiresAt stayed stale, so
   * isJwtExpiredOrNearExpiry() stayed true and the very next request started a
   * fresh cycle. CHANGED 2026-09-09: establishDeviceToken() asserts against
   * the persisted key and never re-runs the native step inside one call, so
   * the storm this ladder was built for is now impossible by construction;
   * the ladder stays as defense in depth. Apple rate-limits key generation;
   * a throttled device then fails INITIAL attestation on the next cold start
   * and hits the fatal blocking alert in app.tsx — a transient backend
   * hiccup turned into a bricked launch. Same failure family as the pre-init
   * storm the deviceAuthInitialized flag closed; this closes the post-init
   * half.
   */
  const backoff = createFailureBackoff(DEVICE_REFRESH_BACKOFF_MS)

  const refresh = createSingleFlight(async () => {
    const deviceId = getDeviceId()
    // No deviceId is "not ready", not a failure — don't touch the ladder.
    if (!deviceId) return getDeviceJwt()

    // Outcome recording lives INSIDE the single-flight fn (mirroring the user
    // lane): when withTimeout hands the caller the stale fallback, the
    // attestation round trip is still running, and this is the only code that
    // observes how it eventually settled.
    try {
      const outcome = await establishDeviceToken(deviceId)
      onOutcome?.(outcome)
      if (outcome.status === "ok") {
        backoff.recordSuccess()
      } else {
        backoff.recordFailure(Date.now())
        // Documented lane policy: never eject anyone because attestation had
        // a bad day. `blocked` here (post-init) is treated like degraded —
        // keep the stale token, keep retrying; the cold-start path in app.tsx
        // is the only place a blocked outcome shows an alert.
        log.error(
          "Re-attestation did not produce a token — continuing with existing device token",
          {
            status: outcome.status,
            detail: outcome.status === "degraded" ? outcome.detail : outcome.reason,
          },
        )
      }
    } catch (err) {
      // establishDeviceToken returns outcome objects rather than throwing, but
      // (per the getToken catch below) that is not a guarantee we depend on.
      backoff.recordFailure(Date.now())
      throw err
    }
    return getDeviceJwt()
  })

  return {
    /**
     * ADDED 2026-09-09 (final review): seed the ladder from a cold start that
     * already failed. `initializeDeviceAuthorization()` runs its own
     * establishDeviceToken() outside this refresher, so after a degraded cold
     * start the backoff has recorded nothing and the very first API request
     * re-runs the whole ~87 s ladder seconds later — on iOS generating a
     * second Secure Enclave key right behind the first, which is exactly the
     * Apple rate-limit exposure this branch exists to remove.
     */
    noteColdStartFailure: (now: number = Date.now()) => backoff.recordFailure(now),

    getToken: async () => {
      // ADDED 2026-08-07: never drive attestation before cold-start init has
      // chosen a lane. Until then `isUsingApiKeyFallback()` is false and
      // `isJwtExpiredOrNearExpiry()` is true (no expiry recorded yet), which
      // looks exactly like "attested device, token expired" and sends us
      // straight into establishDeviceToken. Outage mode is the live case: app.tsx
      // returns early before initializeDeviceAuthorization() but still mounts
      // the provider tree and starts the /config poll, so those requests were
      // burning ~4 Apple App Attest key generations a minute for the length of
      // the outage — against Apple's rate limit, and stalling each request
      // DEVICE_REFRESH_TIMEOUT_MS on the way. Returning the (null) token here
      // restores the pre-gate behaviour: outage mode attempts no attestation.
      // Full accounting on `deviceAuthInitialized` in deviceToken.ts.
      if (!isDeviceAuthInitialized()) return getDeviceJwt()
      if (isUsingApiKeyFallback()) return null
      if (!isJwtExpiredOrNearExpiry()) return getDeviceJwt()

      // Backing off after recent failures — go out with the stale token (clean
      // 401) instead of driving another Apple/Play round trip per request.
      if (!backoff.shouldAttempt(Date.now())) return getDeviceJwt()

      try {
        return await withTimeout(refresh(), DEVICE_REFRESH_TIMEOUT_MS, getDeviceJwt())
      } catch (err) {
        // A refresher must NEVER throw into the auth gate. The gate awaits both
        // lanes in one Promise.all, so a rejection here would reject the whole
        // request and make every API method throw instead of returning a
        // GeneralApiProblem — which call sites destructure as `.kind`. That is
        // an app-wide blast radius from one bad attestation round trip.
        //
        // withTimeout only resolves its fallback on TIMEOUT; it deliberately
        // propagates rejections, and establishDeviceToken() returning an
        // outcome object rather than throwing is not a guarantee we should
        // depend on from here. The user lane is already fully try/caught —
        // this makes the two symmetric.
        //
        // Falling back to the stale token matches this lane's documented
        // policy: never eject anyone mid-meeting because attestation had a bad
        // day. A stale token yields a clean 401, not a thrown request.
        log.error("Device token refresh threw — falling back to existing token", {
          error: String(err),
        })
        return getDeviceJwt()
      }
    },
  }
}
