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

/** Why an access token cannot be sent to the RecoverySky API. */
export type UnusableTokenReason = "not-jwt" | "wrong-audience" | "no-expiry"

export interface AccessTokenCheckConfig {
  /** AUTH0_CONFIG.audience. Empty (dev builds without the env var) skips the audience rule. */
  audience: string
}

export type AccessTokenCheck = { ok: true } | { ok: false; reason: UnusableTokenReason }

/** Decode one base64url JSON segment; null when it is not JSON. */
function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/")
    const parsed: unknown = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"))
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Can this access token possibly be accepted by the RecoverySky API?
 *
 * ADDED 2026-09-10. Auth0 hands out two kinds of access token: a signed JWT
 * for an API audience, and an opaque string valid for /userinfo only. Which
 * kind a refresh token mints is fixed by the login that created it, and the
 * SDK never adds an audience on renewal — so a session that started on a
 * build without EXPO_PUBLIC_AUTH0_AUDIENCE (every TestFlight build from
 * 3.12.1 through 4.1.6) renews into opaque tokens forever. The app used to
 * store those with a healthy expiry and every signed-in call 401'd.
 *
 * This checks a STRICT SUBSET of what the API's verifyToken checks — shape,
 * audience, expiry present — never the signature and deliberately never the
 * issuer (the API's issuer is env-configured; a client-side guess could eject
 * a user the server accepts). A token that fails here is guaranteed to fail
 * on the server; a token that passes may still fail there, and that case is
 * covered by the bearer-rejection monitor in services/api. Never logs the
 * token. Spec: docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md
 */
export function isUsableAccessToken(
  token: string,
  config: AccessTokenCheckConfig,
): AccessTokenCheck {
  const parts = token.split(".")
  if (parts.length !== 3) return { ok: false, reason: "not-jwt" }

  const header = decodeSegment(parts[0])
  const payload = decodeSegment(parts[1])
  if (!header || !payload) return { ok: false, reason: "not-jwt" }

  if (config.audience) {
    const aud = payload.aud
    const audiences = Array.isArray(aud) ? aud : typeof aud === "string" ? [aud] : []
    if (!audiences.includes(config.audience)) return { ok: false, reason: "wrong-audience" }
  }

  if (typeof payload.exp !== "number") return { ok: false, reason: "no-expiry" }

  return { ok: true }
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
 * CHANGED 2026-09-30: no such Action exists (auth0/actions/<tenant>/ is the source of
 * truth), so this returns null for every real token today.
 * Requires an Auth0 Action to inject `https://recoverysky.app/metadata`
 * into the ID token with the user's sqliteKey.
 */
export function extractSqliteKeyFromClaims(claims: IdTokenClaims): string | null {
  const metadata = claims["https://recoverysky.app/metadata"]
  return metadata?.sqliteKey ?? null
}
