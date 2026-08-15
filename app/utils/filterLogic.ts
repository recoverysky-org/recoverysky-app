/**
 * Pure filter logic for the Meetings tab's three segments.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it — see the
 * "Test Runner Split" section of CLAUDE.md, and the sibling modules
 * `nearbyLogic.ts` / `returnToLogic.ts` / `syncLogic.ts` that follow the same
 * shape. Type-only imports would be fine (they're erased); value imports are
 * not.
 *
 * Holds the `shortTime` bucket definitions and their predicate (In-Person's
 * Time filter), the day-of-week vocabulary shared by both day pickers, plus the
 * Search segment's venue / radius / extended-time choices.
 */

import type { TxKeyPath } from "@/i18n"

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

// ============================================================================
// Search segment: venue
// ============================================================================

/**
 * Venue choice for the Search segment's Venue filter.
 *
 * These are the same two values as `VenueFilter` in `app/services/api` (the
 * wire value), but this is the *UI* choice and stays a separate type: there is
 * no value-to-value converter, because `poolsForVenue` turns the choice into
 * "which legs run" and each leg passes its own literal wire value.
 *
 * CHANGED 2026-08-04: dropped the third choice, `"all"`. Jenova's call — a
 * mixed list is the one result set where a row's most important fact (can I
 * walk there, or do I open Zoom?) had to be carried by a tag the eye may not
 * reach, and every other surface in the app is single-venue. Removing it also
 * removes the state where Search silently fetched two pools, and with them a
 * location prompt the user never asked for. If you re-add it, the Online tag
 * on `MeetingRow` (removed with it) has to come back too.
 */
export type VenueChoice = "online" | "in_person"

/** Selector order. `online` leads because it's the default. */
export const VENUE_OPTIONS: readonly VenueChoice[] = ["online", "in_person"]

/**
 * Default venue. Online: it needs no location, so a first visit still asks for
 * nothing, and it matches what the server returns when the param is omitted.
 */
export const DEFAULT_VENUE: VenueChoice = "online"

/**
 * Which venue choices the picker may offer, given the Settings → Permissions
 * Location toggle.
 *
 * ADDED 2026-08-12: an in-person search is a distance search — it exists only
 * as `/schedules/nearby` around a fix — so with the toggle off it can never
 * return anything. Search used to offer the choice anyway and answer with an
 * empty list plus a dimmed "Location off" radius cell, while the In-Person
 * segment (same data, same toggle) explains itself with a banner. Offering a
 * control that cannot work is the part that reads as broken, so the option is
 * removed and `venueLocationBlocked` below puts the explanation on screen.
 */
export function venueOptionsFor(locationEnabled: boolean): readonly VenueChoice[] {
  return locationEnabled ? VENUE_OPTIONS : VENUE_OPTIONS.filter((v) => !radiusAppliesTo(v))
}

/**
 * The venue choice that survives the current location state.
 *
 * Load-bearing for the toggle-flipped-while-you-were-here case: the Meetings
 * tab stays mounted behind Settings, so a user can be sitting on an In-Person
 * search when the switch goes off. Without this coercion the selector's value
 * column would name an option the picker no longer lists, over a list that can
 * only ever be empty.
 */
export function coerceVenue(choice: VenueChoice, locationEnabled: boolean): VenueChoice {
  return venueOptionsFor(locationEnabled).includes(choice) ? choice : DEFAULT_VENUE
}

/**
 * Does a meeting's `venueType` satisfy the chosen venue filter?
 *
 * Venue semantics are the common lib's: `""` (legacy online rows scraped
 * before VenueType existed) and `"online"` are both online; only `"in_person"`
 * is in-person. That one-liner is duplicated from `isInPersonVenue` in
 * `app/context/meetingPools.ts` rather than imported, because this module must
 * stay free of runtime `@/` imports for vitest (see the header). If the venue
 * vocabulary ever grows a third value, both copies change together.
 */
export function matchesVenue(venueType: string, choice: VenueChoice): boolean {
  const isInPerson = venueType === "in_person"
  return choice === "in_person" ? isInPerson : !isInPerson
}

/**
 * Which pools a venue choice needs fetched.
 *
 * Returned as a pair rather than a single value because the Search fetch has to
 * decide *before* it knows what the rows look like — skipping a pool is the
 * whole point (an online-only search shouldn't spend a request, or a location
 * prompt, on in-person meetings).
 *
 * CHANGED 2026-08-04: with `"all"` gone, exactly one flag is true for every
 * choice. The pair shape stays because both call sites read the flags
 * independently, and because a future third venue could again need two legs.
 */
export function poolsForVenue(choice: VenueChoice): {
  online: boolean
  inPerson: boolean
} {
  return {
    online: choice === "online",
    inPerson: choice === "in_person",
  }
}

// ============================================================================
// Day of week — shared by BOTH day pickers (In-Person and Search)
// ============================================================================

/**
 * ISO day of week: 1=Monday..7=Sunday, in picker order.
 *
 * MOVED HERE 2026-08-14 from `app/components/DaySelectorModal.tsx`. It had
 * lived in the modal since the In-Person segment started sharing that picker,
 * which was fine while the modal was the only thing that needed to name a
 * weekday. `MeetingRow` now needs the same labels for its "Any" day badge, and
 * a row component reaching into a modal for its vocabulary is backwards — so
 * the list sits with `ANY_DAY` and `coerceDay` instead, and the modal imports
 * it like everyone else.
 *
 * Keys stay in the `listingsScreen` namespace even though three surfaces now
 * use them — renaming i18n keys would churn all nine translation files for zero
 * user value. The strings are abbreviated ("Mon"), which is what lets
 * `MeetingRow` prefix a time with one without wrapping the row.
 */
