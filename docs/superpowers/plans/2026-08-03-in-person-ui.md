# In-Person Meetings UI & Near-Me Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third "In-Person" segment to the Meetings tab that shows in-person meetings nearest-first via `/schedules/nearby`, degrading to day-browse without location, with venue detail, directions, contacts, reminders, and one-tap attendance capture.

**Architecture:** A new stay-mounted `InPersonContent` view joins Live/Listings inside `MeetingsScreen`. A `useNearbySchedules` hook orchestrates location + fetching around a pure, vitest-tested `nearbyLogic.ts` decision module. A new small `InPersonPopup` handles venue detail (deliberately not `SchedulePopup`). Attendance writes go through the `repositories.ts` choke point so they enqueue to the sync outbox.

**Tech Stack:** React Native 0.81 / Expo 54, MobX-State-Tree (read-only here), expo-location (new native dep), Apisauce API layer, Drizzle/SQLite via common-lib repos, vitest (pure logic) + jest-expo (components).

**Spec:** `docs/superpowers/specs/2026-08-03-in-person-ui-design.md` — read it first.

## Global Constraints

- **Test runner split:** `*.test.ts` → vitest (pure TS only, **cannot resolve `@/` runtime imports** — type-only imports are fine); `*.test.tsx` → jest-expo. Run vitest: `npm run test:unit -- path`; jest: `npm run test:component -- path`.
- **`/schedules/nearby` params are exactly** `lat`, `lon`, `radius` (meters, max 100000), `iso_dow` (1–7, required), `fellowship` (optional). **Never send `limit`, `venueType`, or `tz`** — unknown params are silently stripped by the server (they'd "work" while doing nothing).
- **`distance_m?: number`** — emitted as number or omitted, never null (API team tightened at our request). Sort missing-last defensively.
- **Never log raw coordinates.** Logs ship to Loki. Log radius/iso_dow/counts only. Coordinates live in memory only — never MMKV, never SQLite.
- **i18n:** every user-facing string gets `en.ts` + `es.ts` keys; components use `tx` props / `useTranslation`. No hardcoded strings.
- **ESLint:** named React imports; no raw `Text`/`Button`/`TextInput` from react-native (use `@/components` wrappers); unused vars prefixed `_`; import order React → RN → Expo → external → `@/` → relative.
- **Comments:** liberal, per CLAUDE.md — record the "why" at call sites; when changing commented code, update the comment (append `CHANGED <date>:` notes rather than deleting still-true text).
- **Extract `ListHeaderComponent`-style pieces as standalone components**, not inline `useCallback` closures (FlatList focus-loss bug).
- **`runtimeVersion` stays 4.7.0 until the release task** (Task 12) — dev builds meanwhile require a rebuilt dev client after Task 3 (`npm run ios` / `build:ios:sim`).
- **CHANGELOG.md:** update `[Unreleased]` in the same commit as each user-visible change (Tasks 4, 9, 10 at minimum).
- Commit messages follow repo style (gitmoji prefix, e.g. `✨ feat(inperson): …`).

## File Structure

| File | Responsibility |
|---|---|
| `app/utils/nearbyLogic.ts` (create) | Pure decisions: mode resolution, param building, sorts, distance formatting, directions URLs, same-local-day. Zero runtime `@/` imports. |
| `app/utils/nearbyLogic.test.ts` (create) | Vitest coverage for all of the above. |
| `app/services/api/index.ts` (modify) | `getNearbySchedules()` + `distance_m?` on `LiveSchedule`. |
| `app/hooks/useNearbySchedules.ts` (create) | I/O orchestrator: permission, fix, fetches, radius persistence, maintenance gate. |
| `app/components/DaySelectorModal.tsx` (create) | Day-picker modal extracted from ListingsScreen; exports `ISO_DAYS`. |
| `app/components/InPersonScheduleRow.tsx` (create) | List row: name, time, venue, distance badge, hybrid glyph. |
| `app/components/InPersonScheduleRow.test.tsx` (create) | jest-expo render test. |
| `app/components/InPersonPopup.tsx` (create) | Venue detail: address, directions, contacts, reminders, "I'm Here". |
| `app/services/inPerson/attendance.ts` (create) | `saveInPersonAttendance()` — create + markProcessed + events, double-log guard. |
| `app/screens/InPersonScreen.tsx` (create) | `InPersonContent`: controls row, list, states, banner, popup wiring. |
| `app/screens/MeetingsScreen.tsx` (modify) | Third segment. |
| `app/navigators/navigationTypes.ts` (modify) | `MeetingsSegment` gains `"inperson"`. |
| `app/screens/ListingsScreen.tsx` (modify) | Use `DaySelectorModal`; delete inline modal + local `ISO_DAYS`. |
| `app/i18n/en.ts`, `app/i18n/es.ts` (modify) | New keys; "Listings" → "Search" relabel. |
| `app.json` (modify) | expo-location plugin + permission strings. |
| `CHANGELOG.md`, `docs/PRODUCTION_CHECKLIST.md`, `CLAUDE.md`, `EVENTS.md` (modify) | Docs. |

---

### Task 1: Pure logic module `nearbyLogic.ts` (TDD)

**Files:**
- Create: `app/utils/nearbyLogic.ts`
- Test: `app/utils/nearbyLogic.test.ts`

**Interfaces:**
- Consumes: nothing (pure; no `@/` runtime imports — this is load-bearing, vitest cannot resolve the alias).
- Produces (later tasks import these exact names from `@/utils/nearbyLogic`):
  - `type NearbyMode = "locating" | "nearby" | "fallback"`
  - `interface NearbyModeInput { active: boolean; permission: "undetermined" | "granted" | "denied"; fix: "pending" | "acquired" | "failed"; nearbyFetchFailed: boolean }`
  - `resolveMode(input: NearbyModeInput): NearbyMode`
  - `RADIUS_OPTIONS_KM: readonly number[]` (`[10, 25, 50, 100]`), `DEFAULT_RADIUS_KM = 25`, `MAX_RADIUS_M = 100_000`
  - `interface NearbyParams { lat: number; lon: number; radius: number; iso_dow: number; fellowship?: string }`
  - `buildNearbyParams(lat: number, lon: number, radiusKm: number, isoDow: number, fellowship?: string): NearbyParams`
  - `sortByDistance<T extends { distance_m?: number }>(items: T[]): T[]`
  - `sortByLocalTime<T extends { millis: number }>(items: T[]): T[]`
  - `formatDistance(distanceM: number | undefined, useMiles: boolean): string`
  - `interface DirectionsInput { platform: "ios" | "android" | "web"; latitude?: number; longitude?: number; venueName?: string; formattedAddress?: string }`
  - `buildDirectionsUrl(input: DirectionsInput): string` (empty string = nothing to link; caller hides the button)
  - `isSameLocalDay(aMillis: number, bMillis: number): boolean`

- [ ] **Step 0: Commit the pending dependency bump**

The working tree already holds the `@recoverysky-org/common ^2.4.1` bump (package.json + package-lock.json). Land it first so feature commits stay clean:

```bash
git add package.json package-lock.json
git commit -m "⬆️ deps: @recoverysky-org/common ^2.4.1"
```

- [ ] **Step 1: Write the failing tests**

Create `app/utils/nearbyLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  buildDirectionsUrl,
  buildNearbyParams,
  DEFAULT_RADIUS_KM,
  formatDistance,
  isSameLocalDay,
  resolveMode,
  sortByDistance,
  sortByLocalTime,
} from "./nearbyLogic"

describe("resolveMode", () => {
  const base = {
    active: true,
    permission: "granted",
    fix: "acquired",
    nearbyFetchFailed: false,
  } as const

  it("is locating before activation", () => {
    expect(resolveMode({ ...base, active: false })).toBe("locating")
  })
  it("is locating while permission is undetermined", () => {
    expect(resolveMode({ ...base, permission: "undetermined" })).toBe("locating")
  })
  it("is locating while the fix is pending", () => {
    expect(resolveMode({ ...base, fix: "pending" })).toBe("locating")
  })
  it("falls back when permission is denied", () => {
    expect(resolveMode({ ...base, permission: "denied", fix: "pending" })).toBe("fallback")
  })
  it("falls back when the fix failed", () => {
    expect(resolveMode({ ...base, fix: "failed" })).toBe("fallback")
  })
  it("falls back when the nearby fetch failed", () => {
    expect(resolveMode({ ...base, nearbyFetchFailed: true })).toBe("fallback")
  })
  it("is nearby with permission, fix, and a healthy fetch", () => {
    expect(resolveMode(base)).toBe("nearby")
  })
})

describe("buildNearbyParams", () => {
  it("converts km to meters and includes required params", () => {
    expect(buildNearbyParams(43.6, -116.2, 25, 2)).toEqual({
      lat: 43.6,
      lon: -116.2,
      radius: 25000,
      iso_dow: 2,
    })
  })
  it("clamps radius to the API max (100000 m)", () => {
    expect(buildNearbyParams(0, 0, 250, 1).radius).toBe(100_000)
  })
  it("includes fellowship only when provided", () => {
    expect(buildNearbyParams(1, 2, 10, 7, "NA").fellowship).toBe("NA")
    expect("fellowship" in buildNearbyParams(1, 2, 10, 7)).toBe(false)
  })
  it("never emits limit, venueType, or tz keys", () => {
    const keys = Object.keys(buildNearbyParams(1, 2, 10, 7, "AA"))
    expect(keys).not.toContain("limit")
    expect(keys).not.toContain("venueType")
    expect(keys).not.toContain("tz")
  })
})

describe("sortByDistance", () => {
  it("sorts ascending and does not mutate the input", () => {
    const input = [{ distance_m: 500 }, { distance_m: 100 }, { distance_m: 300 }]
    const out = sortByDistance(input)
    expect(out.map((x) => x.distance_m)).toEqual([100, 300, 500])
    expect(input[0].distance_m).toBe(500)
  })
  it("sorts entries missing distance_m last", () => {
    const out = sortByDistance([{ distance_m: 900 }, {}, { distance_m: 100 }])
    expect(out[0].distance_m).toBe(100)
    expect(out[2].distance_m).toBeUndefined()
  })
})

describe("sortByLocalTime", () => {
  it("orders by local wall-clock hour:minute, not raw millis", () => {
    // 23:30 today vs 06:15 tomorrow — raw millis order is reversed
    const today = new Date()
    const at = (dayOffset: number, h: number, m: number) =>
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + dayOffset,
        h,
        m,
      ).getTime()
    const out = sortByLocalTime([{ millis: at(0, 23, 30) }, { millis: at(1, 6, 15) }])
    expect(new Date(out[0].millis).getHours()).toBe(6)
  })
})

describe("formatDistance", () => {
  it("returns empty string for undefined", () => {
    expect(formatDistance(undefined, true)).toBe("")
  })
  it("formats miles with one decimal under 10 mi", () => {
    expect(formatDistance(1287, true)).toBe("0.8 mi")
  })
  it("rounds miles at 10+ mi", () => {
    expect(formatDistance(19312, true)).toBe("12 mi")
  })
  it("strips a trailing .0", () => {
    expect(formatDistance(8046.72, true)).toBe("5 mi")
  })
  it("formats meters under 1 km", () => {
    expect(formatDistance(480, false)).toBe("480 m")
  })
  it("formats km with one decimal under 10 km", () => {
    expect(formatDistance(1250, false)).toBe("1.3 km")
  })
  it("rounds km at 10+ km", () => {
    expect(formatDistance(25400, false)).toBe("25 km")
  })
})

describe("buildDirectionsUrl", () => {
  const coords = { latitude: 43.61, longitude: -116.2, venueName: "St. Mark's" }
  it("uses Apple Maps with coordinates on iOS", () => {
    expect(buildDirectionsUrl({ platform: "ios", ...coords })).toBe(
      "http://maps.apple.com/?daddr=43.61,-116.2",
    )
  })
  it("uses a geo: URI with a label on Android", () => {
    expect(buildDirectionsUrl({ platform: "android", ...coords })).toBe(
      "geo:43.61,-116.2?q=43.61,-116.2(St.%20Mark's)",
    )
  })
  it("uses Google Maps directions on web", () => {
    expect(buildDirectionsUrl({ platform: "web", ...coords })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=43.61%2C-116.2",
    )
  })
  it("falls back to the address when coordinates are missing", () => {
    const input = { formattedAddress: "100 Main St, Boise, ID" }
    expect(buildDirectionsUrl({ platform: "ios", ...input })).toBe(
      "http://maps.apple.com/?daddr=100%20Main%20St%2C%20Boise%2C%20ID",
    )
    expect(buildDirectionsUrl({ platform: "android", ...input })).toBe(
      "geo:0,0?q=100%20Main%20St%2C%20Boise%2C%20ID",
    )
  })
  it("treats (0,0) coordinates as missing", () => {
    expect(
      buildDirectionsUrl({ platform: "ios", latitude: 0, longitude: 0 }),
    ).toBe("")
  })
  it("returns empty string with neither coords nor address", () => {
    expect(buildDirectionsUrl({ platform: "android" })).toBe("")
  })
})

describe("isSameLocalDay", () => {
  it("true for two times on the same local calendar day", () => {
    const a = new Date(2026, 7, 3, 0, 5).getTime()
    const b = new Date(2026, 7, 3, 23, 55).getTime()
    expect(isSameLocalDay(a, b)).toBe(true)
  })
  it("false across local midnight", () => {
    const a = new Date(2026, 7, 3, 23, 55).getTime()
    const b = new Date(2026, 7, 4, 0, 5).getTime()
    expect(isSameLocalDay(a, b)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- app/utils/nearbyLogic.test.ts`
Expected: FAIL — cannot resolve `./nearbyLogic`.

- [ ] **Step 3: Implement `app/utils/nearbyLogic.ts`**

```ts
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
      (a.distance_m ?? Number.POSITIVE_INFINITY) -
      (b.distance_m ?? Number.POSITIVE_INFINITY),
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- app/utils/nearbyLogic.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Compile, lint, commit**

```bash
npm run compile && npm run lint:check
git add app/utils/nearbyLogic.ts app/utils/nearbyLogic.test.ts
git commit -m "✨ feat(inperson): pure nearby decision logic (mode, params, sorts, distance, directions)"
```

---

### Task 2: API method `getNearbySchedules`

**Files:**
- Modify: `app/services/api/index.ts` (add `distance_m?` to `LiveSchedule` ~line 139–154; add method after `getDailySchedules` ~line 645)

**Interfaces:**
- Consumes: `NearbyParams` from Task 1 (structurally — the API file defines its own arg type to avoid coupling; the hook passes `buildNearbyParams(...)` output).
- Produces: `api.getNearbySchedules(params: { lat: number; lon: number; radius: number; iso_dow: number; fellowship?: string }): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem>` and `LiveSchedule.distance_m?: number`.

- [ ] **Step 1: Add `distance_m` to `LiveSchedule`**

In the `LiveSchedule` interface add:

```ts
  /**
   * Meters from the query point — present only on /schedules/nearby
   * responses. Emitted as number-or-omitted, never null (API tightened
   * 2026-08-03); treat missing as "no distance", sort last.
   */
  distance_m?: number
```

- [ ] **Step 2: Add the method**

After `getDailySchedules`, following its exact response-handling pattern:

```ts
  /**
   * Get in-person schedules near a point, for the In-Person segment.
   *
   * Server contract (confirmed with API team 2026-08-03):
   * - Sends EXACTLY lat/lon/radius/iso_dow(+fellowship). No `limit`
   *   (removed — it capped geo candidates before the day filter and
   *   silently truncated results), no `venueType` (in_person is the
   *   default and only accepted value), no `tz` (not accepted here,
   *   unlike /schedules/daily). Unknown params are silently stripped.
   * - Response is /schedules/daily-shaped with distance_m added,
   *   millis-ascending; callers re-sort by distance client-side.
   *
   * PRIVACY: never log lat/lon — logs ship to Loki. Radius/iso_dow only.
   */
  async getNearbySchedules(params: {
    lat: number
    lon: number
    radius: number
    iso_dow: number
    fellowship?: string
  }): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching nearby schedules from API", {
      radius: params.radius,
      iso_dow: params.iso_dow,
      fellowship: params.fellowship,
    })

    const query: Record<string, string | number> = {
      lat: params.lat,
      lon: params.lon,
      radius: params.radius,
      iso_dow: params.iso_dow,
    }
    if (params.fellowship) query.fellowship = params.fellowship

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      iso_dow: number
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/nearby", query)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("API request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || !Array.isArray(response.data.schedules)) {
      log.warn("Invalid response data format")
      return { kind: "bad-data" }
    }

    log.debug("Received nearby schedules", {
      count: response.data.count,
      iso_dow: params.iso_dow,
    })

    return {
      kind: "ok",
      schedules: response.data.schedules,
      count: response.data.count,
    }
  }
