/**
 * nearbyLogic — pure decision logic for the In-Person segment.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it
 * (vitest has no path-alias resolution in this repo — see CLAUDE.md
 * "Test Runner Split"). I/O lives in useNearbySchedules.
 */

// Relative, not `@/` — vitest has no alias (CLAUDE.md "Test Runner Split").
import { sortByFeedback, type FeedbackSortable } from "./feedbackSort"

export type NearbyMode = "locating" | "nearby" | "fallback"

export interface NearbyModeInput {
  /** In-Person segment has been activated at least once */
  active: boolean
  permission: "undetermined" | "granted" | "denied"
  fix: "pending" | "acquired" | "failed"
  /** The /schedules/nearby fetch failed after retry */
  nearbyFetchFailed: boolean
}

/**
 * Resolve the segment's display mode. Order matters: permission denial
 * and fix failure route to fallback *before* fetch health is considered.
 *
 * CHANGED 2026-08-04: "fallback" no longer implies a day-browse list. Without
 * a position the segment now renders an empty state instead of every in-person
 * meeting on the server (see useNearbySchedules.fetchMeetings) — a worldwide
 * list of places you can't drive to was never "something useful". The mode
 * values are unchanged; only what fallback renders is.
 */
export function resolveMode(input: NearbyModeInput): NearbyMode {
  if (!input.active) return "locating"
  if (input.permission === "undetermined") return "locating"
  if (input.permission === "denied") return "fallback"
  if (input.fix === "pending") return "locating"
  if (input.fix === "failed") return "fallback"
  return input.nearbyFetchFailed ? "fallback" : "nearby"
}

/**
 * Why the segment is in fallback mode, which is also what the banner says and
 * what tapping it does.
 *
 * CHANGED 2026-08-04: "denied" and "fixFailed" used to be a single "location"
 * reason, so a user whose permission was granted but whose GPS fix had timed
 * out was told to "enable location" — advice they had already taken, for a
 * control that was already on. They are different problems with different
 * remedies (Settings vs. retry) and the copy has to say so.
 */
export type NearbyBannerReason =
  /** Permission refused (or never granted). */
  | "denied"
  /** Permission granted, but we could not obtain a position. */
  | "fixFailed"
  /** Located fine; /schedules/nearby failed after its retry. */
  | "nearbyFailed"

/**
 * Resolve the banner reason, or null when no banner belongs on screen.
 *
 * Denial is checked before fetch health on purpose: a denied user never
 * reaches the nearby endpoint, so a stale failure flag from an earlier grant
 * must not out-rank the reason they are actually looking at.
 */
export function resolveBannerReason(input: NearbyModeInput): NearbyBannerReason | null {
  if (resolveMode(input) !== "fallback") return null
  if (input.permission === "denied") return "denied"
  if (input.nearbyFetchFailed) return "nearbyFailed"
  return "fixFailed"
}

/**
 * Degrees of latitude/longitude below which two fixes are treated as the same
 * place. 0.0025° is ~275 m of latitude (and less than that of longitude away
 * from the equator, so this is conservative in the direction that matters).
 *
 * Sized against what it guards, not against GPS accuracy: the only consumer of
 * a position here is a radius filter whose smallest option is 10 km. A quarter
 * of a kilometre cannot change which meetings fall inside that, so a "new" fix
 * that close to the last one is not worth a refetch.
 */
const SAME_POSITION_EPSILON_DEG = 0.0025

/**
 * True when a freshly acquired fix is close enough to the one we already hold
 * that re-running the search would return the same rows.
 *
 * Exists because both location hooks now seed from the OS's cached position
 * before taking a real fix (see their headers): without this, every activation
 * would bump `fixVersion` twice and spend two network requests to render the
 * identical list. Deliberately a flat degree box rather than a haversine — the
 * threshold is two orders of magnitude below the smallest radius option, so
 * precision here buys nothing.
 */
