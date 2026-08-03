/**
 * nearbyLogic — pure decision logic for the In-Person segment.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it
 * (vitest has no path-alias resolution in this repo — see CLAUDE.md
 * "Test Runner Split"). I/O lives in useNearbySchedules.
 */

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
 * and fix failure route to fallback (day-browse) *before* fetch health is
 * considered — the segment must always render something useful.
 */
export function resolveMode(input: NearbyModeInput): NearbyMode {
  if (!input.active) return "locating"
  if (input.permission === "undetermined") return "locating"
  if (input.permission === "denied") return "fallback"
  if (input.fix === "pending") return "locating"
  if (input.fix === "failed") return "fallback"
  return input.nearbyFetchFailed ? "fallback" : "nearby"
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

/**
 * Sort by local wall-clock time (hour:minute), not raw UTC millis —
 * mirrors the merged-pool ordering ListingsScreen established in the
 * 2026-08-02 data-layer piece.
 */
export function sortByLocalTime<T extends { millis: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = new Date(a.millis)
    const dbb = new Date(b.millis)
    return da.getHours() * 60 + da.getMinutes() - (dbb.getHours() * 60 + dbb.getMinutes())
  })
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

/** Same local calendar day (device timezone) — the "I'm Here" double-log guard. */
export function isSameLocalDay(aMillis: number, bMillis: number): boolean {
  const a = new Date(aMillis)
  const b = new Date(bMillis)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