```

- [ ] **Step 3: Verify against dev API, compile, commit**

```bash
npm run compile && npm run lint:check
# Sanity: endpoint exists on dev :4000 (device-auth means curl may 401 — a
# 401/400 response still proves the ROUTE exists; only 404 is a failure)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4000/schedules/nearby?lat=43.6&lon=-116.2&radius=25000&iso_dow=2"
git add app/services/api/index.ts
git commit -m "✨ feat(api): getNearbySchedules for /schedules/nearby + distance_m on LiveSchedule"
```

---

### Task 3: expo-location dependency + app.json config

**Files:**
- Modify: `package.json`, `package-lock.json` (via expo install), `app.json` (plugins array, ~line 82)

**Interfaces:**
- Produces: `import * as Location from "expo-location"` available to Task 6. New native module — dev client rebuild required from here on.

- [ ] **Step 1: Install**

```bash
npx expo install expo-location
```

- [ ] **Step 2: Add the config plugin**

In `app.json` `expo.plugins`, after `"expo-secure-store"`, add:

```json
[
  "expo-location",
  {
    "locationWhenInUsePermission": "RecoverySky uses your location only to find in-person meetings near you. Your location is never stored or shared.",
    "isAndroidBackgroundLocationEnabled": false
  }
]
```

The plugin injects `NSLocationWhenInUseUsageDescription` (iOS) and `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` (Android). We request foreground-only; background stays disabled. (Permission copy is English-only in app.json, matching the repo's existing plugin strings.)

- [ ] **Step 3: Rebuild dev client and verify**

```bash
npm run compile
npm run ios   # or: npm run build:ios:sim — native dep means the old dev client won't load
```

Expected: app builds and launches; no runtime references to Location yet.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "✨ feat(inperson): add expo-location (foreground-only) with privacy-first permission copy"
```

