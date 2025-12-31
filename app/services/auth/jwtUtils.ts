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
 * Zitadel ID token claims with custom metadata
 */
export interface ZitadelIdTokenClaims {
  /** Subject (user ID) */
  sub: string
  /** Issuer */
  iss?: string
  /** Audience */
  aud?: string | string[]
  /** Expiration time */
  exp?: number
  /** Issued at */
  iat?: number
  /** Email */
  email?: string
  /** Email verified */
  email_verified?: boolean
  /** Full name */
  name?: string
  /** Preferred username */
  preferred_username?: string
  /** Given name */
  given_name?: string
  /** Family name */
  family_name?: string
  /** Locale */
  locale?: string
  /**
   * Zitadel user metadata claim
   * Contains custom key-value pairs set on the user
   */
  "urn:zitadel:iam:user:metadata"?: Record<string, string>
}

/**
 * Extract SQLite encryption key from Zitadel JWT claims
 */
export function extractSqliteKeyFromClaims(claims: ZitadelIdTokenClaims): string | null {
  const metadata = claims["urn:zitadel:iam:user:metadata"]
  return metadata?.sqliteKey ?? null
}
