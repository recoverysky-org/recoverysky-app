/**
 * Pure meeting-pool logic — dual-fetch merge and the online-only hold-back
 * projection for in-person meeting data.
 *
 * ZERO runtime imports (not even type-only needed) — this file is
 * vitest-tested and vitest has no path-alias config (see the project testing
 * convention in CLAUDE.md and app/services/sync/syncLogic.ts).
 *
 * Venue semantics (common v2.0.0): meetings carry venueType `""` (legacy
 * online rows scraped before VenueType existed), `"online"`, or
 * `"in_person"`. The legacy `""` IS online and must stay visible wherever
 * online meetings show. Only the literal `"in_person"` is ever treated as
 * in-person — every other value, known (`""`, `"online"`) or stale/unknown
 * (e.g. a future venue type, or `"hybrid"`, which v2.0.0 moved to a boolean
 * `hybrid` field and is no longer a venue type at all), falls through to
 * online. A row can never be silently misclassified as in-person.
 * CHANGED 2026-08-02: reworded — the previous version described the
 * "hybrid" test case, not the actual module invariant.
 */

/** Result of one venue pool's fetch after retries. */
export interface PoolOutcome<T> {
  ok: boolean
  items: T[]
}

export interface MergedPools<T> {
  /** Successful pools concatenated, online first. */
  items: T[]
  /** True only when BOTH pools failed — the only case the UI shows an error. */
  bothFailed: boolean
  onlineFailed: boolean
  inPersonFailed: boolean
}

/**
 * Merge the two venue pools into one in-memory list.
 *
 * Failed pools contribute nothing even if they carry items — a failed
 * retry outcome may hold a stale/partial result and must not leak rows.
 */
export function mergePools<T>(online: PoolOutcome<T>, inPerson: PoolOutcome<T>): MergedPools<T> {
  const items: T[] = [...(online.ok ? online.items : []), ...(inPerson.ok ? inPerson.items : [])]
  return {
    items,
    bothFailed: !online.ok && !inPerson.ok,
    onlineFailed: !online.ok,
    inPersonFailed: !inPerson.ok,
  }
}

/** True only for the literal in-person venue type. */
export function isInPersonVenue(venueType: string): boolean {
  return venueType === "in_person"
}

/**
 * Hold-back projection: what pre-in-person UI surfaces render. Excludes
 * in_person rows and nothing else (legacy "" rows are online — see module
 * header). When the in-person UI/UX lands, consumers switch off this
 * projection deliberately, surface by surface.
 *
 * Surfaces switched off so far:
 * - **Search** (`ListingsScreen`), 2026-08-04 — replaced by the user-facing
 *   Venue filter, which calls `matchesVenue` (`app/utils/filterLogic.ts`)
 *   instead. Same self-verification, but now the user picks.
 *
 * Still projected: **Live** (`MeetingContext.liveMeetings`). Live is an
 * "in session right now, tap to join" surface, which an in-person meeting
 * can't satisfy — that hold-back is a product decision, not a pending task,
 * so don't remove it just to finish the list.
 */
export function projectOnline<T extends { venueType: string }>(items: T[]): T[] {
  return items.filter((item) => !isInPersonVenue(item.venueType))
}

/**
 * Build the in-person PoolOutcome, self-verified rather than trusted.
 *
 * A server that doesn't understand (or silently strips) the `venueType`
 * param answers the `venueType=in_person` call with the same rows as the
 * `venueType=online` call — that's exactly what the currently-deployed
 * production API does. Without this filter, those rows would merge in as
 * duplicates of the online pool (see CHANGELOG / final-review-report
 * 2026-08-02, Critical #1). Filtering by the actual venueType field makes an
 * unaware server yield an empty in-person pool, so `mergePools` output
 * equals the online pool exactly — genuinely zero visible change, which is
 * what the hold-back invariant promises regardless of what the server does.
 */
export function inPersonPoolOf<T extends { venueType: string }>(
  ok: boolean,
  items: T[],
): PoolOutcome<T> {
  return { ok, items: ok ? items.filter((i) => isInPersonVenue(i.venueType)) : [] }
}
