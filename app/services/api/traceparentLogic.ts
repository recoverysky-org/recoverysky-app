/**
 * Pure W3C Trace Context helpers for outbound RecoverySky API requests.
 *
 * PURE MODULE — no `@/` runtime imports, no React, no native modules. Vitest
 * cannot resolve the `@/` alias (see CLAUDE.md "Test Runner Split"), so the
 * randomness is handed in as bytes and the header is stamped by the caller in
 * services/api/index.ts — same split as contentRetryLogic.ts.
 *
 * ADDED 2026-09-21. The app has no tracing SDK and deliberately gets none
 * (see the CLAUDE.md note under "Logging"): a full OTel tracer in Hermes costs
 * polyfills, battery and network on a recovery app, and the client-side
 * timings we care about are already in Loki keyed by sessionId. What the app
 * CAN do for almost nothing is *start* a trace: mint a random trace id per
 * request, send it as a `traceparent` header, and log the same id beside the
 * request. The API's http instrumentation (wonder-logger → OTel NodeSDK, W3C
 * propagator by default) continues that trace rather than starting its own,
 * so an app log line in Loki and the server-side trace in Tempo share one id.
 *
 * The header is `00-<trace-id>-<parent-id>-<flags>` per
 * https://www.w3.org/TR/trace-context/: 16-byte trace id, 8-byte parent
 * (span) id, both lowercase hex. Flags `01` = sampled, always: the API's
 * sampler is ParentBased, so it defers to this flag and its own `sampleRate`
 * only governs requests that arrive with no traceparent (probes, webhooks,
 * curl). That makes THIS flag the sampler for app traffic — and it stays at
 * "always" on purpose, because nobody knows in advance which /config poll is
 * the one that will fail. Keeping polls out of Tempo's service graph is the
 * API's job (its `ignorePaths` check runs before ParentBased and is keyed on
 * the route, which the app has no business second-guessing). The server never
 * sends a `traceparent` back on the response, and we never read one.
 */

/** Canonical lowercase name; HTTP header names are case-insensitive anyway. */
export const TRACEPARENT_HEADER = "traceparent"

const TRACE_ID_BYTES = 16
const SPAN_ID_BYTES = 8
/** How many random bytes `makeTraceContext` consumes. */
export const TRACE_CONTEXT_BYTES = TRACE_ID_BYTES + SPAN_ID_BYTES

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/

export interface TraceContext {
  /** 32 lowercase hex chars — the id shared with the server-side trace. */
  traceId: string
  /** 16 lowercase hex chars — the app's own (never-recorded) parent span. */
  spanId: string
  /** The header value to send. */
  traceparent: string
}

function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

/**
 * Build a trace context from exactly `TRACE_CONTEXT_BYTES` random bytes.
 *
 * An all-zero trace id or span id is invalid per the spec and a receiver
 * must treat the header as absent — with 16/8 random bytes that's a 1-in-2^128
 * event, but the guard is one line and keeps the output unconditionally valid.
 */
export function makeTraceContext(random: Uint8Array): TraceContext {
  if (random.length !== TRACE_CONTEXT_BYTES) {
    throw new Error(`makeTraceContext needs ${TRACE_CONTEXT_BYTES} bytes, got ${random.length}`)
  }
  const traceBytes = random.slice(0, TRACE_ID_BYTES)
  const spanBytes = random.slice(TRACE_ID_BYTES)
  if (traceBytes.every((b) => b === 0)) traceBytes[TRACE_ID_BYTES - 1] = 1
  if (spanBytes.every((b) => b === 0)) spanBytes[SPAN_ID_BYTES - 1] = 1

  const traceId = toHex(traceBytes)
  const spanId = toHex(spanBytes)
  return { traceId, spanId, traceparent: `00-${traceId}-${spanId}-01` }
}

/**
 * The trace id carried by a `traceparent` header value, or undefined when the
 * value is missing or not the version-00 shape this module emits. Used by the
 * response monitor to put the id on the request's log line.
 */
export function traceIdFromTraceparent(header: string | undefined): string | undefined {
  if (!header) return undefined
  return TRACEPARENT_RE.exec(header)?.[1]
}
