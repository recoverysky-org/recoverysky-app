/**
 * useZitadelAuth Hook
 *
 * Custom hook for Zitadel OAuth authentication using expo-auth-session.
 * Handles the complete OAuth flow with PKCE, token exchange, and secure storage.
 */

import { useCallback, useEffect, useState } from "react"
import * as AuthSession from "expo-auth-session"
import * as WebBrowser from "expo-web-browser"

import { useAuthenticationStore, useConfigStore } from "@/models"
import { getCurrentSqliteKey, setSqliteEncryptionKey } from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { decodeJwtPayload, extractSqliteKeyFromClaims, type ZitadelIdTokenClaims } from "./jwtUtils"
import * as SecureStorage from "./secureStorage"
import {
  ZITADEL_CONFIG,
  discoveryDocument,
  type ZitadelTokenResponse,
  type ZitadelUserInfo,
} from "./zitadel"

const log = logger.child({ module: "useZitadelAuth" })

// Ensure browser session is completed on app resume
WebBrowser.maybeCompleteAuthSession()

// Secure storage keys
const STORAGE_KEYS = {
  ACCESS_TOKEN: "zitadel_access_token",
  REFRESH_TOKEN: "zitadel_refresh_token",
  ID_TOKEN: "zitadel_id_token",
  EXPIRES_AT: "zitadel_expires_at",
} as const

export interface UseZitadelAuthOptions {
  /** Callback when SQLite encryption key from JWT differs from current key */
  onSqliteKeyChange?: (newKey: string) => Promise<void>
}

export interface UseZitadelAuthResult {
  /** Initiate the OAuth login flow */
  login: () => Promise<void>
  /** Login as anonymous user (no OAuth) */
  loginAnonymously: () => void
  /** Logout and clear all tokens */
  logout: () => Promise<void>
  /** Refresh the access token using refresh token */
  refreshTokens: () => Promise<boolean>
  /** Whether an auth operation is in progress */
  isLoading: boolean
  /** Error message if auth failed */
  error: string | null
  /** Clear the error state */
  clearError: () => void
}

/**
 * Hook for Zitadel OAuth authentication
 */
