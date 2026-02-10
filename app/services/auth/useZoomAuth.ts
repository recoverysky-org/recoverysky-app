/**
 * useZoomAuth Hook
 *
 * Custom hook for Zoom OAuth authentication.
 * Uses server-side token exchange (client_secret stays on server).
 *
 * Flow:
 * 1. App generates nonce, stores in SecureStore
 * 2. Opens browser to server OAuth start endpoint
 * 3. Server handles Zoom OAuth and token exchange
 * 4. Server redirects to app with tokens via deep link
 * 5. App verifies nonce and stores tokens in encrypted SQLite
 */

import { useCallback, useEffect, useState } from "react"
import * as Linking from "expo-linking"
import * as WebBrowser from "expo-web-browser"

import { zoomAuthRepo, type ZoomAuthRecord } from "@/db"
import { useAuthenticationStore, useConfigStore } from "@/models"
import { logger } from "@/utils/logger"

import * as SecureStorage from "./secureStorage"
import {
  ZOOM_OAUTH_CONFIG,
  ZOOM_API,
  ZOOM_NONCE_KEY,
  buildOAuthStartUrl,
  encodeOAuthState,
  decodeOAuthState,
  generateNonce,
  type ZoomOAuthState,
  type ZoomOAuthCallbackParams,
  type ZoomUserInfo,
} from "./zoomOAuth"
import { getZakToken as fetchZakToken } from "../zak"

const log = logger.child({ module: "useZoomAuth" })

export interface UseZoomAuthResult {
  /** Initiate Zoom OAuth login flow */
  connect: () => Promise<void>
  /** Disconnect Zoom account (clear tokens) */
  disconnect: () => Promise<void>
  /** Refresh access token using refresh token */
  refresh: () => Promise<boolean>
  /** Get ZAK token for meeting join (refreshes if needed) */
  getZakToken: () => Promise<string | null>
  /** Whether Zoom is connected */
  isConnected: boolean
  /** Connected Zoom auth record */
  zoomAuth: ZoomAuthRecord | null
  /** Loading state */
  isLoading: boolean
  /** Error message */
  error: string | null
  /** Clear the error state */
  clearError: () => void
  /** Reload zoom auth state from database */
  reload: () => Promise<void>
}

/**
 * Hook for Zoom OAuth authentication
 */
