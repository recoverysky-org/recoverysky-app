/**
 * Pure filter logic for the Meetings tab's three segments.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it — see the
 * "Test Runner Split" section of CLAUDE.md, and the sibling modules
 * `nearbyLogic.ts` / `returnToLogic.ts` / `syncLogic.ts` that follow the same
 * shape. Type-only imports would be fine (they're erased); value imports are
 * not.
 *
 * Holds the `shortTime` bucket definitions and their predicate, used by the
 * In-Person segment's Time filter.
 */

// ============================================================================
// shortTime buckets
// ============================================================================

/**
 * Coarse time-of-day buckets for the In-Person segment's Time filter.
 *
 * Named `shortTime` (rather than `time`) because the values are named spans —
 * "morning", "evening" — not the wall-clock start/end pair the Search segment
 * exposes. The two are deliberately different controls: Search lets you dial an
 * exact hour range, In-Person offers four presets, because someone browsing
 * nearby meetings is picking a part of their day, not a precise window.
 */
export type ShortTime = "all" | "morning" | "afternoon" | "evening" | "overnight"

/** Selector order. `all` leads because it's the default (no narrowing). */
export const SHORT_TIME_OPTIONS: readonly ShortTime[] = [
  "all",
  "morning",
  "afternoon",
  "evening",
  "overnight",
]

/** The neutral value — no narrowing. The selector opens on this every visit. */
export const DEFAULT_SHORT_TIME: ShortTime = "all"

/**
 * Inclusive local-hour bounds per bucket. Boundaries chosen with Jenova
 * 2026-08-04 for recovery meeting culture rather than the plain calendar split:
 * a 5am start puts sunrise/6am meetings in Morning where people look for them,
 * and Overnight reaches to 04:59 so the 1am–4am insomnia meetings are findable
 * as a group instead of scattered into "morning".
 *
 * Every hour of the day belongs to exactly one bucket — no gaps, no overlap.
 * If you change a boundary, change its neighbour too or you'll open a hole that
 * silently drops meetings from every bucket.
 */
export const SHORT_TIME_RANGES: Readonly<
  Record<Exclude<ShortTime, "all">, { startHour: number; endHour: number }>
> = {
  morning: { startHour: 5, endHour: 11 },
  afternoon: { startHour: 12, endHour: 16 },
  evening: { startHour: 17, endHour: 21 },
  // Wraps midnight — startHour > endHour. `matchesShortTime` handles this;
  // don't "fix" the apparent inversion.
  overnight: { startHour: 22, endHour: 4 },
}

/**
 * Does a meeting's local start time fall in the given bucket?
 *
 * `millis` is the meeting's start instant; we compare the *device-local* hour,
 * matching how ListingsScreen filters its hour range and how
 * `nearbyLogic.sortByLocalTime` sorts. Plain `Date` rather than Luxon keeps
 * this module dependency-free.
 */
export function matchesShortTime(millis: number, bucket: ShortTime): boolean {
  if (bucket === "all") return true

  const range = SHORT_TIME_RANGES[bucket]
  if (!range) return true

  const hour = new Date(millis).getHours()

  // Normal, non-wrapping bucket.
  if (range.startHour <= range.endHour) {
    return hour >= range.startHour && hour <= range.endHour
  }

  // Wrapping bucket (overnight): the span runs past midnight, so a matching
  // hour is either late in the evening OR early the next morning.
  return hour >= range.startHour || hour <= range.endHour
}
