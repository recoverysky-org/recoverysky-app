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

import { useAuthenticationStore, useConfigStore } from "@/models"
import { setSqliteEncryptionKey, getCurrentSqliteKey } from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { AUTH0_CONFIG, type Auth0UserInfo } from "./auth0"
import { decodeJwtPayload, extractSqliteKeyFromClaims, type IdTokenClaims } from "./jwtUtils"
import { saveAuthCredentials, clearAuthCredentials } from "./secureStorage"

const log = logger.child({ module: "useAuth0Wrapper" })

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
  useEffect(() => {
    if (auth0Error) {
      if (
        auth0Error instanceof WebAuthError &&
        auth0Error.type === WebAuthErrorCodes.USER_CANCELLED
      ) {
        log.info("Auth0 operation cancelled by user")
        return
      }
      log.error("Auth0 error", { error: auth0Error.message })
      setError(auth0Error.message || "Authentication failed")
    }
  }, [auth0Error])

  // Sync Auth0 user state to MST store
  // Note: We intentionally only depend on `user` - other deps are stable refs
  useEffect(() => {
    const syncUserToStore = async () => {
      if (isLoggingOut.current) return
      if (user) {
        log.info("Syncing Auth0 user to MST store", { sub: user.sub })

        try {
          // Get credentials (tokens) from Auth0
          const credentials = await getCredentials()

          if (credentials) {
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

            // Persist credentials to SecureStore for instant restore on next cold start
            saveAuthCredentials({
              accessToken: credentials.accessToken,
              refreshToken: credentials.refreshToken ?? undefined,
              idToken: credentials.idToken ?? undefined,
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

            log.info("Auth state synced to MST store", { userId: user.sub })
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
      const message = err instanceof Error ? err.message : "Login failed"
      log.error("Auth0 login failed", { error: message })
      setError(message)
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
      const message = err instanceof Error ? err.message : "Signup failed"
      log.error("Auth0 signup failed", { error: message })
      setError(message)
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
      log.info("Anonymous login complete", { deviceId: authStore.deviceId?.slice(0, 8) + "..." })
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
      // Clear Auth0 web session (requires browser redirect on iOS)
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
    log.info("Anonymous user session restored", {
      deviceId: authStore.deviceId?.slice(0, 8) + "...",
    })
    return true
  }

  return false
}