export function isNearlySamePosition(
  a: { lat: number; lon: number } | null,
  b: { lat: number; lon: number } | null,
): boolean {
  if (!a || !b) return false
  return (
    Math.abs(a.lat - b.lat) < SAME_POSITION_EPSILON_DEG &&
    Math.abs(a.lon - b.lon) < SAME_POSITION_EPSILON_DEG
  )
}

export const RADIUS_OPTIONS_KM: readonly number[] = [10, 25, 50, 100]
export const DEFAULT_RADIUS_KM = 25
/** Server-enforced maximum radius on /schedules/nearby (meters). */
export const MAX_RADIUS_M = 100_000

export interface NearbyParams {
  lat: number
  lon: number
  radius: number
  iso_dow: number
  fellowship?: string
}

/**
 * Build /schedules/nearby query params. Exactly these keys — the server
 * silently strips unknown params (a sent `limit` would "work" while doing
 * nothing; it was removed from the API 2026-08-03), and `venueType` /
 * `tz` must not be sent (in_person is the default; tz isn't accepted).
 *
 * `isoDow` accepts `ANY_DAY` (0) for "all seven days" — see that constant in
 * `filterLogic.ts` for why the sentinel is sent explicitly instead of omitting
 * the param. It passes straight through with no special-casing here; the
 * server owns the meaning.
 */
export function buildNearbyParams(
  lat: number,
  lon: number,
  radiusKm: number,
  isoDow: number,
  fellowship?: string,
): NearbyParams {
  const radius = Math.min(Math.round(radiusKm * 1000), MAX_RADIUS_M)
  const params: NearbyParams = { lat, lon, radius, iso_dow: isoDow }
  if (fellowship) params.fellowship = fellowship
  return params
}

/**
 * Nearest-first. Entries missing `distance_m` sort last — the API emits
 * number-or-omitted (never null; tightened at our request 2026-08-03), so
 * a missing value only appears on an API regression and must degrade to
 * "at the bottom", never a crash.
 */
export function sortByDistance<T extends { distance_m?: number }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (a.distance_m ?? Number.POSITIVE_INFINITY) - (b.distance_m ?? Number.POSITIVE_INFINITY),
  )
}

/** Device-local minutes since midnight: 12:00am → 0, 11:59pm → 1439. */
export function localMinutes(millis: number): number {
  const d = new Date(millis)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Sort by local wall-clock time (hour:minute), not raw UTC millis —
 * mirrors the merged-pool ordering ListingsScreen established in the
 * 2026-08-02 data-layer piece.
 *
 * THE ONE CLOCK KEY (Jenova, 2026-09-08). Every time-ordered list — Search,
 * the In-Person "start" order, and the within-day order under "Any" day —
 * uses this midnight-anchored, AM-first key. A noon-rotated variant
 * (`sortByLocalTimePmFirst`, 2026-08-12 → 2026-09-08) used to lead Search
 * with the evening rows on the argument that a far-east "Monday" meeting
 * lands on Sunday evening here; that reasoning is retired. The app takes a
 * purely local view: which day a meeting belongs to is the API's job, and the
 * app only orders by when each row happens on this device's clock. Don't
 * reintroduce a rotation here — change the server's day assignment instead.
 */
export function sortByLocalTime<T extends { millis: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    return localMinutes(a.millis) - localMinutes(b.millis)
  })
}

// REMOVED 2026-09-08: NOON_MINUTES / pmFirstMinutes / sortByLocalTimePmFirst.
// See the note on `sortByLocalTime` for why the noon rotation is gone.