export const ISO_DAYS: { iso: number; tx: TxKeyPath }[] = [
  { iso: 1, tx: "listingsScreen:monday" },
  { iso: 2, tx: "listingsScreen:tuesday" },
  { iso: 3, tx: "listingsScreen:wednesday" },
  { iso: 4, tx: "listingsScreen:thursday" },
  { iso: 5, tx: "listingsScreen:friday" },
  { iso: 6, tx: "listingsScreen:saturday" },
  { iso: 7, tx: "listingsScreen:sunday" },
]

/**
 * Sentinel day meaning "every day of the week".
 *
 * Zero is safe because ISO 8601 numbers weekdays 1 (Monday) through 7 (Sunday)
 * and never uses 0, so this can never collide with a real selection. It is also
 * the wire value: `/schedules/daily` and `/schedules/nearby` both accept
 * `iso_dow=0` as "all seven days" (API change 2026-08-14).
 *
 * Sent EXPLICITLY rather than by omitting the param. Both endpoints silently
 * strip params they don't recognise, so an omitted `iso_dow` is
 * indistinguishable from a client bug that dropped it — and such a bug would
 * then quietly *succeed*, answering with a whole week the user never asked for.
 * An explicit sentinel also greps cleanly across both codebases.
 */
export const ANY_DAY = 0

/**
 * May the Day picker offer "Any" for this venue choice?
 *
 * In-person only, and the reason is the size of the answer rather than anything
 * technical. An in-person search is bounded by a radius, so "Any day" in a
 * sparse region collapses a week of manual paging into one short list — which
 * is the entire point of the feature. An online search has no such bound: one
 * day is already ~500 rows, so seven days is a wall nobody scrolls, and the
 * feature would be pure noise for exactly the users who have the most results.
 *
 * NOTE the deliberate asymmetry with `venueOptionsFor`, which *removes* the
 * In-Person venue outright when location is off. Any is disabled-but-visible
 * instead. The two cases differ: a location-less in-person search is a control
 * that cannot work at all and reads as broken, whereas a hidden Any is a
 * feature nobody in a sparse area ever discovers — and they're the ones it's
 * for. Visible-with-a-reason is the right trade only in the second case.
 */
export function anyDayAllowedFor(choice: VenueChoice): boolean {
  return choice === "in_person"
}

/**
 * The day selection that survives the current venue choice.
 *
 * Mirrors `coerceVenue` exactly, for the same class of bug: without it,
 * switching Search to Online while "Any" is selected leaves a seven-day list on
 * screen under a picker whose Any row is now greyed out, and the next fetch
 * would send `iso_dow=0` for a pool we've just decided must never receive it.
 *
 * `todayIsoDow` is injected rather than read from the clock so this stays pure
 * and testable — the same reason the sort functions in `nearbyLogic` take it.
 */
export function coerceDay(day: number, choice: VenueChoice, todayIsoDow: number): number {
  return day === ANY_DAY && !anyDayAllowedFor(choice) ? todayIsoDow : day
}

// ============================================================================
// Search segment: radius
// ============================================================================

// REMOVED 2026-08-04: `RADIUS_ANY`. Search's radius briefly had an "Any"
// option and defaulted to it, so the tab could work without ever asking for
// location. Jenova's call: Search offers the same fixed radius list as the
// In-Person segment and nothing else — an unbounded distance search isn't a
// meaningful thing to ask for, and two pickers for one concept shouldn't
// disagree about what they offer. The lazy-permission rule is preserved
// differently now: the radius is only *applied* once a fix exists, and the
// prompt fires when the user opens the radius picker rather than on arrival.

/** Radius applies to in-person venues only — online meetings have no place. */
export function radiusAppliesTo(choice: VenueChoice): boolean {
  return choice === "in_person"
}

// ============================================================================
// Search segment: time
// ============================================================================

/**
 * Search's Time filter: In-Person's four buckets plus an explicit custom
 * hour range.
 *
 * `custom` exists here and NOT in `SHORT_TIME_OPTIONS` on purpose. In-Person
 * offers presets only; Search has always had start/end hour pickers and this
 * folds them into the same control instead of spending a permanent row on a
 * range most users never change. Adding `custom` to `ShortTime` would leak an
 * option In-Person has no picker for.
 */
export type SearchTime = ShortTime | "custom"

export const SEARCH_TIME_OPTIONS: readonly SearchTime[] = [...SHORT_TIME_OPTIONS, "custom"]

/** Same neutral default as In-Person. */
export const DEFAULT_SEARCH_TIME: SearchTime = DEFAULT_SHORT_TIME

/**
 * Does a meeting's local start hour fall inside [startHour, endHour)?
 *
 * End-exclusive, matching the range the Search pickers have always produced:
 * start is 0–23, end is 1–24, and 24 means "through midnight". A meeting at
 * 23:30 is in [23, 24) but not in [22, 23).
 */
export function matchesHourRange(millis: number, startHour: number, endHour: number): boolean {
  const hour = new Date(millis).getHours()
  return hour >= startHour && hour < endHour
}

/**
 * The one predicate the Search list filters on, folding both time modes into
 * one call so the screen never has to branch on which mode is active.
 */
export function matchesSearchTime(
  millis: number,
  choice: SearchTime,
  startHour: number,
  endHour: number,
): boolean {
  if (choice === "custom") return matchesHourRange(millis, startHour, endHour)
  return matchesShortTime(millis, choice)
}
