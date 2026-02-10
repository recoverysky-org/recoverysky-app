/**
 * Zoom OAuth Configuration
 *
 * OAuth configuration for Zoom account authentication.
 * Uses server-side token exchange (client_secret stays on server).
 *
 * Flow:
 * 1. App opens browser to server's OAuth start endpoint
 * 2. Server redirects to Zoom authorize
 * 3. User authorizes in Zoom
 * 4. Zoom redirects to server callback
 * 5. Server exchanges code for tokens
 * 6. Server redirects to app with tokens via deep link
 */

import * as Crypto from "expo-crypto"

/**
 * Zoom OAuth configuration (from environment variables)
 * Note: Expo requires EXPO_PUBLIC_ prefix for runtime access
 */
export const ZOOM_OAUTH_CONFIG = {
  /** Zoom OAuth client ID (public - safe to embed in app) */
  clientId: process.env.EXPO_PUBLIC_ZOOM_SDK_KEY ?? "",

  /** Zoom authorize endpoint */
  authorizeUrl: process.env.EXPO_PUBLIC_ZOOM_AUTHORIZE_URL ?? "https://zoom.us/oauth/authorize",

  /** Server callback URL (where Zoom sends the auth code) */
  serverCallbackUrl: process.env.EXPO_PUBLIC_ZOOM_SERVER_CALLBACK_URL ?? "",

  /** Deep link for receiving tokens after server-side exchange */
  appRedirectUri:
    process.env.EXPO_PUBLIC_ZOOM_APP_REDIRECT_URI ?? "recoverysky-app://oauth/zoom/success",

  /** OAuth scopes needed for ZAK token retrieval */
  scopes: ["user:read:zak"],
} as const

/**
 * Server endpoints for Zoom operations
 * These endpoints handle server-side operations where client_secret lives
 */
export const ZOOM_ENDPOINTS = {
  /** Unified ZAK endpoint - handles both authenticated and anonymous users */
  zakMe: process.env.EXPO_PUBLIC_ZAK_ME_ENDPOINT ?? "",

  /** API key for authenticating with zak service */
  apiKey: process.env.EXPO_PUBLIC_ZAK_API_KEY ?? "",
}

/**
 * Zoom API endpoints (called directly from app with access token)
 */
export const ZOOM_API = {
  /** User info endpoint */
  userInfo: "https://api.zoom.us/v2/users/me",

  /** ZAK token endpoint */
  zak: "https://api.zoom.us/v2/users/me/zak",

  /** Token refresh endpoint */
  tokenRefresh: "https://zoom.us/oauth/token",
}

/**
 * OAuth state payload for CSRF protection and return routing
 */
export interface ZoomOAuthState {
  /** Random nonce for CSRF protection */
  nonce: string
  /** Where to return in the app after OAuth */
  returnTo: "settings" | "prejoin"
  /** Device ID for token storage */
  deviceId: string
}

/**
 * Token response from Zoom OAuth
 */
export interface ZoomTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
}

/**
 * User info response from Zoom API
 */
export interface ZoomUserInfo {
  id: string
  first_name: string
  last_name: string
  display_name: string
  email: string
  type: number
  status: string
  pic_url?: string
}

/**
 * ZAK token response from Zoom API
 */
export interface ZoomZakResponse {
  token: string
}

/**
 * Response from /zak/me endpoint
 * Tokens are null when using service account (anonymous flow)
 */
export interface ZakMeResponse {
  zak: string
  access_token: string | null
  refresh_token: string | null
  expires_in: number | null
  was_refreshed: boolean
}

/**
 * Callback parameters received via deep link
 */
export interface ZoomOAuthCallbackParams {
  access_token: string
  refresh_token: string
  expires_in: string
  state: string
  zoom_user_id?: string
  zoom_email?: string
  zoom_display_name?: string
  error?: string
  error_description?: string
}

/**
 * SecureStore key for OAuth nonce
 */
export const ZOOM_NONCE_KEY = "zoom_oauth_nonce"

/**
 * Build Zoom OAuth authorize URL
 *
 * Goes directly to Zoom's authorize endpoint. The redirect_uri points to
 * our server's callback, which handles the code→token exchange (where
 * client_secret is needed) and then redirects to the app with tokens.
 */
export function buildOAuthStartUrl(state: string, clientId?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId || ZOOM_OAUTH_CONFIG.clientId,
    redirect_uri: ZOOM_OAUTH_CONFIG.serverCallbackUrl,
    state,
  })
  return `${ZOOM_OAUTH_CONFIG.authorizeUrl}?${params.toString()}`
}

/**
 * Encode OAuth state as base64 JSON
 */
export function encodeOAuthState(state: ZoomOAuthState): string {
  return btoa(JSON.stringify(state))
}

/**
 * Decode OAuth state from base64 JSON
 */
export function decodeOAuthState(encoded: string): ZoomOAuthState | null {
  try {
    return JSON.parse(atob(encoded)) as ZoomOAuthState
  } catch {
    return null
  }
}

/**
 * Generate a random nonce for CSRF protection
 */
export function generateNonce(): string {
  const array = new Uint8Array(32)
  Crypto.getRandomValues(array)
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