**Note:** This makes the working tree require a 4.8.0 native release — `runtimeVersion` is deliberately NOT bumped until Task 12 (the bump script commits/tags/pushes). Do not OTA from this branch.

---

### Task 4: Segment plumbing, "Search" relabel, `InPersonContent` shell

**Files:**
- Modify: `app/navigators/navigationTypes.ts:11`
- Modify: `app/screens/MeetingsScreen.tsx`
- Modify: `app/i18n/en.ts` (~line 150), `app/i18n/es.ts` (~line 144)
- Create: `app/screens/InPersonScreen.tsx` (shell)

**Interfaces:**
- Produces: `MeetingsSegment = "live" | "inperson" | "listings"`; `InPersonContent: FC<{ active: boolean }>` exported from `app/screens/InPersonScreen.tsx` (Task 10 fills it in; the `active` prop is the lazy-permission trigger and MUST be wired now).
- Route keys unchanged: deep links / `navigate("Meetings", { segment: "listings" })` still work.

- [ ] **Step 1: Widen the segment type**

`app/navigators/navigationTypes.ts:11`:

```ts
// "listings" is labeled "Search" in the UI (2026-08-03 relabel) — the key
// is unchanged so stored nav state and deep links keep working.
export type MeetingsSegment = "live" | "inperson" | "listings"
```

- [ ] **Step 2: Create the shell screen**

`app/screens/InPersonScreen.tsx`:

```tsx
import { FC } from "react"
import { View, ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"

/**
 * InPersonContent - In-person meetings: nearest-first via /schedules/nearby,
 * day-browse fallback without location. Composed into MeetingsScreen as the
 * middle segment (2026-08-03 in-person UI spec).
 *
 * `active` flips true the first time the user opens the segment — location
 * permission is requested lazily off it, never at app start.
 */
export const InPersonContent: FC<{ active: boolean }> = observer(
  function InPersonContent(_props) {
    return <View style={$container} />
  },
)

const $container: ViewStyle = { flex: 1 }
```

- [ ] **Step 3: Add the middle segment to MeetingsScreen**

In `app/screens/MeetingsScreen.tsx` replace the `SEGMENTS` constant, index mapping, and content views:

```tsx
import { InPersonContent } from "./InPersonScreen"

const SEGMENTS = [
  { key: "live", tx: "meetingsScreen:liveSegment" as const },
  { key: "inperson", tx: "meetingsScreen:inPersonSegment" as const },
  { key: "listings", tx: "meetingsScreen:listingsSegment" as const },
]
// Index↔key mapping is positional; keep this array aligned with SEGMENTS.
const SEGMENT_KEYS: MeetingsSegment[] = ["live", "inperson", "listings"]
```

Replace `handleSegmentChange` and `selectedIndex`:

```tsx
  const handleSegmentChange = useCallback((index: number) => {
    setActiveSegment(SEGMENT_KEYS[index] ?? "live")
  }, [])

  const selectedIndex = Math.max(0, SEGMENT_KEYS.indexOf(activeSegment))
```

Track lazy activation and add the third stay-mounted view between Live and Listings:

```tsx
  // Once the user has opened In-Person we keep it "active" so its state
  // machine (location, fetches) survives segment switches like the other
  // stay-mounted views.
  const [inPersonActivated, setInPersonActivated] = useState(false)
  useEffect(() => {
    if (activeSegment === "inperson") setInPersonActivated(true)
  }, [activeSegment])
```

```tsx
      <View style={[$content, activeSegment === "inperson" ? $contentVisible : $contentHidden]}>
        <InPersonContent active={inPersonActivated} />
      </View>
```

The `meetingId`-forces-live effect is untouched.

- [ ] **Step 4: i18n**

`app/i18n/en.ts` `meetingsScreen` block:

```ts
  meetingsScreen: {
    title: "Meetings",
    placeholder: "Meeting list coming soon",
    liveSegment: "Live",
    inPersonSegment: "In-Person",
    // Relabeled from "Listings" 2026-08-03 — segment KEY stays "listings".
    listingsSegment: "Search",
  },
```

`app/i18n/es.ts`: `inPersonSegment: "En persona"`, `listingsSegment: "Buscar"`.

Sweep the remaining "Listings" labels: in `en.ts` set `listingsScreen.title` to `"Search"` (es: `"Buscar"`). Check `grep -n '"Listings"\|Listados' app/i18n/*.ts` and relabel user-facing values only — do NOT rename keys or the `listingsScreen` namespace.

- [ ] **Step 5: Verify + commit**

```bash
npm run compile && npm run lint:check
npm run test:component   # Text.test.tsx etc. still green
```

Manual: launch app → Meetings tab shows Live | In-Person | Search; middle segment renders blank; `navigate("Meetings", { segment: "listings" })` (e.g. from Home) lands on Search.

```bash
git add app/navigators/navigationTypes.ts app/screens/MeetingsScreen.tsx app/screens/InPersonScreen.tsx app/i18n/en.ts app/i18n/es.ts CHANGELOG.md
git commit -m "✨ feat(meetings): In-Person middle segment + Listings→Search relabel"
```

