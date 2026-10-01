import { ApiErrorResponse } from "apisauce"
import { expect, test } from "vitest"

import {
  describeServerFailure,
  getGeneralApiProblem,
  isReadyBody,
  prefixServerFailure,
  shouldTrackApiProblem,
} from "./apiProblem"

test("handles connection errors", () => {
  expect(getGeneralApiProblem({ problem: "CONNECTION_ERROR" } as ApiErrorResponse<null>)).toEqual({
    kind: "cannot-connect",
    temporary: true,
  })
})

test("handles network errors", () => {
  expect(getGeneralApiProblem({ problem: "NETWORK_ERROR" } as ApiErrorResponse<null>)).toEqual({
    kind: "cannot-connect",
    temporary: true,
  })
})

test("handles timeouts", () => {
  expect(getGeneralApiProblem({ problem: "TIMEOUT_ERROR" } as ApiErrorResponse<null>)).toEqual({
    kind: "timeout",
    temporary: true,
  })
})

test("handles server errors", () => {
  expect(getGeneralApiProblem({ problem: "SERVER_ERROR" } as ApiErrorResponse<null>)).toEqual({
    kind: "server",
  })
})

test("handles unknown errors", () => {
  expect(getGeneralApiProblem({ problem: "UNKNOWN_ERROR" } as ApiErrorResponse<null>)).toEqual({
    kind: "unknown",
    temporary: true,
  })
})

test("handles unauthorized errors", () => {
  expect(
    getGeneralApiProblem({ problem: "CLIENT_ERROR", status: 401 } as ApiErrorResponse<null>),
  ).toEqual({
    kind: "unauthorized",
  })
})

test("handles forbidden errors", () => {
  expect(
    getGeneralApiProblem({ problem: "CLIENT_ERROR", status: 403 } as ApiErrorResponse<null>),
  ).toEqual({
    kind: "forbidden",
  })
})

test("handles not-found errors", () => {
  expect(
    getGeneralApiProblem({ problem: "CLIENT_ERROR", status: 404 } as ApiErrorResponse<null>),
  ).toEqual({
    kind: "not-found",
  })
})

test("handles other client errors", () => {
  expect(
    getGeneralApiProblem({ problem: "CLIENT_ERROR", status: 418 } as ApiErrorResponse<null>),
  ).toEqual({
    kind: "rejected",
  })
})

test("handles cancellation errors", () => {
  expect(getGeneralApiProblem({ problem: "CANCEL_ERROR" } as ApiErrorResponse<null>)).toBeNull()
})

// CHANGED 2026-09-14: the `api_error` analytics event used to fire for every
// classified problem, including expected 404s — one per missing report body
// per foreground on a device with Firebase-imported reports. Only a 5xx is
// the API's fault; everything else is either the client's (4xx) or the
// network's (cannot-connect / timeout) and is already visible elsewhere.
test("shouldTrackApiProblem: only server (5xx) problems count as api_error", () => {
  expect(shouldTrackApiProblem({ kind: "server" })).toBe(true)
  expect(shouldTrackApiProblem({ kind: "not-found" })).toBe(false)
  expect(shouldTrackApiProblem({ kind: "unauthorized" })).toBe(false)
  expect(shouldTrackApiProblem({ kind: "forbidden" })).toBe(false)
  expect(shouldTrackApiProblem({ kind: "rejected" })).toBe(false)
  expect(shouldTrackApiProblem({ kind: "bad-data" })).toBe(false)
  expect(shouldTrackApiProblem({ kind: "timeout", temporary: true })).toBe(false)
  expect(shouldTrackApiProblem({ kind: "cannot-connect", temporary: true })).toBe(false)
  expect(shouldTrackApiProblem({ kind: "unknown", temporary: true })).toBe(false)
})

// ADDED 2026-09-14: the cold-start precheck moved from GET /status to
// GET /status/ready and now requires the readiness body, not just a 2xx —
// a captive portal or misrouted proxy can answer 200 with anything.
test("isReadyBody: accepts exactly the readiness payload", () => {
  expect(isReadyBody({ status: "ready" })).toBe(true)
  expect(isReadyBody({ status: "ready", extra: 1 })).toBe(true)
  expect(isReadyBody({ status: "not ready", reasons: ["Database connection failed"] })).toBe(false)
  expect(isReadyBody({ status: "healthy" })).toBe(false)
  expect(isReadyBody({})).toBe(false)
  expect(isReadyBody(null)).toBe(false)
  expect(isReadyBody(undefined)).toBe(false)
  expect(isReadyBody("ready")).toBe(false)
  expect(isReadyBody("<html>captive portal</html>")).toBe(false)
})

// ADDED 2026-10-01: 5xx detail extraction (describeServerFailure).
test("server errors carry sanitized detail from the body", () => {
  expect(
    getGeneralApiProblem({
      problem: "SERVER_ERROR",
      status: 503,
      data: { error: "ServiceUnavailable", code: "upstream_unavailable", subsystem: "trex" },
    } as ApiErrorResponse<unknown>),
  ).toEqual({
    kind: "server",
    detail: {
      status: 503,
      error: "ServiceUnavailable",
      code: "upstream_unavailable",
      subsystem: "trex",
    },
  })
})

test("describeServerFailure: takes only the upstream code out of a JSON message, never the URL", () => {
  // The exact body a pre-503 API sent with TREX down (2026-10-01, local).
  const message = JSON.stringify({
    error: "",
    code: "ECONNREFUSED",
    method: "POST",
    url: "http://localhost:7631/db/search/live",
    body: { now_datetime: "2026-10-01T19:16:04.569Z" },
  })
  const detail = describeServerFailure(500, { error: "InternalError", message })
  expect(detail).toEqual({ status: 500, error: "InternalError", upstreamCode: "ECONNREFUSED" })
  expect(JSON.stringify(detail)).not.toContain("localhost")
})

test("describeServerFailure: drops non-token values instead of truncating them", () => {
  expect(
    describeServerFailure(500, {
      error: "Internal Error with spaces",
      code: "x".repeat(65),
      subsystem: "http://10.0.0.1:7631",
      message: "Failed to fetch daily schedules",
    }),
  ).toEqual({ status: 500 })
})

test("describeServerFailure: nothing to report → undefined", () => {
  expect(describeServerFailure(undefined, null)).toBeUndefined()
  expect(describeServerFailure(undefined, "<html>")).toBeUndefined()
  expect(describeServerFailure(undefined, { message: "{not json" })).toBeUndefined()
})

test("prefixServerFailure flattens under a prefix for multi-request log lines", () => {
  expect(prefixServerFailure("online", { status: 503, subsystem: "trex" })).toEqual({
    onlineStatus: 503,
    onlineSubsystem: "trex",
  })
  expect(prefixServerFailure("inPerson", undefined)).toEqual({})
})
