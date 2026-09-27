/**
 * Pure logic for Live's "Starts In" selector (GET /schedules/at_next).
 *
 * ADDED 2026-09-26. The API owns the window math: it interprets `offset`
 * against `starts_at`. The app only builds `starts_at`, prunes meetings that
 * have begun since the last fetch, sorts, and decides what a failure means.
 * Free of runtime `@/` imports so vitest can run it (CLAUDE.md "Test Runner
 * Split"). Spec: docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md
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
 * `starts_at` param: device now, truncated to the minute, ISO 8601 (UTC "Z").
 * Truncating makes every request within the same minute identical, which
 * keeps them cacheable server-side.
 */
export function buildStartsAt(now: Date): string {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString()
}

/**
 * Drop entries whose start has passed (`millis <= nowMs`).
 * Runs on a 60 s tick between fetches, so a 15-minute list never shows a
 * meeting that already began. Also drops continuous rooms (`millis === 0`,
 * shown as "24h" by MeetingRow): an always-open room has no upcoming start, so
 * it doesn't belong in a "starting soon" list even if the API returns one.
 */
export function pruneStarted<T extends { millis: number }>(items: readonly T[], nowMs: number): T[] {
  return items.filter((i) => i.millis > nowMs)
}

/** Soonest first. A "starting soon" list is a countdown, not a ranking. */
export function sortByStart<T extends { millis: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.millis - b.millis)
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

/**
 * True when the Live segment has just come on screen: hidden → visible, or a
 * visible first render (`prev` undefined). Keyed on the edge, never on a store
 * value. See CLAUDE.md "The trap, hit twice".
 */
export function isShowEdge(prev: boolean | undefined, next: boolean): boolean {
  return next && prev !== true
}
