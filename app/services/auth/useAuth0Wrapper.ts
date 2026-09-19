/**
 * useAuth0Wrapper Hook
 *
 * Custom hook that wraps Auth0's useAuth0 hook to:
 * - Sync auth state to MST AuthenticationStore for API layer compatibility
 * - Handle anonymous login (Auth0 doesn't support this natively)
 * - Extract SQLite encryption key from JWT claims if present
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth0, WebAuthError, WebAuthErrorCodes } from "react-native-auth0"

import { translate } from "@/i18n"
import { useAuthenticationStore, useConfigStore } from "@/models"
import { setSqliteEncryptionKey, getCurrentSqliteKey } from "@/services/encryption/sqliteKey"
import { hashUserId, logger } from "@/utils/logger"

import { AUTH0_CONFIG, type Auth0UserInfo } from "./auth0"
import { classifyAuthError, isUserAbandonedAuth } from "./authErrorLogic"
import {
  decodeJwtPayload,
  extractSqliteKeyFromClaims,
  isUsableAccessToken,
  type IdTokenClaims,
} from "./jwtUtils"
import { saveAuthCredentials, clearAuthCredentials } from "./secureStorage"
import { reportUnusableToken } from "./unusableTokenHandler"

const log = logger.child({ module: "useAuth0Wrapper" })

/**
 * Pick what the login screen shows for a failed web-auth call. The two cases
 * we can give real advice for (browser closed by a relaunch, network) get an
 * i18n string; everything else keeps the SDK's message so the raw diagnostic
 * still reaches us via the "Auth error displayed to user" log line.
 * ADDED 2026-09-12 — see authErrorLogic.ts for the incident history.
 */
function displayMessageFor(err: unknown, fallback: string): string {
  const key = classifyAuthError(err)
  if (key === "browserTerminated") return translate("loginScreen:errorBrowserTerminated")
  if (key === "networkError") return translate("loginScreen:errorNetwork")
  return (err instanceof Error && err.message) || fallback
}

export interface UseAuth0WrapperOptions {
  /** Callback when SQLite encryption key from JWT differs from current key */
  onSqliteKeyChange?: (newKey: string) => Promise<void>
}

export interface UseAuth0WrapperResult {
  /** Initiate the OAuth login flow */
  login: () => Promise<void>
  /** Initiate the OAuth signup flow (opens Auth0 signup tab) */
  signup: () => Promise<void>
  /** Login as anonymous user (no OAuth) */
  loginAnonymously: () => void
  /** Logout and clear all tokens */
  logout: () => Promise<void>
  /** Whether an auth operation is in progress */
  isLoading: boolean
  /** Error message if auth failed */
  error: string | null
  /** Clear the error state */
  clearError: () => void
  /** Auth0 user info (null if not authenticated) */
  user: Auth0UserInfo | null
  /** Whether user is authenticated via Auth0 */
  isAuthenticated: boolean
}

/**
 * Hook for Auth0 authentication with MST store integration
 */
