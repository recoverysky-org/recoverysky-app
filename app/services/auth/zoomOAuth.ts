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

/**
 * Zoom OAuth configuration
 */
export const ZOOM_OAUTH_CONFIG = {
  /** RecoverySky API server for OAuth endpoints */
  apiServer: "https://api.recoverysky.app",

  /** Deep link for receiving tokens after server-side exchange */
  appRedirectUri: "recoverysky-app://oauth/zoom/success",

  /** OAuth scopes needed for ZAK token retrieval */
  scopes: ["user:read:zak"],
} as const

/**
 * Server endpoints for Zoom OAuth
 * These endpoints handle the OAuth flow server-side (where client_secret lives)
 */
export const ZOOM_ENDPOINTS = {
  /** Start OAuth flow - redirects to Zoom authorize */
  oauthStart: `${ZOOM_OAUTH_CONFIG.apiServer}/oauth/zoom/start`,

  /** Token refresh endpoint (optional - can call Zoom directly) */
  tokenRefresh: `${ZOOM_OAUTH_CONFIG.apiServer}/oauth/zoom/refresh`,

  /** ZAK retrieval endpoint (optional - can call Zoom directly) */
  zakRetrieval: `${ZOOM_OAUTH_CONFIG.apiServer}/zak/me`,
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
 * Build OAuth start URL with state parameter
 */
export function buildOAuthStartUrl(state: string): string {
  const params = new URLSearchParams({ state })
  return `${ZOOM_ENDPOINTS.oauthStart}?${params.toString()}`
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
  crypto.getRandomValues(array)
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