(CHANGELOG `[Unreleased]` → `Changed`: "Meetings tab: Listings segment renamed Search; new In-Person segment (placeholder pending nearby list).")

---

### Task 5: Extract `DaySelectorModal` from ListingsScreen

**Files:**
- Create: `app/components/DaySelectorModal.tsx`
- Modify: `app/screens/ListingsScreen.tsx` (delete local `ISO_DAYS` ~lines 46–55; replace inline day modal ~lines 518–558; keep `dayModalVisible` state)

**Interfaces:**
- Produces: `ISO_DAYS: { iso: number; tx: TxKeyPath }[]` and `DaySelectorModal: FC<{ visible: boolean; selectedDay: number; onSelect: (isoDow: number) => void; onClose: () => void }>` — Task 10 consumes both.
- `onSelect` fires then the caller closes/tracks (tracking stays caller-side: Listings tracks `listings_day_changed`, In-Person will track `inperson_day_changed`).

- [ ] **Step 1: Create the component**

`app/components/DaySelectorModal.tsx` — move the modal JSX and `ISO_DAYS` verbatim from ListingsScreen, parameterized:

```tsx
import { FC } from "react"
import { Modal, Pressable, TextStyle, TouchableOpacity, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

// ISO day of week: 1=Monday, 7=Sunday. Keys stay in the listingsScreen
// namespace even though this component is shared — renaming i18n keys
// would churn both translation files for zero user value.
export const ISO_DAYS = [
  { iso: 1, tx: "listingsScreen:monday" as const },
  { iso: 2, tx: "listingsScreen:tuesday" as const },
  { iso: 3, tx: "listingsScreen:wednesday" as const },
  { iso: 4, tx: "listingsScreen:thursday" as const },
  { iso: 5, tx: "listingsScreen:friday" as const },
  { iso: 6, tx: "listingsScreen:saturday" as const },
  { iso: 7, tx: "listingsScreen:sunday" as const },
]

interface DaySelectorModalProps {
  visible: boolean
  /** ISO day of week, 1=Monday..7=Sunday */
  selectedDay: number
  /** Called with the tapped day; caller owns tracking + state */
  onSelect: (isoDow: number) => void
  onClose: () => void
}

/**
 * Day-of-week picker modal. Extracted from ListingsScreen (2026-08-03)
 * so the In-Person segment shares one implementation.
 */
export const DaySelectorModal: FC<DaySelectorModalProps> = ({
  visible,
  selectedDay,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={themed($modalOverlay)} onPress={onClose}>
        <View style={themed($modalContent)} accessibilityViewIsModal>
          <Text style={themed($modalTitle)}>{t("listingsScreen:selectDay")}</Text>
          {ISO_DAYS.map((day) => (
            <TouchableOpacity
              key={day.iso}
              style={[themed($modalOption), selectedDay === day.iso && themed($modalOptionSelected)]}
              onPress={() => {
                onSelect(day.iso)
                onClose()
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedDay === day.iso }}
            >
              <Text
                style={[
                  themed($modalOptionText),
                  selectedDay === day.iso && themed($modalOptionTextSelected),
                ]}
              >
                {t(day.tx)}
              </Text>
              {selectedDay === day.iso && (
                <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  )
}
```

Copy the five `$modal*` themed styles verbatim from ListingsScreen into this file (`$modalOverlay`, `$modalContent`, `$modalTitle`, `$modalOption`, `$modalOptionSelected`, `$modalOptionText`, `$modalOptionTextSelected`).

- [ ] **Step 2: Refactor ListingsScreen to use it**

- Delete the local `ISO_DAYS`; add `import { DaySelectorModal, ISO_DAYS } from "@/components/DaySelectorModal"`.
- Replace the inline Day Selector `<Modal>` block with:

```tsx
      <DaySelectorModal
        visible={dayModalVisible}
        selectedDay={selectedDay}
        onSelect={(day) => {
          setSelectedDay(day)
          trackEvent("listings_day_changed", { day })
        }}
        onClose={() => setDayModalVisible(false)}
      />
```

- Keep the language/fellowship/time modals and their `$modal*` styles untouched (they still use the local styles — only delete style constants if nothing else references them; the other modals do, so they stay).

- [ ] **Step 3: Verify + commit**

```bash
npm run compile && npm run lint:check && npm test
```

Manual: Search segment day picker opens, selects, tracks, closes; list refetches.

```bash
git add app/components/DaySelectorModal.tsx app/screens/ListingsScreen.tsx
git commit -m "♻️ refactor(listings): extract shared DaySelectorModal + ISO_DAYS"
```

---

### Task 6: `useNearbySchedules` hook

**Files:**
- Create: `app/hooks/useNearbySchedules.ts`

**Interfaces:**
- Consumes: Task 1 (`resolveMode`, `buildNearbyParams`, `sortByDistance`, `sortByLocalTime`, `DEFAULT_RADIUS_KM`), Task 2 (`api.getNearbySchedules`), Task 3 (`expo-location`), existing `api.getDailySchedules`, `inPersonPoolOf` from `@/context/meetingPools`, `MeetingWithTrex`, `loadString`/`saveString` from `@/utils/storage`, `useConfigStore`/`useProfileStore`.
- Produces (Task 10 consumes):

```ts
export interface UseNearbySchedulesResult {
  mode: NearbyMode
  meetings: MeetingWithTrex[]
  isLoading: boolean
  /** Set only when the ACTIVE path's fetch failed (fallback fetch failing, or total dead-end) */
  error: string | null
  /** Why the fallback banner is showing (null in nearby/locating modes) */
  bannerReason: "location" | "nearbyFailed" | null
  selectedDay: number
  setSelectedDay: (isoDow: number) => void
  radiusKm: number
  setRadiusKm: (km: number) => void
  useMiles: boolean
  /** Pull-to-refresh: re-fix location (if permitted) then refetch */
  refresh: () => Promise<void>
  /** Banner tap: re-request permission (no-op → Settings when !canAskAgain) */
  requestLocation: () => Promise<void>
  canAskAgain: boolean
}
export function useNearbySchedules(active: boolean): UseNearbySchedulesResult
```

- [ ] **Step 1: Implement the hook**

`app/hooks/useNearbySchedules.ts` — key structure (write it in full; this is the complete logic, not a sketch):

```ts
import { useCallback, useEffect, useRef, useState } from "react"
import * as Location from "expo-location"
import { getLocales } from "expo-localization"

import { MeetingWithTrex } from "@/context/MeetingContext"
import { inPersonPoolOf } from "@/context/meetingPools"
import { useConfigStore, useProfileStore } from "@/models"
import { api, LiveSchedule } from "@/services/api"
import { logger } from "@/utils/logger"
import {
  buildNearbyParams,
  DEFAULT_RADIUS_KM,
  NearbyMode,
  resolveMode,
  sortByDistance,
  sortByLocalTime,
} from "@/utils/nearbyLogic"
import { loadString, saveString } from "@/utils/storage"

const log = logger.child({ module: "useNearbySchedules" })

/** MMKV key for the persisted radius preference (a preference, NOT location data). */
const RADIUS_STORAGE_KEY = "inperson.radius"
/** Give the GPS 10 s before degrading to day-browse. */
const FIX_TIMEOUT_MS = 10_000

const getCurrentIsoDow = (): number => {
  const jsDay = new Date().getDay()
  return jsDay === 0 ? 7 : jsDay
}

const loadRadius = (): number => {
  const stored = Number(loadString(RADIUS_STORAGE_KEY))
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_RADIUS_KM
}

// Same wire→app mapping ListingsScreen uses for the daily endpoints; the
// nearby response is daily-shaped plus distance_m (kept via the spread? No —
// distance_m is on the schedule row, not meeting; copy it explicitly).
const toMeetings = (schedules: LiveSchedule[]): MeetingWithTrex[] =>
  schedules.map((s) => ({
    ...s.meeting,
    feedback: null,
    sid: s.sid,
    millis: s.millis,
    duration_ms: s.duration_ms ?? 0,
    scheduleData: s.data,
    distance_m: s.distance_m,
  }))
```

