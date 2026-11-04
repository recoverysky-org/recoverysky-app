/**
 * Pure translation from a Daily Dash client log line's fields to the app
 * logger's flat `LogAttributes`. ADDED 2026-11-04 (My Day tab).
 *
 * The client logs `(fields, msg)` with arbitrary values; the app's OTLP logger
 * takes `(msg, attributes)` whose values must be scalars. This module keeps no
 * runtime `@/` import (the type import below is erased) so vitest can load it
 * — see CLAUDE.md "Test Runner Split".
 */
import type { LogAttributes } from "@/utils/logger"

/**
 * Longest value we forward. A client field can be a whole problem's `details`
 * or a response shape; Loki lines are cheap but not free, and a runaway
 * stringify (a big array) should not swamp one record.
 */
export const MAX_ATTRIBUTE_LENGTH = 2000

/**
 * Keys that never leave the device. `cause` is the client's thrown error, and
 * it can carry request context (URLs, headers, a token in a message): the
 * client README's "what a host never logs" and spec §4.8 both say drop it,
 * whatever it holds.
 */
const DROPPED_KEYS: ReadonlySet<string> = new Set(["cause"])

function truncate(value: string): string {
  return value.length > MAX_ATTRIBUTE_LENGTH ? value.slice(0, MAX_ATTRIBUTE_LENGTH) : value
}

/** JSON for objects; `String()` for what JSON can't say (a cycle, a BigInt, a function). */
function stringify(value: unknown): string {
  try {
    const json = JSON.stringify(value)
    // JSON.stringify returns undefined (not a string) for functions/symbols.
    return json === undefined ? String(value) : json
  } catch {
    return String(value)
  }
}

/**
 * Drops `cause` and any `undefined`/`null`; keeps strings (truncated), numbers
 * and booleans; JSON-stringifies anything else, truncated to
 * `MAX_ATTRIBUTE_LENGTH` characters.
 */
export function toLogAttributes(fields: Record<string, unknown>): LogAttributes {
  const out: LogAttributes = {}
  for (const [key, value] of Object.entries(fields)) {
    if (DROPPED_KEYS.has(key) || value === undefined || value === null) continue
    if (typeof value === "string") out[key] = truncate(value)
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value
    else out[key] = truncate(stringify(value))
  }
  return out
}
