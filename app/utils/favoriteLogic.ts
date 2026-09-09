/**
 * favoriteLogic — the schedule-wide favorite and rating decisions.
 *
 * ADDED 2026-09-04: favoriting stopped being per-meeting. Tapping the heart on
 * any meeting now sets `loves` on every meeting in that schedule, so a Monday
 * favorite makes the whole schedule (Tue, Wed, …) favorite too. This module is
 * the pure half of that: given the tapped meeting and its schedule grid, it
 * answers "which mids, and to what value". The I/O half is
 * `feedbackCache.setLoveForMids`, which this module deliberately knows nothing
 * about.
 *
 * CHANGED 2026-09-09: star ratings follow the same rule — `decideScheduleRating`
 * picks the same mids and SETs one star value on all of them (I/O half:
 * `feedbackCache.setRatingForMids`). Join counts remain per-meeting: they are
 * a record of what happened, not a preference.
 *
 * Pure module with no runtime `@/` imports so vitest can reach it (see
 * CLAUDE.md, "Test Runner Split"). `ScheduleCellLike` is declared structurally
 * here instead of importing `ScheduleCell` from `@/services/api` — an API cell
 * satisfies it, and this decision has no business knowing about `millis`.
 */

/** The one field the decision reads off a grid cell. API `ScheduleCell` satisfies this. */
export interface ScheduleCellLike {
  id: string
}

export interface ScheduleLoveDecision {
  /** Unique meeting ids to write, tapped meeting always included. */
  mids: string[]
  /** The value to SET on every mid — not a per-mid toggle. */
  loves: boolean
}

/**
 * Decide the schedule-wide favorite write for a heart tap.
 *
 * **Set, not toggle.** The new value is the tapped meeting's toggle
 * (`!currentLoves`) applied uniformly to every sibling. When legacy per-meeting
 * data left the schedule mixed (some loved, some not), one tap converges the
 * whole schedule on the tapped meeting's new state rather than flipping each
 * row independently — flipping would *preserve* the mixed state forever.
 *
 * The tapped mid is always in the result even when absent from the grid: the
 * grid comes from the API (`scheduleData`) and can be null (some fetch paths
 * leave it unset) or simply not list the tapped meeting. Empty-id cells are
 * skipped defensively for the same reason — the grid is server data, not ours.
 */
export function decideScheduleLove(args: {
  tappedMid: string
  /** Tapped meeting's current loves state; false when it has no feedback record. */
  currentLoves: boolean
  scheduleData: (ScheduleCellLike | null)[][] | null
}): ScheduleLoveDecision {
  const { tappedMid, currentLoves, scheduleData } = args
  return { mids: collectScheduleMids(tappedMid, scheduleData), loves: !currentLoves }
}

/**
 * Every unique meeting id in the grid, tapped meeting always first. Shared by
 * the love and rating decisions — and exported for the one-time migrations in
 * `services/favorites/migrateFavorites.ts` — so "which meetings make up this
 * schedule" has exactly one answer.
 */
export function collectScheduleMids(
  tappedMid: string,
  scheduleData: (ScheduleCellLike | null)[][] | null,
): string[] {
  const mids = new Set<string>([tappedMid])
  for (const gridRow of scheduleData ?? []) {
    for (const cell of gridRow) {
      if (cell?.id) mids.add(cell.id)
    }
  }
  return [...mids]
}

export interface ScheduleRatingDecision {
  /** Unique meeting ids to write, tapped meeting always included. */
  mids: string[]
  /** The star value (0–5) to SET on every mid. */
  rates: number
}

/**
 * Decide the schedule-wide rating write for a star tap.
 *
 * Same shape as `decideScheduleLove`: the tapped star is SET uniformly on every
 * sibling, so a legacy schedule holding mixed per-meeting ratings converges on
 * the tapped value in one tap. Zero (clearing the stars) fans out the same way
 * — a cleared Monday must not leave Tuesday still showing four stars.
 *
 * Clamped to 0–5 here so the cache's per-mid write can trust the value and the
 * clamp is testable without SQLite.
 */
export function decideScheduleRating(args: {
  tappedMid: string
  rating: number
  scheduleData: (ScheduleCellLike | null)[][] | null
}): ScheduleRatingDecision {
  const { tappedMid, rating, scheduleData } = args
  return {
    mids: collectScheduleMids(tappedMid, scheduleData),
    rates: Math.max(0, Math.min(5, rating)),
  }
}

/** The two fields the ratings migration reads off a feedback record. */
export interface RatedLike {
  mid: string
  rates: number
}

/**
 * Order the rated meetings for the one-time ratings migration
 * (`services/favorites/migrateFavorites.ts`): highest star first, input order
 * preserved among equals, unrated rows dropped.
 *
 * The migration walks this list and, for each mid not yet covered, SETs its
 * star on the whole schedule and marks every sibling covered. Highest-first is
 * what makes "the schedule's best rating wins" fall out of that walk without a
 * second pass: by the time a lower-rated sibling comes up, its schedule is
 * already covered. Deterministic tie order keeps a retried pass (the flag is
 * only set after full success) writing the same values.
 */
export function orderRatedForMigration<T extends RatedLike>(records: readonly T[]): T[] {
  // Array.prototype.sort is stable, which is what keeps equal stars in input order.
  return records.filter((r) => r.rates > 0).sort((a, b) => b.rates - a.rates)
}

/**
 * Classify one schedule lookup during the one-time favorites migration
 * (`services/favorites/migrateFavorites.ts`): existing per-meeting favorites
 * get their whole schedule favorited on first run after the schedule-wide
 * favorites update.
 *
 * - `"propagate"` — lookup succeeded; favorite the schedule's meetings.
 * - `"skip"` — the meeting no longer exists upstream (`not-found`) or the
 *   response was malformed (`bad-data`). Permanent: counting it handled is
 *   what lets the migration flag ever get set for a user holding a favorite
 *   on a delisted meeting.
 * - `"abort"` — everything else. The pass stops, the flag stays unset, and
 *   the whole migration retries next cold start (idempotent — setLoveForMids
 *   skips mids already loved). Unrecognized kinds land here deliberately,
 *   the same "unknown defaults to retryable" stance as
 *   tokenFreshnessLogic.ts — skipping on an unknown error would silently
 *   drop a user's favorite forever, while aborting merely costs a retry.
 *
 * Takes the `kind` string off the API result union; typed as plain `string`
 * so this module stays free of runtime `@/` imports (vitest reachability).
 */
export function classifyMigrationLookup(kind: string): "propagate" | "skip" | "abort" {
  if (kind === "ok") return "propagate"
  if (kind === "not-found" || kind === "bad-data") return "skip"
  return "abort"
}