export function useZitadelAuth(options: UseZitadelAuthOptions = {}): UseZitadelAuthResult {
  const { onSqliteKeyChange } = options
  const authStore = useAuthenticationStore()
  const configStore = useConfigStore()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create the auth request with PKCE
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: ZITADEL_CONFIG.clientId,
      scopes: [...ZITADEL_CONFIG.scopes],
      redirectUri: ZITADEL_CONFIG.redirectUri,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
    },
    discoveryDocument,
  )

  // Handle the auth response
  useEffect(() => {
    if (response?.type === "success") {
      const { code } = response.params
      log.info("OAuth code received, exchanging for tokens")
      exchangeCodeForTokens(code)
    } else if (response?.type === "error") {
      log.error("OAuth error", { error: response.error?.message || "Unknown error" })
      setError(response.error?.message || "Authentication failed")
      setIsLoading(false)
    } else if (response?.type === "cancel") {
      log.info("OAuth cancelled by user")
      setIsLoading(false)
    }
  }, [response])

  /**
   * Exchange authorization code for tokens
   */
  const exchangeCodeForTokens = async (code: string) => {
    try {
      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId: ZITADEL_CONFIG.clientId,
          code,
          redirectUri: ZITADEL_CONFIG.redirectUri,
          extraParams: {
            code_verifier: request?.codeVerifier || "",
          },
        },
        discoveryDocument,
      )

      log.info("Token exchange successful")

      // Calculate expiration timestamp
      const expiresAt = Date.now() + (tokenResponse.expiresIn || 3600) * 1000

      // Store tokens securely
      await storeTokens({
        access_token: tokenResponse.accessToken,
        refresh_token: tokenResponse.refreshToken,
        id_token: tokenResponse.idToken,
        expires_in: tokenResponse.expiresIn || 3600,
        token_type: tokenResponse.tokenType,
      })

      // Fetch user info
      const userInfo = await fetchUserInfo(tokenResponse.accessToken)

      // Update MST store
      authStore.setTokens(
        tokenResponse.accessToken,
        tokenResponse.refreshToken,
        tokenResponse.idToken,
        expiresAt,
      )

      // Ensure OAuth login clears anonymous status
      authStore.setProp("isAnonymous", false)

      if (userInfo) {
        authStore.setUserId(userInfo.sub)
        if (userInfo.email) {
          authStore.setAuthEmail(userInfo.email)
        }
      }

      // Check for server-side SQLite encryption key in JWT metadata
      if (tokenResponse.idToken) {
        const claims = decodeJwtPayload<ZitadelIdTokenClaims>(tokenResponse.idToken)
        if (claims) {
          const jwtSqliteKey = extractSqliteKeyFromClaims(claims)
          if (jwtSqliteKey) {
            const currentKey = await getCurrentSqliteKey()
            if (currentKey !== jwtSqliteKey) {
              log.info("SQLite key from JWT differs from current key, triggering rekey")
              // Call rekey callback first (to re-encrypt DB), then update stored key
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
      }

      log.info("Authentication complete", { userId: userInfo?.sub })

      // Fetch server config after successful auth
      configStore.fetchConfig()
    } catch (err) {
      log.error("Token exchange failed", { error: String(err) })
      setError("Failed to complete authentication")
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Fetch user info from Zitadel
   */
  const fetchUserInfo = async (accessToken: string): Promise<ZitadelUserInfo | null> => {
    try {
      const response = await fetch(discoveryDocument.userInfoEndpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        log.error("Failed to fetch user info", { status: response.status })
        return null
      }

      return await response.json()
    } catch (err) {
      log.error("Error fetching user info", { error: String(err) })
      return null
    }
  }

  /**
   * Store tokens in secure storage
   */
  const storeTokens = async (tokens: ZitadelTokenResponse) => {
    const expiresAt = Date.now() + tokens.expires_in * 1000

    await Promise.all([
      SecureStorage.setItemAsync(STORAGE_KEYS.ACCESS_TOKEN, tokens.access_token),
      tokens.refresh_token &&
        SecureStorage.setItemAsync(STORAGE_KEYS.REFRESH_TOKEN, tokens.refresh_token),
      tokens.id_token && SecureStorage.setItemAsync(STORAGE_KEYS.ID_TOKEN, tokens.id_token),
      SecureStorage.setItemAsync(STORAGE_KEYS.EXPIRES_AT, expiresAt.toString()),
    ])
  }

  /**
   * Clear all stored tokens
   */
  const clearStoredTokens = async () => {
    await Promise.all([
      SecureStorage.deleteItemAsync(STORAGE_KEYS.ACCESS_TOKEN),
      SecureStorage.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
      SecureStorage.deleteItemAsync(STORAGE_KEYS.ID_TOKEN),
      SecureStorage.deleteItemAsync(STORAGE_KEYS.EXPIRES_AT),
    ])
  }

  /**
   * Initiate the OAuth login flow
   */
  const login = useCallback(async () => {
    if (!request) {
      log.warn("Auth request not ready")
      setError("Authentication not ready. Please try again.")
      return
    }

    setIsLoading(true)
    setError(null)

    log.info("Starting OAuth login flow")
    await promptAsync()
  }, [request, promptAsync])

  /**
   * Login as anonymous user (no OAuth required)
   */
  const loginAnonymously = useCallback(() => {
    log.info("Anonymous login")
    authStore.loginAnonymously()
    // Fetch server config after anonymous login
    configStore.fetchConfig()
  }, [authStore, configStore])

  /**
   * Logout and clear all tokens
   */
  const logout = useCallback(async () => {
    setIsLoading(true)
    log.info("Logging out")

    try {
      // Revoke tokens if we have them
      const accessToken = await SecureStorage.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN)
      if (accessToken) {
        try {
          await fetch(discoveryDocument.revocationEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              token: accessToken,
              client_id: ZITADEL_CONFIG.clientId,
            }).toString(),
          })
        } catch {
          // Revocation failure is not critical
          log.warn("Token revocation failed, continuing with logout")
        }
      }

      // Clear secure storage
      await clearStoredTokens()

      // Clear MST store
      authStore.logout()

      log.info("Logout complete")
    } catch (err) {
      log.error("Logout error", { error: String(err) })
    } finally {
      setIsLoading(false)
    }
  }, [authStore])

  /**
   * Refresh the access token using refresh token
   */
  const refreshTokens = useCallback(async (): Promise<boolean> => {
    const refreshToken = await SecureStorage.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN)

    if (!refreshToken) {
      log.warn("No refresh token available")
      return false
    }

    try {
      log.info("Refreshing access token")

      const tokenResponse = await AuthSession.refreshAsync(
        {
          clientId: ZITADEL_CONFIG.clientId,
          refreshToken,
        },
        discoveryDocument,
      )

      const expiresAt = Date.now() + (tokenResponse.expiresIn || 3600) * 1000

      await storeTokens({
        access_token: tokenResponse.accessToken,
        refresh_token: tokenResponse.refreshToken || refreshToken,
        id_token: tokenResponse.idToken,
        expires_in: tokenResponse.expiresIn || 3600,
        token_type: tokenResponse.tokenType,
      })

      authStore.setTokens(
        tokenResponse.accessToken,
        tokenResponse.refreshToken || refreshToken,
        tokenResponse.idToken,
        expiresAt,
      )

      log.info("Token refresh successful")
      return true
    } catch (err) {
      log.error("Token refresh failed", { error: String(err) })
      return false
    }
  }, [authStore])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    login,
    loginAnonymously,
    logout,
    refreshTokens,
    isLoading,
    error,
    clearError,
  }
}

/**
 * Load stored tokens into MST store on app startup
 * Call this from app initialization
 */
export async function loadStoredAuth(
  authStore: ReturnType<typeof useAuthenticationStore>,
  configStore?: { fetchConfig: () => void },
): Promise<boolean> {
  try {
    const [accessToken, refreshToken, idToken, expiresAtStr] = await Promise.all([
      SecureStorage.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN),
      SecureStorage.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
      SecureStorage.getItemAsync(STORAGE_KEYS.ID_TOKEN),
      SecureStorage.getItemAsync(STORAGE_KEYS.EXPIRES_AT),
    ])

    if (accessToken && expiresAtStr) {
      const expiresAt = parseInt(expiresAtStr, 10)

      // Check if token is still valid
      if (expiresAt > Date.now()) {
        authStore.setTokens(accessToken, refreshToken || undefined, idToken || undefined, expiresAt)
        log.info("Restored auth from secure storage")
        // Fetch server config after restoring auth
        configStore?.fetchConfig()
        return true
      } else {
        log.info("Stored token expired")
      }
    }

    return false
  } catch (err) {
    log.error("Failed to load stored auth", { error: String(err) })
    return false
  }
}