export function useZoomAuth(): UseZoomAuthResult {
  const authStore = useAuthenticationStore()
  const configStore = useConfigStore()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomAuth, setZoomAuth] = useState<ZoomAuthRecord | null>(null)

  /**
   * Load Zoom auth from database
   */
  const loadZoomAuth = useCallback(async () => {
    if (!authStore.deviceId) return
    try {
      const result = await zoomAuthRepo.findById(authStore.deviceId)
      if (result.ok) {
        setZoomAuth(result.value)
      } else {
        log.error("Failed to load zoom auth", { error: String(result.error) })
      }
    } catch (err) {
      log.error("Error loading zoom auth", { error: String(err) })
    }
  }, [authStore.deviceId])

  // Load auth on mount
  useEffect(() => {
    loadZoomAuth()
  }, [loadZoomAuth])

  /**
   * Handle deep link callback from OAuth flow
   */
  const handleDeepLink = useCallback(
    async (url: string) => {
      log.info("handleDeepLink called", {
        url,
        expectedPrefix: ZOOM_OAUTH_CONFIG.appRedirectUri,
        isMatch: url.startsWith(ZOOM_OAUTH_CONFIG.appRedirectUri),
      })

      // Check if this is our Zoom OAuth callback
      if (!url.startsWith(ZOOM_OAUTH_CONFIG.appRedirectUri)) {
        log.info("Not a Zoom OAuth callback, ignoring")
        return
      }

      log.info("Processing Zoom OAuth callback")
      setIsLoading(true)

      try {
        // Parse URL parameters
        const urlObj = new URL(url)
        const params: Partial<ZoomOAuthCallbackParams> = {}
        urlObj.searchParams.forEach((value, key) => {
          ;(params as Record<string, string>)[key] = value
        })

        // Check for errors
        if (params.error) {
          log.error("OAuth error from server", {
            error: params.error,
            description: params.error_description,
          })
          setError(params.error_description || params.error)
          setIsLoading(false)
          return
        }

        // Verify we have required params
        if (!params.access_token || !params.refresh_token || !params.state) {
          log.error("Missing required OAuth params", {
            hasAccessToken: !!params.access_token,
            hasRefreshToken: !!params.refresh_token,
            hasState: !!params.state,
          })
          setError("Invalid OAuth response")
          setIsLoading(false)
          return
        }

        // Verify nonce (CSRF protection)
        const storedNonce = await SecureStorage.getItemAsync(ZOOM_NONCE_KEY)
        const stateData = decodeOAuthState(params.state)

        if (!stateData || stateData.nonce !== storedNonce) {
          log.error("Nonce mismatch - possible CSRF attack", {
            storedNonce: storedNonce?.substring(0, 8),
            receivedNonce: stateData?.nonce?.substring(0, 8),
          })
          setError("Security verification failed. Please try again.")
          setIsLoading(false)
          return
        }

        log.info("OAuth state verified")

        // Calculate expiration
        const expiresIn = parseInt(params.expires_in || "3600", 10)
        const expiresAt = Date.now() + expiresIn * 1000

        // Fetch user info if not provided by server
        let zoomUserId = params.zoom_user_id || ""
        let zoomEmail = params.zoom_email || ""
        let zoomDisplayName = params.zoom_display_name || ""

        if (!zoomUserId) {
          const userInfo = await fetchZoomUserInfo(params.access_token)
          if (userInfo) {
            zoomUserId = userInfo.id
            zoomEmail = userInfo.email
            zoomDisplayName = userInfo.display_name
          }
        }

        // Store in encrypted SQLite
        // deviceId is guaranteed at this point since we're in a callback that requires auth
        const upsertResult = await zoomAuthRepo.upsert({
          id: authStore.deviceId!,
          accessToken: params.access_token,
          refreshToken: params.refresh_token,
          zoomUserId,
          zoomEmail,
          zoomDisplayName,
          expiresAt,
        })

        if (upsertResult.ok) {
          setZoomAuth(upsertResult.value)
          log.info("Zoom auth stored successfully", { zoomEmail })
        } else {
          log.error("Failed to store zoom auth", { error: String(upsertResult.error) })
          setError("Failed to save Zoom account")
        }

        // Clear the nonce
        await SecureStorage.deleteItemAsync(ZOOM_NONCE_KEY)
      } catch (err) {
        log.error("Error handling OAuth callback", { error: String(err) })
        setError("Failed to complete Zoom login")
      } finally {
        setIsLoading(false)
      }
    },
    [authStore.deviceId],
  )

  // Listen for deep links
  useEffect(() => {
    log.info("Setting up deep link listener", {
      expectedRedirectUri: ZOOM_OAUTH_CONFIG.appRedirectUri,
    })

    // Check for initial URL (app was opened via deep link)
    Linking.getInitialURL().then((url) => {
      log.info("Initial URL check", { url: url || "none" })
      if (url) handleDeepLink(url)
    })

    // Listen for deep links while app is running
    const subscription = Linking.addEventListener("url", (event) => {
      log.info("Deep link received", { url: event.url })
      handleDeepLink(event.url)
    })

    return () => {
      log.info("Removing deep link listener")
      subscription.remove()
    }
  }, [handleDeepLink])

  /**
   * Initiate the OAuth login flow
   */
  const connect = useCallback(async () => {
    if (!authStore.deviceId) {
      setError("Device not initialized")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Generate and store nonce for CSRF protection
      const nonce = generateNonce()
      await SecureStorage.setItemAsync(ZOOM_NONCE_KEY, nonce)

      // Build state parameter
      const state: ZoomOAuthState = {
        nonce,
        returnTo: "settings",
        deviceId: authStore.deviceId,
      }
      const encodedState = encodeOAuthState(state)

      // Build OAuth start URL
      const authUrl = buildOAuthStartUrl(encodedState, configStore.zoomSdkKey)

      log.info("Opening Zoom OAuth flow", {
        authUrl,
        redirectUri: ZOOM_OAUTH_CONFIG.appRedirectUri,
      })

      // Open browser for OAuth
      const result = await WebBrowser.openAuthSessionAsync(
        authUrl,
        ZOOM_OAUTH_CONFIG.appRedirectUri,
      )

      log.info("WebBrowser.openAuthSessionAsync returned", {
        type: result.type,
        url: "url" in result ? result.url : undefined,
      })

      if (result.type === "cancel") {
        log.info("OAuth cancelled by user")
        await SecureStorage.deleteItemAsync(ZOOM_NONCE_KEY)
      } else if (result.type === "dismiss") {
        log.info("OAuth dismissed")
      } else if (result.type === "success" && "url" in result) {
        // WebBrowser may return the URL directly on some platforms
        log.info("OAuth success with URL from WebBrowser", { url: result.url })
        handleDeepLink(result.url)
      }
      // Success case may also be handled by deep link listener
    } catch (err) {
      log.error("Error starting OAuth flow", { error: String(err) })
      setError("Failed to start Zoom login")
      await SecureStorage.deleteItemAsync(ZOOM_NONCE_KEY)
    } finally {
      setIsLoading(false)
    }
  }, [authStore.deviceId, handleDeepLink])

  /**
   * Disconnect Zoom account
   */
  const disconnect = useCallback(async () => {
    if (!authStore.deviceId) return

    setIsLoading(true)

    try {
      const result = await zoomAuthRepo.delete(authStore.deviceId)
      if (result.ok) {
        setZoomAuth(null)
        log.info("Zoom account disconnected")
      } else {
        log.error("Failed to disconnect", { error: String(result.error) })
        setError("Failed to disconnect Zoom account")
      }
    } catch (err) {
      log.error("Error disconnecting", { error: String(err) })
      setError("Failed to disconnect Zoom account")
    } finally {
      setIsLoading(false)
    }
  }, [authStore.deviceId])

  /**
   * Refresh access token
   * @deprecated Token refresh is now handled server-side by /zak/me endpoint.
   * This function is kept for interface compatibility but always returns false.
   */
  const refresh = useCallback(async (): Promise<boolean> => {
    log.warn("refresh() is deprecated - token refresh is handled by /zak/me")
    return false
  }, [])

  /**
   * Get ZAK token for meeting join via /zak/me endpoint.
   * Uses the standalone zak service which handles both authenticated and anonymous flows.
   * When zoomAuth is null, the service account is used (anonymous flow).
   */
  const getZakToken = useCallback(async (): Promise<string | null> => {
    const result = await fetchZakToken(zoomAuth, authStore.deviceId ?? undefined, configStore.zakApiKey)

    // Reload local state if tokens may have been refreshed
    if (result && zoomAuth) {
      await loadZoomAuth()
    }

    return result
  }, [zoomAuth, authStore.deviceId, configStore.zakApiKey, loadZoomAuth])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const reload = useCallback(async () => {
    await loadZoomAuth()
  }, [loadZoomAuth])

  return {
    connect,
    disconnect,
    refresh,
    getZakToken,
    isConnected: !!zoomAuth,
    zoomAuth,
    isLoading,
    error,
    clearError,
    reload,
  }
}

/**
 * Fetch user info from Zoom API
 */
async function fetchZoomUserInfo(accessToken: string): Promise<ZoomUserInfo | null> {
  try {
    const response = await fetch(ZOOM_API.userInfo, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      log.error("Failed to fetch Zoom user info", { status: response.status })
      return null
    }

    return await response.json()
  } catch (err) {
    log.error("Error fetching Zoom user info", { error: String(err) })
    return null
  }
}

/**
 * Load stored Zoom auth on app startup
 * Call this from app initialization to hydrate the state
 */
export async function loadStoredZoomAuth(deviceId: string): Promise<ZoomAuthRecord | null> {
  try {
    const result = await zoomAuthRepo.findById(deviceId)
    if (result.ok) {
      return result.value
    }
    return null
  } catch (err) {
    log.error("loadStoredZoomAuth failed", { error: String(err) })
    return null
  }
}