export function useAuth0Wrapper(options: UseAuth0WrapperOptions = {}): UseAuth0WrapperResult {
  const { onSqliteKeyChange } = options
  const authStore = useAuthenticationStore()
  const _configStore = useConfigStore()
  const [error, setError] = useState<string | null>(null)

  // Auth0 SDK hook
  const {
    authorize,
    clearSession,
    user,
    isLoading: auth0Loading,
    error: auth0Error,
    getCredentials,
    cancelWebAuth,
  } = useAuth0()

  // Track our own loading state for anonymous login
  const [localLoading, setLocalLoading] = useState(false)
  const isLoading = auth0Loading || localLoading

  // Guard: prevent user sync from re-populating MST during logout
  const isLoggingOut = useRef(false)

  // Sync Auth0 error to local state (ignore user-cancelled errors)
  // CHANGED 2026-09-19 (RS-022): "cancelled" now includes declining the
  // consent screen (ACCESS_DENIED / "User did not authorize the request"),
  // which was reaching the ERROR line below twice per tap. See
  // isUserAbandonedAuth.
  useEffect(() => {
    if (auth0Error) {
      if (isUserAbandonedAuth(auth0Error)) {
        log.info("Auth0 operation cancelled or declined by user")
        return
      }
      log.error("Auth0 error", { error: auth0Error.message })
      // CHANGED 2026-09-12: route through displayMessageFor so BROWSER_TERMINATED
      // and network failures get the actionable copy instead of the raw SDK text.
      setError(displayMessageFor(auth0Error, "Authentication failed"))
    }
  }, [auth0Error])

  // Sync Auth0 user state to MST store
  // Note: We intentionally only depend on `user` - other deps are stable refs
  useEffect(() => {
    const syncUserToStore = async () => {
      if (isLoggingOut.current) return
      if (user) {
        // Hashed, not raw: these two lines were the only place the unhashed
        // Auth0 sub reached Loki. CHANGED 2026-09-04: every record now carries
        // the same hash via logger context (see hashUserId.ts), so logging it
        // here is belt-and-braces for the sign-in moment itself.
        log.info("Syncing Auth0 user to MST store", { userId: hashUserId(user.sub) })

        try {
          // Get credentials (tokens) from Auth0
          const credentials = await getCredentials()

          if (credentials) {
            // ADDED 2026-09-10: the SDK renews with the stored refresh token,
            // and a refresh token from an audience-less login (TestFlight
            // builds 3.12.1–4.1.6 shipped without EXPO_PUBLIC_AUTH0_AUDIENCE)
            // renews into an opaque token the API can never accept. Do not
            // store it; eject through the same path as a dead refresh token.
            // setAuthReady() still runs so the splash never waits on a session
            // that is being torn down — forced logout flips isAuthenticated
            // and routes to Login on its own.
            const check = isUsableAccessToken(credentials.accessToken, {
              audience: AUTH0_CONFIG.audience,
            })
            if (!check.ok) {
              const handled = reportUnusableToken(check.reason)
              log.error("Auth0 SDK returned unusable access token — signing out", {
                source: "sdk-sync",
                reason: check.reason,
                tokenLength: credentials.accessToken.length,
                tokenSegments: credentials.accessToken.split(".").length,
                handled,
              })
              authStore.setAuthReady()
              return
            }

            // Auth0 SDK returns expiresAt as UNIX timestamp (seconds)
            // Convert to milliseconds for JavaScript Date compatibility
            const expiresAt = credentials.expiresAt * 1000

            // Update MST store with tokens
            // Auth0 SDK may return null for optional fields; coerce to undefined for MST
            authStore.setTokens(
              credentials.accessToken,
              credentials.refreshToken ?? undefined,
              credentials.idToken ?? undefined,
              expiresAt,
            )

            // Clear anonymous flag for OAuth users
            authStore.setProp("isAnonymous", false)

            // Set user info
            authStore.setUserId(user.sub)
            if (user.email) {
              authStore.setAuthEmail(user.email)
            }

            // Persist credentials to SecureStore for instant restore on next cold start.
            // CHANGED 2026-09-14: the ID token is deliberately left out — it is
            // only needed right here (handleSqliteKeyFromJwt below) and its
            // size pushed the record past SecureStore's 2048-byte limit.
            saveAuthCredentials({
              accessToken: credentials.accessToken,
              refreshToken: credentials.refreshToken ?? undefined,
              expiresAt,
            }).catch((err) =>
              log.error("Failed to persist auth credentials", { error: String(err) }),
            )

            // Auth initialization complete — credentials are now in MST
            authStore.setAuthReady()

            // Check for SQLite encryption key in JWT claims
            if (credentials.idToken) {
              await handleSqliteKeyFromJwt(credentials.idToken)
            }

            log.info("Auth state synced to MST store", { userId: hashUserId(user.sub) })
          }
        } catch (err) {
          log.error("Failed to sync credentials to store", { error: String(err) })
        }
      }
    }

    syncUserToStore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // When Auth0 SDK finishes loading: if no user, auth is resolved (no session to restore)
  useEffect(() => {
    if (!auth0Loading && !user && !isLoggingOut.current && !authStore.authReady) {
      log.info("Auth0 resolved without user, auth ready")
      authStore.setAuthReady()
      clearAuthCredentials().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth0Loading, user])

  /**
   * Extract SQLite key from JWT claims and handle rekey if needed
   */
  const handleSqliteKeyFromJwt = async (idToken: string) => {
    try {
      const claims = decodeJwtPayload<IdTokenClaims>(idToken)
      if (claims) {
        const jwtSqliteKey = extractSqliteKeyFromClaims(claims)
        if (jwtSqliteKey) {
          const currentKey = await getCurrentSqliteKey()
          if (currentKey !== jwtSqliteKey) {
            log.info("SQLite key from JWT differs from current key, triggering rekey")
            if (onSqliteKeyChange) {
              await onSqliteKeyChange(jwtSqliteKey)
            } else {
              // Fallback: just save the key (requires app restart for rekey)
              await setSqliteEncryptionKey(jwtSqliteKey)
            }
          } else {
            log.debug("SQLite key from JWT matches current key")
          }
        }
      }
    } catch (err) {
      log.error("Failed to extract SQLite key from JWT", { error: String(err) })
    }
  }

  /**
   * Initiate the OAuth login flow
   */
  const login = useCallback(async () => {
    log.info("Starting Auth0 login flow")
    setError(null)

    try {
      // Cancel any stale/interrupted login transactions (iOS only)
      try {
        await cancelWebAuth()
      } catch {
        // Ignore - cancelWebAuth may fail if no transaction exists
      }

      await authorize(
        { scope: AUTH0_CONFIG.scopes.join(" "), audience: AUTH0_CONFIG.audience },
        { customScheme: AUTH0_CONFIG.customScheme },
      )
      log.info("Auth0 login flow completed")
    } catch (err) {
      // CHANGED 2026-09-19 (RS-022): also covers a declined consent screen.
      if (isUserAbandonedAuth(err)) {
        log.info("Login cancelled or declined by user")
        return
      }
      const message = err instanceof Error ? err.message : "Login failed"
      log.error("Auth0 login failed", { error: message })
      // CHANGED 2026-09-12: the log keeps the raw SDK message; the user sees the
      // friendlier mapped copy when we have one (see displayMessageFor).
      setError(displayMessageFor(err, message))
    }
  }, [authorize])

  /**
   * Initiate the OAuth signup flow (opens Auth0 signup tab)
   */
  const signup = useCallback(async () => {
    log.info("Starting Auth0 signup flow")
    setError(null)

    try {
      try {
        await cancelWebAuth()
      } catch {
        // Ignore - cancelWebAuth may fail if no transaction exists
      }

      await authorize(
        {
          scope: AUTH0_CONFIG.scopes.join(" "),
          audience: AUTH0_CONFIG.audience,
          additionalParameters: { screen_hint: "signup" },
        },
        { customScheme: AUTH0_CONFIG.customScheme },
      )
      log.info("Auth0 signup flow completed")
    } catch (err) {
      // CHANGED 2026-09-19 (RS-022): also covers a declined consent screen.
      if (isUserAbandonedAuth(err)) {
        log.info("Signup cancelled or declined by user")
        return
      }
      const message = err instanceof Error ? err.message : "Signup failed"
      log.error("Auth0 signup failed", { error: message })
      // CHANGED 2026-09-12: the log keeps the raw SDK message; the user sees the
      // friendlier mapped copy when we have one (see displayMessageFor).
      setError(displayMessageFor(err, message))
    }
  }, [authorize])

  /**
   * Login as anonymous user (no OAuth required)
   */
  const loginAnonymously = useCallback(() => {
    log.info("Anonymous login")
    setLocalLoading(true)
    setError(null)

    try {
      authStore.loginAnonymously()
      log.info("Anonymous login complete")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Anonymous login failed"
      log.error("Anonymous login failed", { error: message })
      setError(message)
    } finally {
      setLocalLoading(false)
    }
  }, [authStore])

  /**
   * Logout and clear all tokens.
   *
   * Uses clearSession to revoke the Auth0 web session (prevents auto-login
   * on next sign-in). iOS shows a system "Sign In" dialog for this — if the
   * user cancels it, the logout is aborted gracefully.
   */
  const logout = useCallback(async () => {
    log.info("Logging out")
    setError(null)
    isLoggingOut.current = true

    try {
      // Clear Auth0 web session (requires browser redirect)
      if (user && !authStore.isAnonymous) {
        await clearSession({}, { customScheme: AUTH0_CONFIG.customScheme })
        log.info("Auth0 session cleared")
      }

      // Clear MST store and SecureStore
      authStore.logout()
      clearAuthCredentials().catch((err) =>
        log.error("Failed to clear auth credentials", { error: String(err) }),
      )
      log.info("Logout complete")
    } catch (err) {
      // User cancelled the iOS browser dialog — abort logout
      if (err instanceof WebAuthError && err.type === WebAuthErrorCodes.USER_CANCELLED) {
        log.info("Logout cancelled by user")
        return
      }

      const message = err instanceof Error ? err.message : "Logout failed"
      log.error("Logout failed", { error: message })
      // Still clear local state on unexpected errors
      authStore.logout()
      clearAuthCredentials().catch(() => {})
    } finally {
      isLoggingOut.current = false
    }
  }, [user, authStore, clearSession])

  /**
   * Clear the error state
   */
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    login,
    signup,
    loginAnonymously,
    logout,
    isLoading,
    error,
    clearError,
    user: user as Auth0UserInfo | null,
    isAuthenticated: !!user,
  }
}

/**
 * Load stored auth state on app startup
 *
 * Auth0 SDK handles token persistence internally, so this is mainly for
 * syncing to MST store. Call this from app initialization.
 */
export async function loadStoredAuth0(
  authStore: ReturnType<typeof useAuthenticationStore>,
): Promise<boolean> {
  log.info("loadStoredAuth0() - Auth0 SDK handles token persistence internally")

  // Auth0 SDK automatically restores session on mount
  // This function is kept for API compatibility but doesn't need to do much
  // The useAuth0Wrapper hook will sync state when user becomes available

  // Check if we have a deviceId for anonymous users
  if (authStore.isAnonymous && authStore.deviceId) {
    log.info("Anonymous user session restored")
    return true
  }

  return false
}
