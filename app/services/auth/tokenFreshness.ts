/**
 * The two token refreshers behind the proactive request gate.
 *
 * ORCHESTRATOR — intentionally has no automated coverage: it imports
 * `@/utils/logger` and drives native SDKs, so vitest can't load it. Every
 * decision it makes is delegated to tokenFreshnessLogic.ts, which IS covered.
 * Same split as syncLogic.ts vs services/sync/index.ts. Verify changes here
 * against the manual checklist in the design spec.
 *
 * Dependencies arrive by injection rather than import so this module never
 * reaches into MST or app.tsx, and so app/services/api/ can consume the result
 * without gaining an import edge that would make depcruise see a cycle.
 */

import {
  getDeviceJwt,
  isDeviceAuthInitialized,
  isJwtExpiredOrNearExpiry,
  isUsingApiKeyFallback,
  performAttestation,
} from "@/services/attestation/deviceToken"
import { logger } from "@/utils/logger"

import { getFreshCredentials } from "./auth0Client"
import { saveAuthCredentials } from "./secureStorage"
import {
  classifyRefreshError,
  createSingleFlight,
  shouldRefresh,
  withTimeout,
} from "./tokenFreshnessLogic"

const log = logger.child({ module: "tokenFreshness" })

/**
 * Refresh the access token when it has under a minute left. Cheap — one
 * network hop — so the margin can be tight, unlike the device lane.
 */
export const USER_TOKEN_SKEW_MS = 60 * 1000

/** Caps so one hung refresh can't stall every request behind it. */
export const USER_REFRESH_TIMEOUT_MS = 10 * 1000
export const DEVICE_REFRESH_TIMEOUT_MS = 15 * 1000

/** The slice of AuthenticationStore the user refresher touches. */
export interface UserRefresherStore {
  accessToken?: string
  refreshToken?: string
  idToken?: string
  expiresAt?: number
  isAnonymous: boolean
  setTokens(accessToken: string, refreshToken?: string, idToken?: string, expiresAt?: number): void
}

export interface UserRefresherDeps {
  authStore: UserRefresherStore
  /** Called once when the refresh token is proven dead. Drives forced logout. */
  onPermanentFailure: () => void
}

export interface DeviceRefresherDeps {
  /** Device id, or null before cold-start init has resolved one. */
  getDeviceId: () => string | null
}

/**
 * Refresher for the Auth0 access token (`Authorization: Bearer`).
 *
 * Returns the token to stamp on the outgoing request, or null when there
 * should be no Authorization header at all (anonymous, signed out, or the
 * refresh token is dead).
 */