Note: `MeetingWithTrex` needs `distance_m?: number` — add it to the interface in `app/context/MeetingContext.tsx` (with a comment: "present only when the row came from /schedules/nearby"). That's part of this task.

State and refs:

```ts
  const [permission, setPermission] = useState<"undetermined" | "granted" | "denied">("undetermined")
  const [canAskAgain, setCanAskAgain] = useState(true)
  const [fix, setFix] = useState<"pending" | "acquired" | "failed">("pending")
  const [nearbyFetchFailed, setNearbyFetchFailed] = useState(false)
  const [meetings, setMeetings] = useState<MeetingWithTrex[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState(getCurrentIsoDow)
  const [radiusKm, setRadiusKmState] = useState(loadRadius)
  // PRIVACY: coordinates live in this ref only — never state (avoids
  // accidental serialization in devtools snapshots), never MMKV/SQLite,
  // sent nowhere but the /schedules/nearby query.
  const coordsRef = useRef<{ lat: number; lon: number } | null>(null)
```

`useMiles`: `getLocales()[0]?.measurementSystem === "us"` (compute once with `useRef` or `useMemo`).

Location acquisition (called on first activation and on refresh/requestLocation):

```ts
  const acquireLocation = useCallback(async (): Promise<boolean> => {
    const perm = await Location.requestForegroundPermissionsAsync()
    setCanAskAgain(perm.canAskAgain)
    if (!perm.granted) {
      setPermission("denied")
      return false
    }
    setPermission("granted")
    setFix("pending")
    try {
      // Race the fix against a 10 s timeout — a cold GPS indoors can hang
      // far longer, and the fallback list is more useful than a spinner.
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("location fix timeout")), FIX_TIMEOUT_MS),
        ),
      ])
      coordsRef.current = { lat: position.coords.latitude, lon: position.coords.longitude }
      setFix("acquired")
      return true
    } catch (err) {
      log.warn("Location fix failed", { error: String(err) }) // no coords in logs
      setFix("failed")
      return false
    }
  }, [])
```

