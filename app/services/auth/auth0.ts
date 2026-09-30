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
  /**
   * Per-request timeout for the SDK's JS Authentication API calls
   * (passwordless send/verify, token exchange), passed to `Auth0Provider`.
   * ADDED 2026-09-30: the SDK default is 10 s, and `/passwordless/start`
   * answers only after Auth0 has handed the email to its mailer — measured
   * at 5–9 s on the dev tenant (no email provider configured) and up to 19 s
   * through a VPN. Past 10 s the SDK aborted and the user saw "couldn't reach
   * the sign-in service" while the code email was already on its way (tenant
   * log `cls`, email received). 30 s gives a slow mailer or a slow network
   * path headroom without leaving a genuinely dead network hanging for long.
   */
  timeoutMs: 30_000,
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