export function createUserTokenRefresher(deps: UserRefresherDeps): {
  getToken: () => Promise<string | null>
  reset: () => void
} {
  const { authStore, onPermanentFailure } = deps

  /**
   * Latched once a refresh fails permanently. Without it every subsequent
   * request would retry a refresh we already know is dead — and during the
   * deferred-logout window (timer running) that could be a request every few
   * seconds for the length of a meeting.
   */
  let permanentlyFailed = false

  const refresh = createSingleFlight(async () => {
    const creds = await getFreshCredentials(USER_TOKEN_SKEW_MS / 1000)

    // Auth0 returns expiresAt in SECONDS; the rest of the app uses ms.
    const expiresAt = creds.expiresAt * 1000

    // CHANGED 2026-08-07: keep the stored refresh token when the response does
    // not carry a new one. Auth0 only returns a refresh token when it actually
    // rotates one, and passing undefined through blanked BOTH copies —
    // setTokens() assigns unconditionally and saveAuthCredentials() rewrites
    // the whole record. The session still refreshed fine (the SDK's own
    // keychain is the real source of truth) but AuthenticationStore.canRefresh
    // then reported false for a session that could refresh perfectly well.
    // Read before setTokens(), which is what would overwrite it.
    const refreshToken = creds.refreshToken ?? authStore.refreshToken

    authStore.setTokens(creds.accessToken, refreshToken, creds.idToken ?? undefined, expiresAt)

    // Write-back matters: without it the same refresh repeats on every cold
    // start, because setupRootStore hydrates from SecureStore and would keep
    // reading the old expiry.
    saveAuthCredentials({
      accessToken: creds.accessToken,
      refreshToken,
      idToken: creds.idToken ?? undefined,
      expiresAt,
    }).catch((err) => log.error("Failed to persist refreshed credentials", { error: String(err) }))

    log.info("Access token refreshed", {
      expiresIn: Math.round((expiresAt - Date.now()) / 1000 / 60) + " min",
    })

    return creds.accessToken
  })

  return {
    getToken: async () => {
      if (permanentlyFailed) return null
      if (authStore.isAnonymous) return null
      // Load-bearing, not defensive. A user who has never signed in has no
      // tokens at all, so without this the very first request would call
      // getFreshCredentials(), the SDK would throw NO_CREDENTIALS, and
      // classifyRefreshError() treats that as PERMANENT — which fires
      // onPermanentFailure() and force-logs-out someone who was never logged
      // in. Bail before the refresh, not inside it.
      if (!authStore.accessToken && !authStore.refreshToken) return null

      const current = authStore.accessToken ?? null
      if (!shouldRefresh(authStore.expiresAt, Date.now(), USER_TOKEN_SKEW_MS)) {
        return current
      }

      try {
        // On timeout we fall back to the current token and let the request go
        // out and fail on its own. Blocking would hang every call in the app.
        return await withTimeout(refresh(), USER_REFRESH_TIMEOUT_MS, current)
      } catch (err) {
        // Concurrent callers share one in-flight refresh (createSingleFlight),
        // so a permanent rejection lands in EVERY waiting caller's catch. Only
        // the first one may latch and eject: performForcedLogout() ends with
        // reset(), so a second pass would log the user out twice AND leave the
        // latch cleared, re-enabling the dead-refresh retries this latch exists
        // to stop.
        if (permanentlyFailed) return null

        if (classifyRefreshError(err) === "permanent") {
          log.error("Access token refresh failed permanently — forcing logout", {
            error: String(err),
          })
          permanentlyFailed = true
          onPermanentFailure()
          return null
        }

        log.warn("Access token refresh failed transiently — proceeding with current token", {
          error: String(err),
        })
        return current
      }
    },

    /** Clear the latch after a completed forced logout, so a re-login works. */
    reset: () => {
      permanentlyFailed = false
    },
  }
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
 * is a worse outcome than a few failed background fetches. Cold-start failure
 * is still fatal — that alert lives in app.tsx.
 */
export function createDeviceTokenRefresher(deps: DeviceRefresherDeps): {
  getToken: () => Promise<string | null>
} {
  const { getDeviceId } = deps

  const refresh = createSingleFlight(async () => {
    const deviceId = getDeviceId()
    if (!deviceId) return getDeviceJwt()

    const result = await performAttestation(deviceId)
    if (!result.ok) {
      log.error("Re-attestation failed — continuing with existing device token", {
        code: result.error.code,
        kind: result.error.kind,
        temporary: result.error.temporary,
      })
    }
    return getDeviceJwt()
  })

  return {
    getToken: async () => {
      // ADDED 2026-08-07: never drive attestation before cold-start init has
      // chosen a lane. Until then `isUsingApiKeyFallback()` is false and
      // `isJwtExpiredOrNearExpiry()` is true (no expiry recorded yet), which
      // looks exactly like "attested device, token expired" and sends us
      // straight into performAttestation. Outage mode is the live case: app.tsx
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
        // propagates rejections, and performAttestation() returning a result
        // object rather than throwing is not a guarantee we should depend on
        // from here. The user lane is already fully try/caught — this makes the
        // two symmetric.
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
