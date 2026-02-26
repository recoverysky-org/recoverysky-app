/**
 * Auth0 Configuration
 *
 * OAuth configuration for Auth0 authentication provider.
 * Uses Auth0's Universal Login for secure native app authentication.
 */

export const AUTH0_CONFIG = {
  domain: process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? "",
  clientId: process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? "",
  audience: process.env.EXPO_PUBLIC_AUTH0_AUDIENCE ?? "",
  customScheme: "recoverysky-app",
  scopes: ["openid", "profile", "email", "offline_access"],
} as const

/**
 * User info from Auth0
 */
export interface Auth0UserInfo {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  nickname?: string
  given_name?: string
  family_name?: string
  picture?: string
  updated_at?: string
}
