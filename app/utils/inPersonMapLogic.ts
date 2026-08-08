/**
 * inPersonMapLogic — pure decision logic for the In-Person segment's map view.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it (see
 * CLAUDE.md "Test Runner Split"). `@recoverysky-org/common/browser` is a
 * normal node_modules dependency and is fine. I/O — the GL component, MMKV,
 * stores — lives in InPersonMapView / InPersonScreen.
 *
 * Spec: docs/superpowers/specs/2026-08-07-in-person-map-view-design.md
 */

import { FELLOWSHIP_COLORS, Fellowship } from "@recoverysky-org/common/browser"

export interface MapVenueMeeting {
  id: string
  latitude?: number
  longitude?: number
  approximate?: boolean
  fellowship?: string
}

export interface VenueFeatureProperties {
  /**
   * Comma-joined meeting ids at this venue. A scalar string, NOT an array:
   * GL feature properties round-trip through the native bridge on tap, and
   * arrays have historically deserialized inconsistently across platforms.
   * parseVenueIds() is the only sanctioned reader.
   */
  ids: string
  count: number
  color: string
  approximate: boolean
}

export interface PointFeature {
  type: "Feature"
  geometry: { type: "Point"; coordinates: [number, number] }
  properties: VenueFeatureProperties
}

export interface VenueFeatureCollection {
  type: "FeatureCollection"
  features: PointFeature[]
}

/**
 * Same (0,0)-is-missing rule as buildDirectionsUrl / distanceMeters in
 * nearbyLogic.ts: sources use null island as a placeholder for ungeocodable
 * venues, and a pin in the Gulf of Guinea is worse than no pin.
 */
export function hasUsableCoords(m: { latitude?: number; longitude?: number }): boolean {
  const { latitude, longitude } = m
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !(latitude === 0 && longitude === 0)
  )
}

/** Mirrors MeetingRow's accent resolution: known fellowship color or NONE. */
export function fellowshipColor(fellowship?: string): string {
  return FELLOWSHIP_COLORS[fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]
}

/**
 * ~11 cm at 6 decimals — two meetings this close are the same venue. Grouping
 * matters because co-located same-day meetings would otherwise become a
 * cluster that can never expand (the points are identical, so no zoom level
 * separates them) — the map would have unreachable meetings.
 */
const VENUE_KEY_DECIMALS = 6

export function venuesToFeatureCollection(meetings: MapVenueMeeting[]): VenueFeatureCollection {
  const byVenue = new Map<string, MapVenueMeeting[]>()
  for (const m of meetings) {
    if (!hasUsableCoords(m)) continue
    const key = `${m.latitude!.toFixed(VENUE_KEY_DECIMALS)},${m.longitude!.toFixed(VENUE_KEY_DECIMALS)}`
    const list = byVenue.get(key)
    if (list) list.push(m)
    else byVenue.set(key, [m])
  }

  const features: PointFeature[] = []
  for (const group of byVenue.values()) {
    const first = group[0]
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [first.longitude!, first.latitude!] },
      properties: {
        ids: group.map((m) => m.id).join(","),
        count: group.length,
        color: fellowshipColor(first.fellowship),
        // `some`, not `first.approximate`: if ANY source flagged this
        // coordinate as fuzzed, the whole venue renders as an area, never a
        // precise pin (spec decision #7 — deliberately-imprecise venues must
        // not be pinpointed).
        approximate: group.some((m) => m.approximate === true),
      },
    })
  }
  return { type: "FeatureCollection", features }
}

/** Only sanctioned reader of VenueFeatureProperties.ids — see its comment. */
export function parseVenueIds(ids: unknown): string[] {
  if (typeof ids !== "string" || ids === "") return []
  return ids.split(",")
}
