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
 * The one user-lane 401 that carries no `code`: api/src/middleware/auth.ts
 * answers a request with NO Authorization header at all with exactly this
 * body (its `authMethod: "none"` branch). Every other user-lane rejection is
 * coded. Mirrored verbatim because it is the only thing that tells this
 * response apart from the device middleware's — both say `error:
 * "Unauthorized"`, and the device lane's messages are "Invalid device token"
 * / "Device token expired" / "Device token validation failed". If the API
 * ever adds a `code` to that branch, this constant becomes dead weight, which
 * is the intended direction (RS-040).
 */
export const USER_LANE_MISSING_CREDENTIALS_BODY = {
  error: "Unauthorized",
  message: "Missing or invalid authorization header",
} as const

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
 * CHANGED 2026-09-21 (RS-040): "every user-lane rejection carries a code"
 * had one hole — a signed-in route called with no Bearer at all gets
 * auth.ts's code-less missing-header 401, AFTER the device middleware has
 * verified the JWT. Reading that as a device rejection threw away a valid
 * device JWT on every cold start of an install whose keychain had lost its
 * auth credentials while MMKV still named the user (19 drops / 5 devices in
 * 7d, all on /push-tokens/ and /sync/attendance). That body is now excluded
 * by its exact text; everything else code-less still drops, because a
 * wrongly dropped JWT costs one re-assert and a wrongly kept dead one costs
 * an edge ban.
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
    const { code, error, message } = data as {
      code?: unknown
      error?: unknown
      message?: unknown
    }
    if (typeof code === "string") return null
    if (
      error === USER_LANE_MISSING_CREDENTIALS_BODY.error &&
      message === USER_LANE_MISSING_CREDENTIALS_BODY.message
    ) {
      return null
    }
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
