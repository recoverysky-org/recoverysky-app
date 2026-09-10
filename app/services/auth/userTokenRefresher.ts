/**
 * The Auth0 access-token refresher behind the proactive request gate.
 *
 * EXTRACTED 2026-09-10 from tokenFreshness.ts with its I/O injected, so
 * vitest can exercise the eject latch — the decision that signs a user out.
 * It has NO `@/` imports and no native imports at value level: the SDK call,
 * the SecureStore write and the logger all arrive through `UserRefresherIo`.
 * tokenFreshness.ts binds the real ones. Keep it that way (see CLAUDE.md
 * "Test Runner Split").
 *
 * Returns the token to stamp on the outgoing request, or null when there
 * should be no Authorization header at all (anonymous, signed out, or the
 * refresh token is dead).
 */

import { isUsableAccessToken } from "./jwtUtils"
import type { StoredAuthCredentials } from "./secureStorage"
import {
  classifyRefreshError,
  createFailureBackoff,
  createSingleFlight,
  shouldRefresh,
  UnusableTokenError,
  withTimeout,
} from "./tokenFreshnessLogic"

/**
 * Refresh the access token when it has under a minute left. Cheap — one
 * network hop — so the margin can be tight, unlike the device lane.
 */
export const USER_TOKEN_SKEW_MS = 60 * 1000

/** Cap so one hung refresh can't stall every request behind it. */
export const USER_REFRESH_TIMEOUT_MS = 10 * 1000

/**
 * Hold-off ladder after failed refreshes (see createFailureBackoff for the
 * failure modes it exists to stop). ADDED 2026-08-07: without it, refresh was
 * retried at REQUEST rate. Parks at 15 min — the AppState foreground warm-up
 * and the next successful attempt are the recovery paths.
 */
export const USER_REFRESH_BACKOFF_MS: readonly number[] = [15_000, 60_000, 300_000, 900_000]

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
  /** Called once when the session is proven dead. Drives forced logout. */
  onPermanentFailure: () => void
}

/** What the Auth0 credentials manager hands back. `expiresAt` is SECONDS. */
export interface FreshCredentials {
  accessToken: string
  refreshToken?: string | null
  idToken?: string | null
  expiresAt: number
}

export interface RefresherLog {
  info(message: string, attributes?: Record<string, unknown>): void
  warn(message: string, attributes?: Record<string, unknown>): void
  error(message: string, attributes?: Record<string, unknown>): void
}

/** The I/O this module refuses to import. Bound by tokenFreshness.ts. */
export interface UserRefresherIo {
  getFreshCredentials: (minTtlSec: number) => Promise<FreshCredentials>
  persistCredentials: (creds: StoredAuthCredentials) => Promise<void>
  log: RefresherLog
  /** AUTH0_CONFIG.audience; empty skips the audience rule (dev builds). */
  audience: string
}

export interface UserTokenRefresher {
  getToken: () => Promise<string | null>
  /** Clear the latch after a completed forced logout, so a re-login works. */
  reset: () => void
  /**
   * The API answered a bearer with a code meaning "this token can never
   * work" (token_malformed / token_claims / token_signature). Latches exactly
   * like a permanent refresh failure and ejects. The latch holds only until
   * performForcedLogout() calls reset() — so it is load-bearing during the
   * timer-deferred window (pendingLogout, no reset) and best-effort
   * otherwise; several concurrent 401s can each eject once. Documented, not
   * fixed: moving reset() to re-login is a bigger change than an OTA hotfix
   * warrants. ADDED 2026-09-10.
   */
  markRejected: () => void
}

