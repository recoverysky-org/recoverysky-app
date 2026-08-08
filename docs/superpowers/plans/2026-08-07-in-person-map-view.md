# In-Person Map View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a list/map toggle to the Meetings tab's In-Person segment: a MapLibre GL map rendering the same day-scoped result set as the list, with clustering, fellowship-colored pins, approximate-venue circles, and the native user-location puck.

**Architecture:** `@maplibre/maplibre-react-native` renders hosted MapTiler vector tiles whose style URLs (light + dark, API key embedded server-side) arrive via `/config` → ConfigStore. All decision logic lives in a new pure `app/utils/inPersonMapLogic.ts` (vitest-covered); the GL component `InPersonMapView` and the screen integration are thin I/O layers. Tapping a pin opens the existing `InPersonPopup`.

**Tech Stack:** React Native 0.81 / Expo SDK 54 (New Architecture), `@maplibre/maplibre-react-native` ^11.3.6, MobX-State-Tree, vitest + jest-expo (split by extension), i18next (9 locales).

**Spec:** `docs/superpowers/specs/2026-08-07-in-person-map-view-design.md` — read it first. The superseded `2026-08-03-in-person-map-design.md` is historical context only.

## Global Constraints

- **Native dependency** → `runtimeVersion` bump required at release (see "Release notes" at the bottom). Nothing in this plan ships as OTA.
- **`app.json` is FLAT** — no top-level `expo` wrapper. The plugin entry goes in the top-level `"plugins"` array.
- **Vitest cannot resolve `@/`** — `inPersonMapLogic.ts` must have zero runtime `@/` imports (type-only OK; `@recoverysky-org/common/browser` is a normal node_modules import and IS allowed).
- **Test runner split:** `*.test.ts` → vitest (`npm run test:unit -- path`), `*.test.tsx` → jest-expo (`npm run test:component -- path`).
- **PRIVACY:** no coordinate, `distance_m`, or directions URL may enter `trackEvent`, any log call, or React state. User coords live in `coordsRef` inside `useNearbySchedules` only. The PRIVACY header accounting in `useNearbySchedules.ts` must be updated in the SAME commit that lands the map integration (Task 8).
- **i18n:** every new key is a nine-file change (`en`, `es`, `ar`, `de`, `fr`, `pt`, `ru`, `th`, `uk`) — missing keys are hard `tsc` errors. English placeholder text is fine in the other eight.
- **ESLint house rules:** named React imports only; `Text` from `@/components`; unused vars prefixed `_`; comments follow the repo's liberal-comment policy (CLAUDE.md "Comments").
- **A11y is first-class:** every new interactive element needs `accessibilityRole` / `accessibilityLabel` (+ `accessibilityState` / hint where applicable).
- Commit messages follow repo gitmoji style (`✨ feat: …`, `🐛 fix: …`, `📝 docs: …`, `✅ test: …`).

---

### Task 1: Dependency + config plugin + New Architecture gate

This is the spec's verification gate #1 — **if the dev build fails on the MapLibre native module, STOP and report; every later task depends on this**.

**Files:**
- Modify: `package.json` (dependency)
- Modify: `app.json` (plugins array, ~line 81)

**Interfaces:**
- Produces: `@maplibre/maplibre-react-native` importable everywhere; native module present in dev builds.

- [ ] **Step 1: Install the dependency**

```bash
npx expo install @maplibre/maplibre-react-native
```

Then check `package.json` — expect a `"@maplibre/maplibre-react-native": "~11.x"` (or `^11.x`) entry. v11.3.6 was current as of 2026-06; anything 11.x is fine.

- [ ] **Step 2: Add the config plugin to app.json**

In `app.json`'s **top-level** `"plugins"` array (the file is flat — no `expo` wrapper), append after the existing entries:

```json
    "@maplibre/maplibre-react-native",
```

- [ ] **Step 3: Type check + dependency check**

Run: `npm run compile && npm run lint:deps`
Expected: both pass (nothing imports the lib yet).

- [ ] **Step 4: Build a dev client and boot it (THE GATE)**

Run: `npm run build:ios:sim` then install/boot the produced app in the iOS simulator (`npm start` + open). The app must cold-start with no native crash and no Metro red screen.

If the build or boot fails on a MapLibre symbol / Fabric error: **STOP. Do not work around it. Report the failure** — the spec names this the gate that can sink the library choice.

(Android: `npm run build:android:sim:debug` is the equivalent check; run it if an Android emulator is available, otherwise defer to the release checklist.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "✨ feat(map): add @maplibre/maplibre-react-native + config plugin"
```

---

### Task 2: Pure map logic — GeoJSON building

**Files:**
- Create: `app/utils/inPersonMapLogic.ts`
- Test: `app/utils/inPersonMapLogic.test.ts` (vitest — pure `.ts`)

**Interfaces:**
- Consumes: `FELLOWSHIP_COLORS`, `Fellowship` from `@recoverysky-org/common/browser` (node_modules — allowed in vitest).
- Produces (used by Tasks 3, 7, 8):

```ts
export interface MapVenueMeeting {
  id: string
  latitude?: number
  longitude?: number
  approximate?: boolean
  fellowship?: string
}
export interface VenueFeatureProperties {
  ids: string        // comma-joined meeting ids (bridge-safe scalar, NOT an array)
  count: number
  color: string
  approximate: boolean
}
export interface PointFeature {
  type: "Feature"
  geometry: { type: "Point"; coordinates: [number, number] } // [lon, lat] — GeoJSON order
  properties: VenueFeatureProperties
}
export interface VenueFeatureCollection {
  type: "FeatureCollection"
  features: PointFeature[]
}
export function fellowshipColor(fellowship?: string): string
export function hasUsableCoords(m: { latitude?: number; longitude?: number }): boolean
export function venuesToFeatureCollection(meetings: MapVenueMeeting[]): VenueFeatureCollection
export function parseVenueIds(ids: unknown): string[]
```

- [ ] **Step 1: Write the failing tests**

Create `app/utils/inPersonMapLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  fellowshipColor,
  hasUsableCoords,
  parseVenueIds,
  venuesToFeatureCollection,
} from "./inPersonMapLogic"