/**
 * The device-local ISO weekday (1=Mon..7=Sun) a meeting's start instant falls
 * on, or null when the meeting has no meaningful day.
 *
 * ADDED 2026-08-14 for the "Any" day option: once a list can hold all seven
 * days, every row has to say which one it is.
 *
 * WHY THE WEEKDAY IS READ FROM `millis` AND NOT FROM A SERVER `iso_dow` — this
 * looks like the wrong source and is the right one. The retired
 * `sortByLocalTimePmFirst` docblock established that `millis`'s *date* is
 * untrustworthy: it carries the
 * vintage of whenever the row was last hydrated, so rows from one query
 * straddle multiple calendar weeks. Its *weekday* is a different matter and is
 * sound — every row of an `iso_dow=1` query is a Monday, whichever week it was
 * hydrated in, so the weekday survives the thing that ruins the date.
 *
 * Reading it locally is also the only version that agrees with the rest of the
 * row. A meeting the server lists as Monday in Sydney happens on *Sunday
 * evening* for a device in the Americas, and `formatMillisToLocalTime` already
 * renders it as a Sunday-evening time. Printing a server-supplied "Mon" beside
 * that would put a weekday and a time that contradict each other on one line.
 * The tz shift has to be applied to both or neither.
 *
 * `millis === 0` is the 24/7 marathon meetings, which `MeetingRow` renders as
 * "24h". They return null: they run continuously, so labelling one with the
 * weekday the epoch happens to land on in the device's zone would be a
 * fabrication, not a rounding.
 */
export function localIsoDow(millis: number): number | null {
  if (!Number.isFinite(millis) || millis === 0) return null
  const jsDay = new Date(millis).getDay()
  return jsDay === 0 ? 7 : jsDay
}

/**
 * Sort an all-days result set by weekday first — starting from TODAY and
 * rolling forward through the week — then by pm-first local clock within each
 * day.
 *
 * ADDED 2026-08-14 for the "Any" day option on the Search segment.
 *
 * Day-primary is the whole point. Applying `sortByLocalTime` alone to a
 * seven-day set interleaves the days into one clock order, so a Tuesday 7pm
 * meeting sits between two Saturday 7pm ones and the list stops being
 * scannable — the reader has to check the day badge on every single row to
 * make sense of the ordering.
 *
 * Rolling from today rather than from Monday because the question behind "Any
 * day" is "when is the next one I can get to", not "show me the calendar".
 * Today's remaining meetings lead; the day the user has already missed most of
 * ends up last, six days out, which is where it belongs.
 *
 * The In-Person segment deliberately does NOT use this — it stays nearest-first
 * (`sortByDistance`), because that segment's promise is proximity and the day
 * is a label there, not the axis.
 *
 * Meetings with no weekday (`millis === 0` — the 24/7 rooms) rank ahead of
 * today. They are available right now, which makes them the most actionable
 * answer to the question above, and there are only ever a handful of them.
 *
 * @param todayIsoDow - the device's current ISO weekday, injected rather than
 *   read from the clock so this stays pure (see `localIsoDow`'s siblings).
 */
export function sortByDayThenLocalTime<T extends { millis: number }>(
  items: T[],
  todayIsoDow: number,
): T[] {
  // -1 for the dayless 24/7 rooms, then 0 for today through 6 for "this day
  // last week", i.e. the furthest away the user could be from it.
  const dayRank = (millis: number): number => {
    const dow = localIsoDow(millis)
    if (dow === null) return -1
    return (dow - todayIsoDow + 7) % 7
  }

  return [...items].sort((a, b) => {
    const byDay = dayRank(a.millis) - dayRank(b.millis)
    if (byDay !== 0) return byDay
    // Same day: device-local start time from midnight, AM first.
    // CHANGED 2026-09-08 (Jenova): was the noon rotation Search used to
    // share; see `sortByLocalTime` for why that is retired.
    return localMinutes(a.millis) - localMinutes(b.millis)
  })
}

/**
 * The In-Person list's two sort orders. `"distance"` is nearest-first, the
 * segment's default and its whole promise; `"start"` is by local start time.
 *
 * ADDED 2026-09-06 (Jenova): a second pill beside the list/map one, so a user
 * planning their day can read the list as a timetable instead of a radius.
 * Kept to exactly two values on purpose — the pill design that carries it
 * (`SegmentedPill`) shows every option at once, and a third would not fit
 * beside its label on a small phone.
 */
export type InPersonSortOrder = "distance" | "start"

