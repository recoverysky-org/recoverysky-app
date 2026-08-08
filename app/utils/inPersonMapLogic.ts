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

export interface CameraBounds {
  ne: [number, number]
  sw: [number, number]
}

export interface CenterZoomCamera {
  centerCoordinate: [number, number]
  zoomLevel: number
}

const KM_PER_DEGREE_LAT = 111.32

/**
 * Bounding box around a search center sized to the radius. A flat
 * degrees-per-km conversion, not geodesy: the camera fit is cosmetic and the
 * radii are ≤100 km. cos() clamp keeps the box finite near the poles.
 */
export function boundsForRadius(lat: number, lon: number, radiusKm: number): CameraBounds {
  const dLat = radiusKm / KM_PER_DEGREE_LAT
  const dLon = radiusKm / (KM_PER_DEGREE_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  return { ne: [lon + dLon, lat + dLat], sw: [lon - dLon, lat - dLat] }
}

/** Padding applied around the venue extent; also the floor that keeps a
 * single-venue "box" from being a zero-area point the camera can't fit. */
const VENUE_BOUNDS_PAD_DEG = 0.01

export function boundsForVenues(fc: VenueFeatureCollection): CameraBounds | null {
  if (fc.features.length === 0) return null
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const f of fc.features) {
    const [lon, lat] = f.geometry.coordinates
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return {
    ne: [maxLon + VENUE_BOUNDS_PAD_DEG, maxLat + VENUE_BOUNDS_PAD_DEG],
    sw: [minLon - VENUE_BOUNDS_PAD_DEG, minLat - VENUE_BOUNDS_PAD_DEG],
  }
}

/**
 * Continent-level default cameras by device region — the fallback-mode camera
 * when there is no fix and no pins to frame (spec, Error handling #5). Coarse
 * on purpose: it frames a continent, not the user. regionCode comes from
 * expo-localization at the call site so this stays pure.
 */
const REGION_CAMERAS: Record<string, CenterZoomCamera> = {
  US: { centerCoordinate: [-98, 39], zoomLevel: 3 },
  CA: { centerCoordinate: [-98, 56], zoomLevel: 3 },
  MX: { centerCoordinate: [-102, 24], zoomLevel: 4 },
  BR: { centerCoordinate: [-52, -14], zoomLevel: 3 },
  GB: { centerCoordinate: [-2, 54], zoomLevel: 5 },
  IE: { centerCoordinate: [-8, 53], zoomLevel: 6 },
  DE: { centerCoordinate: [10, 51], zoomLevel: 5 },
  FR: { centerCoordinate: [2, 47], zoomLevel: 5 },
  ES: { centerCoordinate: [-4, 40], zoomLevel: 5 },
  PT: { centerCoordinate: [-8, 39.5], zoomLevel: 6 },
  UA: { centerCoordinate: [31, 49], zoomLevel: 5 },
  RU: { centerCoordinate: [90, 60], zoomLevel: 2 },
  TH: { centerCoordinate: [101, 15], zoomLevel: 5 },
  AU: { centerCoordinate: [134, -26], zoomLevel: 3 },
  NZ: { centerCoordinate: [173, -41], zoomLevel: 5 },
  ZA: { centerCoordinate: [25, -29], zoomLevel: 5 },
  IN: { centerCoordinate: [79, 22], zoomLevel: 4 },
}

const WORLD_CAMERA: CenterZoomCamera = { centerCoordinate: [0, 20], zoomLevel: 1 }

export function defaultCameraForRegion(
  regionCode: string | null | undefined,
): CenterZoomCamera {
  if (!regionCode) return WORLD_CAMERA
  return REGION_CAMERAS[regionCode.toUpperCase()] ?? WORLD_CAMERA
}

/**
 * The toggle renders only when the map can actually work: never on web
 * (@maplibre/maplibre-react-native is native-only — spec decision #10), and
 * only when the server sent BOTH style URLs. An empty field is the remote
 * kill switch (spec "Config & keys"), not an error state.
 */
export function shouldShowMapToggle(input: {
  platform: string
  styleUrlLight: string
  styleUrlDark: string
}): boolean {
  if (input.platform === "web") return false
  return input.styleUrlLight !== "" && input.styleUrlDark !== ""
}