export function buildUserTokenRefresher(
  deps: UserRefresherDeps & UserRefresherIo,
): UserTokenRefresher {
  const { authStore, onPermanentFailure, getFreshCredentials, persistCredentials, log, audience } =
    deps

  /**
   * Latched once a refresh fails permanently. Without it every subsequent
   * request would retry a refresh we already know is dead — and during the
   * deferred-logout window (timer running) that could be a request every few
   * seconds for the length of a meeting.
   */
  let permanentlyFailed = false

  /**
   * ADDED 2026-08-07: hold-off between failed renewals. RENEW_FAILED — the
   * SDK's bucket for invalid_grant, i.e. the ORDINARY revoked/expired refresh
   * token — is classified transient on purpose, which used to mean a dead
   * session re-attempted a full renewal on every single request, forever. The
   * backoff absorbs that cost so the classification can stay conservative.
   */
  const backoff = createFailureBackoff(USER_REFRESH_BACKOFF_MS)

  /**
   * Shared by the refresh path and markRejected(). Ejects at most once per
   * latch — but see markRejected(): performForcedLogout() resets the latch
   * synchronously, so in the immediate-logout path the guard is inert and
   * concurrent callers can each eject.
   */
  const latchAndEject = (message: string, attributes: Record<string, unknown>) => {
    if (permanentlyFailed) return
    log.error(message, attributes)
    permanentlyFailed = true
    onPermanentFailure()
  }

  const refresh = createSingleFlight(async () => {
    // Outcome recording lives INSIDE the single-flight fn, not in getToken's
    // catch: when withTimeout resolves the stale fallback, the underlying
    // refresh keeps running and settles after the caller has moved on — this
    // is the only place that observes that late outcome.
    try {
      const creds = await getFreshCredentials(USER_TOKEN_SKEW_MS / 1000)

      // ADDED 2026-09-10: refuse a renewed token that is not a JWT for our
      // audience BEFORE it reaches the store. Thrown, not returned, so the
      // existing permanent-failure catch in getToken handles it — no second
      // eject path. See isUsableAccessToken for the why.
      const check = isUsableAccessToken(creds.accessToken, { audience })
      if (!check.ok) {
        log.error("Auth0 SDK renewed into an unusable access token", {
          source: "refresh",
          reason: check.reason,
          tokenLength: creds.accessToken.length,
          tokenSegments: creds.accessToken.split(".").length,
        })
        throw new UnusableTokenError(check.reason)
      }

      // ADDED 2026-09-10 (final review): the session may have been ejected
      // while this refresh was in flight — a concurrent 401 tripping
      // markRejected(), or a deferred logout landing. Do not write a token
      // back into a store that was just cleared: it would flip
      // isAuthenticated true again and re-persist credentials the forced
      // logout deleted. Deliberately NOT keyed on `permanentlyFailed` —
      // performForcedLogout() ends with reset(), which clears that flag
      // synchronously, so it cannot be relied on here.
      if (!authStore.accessToken && !authStore.refreshToken) {
        log.warn("Refresh landed after the session was cleared — discarding", {
          source: "refresh",
        })
        backoff.recordSuccess()
        return null
      }

      // Auth0 returns expiresAt in SECONDS; the rest of the app uses ms.
      const expiresAt = creds.expiresAt * 1000

      // CHANGED 2026-08-07: keep the stored refresh token when the response does
      // not carry a new one. Auth0 only returns a refresh token when it actually
      // rotates one, and passing undefined through blanked BOTH copies —
      // setTokens() assigns unconditionally and persistCredentials() rewrites
      // the whole record. The session still refreshed fine (the SDK's own
      // keychain is the real source of truth) but AuthenticationStore.canRefresh
      // then reported false for a session that could refresh perfectly well.
      // Read before setTokens(), which is what would overwrite it.
      const refreshToken = creds.refreshToken ?? authStore.refreshToken

      authStore.setTokens(creds.accessToken, refreshToken, creds.idToken ?? undefined, expiresAt)

      // Write-back matters: without it the same refresh repeats on every cold
      // start, because setupRootStore hydrates from SecureStore and would keep
      // reading the old expiry.
      persistCredentials({
        accessToken: creds.accessToken,
        refreshToken,
        idToken: creds.idToken ?? undefined,
        expiresAt,
      }).catch((err) =>
        log.error("Failed to persist refreshed credentials", { error: String(err) }),
      )

      log.info("Access token refreshed", {
        expiresIn: Math.round((expiresAt - Date.now()) / 1000 / 60) + " min",
      })

      backoff.recordSuccess()
      return creds.accessToken
    } catch (err) {
      backoff.recordFailure(Date.now())
      throw err
    }
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

      // Backing off after recent failures — go out with what we have. A stale
      // Bearer yields a clean 401; hammering the renewal endpoint on every
      // request yields nothing but load.
      if (!backoff.shouldAttempt(Date.now())) {
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
        // to stop. CHANGED 2026-09-10 (final review): this guard only holds
        // while the latch survives, i.e. the timer-deferred path; in the
        // immediate-logout path reset() has already cleared it and each
        // waiting caller ejects again. Harmless (logout() empties the store
        // so the never-signed-in guard above bails next time) but noisy —
        // expect duplicate ERROR lines in Loki.
        if (permanentlyFailed) return null

        if (classifyRefreshError(err) === "permanent") {
          latchAndEject("Access token refresh failed permanently — forcing logout", {
            error: String(err),
          })
          return null
        }

        log.warn("Access token refresh failed transiently — proceeding with current token", {
          error: String(err),
        })
        return current
      }
    },

    reset: () => {
      permanentlyFailed = false
      // The dead session's failure ladder must not throttle the NEW session's
      // first refreshes after re-login.
      backoff.recordSuccess()
    },

    markRejected: () => {
      latchAndEject("Server rejected the bearer as unusable — forcing logout", {
        source: "server-401",
      })
    },
  }
}
