/**
 * Pure logic for Live's "Starts In" selector (GET /schedules/at-next —
 * hyphenated; the `at_next` spelling was the design draft's).
 *
 * ADDED 2026-09-26. The API owns the window math: it interprets `offset`
 * against `starts_at`. The app only builds `starts_at`, prunes meetings that
 * have begun since the last fetch, sorts, and decides what a failure means.
 * Free of runtime `@/` imports so vitest can run it (CLAUDE.md "Test Runner
 * Split"). Spec: docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md
 *
 * CHANGED 2026-09-27: aligned with the deployed API (api repo, src/openapi.ts
 * `GET /schedules/at-next`). The route is hyphenated; `offset` picks ONE
 * coming quarter-hour mark (15 = the next :00/:15/:30/:45 strictly after now,
 * 30/45/60 = 15/30/45 min past that) rather than a window; `starts_at` is a
 * boolean ("only meetings starting exactly at the mark"), not a reference
 * timestamp; and the response carries `at`, the mark it answered for. So the
 * app no longer builds a timestamp (`buildStartsAt` is gone), no longer sorts
 * by start (every row shares `at` — `sortByStart` is gone), and instead
 * schedules its refetch for just after `at`, when the server's answer moves
 * to the next mark.
 */

/** Selector values. Strings, because SegmentedPill is typed `T extends string`. */
export type StartsIn = "live" | "15" | "30" | "45" | "60"

/** Minutes the API accepts for `offset`. */
export type AtNextOffset = 15 | 30 | 45 | 60

/** Selector order. `live` leads because it is the default (today's list). */
export const STARTS_IN_OPTIONS: readonly StartsIn[] = ["live", "15", "30", "45", "60"]

/** `null` for `live`: that view comes from MeetingContext, not at_next. */
export function offsetOf(s: StartsIn): AtNextOffset | null {
  return s === "live" ? null : (Number(s) as AtNextOffset)
}

/**
 * The response's `at` (ISO 8601, the quarter-hour mark answered for) as UTC
 * millis, or null when absent/unparseable. Null disables the mark-driven
 * refetch and the "Starting at …" line rather than guessing a mark: the API
 * owns that math (`nextQuarterHour` server-side).
 */
export function parseAtMillis(at: string | undefined): number | null {
  if (!at) return null
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Slack after the mark before refetching, so the API's pre-emptive cache
 * rotation at the boundary has landed and we get the NEXT mark's answer.
 */
export const REFETCH_GRACE_MS = 5_000

/**
 * Minimum wait when `at` is already in the past by the device clock. That only
 * happens when the device clock runs ahead of the API's: refetching "right
 * away" would get the same `at` back and loop every few seconds until the
 * clocks agree.
 */
export const REFETCH_SKEW_FLOOR_MS = 60_000

/**
 * How long to wait before refetching. The server's answer for an offset only
 * changes when its quarter-hour mark passes (each offset is a warm cache slot
 * that rotates at the boundary), so polling in between would return the same
 * rows: one request per mark is the whole budget.
 */
export function refetchDelayMs(atMs: number | null, nowMs: number): number | null {
  if (atMs === null) return null
  return atMs > nowMs ? atMs - nowMs + REFETCH_GRACE_MS : REFETCH_SKEW_FLOOR_MS
}

/**
 * Drop entries whose start has passed (`millis <= nowMs`).
 * Runs on a 60 s tick between fetches, so a 15-minute list never shows a
 * meeting that already began.
 * CHANGED 2026-09-27: with `starts_at=true` every row starts exactly at `at`,
 * so this now empties the list the moment the mark passes; the mark-driven
 * refetch (refetchDelayMs) replaces it with the next mark a few seconds later. Also drops continuous rooms (`millis === 0`,
 * shown as "24h" by MeetingRow): an always-open room has no upcoming start, so
 * it doesn't belong in a "starting soon" list even if the API returns one.
 */
export function pruneStarted<T extends { millis: number }>(
  items: readonly T[],
  nowMs: number,
): T[] {
  return items.filter((i) => i.millis > nowMs)
}

/**
 * What a failed at_next fetch means for the UI.
 * `not-found` = this API build has no route yet (the `startsInVisible` flag
 * was flipped before the deploy), so hide the selector for the session and
 * show Live. Anything else is a real failure worth a retry prompt. Transport
 * retries already happened inside retryWithBackoff before this is asked.
 */
export function classifyAtNextProblem(kind: string): "hide-for-session" | "show-error" {
  return kind === "not-found" ? "hide-for-session" : "show-error"
}
