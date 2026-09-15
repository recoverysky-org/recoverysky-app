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
 * the love and rating decisions and by `reconcileScheduleFeedback` (it used to
 * serve the one-time migrations in `services/favorites/migrateFavorites.ts`,
 * removed 2026-09-14) so "which meetings make up this schedule" has exactly
 * one answer.
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

/** The two preference fields the reconcile reads off a feedback record. */
export interface FeedbackPrefsLike {
  loves: boolean
  rates: number
}

/** One list row as the schedules endpoints return it: the meeting plus its sibling grid. */
export interface ScheduleRowLike {
  meeting: { id: string }
  data: (ScheduleCellLike | null)[][] | null
}

export interface ScheduleFeedbackPlan {
  /** Schedules to `setLoveForMids(mids, true)`. */
  loveMids: string[][]
  /** Schedules to `setRatingForMids(mids, rates)`. */
  ratingWrites: { mids: string[]; rates: number }[]
}

/**
 * Bring legacy per-meeting hearts and stars up to schedule-wide as the
 * schedules arrive.
 *
 * Before 2026-09-04 (hearts) and 2026-09-09 (stars) feedback was set on the
 * single tapped meeting, so a user's Monday favorite left Tue/Wed/… of the
 * same schedule unloved. The first fix was a one-time migration
 * (`services/favorites/migrateFavorites.ts`, REMOVED 2026-09-14) that asked
 * the API `GET /schedules/meeting/:mid` for every loved or rated meeting to
 * learn its siblings — one or two requests per favorite, a 404 per delisted
 * one, unpaced, re-run every launch until it completed. Those distinct 404
 * paths are what the edge's `http-probing` scenario bans on.
 *
 * The lookup was never needed: hearts are only ever rendered on rows that
 * came from `/schedules/live`, `/schedules/daily` or `/schedules/nearby`,
 * and every one of those rows already carries the full sibling grid. So the
 * fix is applied here, to whatever payload just arrived, with no requests:
 * a schedule where any sibling is loved and another is not gets loved
 * whole; a schedule whose siblings hold different stars gets its highest
 * star everywhere (same "best rating wins" rule the migration used). A
 * favorite on a meeting that never appears in a list is never displayed,
 * so it needs no reconcile; a delisted meeting simply never shows up.
 *
 * A mixed schedule can only be legacy data — the popups have written
 * schedule-wide since the change — so this converges once per schedule and
 * is then a no-op. It also covers a meeting added upstream to an
 * already-loved schedule, which is what "schedule-wide" should mean.
 *
 * Pure: `lookup` is the cache read, the result is the list of writes. The
 * I/O half is `feedbackCache.reconcileSchedules`. Uniform schedules produce
 * nothing, so calling this on every fetch costs one Map lookup per cell.
 */
export function reconcileScheduleFeedback(
  schedules: readonly ScheduleRowLike[],
  lookup: (mid: string) => FeedbackPrefsLike | null,
): ScheduleFeedbackPlan {
  const plan: ScheduleFeedbackPlan = { loveMids: [], ratingWrites: [] }
  // The same schedule can occupy several rows (one per occurrence); plan it
  // once. Keyed on the sorted mid set rather than `sid` so a row without one
  // still dedupes.
  const seen = new Set<string>()

  for (const s of schedules) {
    const mids = collectScheduleMids(s.meeting.id, s.data)
    if (mids.length < 2) continue
    const key = [...mids].sort().join("|")
    if (seen.has(key)) continue
    seen.add(key)

    let lovedCount = 0
    let maxRates = 0
    let ratesDisagree = false
    const prefs = mids.map((mid) => lookup(mid) ?? { loves: false, rates: 0 })
    for (const p of prefs) {
      if (p.loves) lovedCount++
      if (p.rates > maxRates) maxRates = p.rates
    }
    if (lovedCount > 0 && lovedCount < mids.length) plan.loveMids.push(mids)
    if (maxRates > 0) {
      ratesDisagree = prefs.some((p) => p.rates !== maxRates)
      if (ratesDisagree) plan.ratingWrites.push({ mids, rates: maxRates })
    }
  }

  return plan
}