describe("hasUsableCoords", () => {
  it("accepts real coordinates", () => {
    expect(hasUsableCoords({ latitude: 40.7, longitude: -74.0 })).toBe(true)
  })
  it("rejects missing, non-finite, and null-island coordinates", () => {
    expect(hasUsableCoords({})).toBe(false)
    expect(hasUsableCoords({ latitude: 40.7 })).toBe(false)
    expect(hasUsableCoords({ latitude: NaN, longitude: 0 })).toBe(false)
    expect(hasUsableCoords({ latitude: 0, longitude: 0 })).toBe(false)
  })
})

describe("fellowshipColor", () => {
  it("returns a non-empty hex color for a known fellowship", () => {
    expect(fellowshipColor("AA")).toMatch(/^#/)
  })
  it("falls back to the NONE color for unknown/undefined", () => {
    expect(fellowshipColor(undefined)).toMatch(/^#/)
    expect(fellowshipColor("NOT_A_FELLOWSHIP")).toBe(fellowshipColor(undefined))
  })
})

describe("venuesToFeatureCollection", () => {
  const mtg = (id: string, lat: number, lon: number, extra: object = {}) => ({
    id,
    latitude: lat,
    longitude: lon,
    ...extra,
  })

  it("emits one feature per unique venue coordinate, GeoJSON [lon, lat] order", () => {
    const fc = venuesToFeatureCollection([mtg("a", 40.7, -74.0), mtg("b", 41.0, -73.5)])
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].geometry.coordinates).toEqual([-74.0, 40.7])
  })

  it("groups co-located meetings into one feature with joined ids and count", () => {
    const fc = venuesToFeatureCollection([mtg("a", 40.7, -74.0), mtg("b", 40.7, -74.0)])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties.ids).toBe("a,b")
    expect(fc.features[0].properties.count).toBe(2)
  })

  it("drops meetings without usable coordinates", () => {
    const fc = venuesToFeatureCollection([mtg("a", 0, 0), { id: "b" }, mtg("c", 40.7, -74.0)])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties.ids).toBe("c")
  })

  it("marks the venue approximate when any co-located meeting is approximate", () => {
    const fc = venuesToFeatureCollection([
      mtg("a", 40.7, -74.0),
      mtg("b", 40.7, -74.0, { approximate: true }),
    ])
    expect(fc.features[0].properties.approximate).toBe(true)
  })
})

describe("parseVenueIds", () => {
  it("splits a comma-joined string", () => {
    expect(parseVenueIds("a,b,c")).toEqual(["a", "b", "c"])
  })
  it("returns [] for non-strings and empty strings", () => {
    expect(parseVenueIds(undefined)).toEqual([])
    expect(parseVenueIds(42)).toEqual([])
    expect(parseVenueIds("")).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- app/utils/inPersonMapLogic.test.ts`
Expected: FAIL — cannot resolve `./inPersonMapLogic`.

- [ ] **Step 3: Write the implementation**

Create `app/utils/inPersonMapLogic.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- app/utils/inPersonMapLogic.test.ts`
Expected: all PASS. Also run `npm run compile`.

- [ ] **Step 5: Commit**

```bash
git add app/utils/inPersonMapLogic.ts app/utils/inPersonMapLogic.test.ts
git commit -m "✨ feat(map): pure GeoJSON venue-grouping logic for the in-person map"
```

---

### Task 3: Pure map logic — camera math + toggle rule

**Files:**
- Modify: `app/utils/inPersonMapLogic.ts` (append)
- Test: `app/utils/inPersonMapLogic.test.ts` (append)

**Interfaces:**
- Consumes: `VenueFeatureCollection` from Task 2.
- Produces (used by Tasks 6, 7, 8):

```ts
export interface CameraBounds { ne: [number, number]; sw: [number, number] } // [lon, lat]
export interface CenterZoomCamera { centerCoordinate: [number, number]; zoomLevel: number }
export function boundsForRadius(lat: number, lon: number, radiusKm: number): CameraBounds
export function boundsForVenues(fc: VenueFeatureCollection): CameraBounds | null
export function defaultCameraForRegion(regionCode: string | null | undefined): CenterZoomCamera
export function shouldShowMapToggle(input: {
  platform: string // Platform.OS
  styleUrlLight: string
  styleUrlDark: string
}): boolean
```

- [ ] **Step 1: Write the failing tests (append to the test file)**

```ts
import {
  boundsForRadius,
  boundsForVenues,
  defaultCameraForRegion,
  shouldShowMapToggle,
} from "./inPersonMapLogic"

describe("boundsForRadius", () => {
  it("builds a box that spans roughly 2× the radius in latitude", () => {
    const b = boundsForRadius(40.7, -74.0, 25)
    const latSpanKm = (b.ne[1] - b.sw[1]) * 111.32
    expect(latSpanKm).toBeGreaterThan(45)
    expect(latSpanKm).toBeLessThan(55)
    expect(b.ne[0]).toBeGreaterThan(b.sw[0])
  })
  it("widens the longitude span at high latitude", () => {
    const equator = boundsForRadius(0, 10, 25)
    const arctic = boundsForRadius(70, 10, 25)
    expect(arctic.ne[0] - arctic.sw[0]).toBeGreaterThan(equator.ne[0] - equator.sw[0])
  })
})

describe("boundsForVenues", () => {
  const fc = (coords: Array<[number, number]>) => ({
    type: "FeatureCollection" as const,
    features: coords.map(([lon, lat]) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] },
      properties: { ids: "x", count: 1, color: "#000", approximate: false },
    })),
  })

  it("returns null for an empty collection", () => {
    expect(boundsForVenues(fc([]))).toBeNull()
  })
  it("pads a single point into a non-degenerate box", () => {
    const b = boundsForVenues(fc([[-74.0, 40.7]]))!
    expect(b.ne[0]).toBeGreaterThan(b.sw[0])
    expect(b.ne[1]).toBeGreaterThan(b.sw[1])
  })
  it("contains all points with padding", () => {
    const b = boundsForVenues(fc([[-74.0, 40.7], [-73.5, 41.0]]))!
    expect(b.sw[0]).toBeLessThan(-74.0)
    expect(b.ne[0]).toBeGreaterThan(-73.5)
    expect(b.sw[1]).toBeLessThan(40.7)
    expect(b.ne[1]).toBeGreaterThan(41.0)
  })
})

