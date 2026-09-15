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

/**
 * The device JWT this 401 refused, or null when the response says nothing
 * about the device lane.
 *
 * ADDED 2026-09-14. The two server middlewares reject differently: the device
 * middleware (api/src/middleware/deviceAuth.ts) answers a bad X-Device-Token
 * with a 401 whose body has NO `code`, while every user-lane rejection
 * (api/src/middleware/auth.ts) carries `code: token_*` — and the device check
 * runs first, so a bearer code means the device token was accepted. That
 * asymmetry is the whole decision. A request that carried no device token
 * (the API-key lane, a bypassed exchange, or the local no-credential 401
 * below) has nothing to reject.
 *
 * Before this existed there was no reactive 401 path at all: a JWT the server
 * had stopped honouring (rotated secret, revocation) was re-sent on every
 * request until its own expiry — up to seven days — and the edge's 401
 * brute-force scenario banned the device within minutes.
 */
export function deviceJwtRejected(
  status: number | undefined,
  requestHeaders: unknown,
  data: unknown,
): string | null {
  if (status !== 401) return null

  const deviceToken = readHeader(requestHeaders, "X-Device-Token")
  if (!deviceToken) return null

  if (data !== null && typeof data === "object") {
    const code = (data as { code?: unknown }).code
    if (typeof code === "string") return null
  }
  return deviceToken
}

/** `error` field of the 401 the gate synthesises when it has no credential to send. */
export const NO_DEVICE_CREDENTIAL_ERROR = "no_device_credential"

/** The minimum of an axios response that apisauce needs to classify a 401. */
export interface SyntheticResponse<C> {
  data: { error: string; message: string }
  status: number
  statusText: string
  headers: Record<string, string>
  config: C
}

/**
 * Per-request axios adapter that answers 401 locally instead of sending.
 *
 * ADDED 2026-09-14. When the auth gate has neither a device JWT nor an API
 * key (production while attestation is degraded or backing off, or outage
 * mode where the lane was never chosen), the request used to go out with no
 * device credential at all — a guaranteed 401 from the server for every
 * poll, mount and foreground, which is exactly what the edge's 401
 * brute-force scenario counts. Resolving the same 401 here keeps every call
 * site's contract (`{ kind: "unauthorized" }` via getGeneralApiProblem) and
 * puts nothing on the wire. The marker body tells a log reader — and the
 * monitors — that no server ever saw this request.
 */
export function noDeviceCredentialAdapter<C>(config: C): Promise<SyntheticResponse<C>> {
  return Promise.resolve({
    data: {
      error: NO_DEVICE_CREDENTIAL_ERROR,
      message: "Not sent: no device credential available",
    },
    status: 401,
    statusText: "Unauthorized",
    headers: {},
    config,
  })
}