export const IN_PERSON_SORT_ORDERS: InPersonSortOrder[] = ["distance", "start"]

/** MMKV round-trip guard: anything that isn't a known order is the default. */
export function parseInPersonSortOrder(raw: string | undefined | null): InPersonSortOrder {
  return raw === "start" ? "start" : "distance"
}

/**
 * Apply the user's chosen sort to the In-Person list, favourites-first within
 * it (`sortByFeedback` is stable, so it layers over the primary key exactly
 * as `useNearbySchedules` does for the default order — see the comment there).
 *
 * `"start"` keys on the same clock the Search segment uses, and under "Any"
 * day rolls day-first from today (`sortByDayThenLocalTime`) so seven days
 * don't interleave into one clock order.
 * CHANGED 2026-09-08 (Jenova): that clock is now the midnight-anchored
 * `sortByLocalTime` — the same key the day-browse fallback uses — not the
 * noon rotation; see `sortByLocalTime` for the policy. Callers only offer this
 * sort in nearby mode, where every row carries a `distance_m`.
 *
 * `"distance"` re-sorts rather than trusting the incoming order, so the result
 * is correct no matter what the caller hands in (idempotent over an
 * already-sorted list, and the lists are small).
 *
 * @param todayIsoDow - injected, not read from the clock, so this stays pure.
 */
export function sortInPerson<T extends { millis: number; distance_m?: number } & FeedbackSortable>(
  items: T[],
  order: InPersonSortOrder,
  isAnyDay: boolean,
  todayIsoDow: number,
): T[] {
  if (order === "distance") return sortByFeedback(sortByDistance(items))
  return sortByFeedback(
    isAnyDay ? sortByDayThenLocalTime(items, todayIsoDow) : sortByLocalTime(items),
  )
}

const EARTH_RADIUS_M = 6_371_008.8

/**
 * Great-circle distance in meters between two points, or undefined when the
 * venue has no usable coordinates.
 *
 * WHY THIS EXISTS: `distance_m` is only ever populated by `/schedules/nearby`.
 * Every other path — the In-Person segment's day-browse fallback, and Search
 * whenever its radius is "Any" — returns venues with no distance at all, so
 * the badge silently disappeared on lists that were otherwise identical. The
 * meeting already carries its own `latitude`/`longitude`, so once we hold a
 * fix there is nothing to ask the server for.
 *
 * `(0, 0)` is treated as missing, matching `buildDirectionsUrl` above: sources
 * use null island as a placeholder for ungeocodable venues, and a real
 * "8,400 km away" badge on one of those is worse than no badge.
 *
 * Haversine on a spherical earth — accurate to ~0.5% at these distances, which
 * is far inside the rounding `formatDistance` already applies. Do not reach for
 * an ellipsoidal formula here; the badge says "3 mi".
 */
export function distanceMeters(
  from: { lat: number; lon: number },
  to: { latitude?: number; longitude?: number },
): number | undefined {
  const { latitude, longitude } = to
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    (latitude === 0 && longitude === 0)
  ) {
    return undefined
  }

  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(latitude - from.lat)
  const dLon = toRad(longitude - from.lon)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(latitude)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

const METERS_PER_MILE = 1609.344

/** Trim a trailing ".0" from a one-decimal string ("5.0" → "5"). */
function oneDecimal(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "")
}

/**
 * Human distance label. useMiles comes from the device locale's
 * measurement system (resolved in the hook — this stays pure).
 * Returns "" for undefined so callers can hide the badge.
 */
export function formatDistance(distanceM: number | undefined, useMiles: boolean): string {
  if (distanceM === undefined) return ""
  if (useMiles) {
    const mi = distanceM / METERS_PER_MILE
    return mi < 10 ? `${oneDecimal(mi)} mi` : `${Math.round(mi)} mi`
  }
  if (distanceM < 1000) return `${Math.round(distanceM)} m`
  const km = distanceM / 1000
  return km < 10 ? `${oneDecimal(km)} km` : `${Math.round(km)} km`
}

