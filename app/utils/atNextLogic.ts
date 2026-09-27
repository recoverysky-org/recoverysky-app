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
 * Known product gap, not a bug: `starts_at=true` matches `millis === at`
 * exactly, so a meeting starting off the quarter hour (7:05, 7:10…) never
 * appears under any Starts In option.
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
 * Slack after the boundary before refetching: a buffer for the device clock
 * running slightly behind the API's, so the request lands after the server's
 * `nextQuarterHour` has moved on. (The API's cache rotation runs minutes
 * BEFORE the boundary, so it is not what this waits for.)
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
 * How long to wait before refetching. The server recomputes every offset's
 * mark at each quarter-hour boundary (`nextQuarterHour(now, offset)`), so an
 * answer is current until the NEXT boundary — `at` for offset 15, but
 * `at − (offset − 15) min` for 30/45/60 (asked at 12:06, "60" answers for
 * 13:00 and moves to 13:15 at 12:15). Polling between boundaries would return
 * the same rows: one request per quarter hour is the whole budget.
 * FIXED 2026-09-27 (review): this first waited for `at` itself, which left
 * "60" stale for 45 min per cycle and skipped three of every four marks.
 */
export function refetchDelayMs(
  atMs: number | null,
  offset: AtNextOffset,
  nowMs: number,
): number | null {
  if (atMs === null) return null
  const boundaryMs = atMs - (offset - 15) * 60_000
  return boundaryMs > nowMs ? boundaryMs - nowMs + REFETCH_GRACE_MS : REFETCH_SKEW_FLOOR_MS
}

/**
 * Drop entries whose start has passed (`millis <= nowMs`).
 * Runs on a 60 s tick between fetches, so a 15-minute list never shows a
 * meeting that already began.
 * CHANGED 2026-09-27: with `starts_at=true` every row starts exactly at `at`,
 * so for offset 15 this drops the whole list once the mark passes — normally
 * moot, because the boundary refetch (refetchDelayMs) has already replaced
 * the rows a few seconds after the mark, before the next 60 s tick. Also drops continuous rooms (`millis === 0`,
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
