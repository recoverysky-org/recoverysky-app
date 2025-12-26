/**
 * Zitadel OAuth Configuration
 *
 * OIDC configuration for Zitadel authentication provider.
 * Uses PKCE flow for secure native app authentication.
 */

export const ZITADEL_CONFIG = {
  domain: "auth.recoverysky.app",
  clientId: "352715597353582594",
  redirectUri: "recoverysky-hybrid://oauth-callback",
  scopes: ["openid", "profile", "email", "offline_access"],
} as const

/**
 * Zitadel OIDC Discovery Document endpoints
 * Based on: https://auth.recoverysky.app/.well-known/openid-configuration
 */
export const discoveryDocument = {
  authorizationEndpoint: `https://${ZITADEL_CONFIG.domain}/oauth/v2/authorize`,
  tokenEndpoint: `https://${ZITADEL_CONFIG.domain}/oauth/v2/token`,
  revocationEndpoint: `https://${ZITADEL_CONFIG.domain}/oauth/v2/revoke`,
  userInfoEndpoint: `https://${ZITADEL_CONFIG.domain}/oidc/v1/userinfo`,
}

/**
 * Token response from Zitadel
 */
export interface ZitadelTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  id_token?: string
  scope?: string
}

/**
 * User info response from Zitadel
 */
export interface ZitadelUserInfo {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  preferred_username?: string
  given_name?: string
  family_name?: string
  locale?: string
  updated_at?: number
}
