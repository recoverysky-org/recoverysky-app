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
 * online meetings show. `"hybrid"` is not a venue type anymore (v2.0.0 moved
 * it to a boolean `hybrid` field) — it is matched here only so a stale row
 * can never be misclassified as in-person.
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
 */
export function projectOnline<T extends { venueType: string }>(items: T[]): T[] {
  return items.filter((item) => !isInPersonVenue(item.venueType))
}
