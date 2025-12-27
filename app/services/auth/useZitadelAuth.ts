/**
 * useZitadelAuth Hook
 *
 * Custom hook for Zitadel OAuth authentication using expo-auth-session.
 * Handles the complete OAuth flow with PKCE, token exchange, and secure storage.
 */

import { useCallback, useEffect, useState } from "react"
import * as AuthSession from "expo-auth-session"
import * as SecureStore from "expo-secure-store"
import * as WebBrowser from "expo-web-browser"

import { useAuthenticationStore } from "@/models"
import { logger } from "@/utils/logger"

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
export function useZitadelAuth(): UseZitadelAuthResult {
  const authStore = useAuthenticationStore()
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
    discoveryDocument
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
        discoveryDocument
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
        expiresAt
      )

      // Ensure OAuth login clears anonymous status
      authStore.setProp("isAnonymous", false)

      if (userInfo) {
        authStore.setUserId(userInfo.sub)
        if (userInfo.email) {
          authStore.setAuthEmail(userInfo.email)
        }
      }

      log.info("Authentication complete", { userId: userInfo?.sub })
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
      SecureStore.setItemAsync(STORAGE_KEYS.ACCESS_TOKEN, tokens.access_token),
      tokens.refresh_token &&
        SecureStore.setItemAsync(STORAGE_KEYS.REFRESH_TOKEN, tokens.refresh_token),
      tokens.id_token && SecureStore.setItemAsync(STORAGE_KEYS.ID_TOKEN, tokens.id_token),
      SecureStore.setItemAsync(STORAGE_KEYS.EXPIRES_AT, expiresAt.toString()),
    ])
  }

  /**
   * Clear all stored tokens
   */
  const clearStoredTokens = async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(STORAGE_KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
      SecureStore.deleteItemAsync(STORAGE_KEYS.ID_TOKEN),
      SecureStore.deleteItemAsync(STORAGE_KEYS.EXPIRES_AT),
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
  }, [authStore])

  /**
   * Logout and clear all tokens
   */
  const logout = useCallback(async () => {
    setIsLoading(true)
    log.info("Logging out")

    try {
      // Revoke tokens if we have them
      const accessToken = await SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN)
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
    const refreshToken = await SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN)

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
        discoveryDocument
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
        expiresAt
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
  authStore: ReturnType<typeof useAuthenticationStore>
): Promise<boolean> {
  try {
    const [accessToken, refreshToken, idToken, expiresAtStr] = await Promise.all([
      SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN),
      SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN),
      SecureStore.getItemAsync(STORAGE_KEYS.ID_TOKEN),
      SecureStore.getItemAsync(STORAGE_KEYS.EXPIRES_AT),
    ])

    if (accessToken && expiresAtStr) {
      const expiresAt = parseInt(expiresAtStr, 10)

      // Check if token is still valid
      if (expiresAt > Date.now()) {
        authStore.setTokens(accessToken, refreshToken || undefined, idToken || undefined, expiresAt)
        log.info("Restored auth from secure storage")
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
