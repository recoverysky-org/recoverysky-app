import { ApiResponse } from "apisauce"

// Kept free of @/ imports (and any side effects) so it's unit-testable under
// Vitest, which has no @/ alias resolution — see [[vitest-no-path-alias]].
// Analytics tracking for classified problems lives in the caller
// (services/api/index.ts's getGeneralApiProblem wrapper), not here.
export type GeneralApiProblem =
  /**
   * Times up.
   */
  | { kind: "timeout"; temporary: true }
  /**
   * Cannot connect to the server for some reason.
   */
  | { kind: "cannot-connect"; temporary: true }
  /**
   * The server experienced a problem. Any 5xx error.
   * CHANGED 2026-10-01: may carry `detail` — sanitized identifiers from the
   * error body that say WHICH part failed (see describeServerFailure).
   */
  | { kind: "server"; detail?: ServerFailureDetail }
  /**
   * We're not allowed because we haven't identified ourself. This is 401.
   */
  | { kind: "unauthorized" }
  /**
   * We don't have access to perform that request. This is 403.
   */
  | { kind: "forbidden" }
  /**
   * Unable to find that resource.  This is a 404.
   */
  | { kind: "not-found" }
  /**
   * All other 4xx series errors.
   */
  | { kind: "rejected" }
  /**
   * Something truly unexpected happened. Most likely can try again. This is a catch all.
   */
  | { kind: "unknown"; temporary: true }
  /**
   * The data we received is not in the expected format.
   */
  | { kind: "bad-data" }

/**
 * Attempts to get a common cause of problems from an api response.
 *
 * @param response The api response.
 */
export function getGeneralApiProblem(response: ApiResponse<any>): GeneralApiProblem | null {
  let problem: GeneralApiProblem | null = null

  switch (response.problem) {
    case "CONNECTION_ERROR":
      problem = { kind: "cannot-connect", temporary: true }
      break
    case "NETWORK_ERROR":
      problem = { kind: "cannot-connect", temporary: true }
      break
    case "TIMEOUT_ERROR":
      problem = { kind: "timeout", temporary: true }
      break
    case "SERVER_ERROR": {
      const detail = describeServerFailure(response.status, response.data)
      problem = detail ? { kind: "server", detail } : { kind: "server" }
      break
    }
    case "UNKNOWN_ERROR":
      problem = { kind: "unknown", temporary: true }
      break
    case "CLIENT_ERROR":
      switch (response.status) {
        case 401:
          problem = { kind: "unauthorized" }
          break
        case 403:
          problem = { kind: "forbidden" }
          break
        case 404:
          problem = { kind: "not-found" }
          break
        default:
          problem = { kind: "rejected" }
          break
      }
      break
    case "CANCEL_ERROR":
      return null
  }

  return problem
}

/**
 * Whether a classified problem should be reported as an `api_error`
 * analytics event. Only a 5xx ("server") is the API's fault. A 4xx is the
 * client's (or an expected miss — a 404 on a report body the server never
 * had), and cannot-connect / timeout are the network's; both were flooding
 * the metric with non-errors.
 *
 * CHANGED 2026-09-14: used to be "every classified problem". On a device with
 * Firebase-imported reports that meant one event per missing body on every
 * foreground. Pure so vitest can cover it.
 */
export function shouldTrackApiProblem(problem: GeneralApiProblem): boolean {
  return problem.kind === "server"
}

/**
 * True when a response body is the API's readiness payload
 * (`GET /status/ready` → `{ "status": "ready" }`).
 *
 * ADDED 2026-09-14: the cold-start precheck used to accept any 2xx from
 * GET /status. A captive portal or a misrouted proxy can answer 200 with
 * arbitrary HTML, which then read as "API healthy" and sent the user into
 * attestation against a server that was never reached. Requiring the exact
 * body makes the probe say what it means.
 */
export function isReadyBody(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false
  return (data as { status?: unknown }).status === "ready"
}

/**
 * Identifiers pulled from a 5xx error body — enough to tell "the API is up
 * but a subsystem it depends on is down" from "the API itself broke".
 *
 * ADDED 2026-10-01 (Jenova): during a local TREX + Redis outage,
 * `/status/ready` answered 200 `ready` while every `/schedules/*` route 500'd,
 * and the app's logs said only `kind: "server"`. Every field here is
 * optional: the API is moving to a structured 503 (`error`, `code`,
 * `subsystem`), and older builds send only `error` plus a `message`.
 */
export interface ServerFailureDetail {
  status?: number
  /** Body `error`, e.g. "InternalError" / "ServiceUnavailable". */
  error?: string
  /** Body `code`, e.g. "upstream_unavailable". */
  code?: string
  /** Body `subsystem` — the failed dependency, e.g. "trex" / "redis". */
  subsystem?: string
  /**
   * `code` from a JSON object embedded in the body's `message` string, e.g.
   * "ECONNREFUSED". Older API builds pass a failed upstream call through
   * that way; this is the only field we take out of it.
   */
  upstreamCode?: string
}

/**
 * A short identifier-shaped string, or undefined. The whitelist is the
 * privacy guard: these values go to Loki and to analytics, and the API's 500
 * bodies have carried internal URLs and request bodies in `message`, so
 * anything that isn't plainly a token is dropped, never truncated.
 */
function token(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : undefined
}

/**
 * Sanitized summary of a 5xx body, or undefined when there is nothing to
 * report. Never returns `message` or any URL — only whitelisted tokens.
 */
export function describeServerFailure(
  status: number | undefined,
  data: unknown,
): ServerFailureDetail | undefined {
  const detail: ServerFailureDetail = {}
  if (typeof status === "number") detail.status = status

  if (typeof data === "object" && data !== null) {
    const body = data as Record<string, unknown>
    detail.error = token(body.error)
    detail.code = token(body.code)
    detail.subsystem = token(body.subsystem)
    if (typeof body.message === "string" && body.message.startsWith("{")) {
      try {
        const inner: unknown = JSON.parse(body.message)
        if (typeof inner === "object" && inner !== null) {
          detail.upstreamCode = token((inner as Record<string, unknown>).code)
        }
      } catch {
        // Not JSON after all — a plain message, which we never log.
      }
    }
  }

  // Drop unset keys so log lines and analytics props stay compact.
  const entries = Object.entries(detail).filter(([, v]) => v !== undefined)
  return entries.length > 0 ? (Object.fromEntries(entries) as ServerFailureDetail) : undefined
}

/**
 * `detail` flattened under a prefix (`online` + `subsystem` →
 * `onlineSubsystem`), for log lines that report more than one request — the
 * logger takes flat attributes only. Empty object when there is no detail.
 */
export function prefixServerFailure(
  prefix: string,
  detail: ServerFailureDetail | undefined,
): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  if (!detail) return out
  for (const [key, value] of Object.entries(detail)) {
    if (value !== undefined) out[prefix + key[0].toUpperCase() + key.slice(1)] = value
  }
  return out
}
