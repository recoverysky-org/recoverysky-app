/**
 * presenceLogic — pure decision logic for GPS-verified in-person attendance.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it (vitest
 * has no path-alias resolution in this repo — see CLAUDE.md "Test Runner
 * Split"). The I/O half — permission, taking the fix — lives in
 * `@/hooks/usePresenceCheck`.
 *
 * See docs/superpowers/specs/2026-08-05-gps-in-person-attendance-design.md.
 */

import { distanceMeters } from "./nearbyLogic"

/**
 * Default radius, in meters, within which a user counts as present.
 *
 * Phone GPS is 5–20 m outdoors but 30–100 m indoors, and recovery meetings
 * are always indoors — often a church basement or a hospital wing. Tighter
 * rejects real attendees; looser is theater. Overridable from the server via
 * `configStore.presenceRadiusM` so it can be retuned without a build.
 */
export const DEFAULT_PRESENCE_RADIUS_M = 150

/**
 * Fallback radius for `__DEV__` builds, until the server's
 * `DEV_PRESENCE_RADIUS_M` arrives via /config.
 *
 * A simulator reports whatever fixed location Xcode/Android Studio is
 * simulating (Apple HQ by default), which is never within 150 m of a real
 * meeting venue, so every "I'm Here" tap fails "out-of-range" and the whole
 * timer path below the gate is untestable locally. 10 km is wide enough to
 * cover a simulated location against venues in the same metro, and matches the
 * browse radius useNearbySchedules already uses.
 *
 * The `__DEV__` selection happens in `ConfigStore.effectivePresenceRadiusM` —
 * NOT here — because `__DEV__` is a React Native global that does not exist
 * under vitest, and this module must stay importable by the pure tests (see
 * CLAUDE.md "Test Runner Split").
 */
export const DEV_PRESENCE_RADIUS_M = 10_000

export type PresenceReason = "in-range" | "out-of-range" | "no-venue-coords"

export interface PresenceFix {
  lat: number
  lon: number
  /** Reported horizontal accuracy in meters, when the platform supplies it. */
  accuracyM?: number
}

export interface PresenceVenue {
  latitude?: number
  longitude?: number
}

export interface PresenceInput {
  fix: PresenceFix
  venue: PresenceVenue
  radiusM: number
}

export interface PresenceResult {
  inRange: boolean
  /** Undefined ONLY on the "no-venue-coords" branch. */
  distanceM?: number
  reason: PresenceReason
}

/**
 * Decide whether a fix places the user at the venue.
 *
 * Venue-coordinate validity is delegated entirely to `distanceMeters`, which
 * already returns undefined for missing, non-finite, and (0, 0) coordinates —
 * null island is a real placeholder in this data for ungeocodable venues. Do
 * NOT add a second validity check here; two rules that can disagree is how
 * "verified" starts meaning different things in different files.
 *
 * The boundary is INCLUSIVE (`<=`). A user measured at exactly the radius is
 * in — the gate should not reject someone standing on the line.
 *
 * The fix's own `accuracyM` deliberately does NOT widen the radius. It is
 * recorded on the attendance record for audit only. Widening by accuracy would
 * make the gate stochastic: the same user in the same chair would pass or fail
 * depending on GPS conditions, and a record would no longer mean one thing.
 */
export function verifyPresence(input: PresenceInput): PresenceResult {
  const distanceM = distanceMeters({ lat: input.fix.lat, lon: input.fix.lon }, input.venue)

  if (distanceM === undefined) {
    return { inRange: false, reason: "no-venue-coords" }
  }

  if (distanceM <= input.radiusM) {
    return { inRange: true, distanceM, reason: "in-range" }
  }

  return { inRange: false, distanceM, reason: "out-of-range" }
}