describe("defaultCameraForRegion", () => {
  it("returns a continent-level camera for a known region", () => {
    const cam = defaultCameraForRegion("US")
    expect(cam.zoomLevel).toBeGreaterThanOrEqual(2)
    expect(cam.centerCoordinate[0]).toBeLessThan(-60) // somewhere over North America
  })
  it("falls back to a world view for unknown/absent regions", () => {
    expect(defaultCameraForRegion(undefined).zoomLevel).toBeLessThanOrEqual(1.5)
    expect(defaultCameraForRegion("ZZ").zoomLevel).toBeLessThanOrEqual(1.5)
  })
})

describe("shouldShowMapToggle", () => {
  const urls = { styleUrlLight: "https://x/light.json", styleUrlDark: "https://x/dark.json" }
  it("shows on native platforms with both style URLs", () => {
    expect(shouldShowMapToggle({ platform: "ios", ...urls })).toBe(true)
    expect(shouldShowMapToggle({ platform: "android", ...urls })).toBe(true)
  })
  it("hides on web (spec decision #10)", () => {
    expect(shouldShowMapToggle({ platform: "web", ...urls })).toBe(false)
  })
  it("hides when either style URL is missing (config kill switch)", () => {
    expect(shouldShowMapToggle({ platform: "ios", styleUrlLight: "", styleUrlDark: "x" })).toBe(false)
    expect(shouldShowMapToggle({ platform: "ios", styleUrlLight: "x", styleUrlDark: "" })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test:unit -- app/utils/inPersonMapLogic.test.ts`
Expected: Task 2's tests PASS, new ones FAIL (exports missing).

- [ ] **Step 3: Append the implementation**

```ts
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
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm run test:unit -- app/utils/inPersonMapLogic.test.ts` then `npm run compile`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/utils/inPersonMapLogic.ts app/utils/inPersonMapLogic.test.ts
git commit -m "✨ feat(map): camera math + map-toggle visibility rules"
```

---

### Task 4: ConfigStore fields + /config API types

**Files:**
- Modify: `app/models/ConfigStore.ts`
- Modify: `app/services/api/index.ts` (getConfig, ~lines 890–932)

**Interfaces:**
- Produces: `configStore.mapStyleUrlLight: string`, `configStore.mapStyleUrlDark: string` (both default `""`), populated from `/config`'s `MAP_STYLE_URL_LIGHT` / `MAP_STYLE_URL_DARK`. Task 8 reads them via `useConfigStore()`.

No unit test — ConfigStore imports `@/` (vitest-unreachable) and this repo does not jest-test MST stores. `npm run compile` is the check.

- [ ] **Step 1: Add the props to ConfigStoreModel**

In `app/models/ConfigStore.ts`, after the `latestVersion` prop (~line 82), add:

```ts
    /**
     * MapTiler style URLs for the In-Person map view, light + dark. Full URLs
     * with the API key embedded — served by /config so the key is never baked
     * into the binary and can be rotated (or the provider swapped) without a
     * release. EMPTY IS THE KILL SWITCH: shouldShowMapToggle() hides the map
     * toggle unless both are non-empty, so an old server or a deliberate
     * server-side clear degrades to the list-only segment. No env fallback on
     * purpose — there is no safe client-side default for a keyed URL.
     * Spec: docs/superpowers/specs/2026-08-07-in-person-map-view-design.md
     */
    mapStyleUrlLight: types.optional(types.string, ""),
    mapStyleUrlDark: types.optional(types.string, ""),
```

- [ ] **Step 2: Populate them in fetchConfig**

In the `fetchConfig` flow, after the `LATEST_VERSION` line (~line 172), add:

```ts
              if (config.MAP_STYLE_URL_LIGHT) store.mapStyleUrlLight = config.MAP_STYLE_URL_LIGHT
              if (config.MAP_STYLE_URL_DARK) store.mapStyleUrlDark = config.MAP_STYLE_URL_DARK
```

- [ ] **Step 3: Clear them in reset()**

In `reset()`, after the `maintenanceUntil` line, add:

```ts
      store.mapStyleUrlLight = ""
      store.mapStyleUrlDark = ""
```

- [ ] **Step 4: Add the fields to both getConfig type literals**

In `app/services/api/index.ts`, add to BOTH the return-type config object (~after line 909) and the `.get<{...}>` generic (~after line 931):

```ts
          /** In-Person map style URLs (keyed MapTiler URLs); absent = map off */
          MAP_STYLE_URL_LIGHT?: string
          MAP_STYLE_URL_DARK?: string
```

(The doc comment on the first occurrence only; the generic literal can take the bare fields.)

- [ ] **Step 5: Verify**

Run: `npm run compile && npm run lint:check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/models/ConfigStore.ts app/services/api/index.ts
git commit -m "✨ feat(map): config-served MapTiler style URLs in ConfigStore"
```

---

### Task 5: i18n keys (nine locales)

**Files:**
- Modify: `app/i18n/en.ts` (`inPersonScreen` section, ~line 858) and the same section in `es.ts`, `ar.ts`, `de.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `th.ts`, `uk.ts`

**Interfaces:**
- Produces translation keys consumed by Tasks 6–8: `inPersonScreen:showMap`, `inPersonScreen:showList`, `inPersonScreen:mapOffline`, `inPersonScreen:mapUnavailable`, `inPersonScreen:venueMeetings`.

- [ ] **Step 1: Add the keys to en.ts**

Append inside the `inPersonScreen` object:

```ts
    showMap: "Show map",
    showList: "Show list",
    mapOffline: "Map is unavailable offline",
    mapUnavailable: "Couldn't load the map — showing the list instead",
    venueMeetings: "Meetings at this location",
```

- [ ] **Step 2: Add the same keys to the other eight locale files**

Same five keys, same English text, in each file's `inPersonScreen` section (English placeholders are the documented convention — CLAUDE.md "Internationalization" — queued for native-speaker review). Every file must get all five or `npm run compile` fails.

- [ ] **Step 3: Verify**

Run: `npm run compile` (this is what enforces the nine-file rule) and `npm run test:unit -- test/i18n.test.ts`
Expected: clean / PASS.

- [ ] **Step 4: Commit**

```bash
git add app/i18n/
git commit -m "✨ feat(map): i18n keys for the in-person map toggle (EN placeholders x9)"
```

---

### Task 6: MapListToggle component + jest test

**Files:**
- Create: `app/components/MapListToggle.tsx`
- Test: `app/components/MapListToggle.test.tsx` (jest-expo — `.tsx`)

**Interfaces:**
- Consumes: i18n keys from Task 5.
- Produces (rendered by Task 8's header):

```ts
export type InPersonViewMode = "list" | "map"
interface MapListToggleProps {
  viewMode: InPersonViewMode
  /** Offline → disabled with the standard greyed pattern (spec Error handling #3) */
  disabled?: boolean
  onToggle: () => void
}
export const MapListToggle: FC<MapListToggleProps>
```

- [ ] **Step 1: Write the failing test**

Create `app/components/MapListToggle.test.tsx` (mirror `MeetingRow.test.tsx`'s harness conventions — same render import, same i18n setup via `test/setup.ts`):

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native"

import { MapListToggle } from "./MapListToggle"

describe("MapListToggle", () => {
  it("offers the map when in list mode", () => {
    render(<MapListToggle viewMode="list" onToggle={jest.fn()} />)
    expect(screen.getByLabelText("Show map")).toBeTruthy()
  })

  it("offers the list when in map mode", () => {
    render(<MapListToggle viewMode="map" onToggle={jest.fn()} />)
    expect(screen.getByLabelText("Show list")).toBeTruthy()
  })

  it("fires onToggle on press", () => {
    const onToggle = jest.fn()
    render(<MapListToggle viewMode="list" onToggle={onToggle} />)
    fireEvent.press(screen.getByRole("button"))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it("does not fire when disabled and exposes the disabled state", () => {
    const onToggle = jest.fn()
    render(<MapListToggle viewMode="list" disabled onToggle={onToggle} />)
    const button = screen.getByRole("button")
    fireEvent.press(button)
    expect(onToggle).not.toHaveBeenCalled()
    expect(button.props.accessibilityState?.disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:component -- app/components/MapListToggle.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `app/components/MapListToggle.tsx`:

```tsx
import { FC } from "react"
import { TouchableOpacity } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { useAppTheme } from "@/theme/context"

export type InPersonViewMode = "list" | "map"

interface MapListToggleProps {
  viewMode: InPersonViewMode
  /** Offline → disabled (spec Error handling #3: blank tiles beat nobody) */
  disabled?: boolean
  onToggle: () => void
}

/**
 * The In-Person segment's list/map switch. Lives in the segment header's
 * title row next to the settings gear. Standalone (not inlined in
 * InPersonListHeader) so jest can exercise it without mocking the MapLibre
 * native module the map side of the toggle implies.
 */
export const MapListToggle: FC<MapListToggleProps> = ({ viewMode, disabled, onToggle }) => {
  const { t } = useTranslation()
  const { theme } = useAppTheme()

  // The label names the DESTINATION, not the current state — "Show map" while
  // the list is up — matching how the icon reads (you tap the thing you want).
  const label = viewMode === "list" ? t("inPersonScreen:showMap") : t("inPersonScreen:showList")

  return (
    <TouchableOpacity
      onPress={onToggle}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={disabled ? t("inPersonScreen:mapOffline") : undefined}
    >
      <Ionicons
        name={viewMode === "list" ? "map-outline" : "list-outline"}
        size={22}
        color={disabled ? theme.colors.textDim : theme.colors.tint}
      />
    </TouchableOpacity>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:component -- app/components/MapListToggle.test.tsx` and `npm run compile`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/MapListToggle.tsx app/components/MapListToggle.test.tsx
git commit -m "✨ feat(map): MapListToggle component with a11y + jest coverage"
```

---

### Task 7: InPersonMapView (the GL component)

**Files:**
- Create: `app/components/InPersonMapView.tsx`

**Interfaces:**
- Consumes: Task 2/3 logic exports; `MeetingWithTrex` from `@/context/MeetingContext` (type-only); MapLibre components.
- Produces (rendered by Task 8):

```ts
interface InPersonMapViewProps {
  meetings: MeetingWithTrex[]
  /** Theme-appropriate style URL from ConfigStore (never "" — caller gates) */
  mapStyleUrl: string
  /** Accessor for the user's fix — a function, NOT a value, so coords never sit in props/state */
  getSearchCenter: () => { lat: number; lon: number } | null
  radiusKm: number
  /** Pin tapped → meeting ids at that venue (caller resolves + opens popup/chooser) */
  onVenuePress: (meetingIds: string[]) => void
  /** Style/tile load failure → caller toasts + flips back to list */
  onMapFailed: () => void
}
export const InPersonMapView: FC<InPersonMapViewProps>
```

No automated test — the native GL module can't run under either runner (same
category as `app/services/sync/index.ts`); it is covered by the manual
checklist in Task 9. Keep everything decidable in `inPersonMapLogic.ts`.

**Import-name caveat:** the component/type names below (`CameraRef`,
`ShapeSourceRef`, `OnPressEvent`, `mapStyle` prop) are v11's documented API.
If any name fails to resolve, check the actual exports in
`node_modules/@maplibre/maplibre-react-native/lib/typescript/` and use those —
do NOT cast to `any`.

- [ ] **Step 1: Implement the component**

Create `app/components/InPersonMapView.tsx`:

```tsx
/**
 * InPersonMapView — the GL map behind the In-Person segment's list/map toggle.
 *
 * Dumb by design: venues in, taps out. Every decision (feature building,
 * camera fit, id parsing) lives in the pure, vitest-covered
 * app/utils/inPersonMapLogic.ts — do not re-derive any of it here.
 *
 * PRIVACY: `getSearchCenter` is an accessor into useNearbySchedules' coordsRef
 * (the ONE sanctioned new consumer — see that file's header). The fix is read
 * once for the mount-time camera, handed to the native Camera component, and
 * never stored, logged, or tracked here. The puck is MapLibre's native
 * UserLocation — coordinates stay in the GL layer and never enter JS.
 * The tile provider (MapTiler) necessarily sees the viewport; that egress is
 * accepted and documented in the 2026-08-07 map-view spec.
 *
 * Spec: docs/superpowers/specs/2026-08-07-in-person-map-view-design.md
 */

import { FC, useCallback, useMemo, useRef } from "react"
import { ViewStyle } from "react-native"
import {
  Camera,
  type CameraRef,
  CircleLayer,
  MapView,
  type OnPressEvent,
  ShapeSource,
  type ShapeSourceRef,
  SymbolLayer,
  UserLocation,
} from "@maplibre/maplibre-react-native"
import { getLocales } from "expo-localization"

import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useAppTheme } from "@/theme/context"
import {
  boundsForRadius,
  boundsForVenues,
  defaultCameraForRegion,
  parseVenueIds,
  venuesToFeatureCollection,
} from "@/utils/inPersonMapLogic"

interface InPersonMapViewProps {
  meetings: MeetingWithTrex[]
  mapStyleUrl: string
  getSearchCenter: () => { lat: number; lon: number } | null
  radiusKm: number
  onVenuePress: (meetingIds: string[]) => void
  onMapFailed: () => void
}

export const InPersonMapView: FC<InPersonMapViewProps> = ({
  meetings,
  mapStyleUrl,
  getSearchCenter,
  radiusKm,
  onVenuePress,
  onMapFailed,
}) => {
  const { theme } = useAppTheme()
  const cameraRef = useRef<CameraRef>(null)
  const shapeSourceRef = useRef<ShapeSourceRef>(null)

  const featureCollection = useMemo(() => venuesToFeatureCollection(meetings), [meetings])

  // Mount-time only, by design: refitting on every result change would yank
  // the map out from under a panning user. Toggling list→map remounts this
  // component, which is exactly when a fresh fit is wanted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialCamera = useMemo(() => {
    const center = getSearchCenter()
    if (center) return { bounds: boundsForRadius(center.lat, center.lon, radiusKm) }
    const venueBounds = boundsForVenues(featureCollection)
    if (venueBounds) return { bounds: venueBounds }
    return defaultCameraForRegion(getLocales()[0]?.regionCode)
  }, [])

  const handleSourcePress = useCallback(
    async (event: OnPressEvent) => {
      const feature = event.features?.[0]
      if (!feature) return
      const properties = feature.properties ?? {}
      if (properties.cluster) {
        // Cluster tap → expand. +0.5 past the expansion zoom so the leaves
        // separate visibly instead of landing exactly at the split threshold.
        const zoom = await shapeSourceRef.current?.getClusterExpansionZoom(feature)
        cameraRef.current?.setCamera({
          centerCoordinate: (feature.geometry as { coordinates: [number, number] }).coordinates,
          zoomLevel: (zoom ?? 14) + 0.5,
          animationDuration: 300,
        })
        return
      }
      const ids = parseVenueIds(properties.ids)
      if (ids.length > 0) onVenuePress(ids)
    },
    [onVenuePress],
  )

  return (
    <MapView
      style={$map}
      mapStyle={mapStyleUrl}
      onDidFailLoadingMap={onMapFailed}
      attributionEnabled
    >
      <Camera ref={cameraRef} defaultSettings={initialCamera} />

      <ShapeSource
        id="inperson-venues"
        ref={shapeSourceRef}
        shape={featureCollection}
        cluster
        clusterRadius={50}
        onPress={handleSourcePress}
      >
        {/* Cluster bubble + count */}
        <CircleLayer
          id="inperson-clusters"
          filter={["has", "point_count"]}
          style={{
            circleColor: theme.colors.tint,
            circleRadius: 18,
            circleOpacity: 0.85,
          }}
        />
        <SymbolLayer
          id="inperson-cluster-count"
          filter={["has", "point_count"]}
          style={{
            textField: ["get", "point_count_abbreviated"],
            textSize: 12,
            textColor: "#ffffff",
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />

        {/* Approximate venues: translucent area, NEVER a precise pin (spec
            decision #7 — deliberately-fuzzed coordinates must not be
            pinpointed; matches the popup's "approximate" caveat line). */}
        <CircleLayer
          id="inperson-venue-approx"
          filter={["all", ["!", ["has", "point_count"]], ["==", ["get", "approximate"], true]]}
          style={{
            circleColor: ["get", "color"],
            circleOpacity: 0.3,
            circleRadius: 22,
            circleStrokeWidth: 1,
            circleStrokeColor: ["get", "color"],
          }}
        />

        {/* Precise venues: fellowship-colored dot */}
        <CircleLayer
          id="inperson-venue-pins"
          filter={["all", ["!", ["has", "point_count"]], ["!=", ["get", "approximate"], true]]}
          style={{
            circleColor: ["get", "color"],
            circleRadius: 9,
            circleStrokeWidth: 2,
            circleStrokeColor: "#ffffff",
          }}
        />

        {/* Multi-meeting venues wear their count, like a mini-cluster that
            can't expand (the points are identical) — the tap opens a chooser
            instead (see InPersonScreen's VenueMeetingsModal). */}
        <SymbolLayer
          id="inperson-venue-count"
          filter={["all", ["!", ["has", "point_count"]], [">", ["get", "count"], 1]]}
          style={{
            textField: ["to-string", ["get", "count"]],
            textSize: 11,
            textColor: "#ffffff",
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />
      </ShapeSource>

      {/* Native blue-dot puck: renders inside the GL layer, coords never
          enter JS (spec decision #8). */}
      <UserLocation visible />
    </MapView>
  )
}

const $map: ViewStyle = {
  flex: 1,
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run compile && npm run lint:check && npm run lint:deps`
Expected: clean. If a MapLibre export name mismatches, fix per the caveat above.

- [ ] **Step 3: Commit**

```bash
git add app/components/InPersonMapView.tsx
git commit -m "✨ feat(map): InPersonMapView GL component (clusters, fellowship pins, approx circles, puck)"
```

---

### Task 8: Screen integration + coords accessor + PRIVACY header

**Files:**
- Modify: `app/hooks/useNearbySchedules.ts` (expose `getCoords`; update PRIVACY header — SAME commit, per the header's standing rule)
- Modify: `app/screens/InPersonScreen.tsx` (view-mode state + MMKV, header toggle, map render path, venue chooser, failure/offline handling)

**Interfaces:**
- Consumes: everything from Tasks 2–7; `useConfigStore` / `useNetworkStore` from `@/models`; `useToast` from `@/components/Toast`; `loadString`/`saveString` from `@/utils/storage`.
- Produces: the user-visible feature. `useNearbySchedules` additionally returns `getCoords: () => { lat: number; lon: number } | null` (stable identity).

- [ ] **Step 1: Expose the coords accessor in useNearbySchedules**

In `app/hooks/useNearbySchedules.ts`:

(a) Add near the other callbacks (a stable accessor — NOT state, NOT a returned value that captures coords):

```ts
  /**
   * Accessor for the current fix, for the map view's mount-time camera. A
   * function returning the ref's current value — deliberately not state and
   * not the raw ref — so coordinates still never appear in a serializable
   * snapshot and no consumer can subscribe to position changes.
   */
  const getCoords = useCallback(() => coordsRef.current, [])
```

(b) Add `getCoords,` to the hook's return object (alongside `refresh`, `requestLocation`, …).

(c) In the file's PRIVACY header, append to the AMENDED 2026-08-05 paragraph's accounting (this is the standing "update in the same commit" obligation):

```
 * AMENDED 2026-08-07 (map view): `coordsRef` gained one new ON-DEVICE
 * consumer — `getCoords()`, read once by InPersonMapView for the mount-time
 * camera fit and handed to the native Camera/UserLocation components; the
 * fix still never enters JS state, MMKV, or logs. NEW third-party egress:
 * while the map view is open, the tile provider (MapTiler) necessarily
 * receives viewport tile requests (approximate browsed area + IP, keyed to
 * our style URL). Accepted explicitly in the 2026-08-07 map-view spec's
 * privacy section; the browse-path scrubbing above is unchanged.
```

- [ ] **Step 2: Wire the screen — imports and state**

In `app/screens/InPersonScreen.tsx`:

(a) Add imports:

```ts
import { Platform } from "react-native" // extend the existing react-native import list
import { InPersonMapView } from "@/components/InPersonMapView"
import { MapListToggle, type InPersonViewMode } from "@/components/MapListToggle"
import { useToast } from "@/components/Toast"
import { useConfigStore, useNetworkStore } from "@/models"
import { loadString, saveString } from "@/utils/storage"
import { shouldShowMapToggle } from "@/utils/inPersonMapLogic"
```

(b) Below `RADIUS_STORAGE_KEY`-style constants (top of file, after `SHORT_TIME_TX`):

```ts
/** MMKV key for the persisted list/map choice (a display preference, NOT
 * location data — same class as inperson.radius). */
const VIEW_MODE_STORAGE_KEY = "inperson.viewMode"

const loadViewMode = (): InPersonViewMode =>
  loadString(VIEW_MODE_STORAGE_KEY) === "map" ? "map" : "list"
```

(c) Inside `InPersonContent`, after the existing modal-visibility state:

```ts
  const configStore = useConfigStore()
  const networkStore = useNetworkStore()
  const { themeContext } = useAppTheme() // extend the existing destructure
  const { showToast } = useToast()

  const [viewMode, setViewModeState] = useState<InPersonViewMode>(loadViewMode)
  /** Meetings at a multi-meeting venue pin awaiting a chooser pick */
  const [venueMeetings, setVenueMeetings] = useState<MeetingWithTrex[]>([])

  const setViewMode = useCallback((next: InPersonViewMode) => {
    setViewModeState(next)
    saveString(VIEW_MODE_STORAGE_KEY, next)
  }, [])

  const showMapToggle = shouldShowMapToggle({
    platform: Platform.OS,
    styleUrlLight: configStore.mapStyleUrlLight,
    styleUrlDark: configStore.mapStyleUrlDark,
  })
  const mapStyleUrl =
    themeContext === "dark" ? configStore.mapStyleUrlDark : configStore.mapStyleUrlLight

  // The config kill switch can flip mid-session (a /config poll clearing the
  // URLs); a persisted "map" pref must degrade to the list, not a blank area.
  const effectiveViewMode: InPersonViewMode =
    viewMode === "map" && showMapToggle ? "map" : "list"
```

(d) Handlers, after `handleClosePopup`:

```ts
  const handleToggleView = useCallback(() => {
    const next: InPersonViewMode = effectiveViewMode === "list" ? "map" : "list"
    setViewMode(next)
    // PRIVACY: a view-mode choice is a display preference, not a position.
    trackEvent("inperson_view_toggled", { view: next })
  }, [effectiveViewMode, setViewMode])

  const handleMapFailed = useCallback(() => {
    // Style/tile load failure (network, MapTiler cap, bad style) → say so and
    // fall back to the list; the toggle stays visible for a manual retry.
    showToast({ message: t("inPersonScreen:mapUnavailable"), type: "error" })
    setViewMode("list")
  }, [showToast, t, setViewMode])

  const handleVenuePress = useCallback(
    (meetingIds: string[]) => {
      // Resolve against the UNFILTERED day list, not visibleMeetings: the pin
      // was built from what the map renders, but ids are stable either way and
      // the popup can show any meeting of the day.
      const found = meetings.filter((m) => meetingIds.includes(m.id))
      if (found.length === 1) {
        setSelectedMeeting(found[0])
      } else if (found.length > 1) {
        setVenueMeetings(found)
      }
    },
    [meetings],
  )

  const handleVenueChooserPick = useCallback((meeting: MeetingWithTrex) => {
    setVenueMeetings([])
    setSelectedMeeting(meeting)
  }, [])

  const handleVenueChooserClose = useCallback(() => setVenueMeetings([]), [])
```

- [ ] **Step 3: Put the toggle in the header**

Extend `InPersonListHeaderProps` with:

```ts
  /** Render the list/map toggle (config kill switch + platform rule) */
  showMapToggle: boolean
  viewMode: InPersonViewMode
  /** Offline → disabled (spec Error handling #3) */
  mapToggleDisabled: boolean
  onToggleView: () => void
```

In `InPersonListHeader`'s title row (the `$header` View, next to the settings gear), render before the settings `TouchableOpacity`:

```tsx
        {showMapToggle && (
          <MapListToggle
            viewMode={viewMode}
            disabled={mapToggleDisabled}
            onToggle={onToggleView}
          />
        )}
```

Wrap the gear + toggle in a row container so they sit side by side:

```tsx
        <View style={$headerActions}>
          {/* toggle then gear */}
        </View>
```

with

```ts
const $headerActions: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 16,
}
```

- [ ] **Step 4: Render the map path**

In `InPersonContent`'s return, replace the single `<FlatList …/>` with a branch. **The header must render in BOTH modes** (filters/banner stay available on the map):

```tsx
      {effectiveViewMode === "map" ? (
        <View style={$screenContainer}>
          <InPersonListHeader
            fellowshipLabel={fellowshipLabel}
            selectedDayLabel={selectedDayLabel}
            radiusLabel={radiusDistance}
            radiusA11yLabel={radiusA11yLabel}
            shortTimeLabel={shortTimeLabel}
            bannerReason={bannerReason}
            canAskAgain={canAskAgain}
            showSpinner={showSpinner}
            onOpenFellowship={handleOpenFellowshipModal}
            onOpenDay={handleOpenDayModal}
            onOpenRadius={handleOpenRadiusModal}
            onOpenShortTime={handleOpenShortTimeModal}
            onBannerPress={handleBannerPress}
            showMapToggle={showMapToggle}
            viewMode={effectiveViewMode}
            mapToggleDisabled={networkStore.isOffline}
            onToggleView={handleToggleView}
          />
          <InPersonMapView
            meetings={visibleMeetings}
            mapStyleUrl={mapStyleUrl}
            getSearchCenter={getCoords}
            radiusKm={radiusKm}
            onVenuePress={handleVenuePress}
            onMapFailed={handleMapFailed}
          />
        </View>
      ) : (
        <FlatList
          … (exactly as today, plus the four new InPersonListHeader props:
             showMapToggle={showMapToggle}, viewMode={effectiveViewMode},
             mapToggleDisabled={networkStore.isOffline},
             onToggleView={handleToggleView})
        />
      )}
```

(`getCoords` comes from the `useNearbySchedules(active)` destructure — add it there.)

- [ ] **Step 5: Venue chooser modal**

Add after the `InPersonPopup` in the JSX (module-level component, same modal chrome as `RadiusSelectorModal` — copied, not extracted, per the note on that component):

```tsx
      <Modal
        visible={venueMeetings.length > 0}
        transparent
        animationType="fade"
        onRequestClose={handleVenueChooserClose}
      >
        <Pressable style={themed($modalOverlay)} onPress={handleVenueChooserClose}>
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>{t("inPersonScreen:venueMeetings")}</Text>
            {venueMeetings.map((m) => (
              <MeetingRow key={m.id} meeting={m} onPress={handleVenueChooserPick} />
            ))}
          </View>
        </Pressable>
      </Modal>
```

(A day's co-located meetings are a handful — no FlatList needed; `$modalContent`'s `maxHeight: "70%"` already caps pathological cases. If `MeetingRow`'s props require the rating/favorite fields, pass `rating={displayFeedback.get(m.id)?.rates ?? 0}` and `isFavorite={displayFeedback.get(m.id)?.loves ?? false}` and `hasReminder={meetingHasReminder(m, reminderLookup)}` exactly as the list's `renderItem` does.)

- [ ] **Step 6: Verify**

Run: `npm run compile && npm run lint:check && npm run lint:deps && npm test`
Expected: all clean/PASS (vitest + jest suites).

Then a smoke check in the dev client (`npm start`, simulator): toggle appears only when the dev server's `/config` serves the two URLs; toggling shows the map; pins render; pin tap opens the popup; toggling back restores the list. (If the dev server doesn't serve the fields yet, temporarily set them via the server's env/config — do NOT hardcode URLs in the client, even for testing; that path is the kill switch under test.)

- [ ] **Step 7: Commit (screen + hook + header TOGETHER — the privacy-header
  rule requires the accounting to land with the consumer it documents)**

```bash
git add app/screens/InPersonScreen.tsx app/hooks/useNearbySchedules.ts
git commit -m "✨ feat(map): list/map toggle in the In-Person segment (MapLibre view, venue chooser, privacy accounting)"
```

---

### Task 9: CHANGELOG + full verification + manual checklist

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` → `Added`)

**Interfaces:** none — release hygiene.

- [ ] **Step 1: Changelog entry**

Under `## [Unreleased]` / `### Added` (create the subsection if absent — note the working tree already has uncommitted CHANGELOG edits; ADD to the file, don't revert anything):

```markdown
- In-Person segment map view: a list/map toggle on the Meetings tab renders
  nearby results as a clustered MapLibre map — pins colored by fellowship,
  deliberately-approximate venues shown as translucent areas instead of
  precise pins, and your own position as the native blue dot. Tapping a pin
  opens the same meeting popup as the list. Requires the server to provide
  MapTiler style URLs via /config (absent = feature hidden); native release
  only (new native dependency — runtimeVersion bump required).
```

- [ ] **Step 2: Full verification suite**

Run: `npm run compile && npm run lint:check && npm run lint:deps && npm test`
Expected: everything green. Fix anything that isn't before committing.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "📝 docs: changelog the In-Person map view"
```

- [ ] **Step 4: Manual test checklist (dev build; full pass on hardware at release)**

Per platform (iOS + Android), per theme (light + dark):

1. Toggle appears only when `/config` serves both style URLs; hidden on web build.
2. Toggle a11y: VoiceOver/TalkBack reads "Show map" / "Show list"; disabled state announced when offline.
3. Map renders themed style matching app theme; switching app theme swaps the style.
4. Nearby mode: camera fits the search radius around the user; puck visible.
5. Fallback mode (location denied): camera fits result pins; no puck.
6. Zero results + no location: continent-level default camera.
7. Cluster tap zooms until leaves separate; cluster count text renders.
8. Single-meeting pin tap opens InPersonPopup for the right meeting.
9. Multi-meeting venue shows count on the pin; tap opens the chooser; picking a row opens its popup.
10. Approximate venue renders translucent circle, not a pin.
11. Airplane mode: toggle greys out; re-enabling network re-enables it.
12. Map-load failure (point style URL at a 404 on the dev server): toast + auto-flip to list.
13. View-mode pref survives an app restart.
14. Radius/day/fellowship/time changes while in map mode update the pins (camera stays put).
15. Kill switch: clear the config fields server-side → toggle disappears; a persisted "map" pref falls back to list.

---

## Release notes (owner-driven — NOT a task to execute in this branch)

When this rides the next native release:

1. **Server first:** `/config` must serve `MAP_STYLE_URL_LIGHT` / `MAP_STYLE_URL_DARK` (full MapTiler style URLs with the API key). Server repo change — the client is null-safe before it.
2. `npm run patch` (or `minor`), then **manually bump `runtimeVersion` in `app.json`** to match — the script does not do it, and forgetting it makes every later OTA target a runtime nobody has.
3. `npm run release:ios` / `npm run release:android`; run the Task 9 manual checklist on physical devices, both platforms. Compare the produced AAB/IPA sizes against the previous release (spec verification gate #3) and note the delta in the release journal.
4. Watch the MapTiler dashboard for free-tier usage after rollout; the escape hatch is swapping the config URLs (OpenFreeMap / self-hosted Protomaps), no client release needed.
```
