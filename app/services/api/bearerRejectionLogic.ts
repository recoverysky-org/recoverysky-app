/**
 * Pure decision behind the bearer-rejection monitor in services/api/index.ts.
 *
 * Kept free of @/ imports and side effects so vitest can load it (see
 * CLAUDE.md "Test Runner Split"). ADDED 2026-09-10; spec:
 * docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md
 *
 * The API (v1.7.0+) puts a machine-readable `code` on every bearer rejection.
 * Only three of them mean "this token can never work, sign in again". The
 * rest — token_expired (the gate refreshes), token_invalid, a 503
 * auth_unavailable (the API could not reach Auth0's keys), and the code-less
 * 401s for a bad X-API-Key or a missing header — must never eject. Loki
 * showed 10 JWKS timeouts against 8 genuine malformed tokens in one month;
 * ejecting on a message string would have signed out healthy users.
 */

export const BEARER_EJECT_CODES: readonly string[] = [
  "token_malformed",
  "token_claims",
  "token_signature",
]

/**
 * Case-insensitive header read that works on both shapes a monitor can see:
 * an axios 1.x AxiosHeaders instance (has get()) and a plain object. The
 * request transform in index.ts sees a plain object; by the time a monitor
 * runs, response.config.headers is an AxiosHeaders — do not bracket-index it.
 */
export function readHeader(headers: unknown, name: string): string | undefined {
  if (headers === null || typeof headers !== "object") return undefined

  const maybeGet = (headers as { get?: unknown }).get
  if (typeof maybeGet === "function") {
    const value: unknown = maybeGet.call(headers, name)
    return typeof value === "string" ? value : undefined
  }

  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === wanted) return typeof value === "string" ? value : undefined
  }
  return undefined
}

/**
 * The eject code when this response says the bearer can never work, else null.
 * A request that bypassed the auth gate (SKIP_AUTH_GATE_HEADER) never had a
 * bearer stamped, so "carried a bearer" already excludes it.
 */
export function bearerRejectionCode(
  status: number | undefined,
  requestHeaders: unknown,
  data: unknown,
): string | null {
  if (status !== 401) return null

  const authorization = readHeader(requestHeaders, "Authorization")
  if (!authorization || !authorization.startsWith("Bearer ")) return null

  if (data === null || typeof data !== "object") return null
  const code = (data as { code?: unknown }).code
  if (typeof code !== "string") return null

  return BEARER_EJECT_CODES.includes(code) ? code : null
}