export interface DirectionsInput {
  platform: "ios" | "android" | "web"
  latitude?: number
  longitude?: number
  venueName?: string
  formattedAddress?: string
}

/**
 * Platform-appropriate directions deep link. Prefers coordinates, falls
 * back to the formatted address; returns "" when there is nothing to
 * link (caller hides the button). (0,0) is treated as missing — sources
 * use it as a null island placeholder for ungeocodable venues.
 */
export function buildDirectionsUrl(input: DirectionsInput): string {
  const { platform, latitude, longitude, venueName, formattedAddress } = input
  const hasCoords =
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !(latitude === 0 && longitude === 0)

  if (hasCoords) {
    const ll = `${latitude},${longitude}`
    if (platform === "ios") return `http://maps.apple.com/?daddr=${ll}`
    if (platform === "android") {
      const label = encodeURIComponent(venueName || formattedAddress || "Meeting")
      return `geo:${ll}?q=${ll}(${label})`
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ll)}`
  }

  if (!formattedAddress) return ""
  const addr = encodeURIComponent(formattedAddress)
  if (platform === "ios") return `http://maps.apple.com/?daddr=${addr}`
  if (platform === "android") return `geo:0,0?q=${addr}`
  return `https://www.google.com/maps/dir/?api=1&destination=${addr}`
}

/**
 * Compose a display address from decomposed street/city/state/postalCode
 * parts, falling back to `formattedAddress` when the API actually supplies
 * one.
 *
 * WHY THIS EXISTS: `formattedAddress` looks like the field the popup
 * should just read — it isn't. The API team queried the live DB and found
 * it populated on **0 of 55,617** active in-person meetings, across every
 * source host (BMLT and TSML alike). It's not a server bug or a
 * projection gap; upstream simply never fills it in. The decomposed parts
 * are populated instead: street 98.8%, city 99.1%, state 92%, postalCode
 * 96% (a `country` field is also populated 99% of the time but is not
 * accepted by this function — it isn't part of a US-style street address
 * display and pulling it in would need a second format branch for no
 * benefit today). Do not "simplify" this back to
 * `meeting.formattedAddress` without re-checking those numbers — that's
 * the exact regression this function exists to prevent.
 *
 * `formattedAddress` is still checked first and returned verbatim so the
 * app gets it for free the moment any upstream source starts populating
 * it — no client change needed then.
 *
 * Output shape mirrors US postal formatting: "<street>, <city>, <state>
 * <postalCode>". Every empty/missing segment is dropped before joining, so
 * a partial address never produces a stray leading/trailing comma or a
 * double space. Returns "" when nothing is available at all — the caller
 * (InPersonPopup) guards rendering with `!!composedAddress`, so an empty
 * result correctly hides the address line rather than rendering blank.
 */
export function composeAddress(m: {
  formattedAddress?: string
  street?: string
  city?: string
  state?: string
  postalCode?: string
}): string {
  if (m.formattedAddress) return m.formattedAddress

  // "City, State" first — comma only appears when both are present.
  const cityState = [m.city, m.state].filter(Boolean).join(", ")
  // Postal code rides after that group with a space (postal convention).
  // CHANGED 2026-08-03: the comment here previously claimed the postal
  // code is dropped when there's no city/state — that's backwards.
  // `filter(Boolean)` drops the *empty* cityState string, not the postal
  // code, so when city and state are both absent the postal code becomes
  // the entire group on its own (e.g. street + bare zip, no comma). City
  // is populated 99.1% of the time so this is a rare edge case, and
  // "<street>, <zip>" is a reasonable degraded display — behavior is
  // unchanged, only this comment was wrong.
  const cityStateZip = [cityState, m.postalCode].filter(Boolean).join(" ")
  // Street leads, then the city/state/zip group, joined by a comma —
  // either side drops out cleanly if empty.
  return [m.street, cityStateZip].filter(Boolean).join(", ")
}