Fetching — one function decides path from current state (mirrors ListingsScreen's maintenance gate and self-verification):

```ts
  const fetchMeetings = useCallback(async () => {
    if (configStore.maintenanceMode) {
      log.debug("Skipping nearby fetch — maintenance mode")
      setIsLoading(false)
      return
    }
    const fellowship = profileStore.fellowship
    if (!fellowship) {
      setMeetings([])
      setError(null)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const coords = coordsRef.current
      if (coords) {
        // Spec §4: degrade only "after the standard retry" — one immediate
        // retry on a non-ok result before falling back to day-browse, so a
        // single dropped packet doesn't demote a located user.
        const params = buildNearbyParams(coords.lat, coords.lon, radiusKm, selectedDay, fellowship)
        let result = await api.getNearbySchedules(params)
        if (result.kind !== "ok") result = await api.getNearbySchedules(params)
        if (result.kind === "ok") {
          // Self-verify venue like the daily path (2026-08-02 fix wave):
          // a proxy/older server answering with online rows yields an
          // empty pool rather than mislabeled meetings.
          const pool = inPersonPoolOf(true, toMeetings(result.schedules))
          setMeetings(sortByDistance(pool.items))
          setNearbyFetchFailed(false)
          return
        }
        log.warn("Nearby fetch failed; degrading to day-browse", { kind: result.kind })
        setNearbyFetchFailed(true)
        // fall through to the fallback fetch below
      }
      const fallback = await api.getDailySchedules(selectedDay, fellowship, "in_person")
      if (fallback.kind === "ok") {
        const pool = inPersonPoolOf(true, toMeetings(fallback.schedules))
        setMeetings(sortByLocalTime(pool.items))
      } else {
        log.error("In-person fallback fetch failed", { kind: fallback.kind })
        setError(`Error: ${fallback.kind}`)
        setMeetings([])
      }
    } catch (err) {
      log.error("Exception fetching in-person schedules", { error: String(err) })
      setError("Failed to load meetings")
      setMeetings([])
    } finally {
      setIsLoading(false)
    }
  }, [radiusKm, selectedDay, profileStore.fellowship, configStore])
```

Effects and the rest:

- First-activation effect: `useEffect(() => { if (!active || startedRef.current) return; startedRef.current = true; acquireLocation().finally(fetchMeetings) }, [active, ...])`.
- Refetch effect on `selectedDay` / `radiusKm` / fellowship change **after** activation (guard with `startedRef.current`).
- Maintenance-exit: `useEffect` observing `configStore.maintenanceMode` — when it flips false and `startedRef.current`, refetch. (The hook runs inside observer components; mirror how ListingsScreen handles this — if Listings relies on its fetch `useCallback` dep on `configStore`, do the same.)
- `setRadiusKm`: `saveString(RADIUS_STORAGE_KEY, String(km))` then `setRadiusKmState(km)`.
- `refresh`: if permission granted → `acquireLocation()` then `fetchMeetings()`; else just `fetchMeetings()`.
- `requestLocation`: `acquireLocation()` then `fetchMeetings()` (caller checks `canAskAgain` and routes to `Linking.openSettings()` itself).
- `mode`: `resolveMode({ active, permission, fix, nearbyFetchFailed })`.
- `bannerReason`: `mode !== "fallback" ? null : nearbyFetchFailed ? "nearbyFailed" : "location"`.

- [ ] **Step 2: Verify + commit**

```bash
npm run compile && npm run lint:check
```

Manual (dev build from Task 3, dev API): open In-Person segment → permission prompt appears (and NOT at app launch); grant → list loads; deny (fresh install / reset permission) → fallback fetch runs.

```bash
git add app/hooks/useNearbySchedules.ts app/context/MeetingContext.tsx
git commit -m "✨ feat(inperson): useNearbySchedules hook — lazy location, nearby fetch, day-browse fallback"
```

---

### Task 7: `InPersonScheduleRow` component (jest-expo TDD)

**Files:**
- Create: `app/components/InPersonScheduleRow.tsx`
- Test: `app/components/InPersonScheduleRow.test.tsx`

**Interfaces:**
- Consumes: `MeetingWithTrex`, `FELLOWSHIP_COLORS` from `@recoverysky-org/common/browser`, `formatDistance` (label computed by caller — the row takes a ready string to stay dumb).
- Produces: `InPersonScheduleRow: FC<{ meeting: MeetingWithTrex; distanceLabel?: string; hasReminder?: boolean; onPress?: (meeting: MeetingWithTrex) => void }>`

- [ ] **Step 1: Write the failing test**

`app/components/InPersonScheduleRow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native"

import { InPersonScheduleRow } from "./InPersonScheduleRow"
import type { MeetingWithTrex } from "@/context/MeetingContext"

const meeting = {
  id: "m1",
  name: "Sunrise Serenity",
  fellowship: "AA",
  venueType: "in_person",
  hybrid: false,
  venueName: "St. Mark's Church",
  city: "Boise",
  state: "ID",
  millis: new Date(2026, 7, 4, 7, 0).getTime(),
  duration_ms: 3600000,
  sid: "s1",
  feedback: null,
  scheduleData: null,
} as unknown as MeetingWithTrex

describe("InPersonScheduleRow", () => {
  it("renders name, venue line, and distance badge", () => {
    render(<InPersonScheduleRow meeting={meeting} distanceLabel="0.8 mi" />)
    expect(screen.getByText("Sunrise Serenity")).toBeTruthy()
    expect(screen.getByText(/St\. Mark's Church/)).toBeTruthy()
    expect(screen.getByText("0.8 mi")).toBeTruthy()
  })

  it("omits the distance badge without a label", () => {
    render(<InPersonScheduleRow meeting={meeting} />)
    expect(screen.queryByText(/mi$/)).toBeNull()
  })

  it("shows the hybrid indicator for hybrid meetings", () => {
    render(<InPersonScheduleRow meeting={{ ...meeting, hybrid: true }} />)
    expect(screen.getByTestId("hybrid-indicator")).toBeTruthy()
  })

  it("hides the hybrid indicator for in-person-only meetings", () => {
    render(<InPersonScheduleRow meeting={meeting} />)
    expect(screen.queryByTestId("hybrid-indicator")).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:component -- app/components/InPersonScheduleRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the row**

Model layout on `LiveMeetingRow` (fellowship color accent bar via `FELLOWSHIP_COLORS[meeting.fellowship]`, name + local time line). Structure:

```tsx
import { FC } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { FELLOWSHIP_COLORS } from "@recoverysky-org/common/browser"

import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface InPersonScheduleRowProps {
  meeting: MeetingWithTrex
  /** Pre-formatted distance ("0.8 mi") — omitted in fallback mode */
  distanceLabel?: string
  hasReminder?: boolean
  onPress?: (meeting: MeetingWithTrex) => void
}

export const InPersonScheduleRow: FC<InPersonScheduleRowProps> = ({
  meeting,
  distanceLabel,
  hasReminder,
  onPress,
}) => {
  // Local wall-clock time, matching LiveMeetingRow's formatting
  const time = new Date(meeting.millis).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
  const venueLine = [meeting.venueName, meeting.city].filter(Boolean).join(" • ")
  // ... accent bar, name row (+ reminder bell like LiveMeetingRow when
  // hasReminder), venue line, right column: distanceLabel badge (hidden
  // when undefined) and hybrid glyph:
  // {meeting.hybrid && (
  //   <Ionicons testID="hybrid-indicator" name="globe-outline" size={14} ... />
  // )}
}
```

Follow LiveMeetingRow's themed-style conventions; badge = small pill using `colors.card` background + `colors.textDim` text.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:component -- app/components/InPersonScheduleRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run compile && npm run lint:check
git add app/components/InPersonScheduleRow.tsx app/components/InPersonScheduleRow.test.tsx
git commit -m "✨ feat(inperson): InPersonScheduleRow with venue line, distance badge, hybrid glyph"
```

---

### Task 8: `saveInPersonAttendance` service

**Files:**
- Create: `app/services/inPerson/attendance.ts`

**Interfaces:**
- Consumes: `attendanceRepo` / `attendanceEvents` from `@/db` (results are `{ ok: true, value } | { ok: false, error }`), `meetingEvents` from `@/db/meetingEvents`, `isSameLocalDay` from `@/utils/nearbyLogic`, `expo-crypto`.
- Produces (Task 9 consumes):

```ts
export interface InPersonAttendanceInput {
  uid: string
  mid: string
  zid: string
  meetingName: string
  durationMs: number
}
export interface InPersonAttendanceResult {
  ok: boolean
  attendanceId?: string
  /** True when a record for this meeting already exists today — no write done */
  alreadyLogged?: boolean
}
export async function saveInPersonAttendance(input: InPersonAttendanceInput): Promise<InPersonAttendanceResult>
export async function hasLoggedToday(mid: string): Promise<boolean>
```

- [ ] **Step 1: Implement**

Model directly on `app/services/zoom/externalAttendance.ts` (same create → events → markProcessed-with-retry → meetingEvents sequence), with these differences: no timer, no `MIN_CREDIT_MS` gate (`valid` is always true — presence was user-confirmed), `SOURCE = { source: "in-person" }`, and a same-local-day guard:

```ts
import * as Crypto from "expo-crypto"

import { attendanceRepo, attendanceEvents, type AttendanceEvent } from "@/db"
import { meetingEvents } from "@/db/meetingEvents"
import { logger } from "@/utils/logger"
import { isSameLocalDay } from "@/utils/nearbyLogic"

const log = logger.child({ module: "InPersonAttendance" })

const SOURCE = { source: "in-person" }

/**
 * True when an attendance record for this meeting was already created
 * today (device-local day). Backs the "I'm Here" double-log guard and the
 * popup's logged-✓ state. Fails open (false) on repo errors — a second
 * record is more recoverable than a blocked first one.
 */
export async function hasLoggedToday(mid: string): Promise<boolean> {
  const result = await attendanceRepo.findByMeetingId(mid)
  if (!result.ok) return false
  const now = Date.now()
  return result.value.some((r) => isSameLocalDay(r.created, now))
}
```

`saveInPersonAttendance`:
1. `if (await hasLoggedToday(input.mid)) return { ok: true, alreadyLogged: true }`
2. `const now = Date.now()`, `const attendanceId = Crypto.randomUUID()`
3. `attendanceRepo.create({ id, uid, mid, zid, meetingName, created: now, events })` where events =

```ts
  [{ timestamp: now, message: "Marked present at in-person meeting", json: JSON.stringify(SOURCE) }]
```

4. On create failure → log + `{ ok: false }`. On success → `attendanceEvents.emit({ type: "created", id: attendanceId })`.
5. `markProcessed(attendanceId, { start: now, end: now + input.durationMs, credit: input.durationMs, valid: true })` with the identical 3-retry / [500, 1500, 4500] ms backoff loop as `externalAttendance.ts` (copy it, comments included — the orphaned-record rationale applies verbatim).
6. On processed success → `attendanceEvents.emit({ type: "processed", id: attendanceId, mid: input.mid, valid: true, source: "in-person" })` and `meetingEvents.completed("in-person")` (rating-engine tally — always fires here; unlike the timer path there is no invalid case).
7. Return `{ ok: true, attendanceId }`.

- [ ] **Step 2: Verify + commit**

```bash
npm run compile && npm run lint:check
git add app/services/inPerson/attendance.ts
git commit -m "✨ feat(inperson): saveInPersonAttendance — sync-outbox write with same-day double-log guard"
```

(Automated coverage note: this module imports `@/` so it is jest/manual territory by repo convention, same as `externalAttendance.ts`. The pure piece — `isSameLocalDay` — is already vitest-covered in Task 1.)

---

### Task 9: `InPersonPopup`

**Files:**
- Create: `app/components/InPersonPopup.tsx`
- Modify: `app/i18n/en.ts`, `app/i18n/es.ts` (new `inPersonPopup` namespace)

**Interfaces:**
- Consumes: `useReminders` (`app/hooks/useReminders.ts` — returns `{ reminderCells, createReminder, updateReminder, deleteReminder, findExistingReminder, checkOverlap }` given `(meeting | null, sid)`), `ScheduleGrid`, `ReminderEditorModal` (props: `visible, onClose, meeting, existingReminder, selectedCell, sid, onCreate, onUpdate, onDelete, onCheckOverlap`), `useSubscription().isPremium`, `useConfigStore`/`useProfileStore`/`useAuthenticationStore` (uid = `authStore.userId || "anonymous"`), `saveInPersonAttendance`/`hasLoggedToday` (Task 8), `buildDirectionsUrl`/`formatDistance` (Task 1), `trackEvent`.
- Produces: `InPersonPopup: FC<{ visible: boolean; meeting: MeetingWithTrex | null; onClose: () => void }>` — Task 10 consumes.

- [ ] **Step 1: i18n keys**

`en.ts`, new top-level namespace:

```ts
  inPersonPopup: {
    getDirections: "Get Directions",
    contacts: "Contacts",
    imHere: "I'm Here",
    imHereSaving: "Saving…",
    logged: "Attendance Logged",
    alsoOnline: "Also meets online",
    approximate: "Location shown is approximate",
    attendanceSaved: "Attendance saved",
    attendanceError: "Couldn't save attendance — please try again",
    tapTimesHint: "Tap a time to set a reminder",
  },
```

`es.ts`:

```ts
  inPersonPopup: {
    getDirections: "Cómo llegar",
    contacts: "Contactos",
    imHere: "Estoy aquí",
    imHereSaving: "Guardando…",
    logged: "Asistencia registrada",
    alsoOnline: "También se reúne en línea",
    approximate: "La ubicación mostrada es aproximada",
    attendanceSaved: "Asistencia guardada",
    attendanceError: "No se pudo guardar la asistencia — inténtalo de nuevo",
    tapTimesHint: "Toca una hora para crear un recordatorio",
  },
```

- [ ] **Step 2: Implement the popup**

Structure (modeled on SchedulePopup's shell — overlay `Modal`, card, close on overlay press, auto-close on screen blur via `useIsFocused`; NOT the file itself, which is online-only machinery):

```tsx
interface InPersonPopupProps {
  visible: boolean
  meeting: MeetingWithTrex | null
  onClose: () => void
}
```

Content sections, top to bottom:

1. **Header**: meeting name, fellowship badge (FELLOWSHIP_COLORS), local time + duration, hybrid note (`tx="inPersonPopup:alsoOnline"` with a small globe icon) when `meeting.hybrid`.
2. **Venue block**: `venueName` (bold), `formattedAddress`, `locationInfo` (dim, only when non-empty), `approximate` caveat row (`tx="inPersonPopup:approximate"`, warning-dim style) when `meeting.approximate`.
3. **Get Directions button** — hidden when `buildDirectionsUrl` returns "":

```tsx
  const directionsUrl = useMemo(
    () =>
      meeting
        ? buildDirectionsUrl({
            platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
            latitude: meeting.latitude,
            longitude: meeting.longitude,
            venueName: meeting.venueName,
            formattedAddress: meeting.formattedAddress,
          })
        : "",
    [meeting],
  )

  const handleDirections = useCallback(() => {
    if (!directionsUrl) return
    trackEvent("inperson_directions_opened")
    // Best-effort: if the geo:/maps: scheme has no handler, fall back to
    // the universal Google Maps web URL rather than failing silently.
    Linking.openURL(directionsUrl).catch(() => {
      const web = buildDirectionsUrl({ platform: "web", latitude: meeting?.latitude, longitude: meeting?.longitude, venueName: meeting?.venueName, formattedAddress: meeting?.formattedAddress })
      if (web) Linking.openURL(web).catch(() => {})
    })
  }, [directionsUrl, meeting])
```

4. **Contacts** (only when `meeting.contacts?.length`): section title `tx="inPersonPopup:contacts"`; per contact a row with `name`, and tappable `phone` (`Linking.openURL(\`tel:${phone}\`)`) / `email` (`mailto:`) — render whichever fields are non-empty.
5. **Schedule + reminders**: copy SchedulePopup's wiring exactly —

```tsx
  const { reminderCells, createReminder, updateReminder, deleteReminder, findExistingReminder, checkOverlap } =
    useReminders(visible ? meeting : null, meeting?.sid ?? "")
```

`scheduleGridData` from `meeting.scheduleData ?? []`, `<ScheduleGrid scheduleData=… currentDow=… onCellPress={handleCellPress} reminderCells={reminderCells} />`, hint `tx="inPersonPopup:tapTimesHint"`, and `handleCellPress` with the **same maintenance-mode gate and premium gate** as `SchedulePopup.tsx:239-277` (copy the block including its comments; the returnTo route string becomes `` `Meetings:meetingId:${meeting!.id}` `` unchanged). Render `<ReminderEditorModal …/>` with the same props SchedulePopup passes (`visible={reminderEditorVisible}`, `existingReminder={editingReminder}`, `selectedCell`, `sid={meeting?.sid ?? ""}`, `onCreate={createReminder}`, `onUpdate={updateReminder}`, `onDelete={deleteReminder}`, `onCheckOverlap={checkOverlap}`).
6. **"I'm Here"** (only when `profileStore.attendanceEnabled`): three-state button —

```tsx
  const [logState, setLogState] = useState<"idle" | "saving" | "logged">("idle")

  // Reset + probe the double-log guard each time the popup opens on a meeting
  useEffect(() => {
    if (!visible || !meeting?.id) return
    setLogState("idle")
    hasLoggedToday(meeting.id).then((logged) => {
      if (logged) setLogState("logged")
    })
  }, [visible, meeting?.id])

  const handleImHere = useCallback(async () => {
    if (!meeting || logState !== "idle") return
    setLogState("saving")
    const result = await saveInPersonAttendance({
      uid: authStore.userId || "anonymous",
      mid: meeting.id,
      zid: meeting.zid,
      meetingName: meeting.name,
      durationMs: meeting.duration_ms || 60 * 60 * 1000, // default 1 h if the wire omitted duration
    })
    if (result.ok) {
      setLogState("logged")
      trackEvent("inperson_attendance_logged")
      // "Attendance saved" toast/banner via the repo's standard pattern
    } else {
      setLogState("idle")
      Alert.alert(t("inPersonPopup:attendanceError"))
    }
  }, [meeting, logState, authStore.userId])
```

Button label: idle → `imHere`, saving → `imHereSaving` (disabled), logged → `logged` with a checkmark icon (disabled).

- [ ] **Step 3: Verify + commit**

```bash
npm run compile && npm run lint:check && npm test
```

Manual (dev build): open a popup from the (Task 10) list — or temporarily mount it from LiveScreen with an in-person record from `allLiveMeetings` — verify directions opens Maps, contacts links work, reminder editor opens with premium/maintenance gates, I'm Here → logged ✓, reopen popup → still logged ✓, Attendance tab shows the record.

```bash
git add app/components/InPersonPopup.tsx app/i18n/en.ts app/i18n/es.ts CHANGELOG.md
git commit -m "✨ feat(inperson): InPersonPopup — venue, directions, contacts, reminders, I'm Here"
```

---

### Task 10: `InPersonContent` — full screen

**Files:**
- Modify: `app/screens/InPersonScreen.tsx` (replace the Task 4 shell)
- Modify: `app/i18n/en.ts`, `app/i18n/es.ts` (new `inPersonScreen` namespace)

**Interfaces:**
- Consumes: `useNearbySchedules(active)` (Task 6), `DaySelectorModal`/`ISO_DAYS` (Task 5), `InPersonScheduleRow` (Task 7), `InPersonPopup` (Task 9), `formatDistance`/`RADIUS_OPTIONS_KM` (Task 1), `useReminderLookup`/`meetingHasReminder` from `@/hooks/useReminders`, `trackEvent`, `Linking.openSettings`.
- Produces: the final `InPersonContent: FC<{ active: boolean }>` (same export name/signature as the shell — MeetingsScreen needs no change).

- [ ] **Step 1: i18n keys**

`en.ts`:

```ts
  inPersonScreen: {
    title: "In-Person",
    withinRadius: "Within {{distance}}",
    selectRadius: "Search Distance",
    locationBanner: "Enable location to see meetings near you",
    locationBannerDenied: "Location is off — open Settings to enable nearby results",
    nearbyFailedBanner: "Couldn't load nearby results — tap to retry",
    emptyNearby: "No in-person meetings within {{distance}} on {{day}} — try a wider radius",
    emptyFallback: "No in-person {{fellowship}} meetings on {{day}}",
    selectFellowship: "Select a fellowship in Settings to see meetings",
  },
```

`es.ts`:

```ts
  inPersonScreen: {
    title: "En persona",
    withinRadius: "En un radio de {{distance}}",
    selectRadius: "Distancia de búsqueda",
    locationBanner: "Activa la ubicación para ver reuniones cerca de ti",
    locationBannerDenied: "La ubicación está desactivada — ábrela en Ajustes para ver resultados cercanos",
    nearbyFailedBanner: "No se pudieron cargar los resultados cercanos — toca para reintentar",
    emptyNearby: "No hay reuniones en persona en un radio de {{distance}} el {{day}} — prueba un radio mayor",
    emptyFallback: "No hay reuniones en persona de {{fellowship}} el {{day}}",
    selectFellowship: "Selecciona una confraternidad en Ajustes para ver reuniones",
  },
```

- [ ] **Step 2: Implement the screen**

Replace the shell body. Structure (all pieces follow ListingsScreen conventions — themed styles, FlatList, RefreshControl):

```tsx
export const InPersonContent: FC<{ active: boolean }> = observer(function InPersonContent({
  active,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const reminderLookup = useReminderLookup()
  const {
    mode, meetings, isLoading, error, bannerReason,
    selectedDay, setSelectedDay, radiusKm, setRadiusKm, useMiles,
    refresh, requestLocation, canAskAgain,
  } = useNearbySchedules(active)

  const [dayModalVisible, setDayModalVisible] = useState(false)
  const [radiusModalVisible, setRadiusModalVisible] = useState(false)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithTrex | null>(null)

  // Segment-view analytics once per activation
  useEffect(() => {
    if (active) trackEvent("inperson_segment_viewed")
  }, [active])
  ...
})
```

Pieces:

- **Controls row** (standalone header component per house rule, observer, above the list): two selector buttons styled like ListingsScreen's (`$selectorButton` pattern): Day (label = selected day via `ISO_DAYS`) opening `DaySelectorModal` (onSelect: `setSelectedDay(day); trackEvent("inperson_day_changed", { day })`), and Radius (label = `t("inPersonScreen:withinRadius", { distance: formatDistance(radiusKm * 1000, useMiles) })`) opening the radius modal.
- **Radius modal**: same modal-selector chrome as `DaySelectorModal` (title `selectRadius`; options mapped from `RADIUS_OPTIONS_KM`, label `formatDistance(km * 1000, useMiles)`, checkmark on selected; onSelect: `setRadiusKm(km); trackEvent("inperson_radius_changed", { km })`). Inline in this file (only user).
- **Banner** (fallback mode only): slim tappable strip under the controls; text by `bannerReason` — `"location"` → `canAskAgain ? locationBanner : locationBannerDenied`, `"nearbyFailed"` → `nearbyFailedBanner`. Tap: `nearbyFailed` → `refresh()`; location + `canAskAgain` → `requestLocation()`; location + `!canAskAgain` → `Linking.openSettings()`.
- **List**: FlatList over `meetings`; `renderItem` →

```tsx
  <InPersonScheduleRow
    meeting={item}
    distanceLabel={mode === "nearby" ? formatDistance(item.distance_m, useMiles) || undefined : undefined}
    hasReminder={meetingHasReminder(item, reminderLookup)}
    onPress={setSelectedMeeting}
  />
```

  `keyExtractor: (item) => item.id`; `RefreshControl` → `refresh`; separator like Listings.
- **States**: `mode === "locating"` → centered `ActivityIndicator`; empty list → no-fellowship (`selectFellowship`) / `error` text / mode-appropriate empty (`emptyNearby` with `distance` + `day` interpolations and a "wider radius" tap opening the radius modal, or `emptyFallback`). Day label for interpolation: `t(ISO_DAYS.find((d) => d.iso === selectedDay)!.tx)`.
- **Popup**: `<InPersonPopup visible={!!selectedMeeting} meeting={selectedMeeting} onClose={() => setSelectedMeeting(null)} />`.

- [ ] **Step 3: Full verification + commit**

```bash
npm run compile && npm run lint:check && npm test
```

Manual on dev build: grant → nearest-first list with distance badges; radius change refetches + persists across restart; day change refetches; deny → fallback list + banner; banner routes correctly (re-ask vs Settings); popup round-trip; pull-to-refresh.

```bash
git add app/screens/InPersonScreen.tsx app/i18n/en.ts app/i18n/es.ts CHANGELOG.md
git commit -m "✨ feat(inperson): full In-Person segment — nearest-first list, radius/day controls, fallback banner"
```

(CHANGELOG `[Unreleased]` → `Added`: user-facing description of the In-Person segment: nearby search, directions, contacts, reminders, I'm-Here attendance.)

---

### Task 11: Documentation

**Files:**
- Modify: `CHANGELOG.md` (verify Tasks 4/9/10 entries are complete and grouped), `docs/PRODUCTION_CHECKLIST.md`, `CLAUDE.md`, `EVENTS.md`

- [ ] **Step 1: PRODUCTION_CHECKLIST.md**

Add under pre-release verification:

```markdown
- [ ] **In-person nearby routes live in prod** (required since 4.8.0): the
      store build calls `GET /schedules/nearby`; confirm
      https://api.recoverysky.app/api/docs lists `/schedules/nearby` and
      `/meetings/nearby` BEFORE submitting. Dev/TestFlight against dev is
      fine; a store build without the prod routes degrades every located
      user to day-browse (nearbyFailed banner).
```

- [ ] **Step 2: CLAUDE.md**

Update the stale spots (per the comment-accuracy rule, these are part of the change):
- **Navigation** section: Meetings tab now has three segments — Live | In-Person | Search (segment keys `live` / `inperson` / `listings`; "Search" is a label-only rename of Listings).
- **Zoom Integration / smaller subsystems**: add a short "In-Person segment" blurb — `useNearbySchedules` + pure `nearbyLogic.ts` (vitest), `InPersonPopup`, `saveInPersonAttendance` (`source: "in-person"`, sync-outbox write, same-day guard), expo-location foreground-only, coordinates never persisted/logged.
- **Runtime Version** section: no text change needed (rule already covers it) — but confirm `version`/`runtimeVersion` guidance still matches after Task 12.

- [ ] **Step 3: EVENTS.md**

Document the new `meetingEvents.completed("in-person")` reason string and the `attendanceEvents` `processed` `source: "in-person"` value alongside the existing `external-timer` entries.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/PRODUCTION_CHECKLIST.md CLAUDE.md EVENTS.md
git commit -m "📝 docs: in-person segment — checklist gate, CLAUDE.md nav/subsystem updates, event catalog"
```

---

### Task 12: Verification & native release (4.8.0)

**Files:**
- Modify: `app.json` (runtimeVersion — manual), `CHANGELOG.md` (cut heading). `package.json`/`app.json` version via script.

- [ ] **Step 1: Full local verification**

```bash
npm run compile && npm run lint:check && npm run lint:deps && npm test
```

All green. Then run the spec's manual smoke checklist end-to-end on a device dev build (`docs/superpowers/specs/2026-08-03-in-person-ui-design.md` → Testing → Manual smoke checklist) — including the Spanish locale sweep and the three-segment deep-link regression.

- [ ] **Step 2: HARD GATE — prod API check**

```bash
curl -s https://api.recoverysky.app/api/docs/swagger-ui-init.js | grep -c "schedules/nearby"
```

Expected: ≥ 1. **If 0: STOP. Do not proceed to store builds.** Coordinate the API prod deploy first (as of 2026-08-03 the nearby routes were unpushed on the API side).

- [ ] **Step 3: Version + runtimeVersion bump**

```bash
npm run minor          # 4.7.0 → 4.8.0; commits, tags, pushes, prebuild:clean, resets OTA counter to 0
```

Then **manually** edit `app.json`: `"runtimeVersion": "4.8.0"` (the script deliberately does not touch it). Move CHANGELOG `[Unreleased]` under `[4.8.0]` with today's date. Commit both:

```bash
git add app.json CHANGELOG.md
git commit -m "🔖 release: runtimeVersion 4.8.0 + changelog cut"
git push
```

- [ ] **Step 4: Store builds + submission**

```bash
npm run release:ios
npm run release:android
```

App Store Connect privacy questionnaire: add **Location** — used for app functionality, not linked to identity, no tracking. Play Console data safety: same.

- [ ] **Step 5: Post-release**

Verify `/config` `LATEST_VERSION` gets bumped server-side once the builds are live (update-prompt flow), and that a subsequent JS-only fix can OTA against runtime 4.8.0 via `npm run update`.

---

## Execution order & dependencies

```
T1 (pure logic) ──┬─→ T2 (API) ──→ T6 (hook) ──┐
T3 (expo-location)┘                            ├─→ T10 (screen) ─→ T11 (docs) ─→ T12 (release)
T4 (plumbing+shell) ──────────────────────────┤
T5 (DaySelectorModal) ────────────────────────┤
T7 (row) ─────────────────────────────────────┤
T8 (attendance svc) ─→ T9 (popup) ────────────┘
```

T1 must land first (everything imports it). T3–T5, T7 are independent of each other. T9 needs T8; T10 needs T5–T7, T9.
