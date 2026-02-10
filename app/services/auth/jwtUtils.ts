/**
 * JWT Utilities
 *
 * Helpers for parsing JWT tokens to extract claims.
 * Note: These do NOT verify signatures - just decode payloads.
 */

import { Buffer } from "buffer"

/**
 * Decode JWT payload without verification.
 *
 * JWTs are already verified by the auth server - we just need to read claims.
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const payload = parts[1]
    // Handle URL-safe base64
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const decoded = Buffer.from(base64, "base64").toString("utf-8")

    return JSON.parse(decoded)
  } catch {
    return null
  }
}

/**
 * Standard OIDC ID token claims with Auth0 custom metadata.
 *
 * Auth0 custom claims use a namespaced key to avoid collisions:
 * https://auth0.com/docs/secure/tokens/json-web-tokens/create-namespaced-custom-claims
 */
export interface IdTokenClaims {
  /** Subject (user ID) */
  "sub": string
  /** Issuer */
  "iss"?: string
  /** Audience */
  "aud"?: string | string[]
  /** Expiration time */
  "exp"?: number
  /** Issued at */
  "iat"?: number
  /** Email */
  "email"?: string
  /** Email verified */
  "email_verified"?: boolean
  /** Full name */
  "name"?: string
  /** Preferred username */
  "preferred_username"?: string
  /** Given name */
  "given_name"?: string
  /** Family name */
  "family_name"?: string
  /** Locale */
  "locale"?: string
  /**
   * Auth0 custom metadata claim (set via Auth0 Action).
   * Namespace must match the Action that injects the claim.
   */
  "https://recoverysky.app/metadata"?: Record<string, string>
}

/**
 * Extract SQLite encryption key from JWT custom claims.
 *
 * Looks for `sqliteKey` in the Auth0 custom metadata namespace.
 * Requires an Auth0 Action to inject `https://recoverysky.app/metadata`
 * into the ID token with the user's sqliteKey.
 */
export function extractSqliteKeyFromClaims(claims: IdTokenClaims): string | null {
  const metadata = claims["https://recoverysky.app/metadata"]
  return metadata?.sqliteKey ?? null
}
