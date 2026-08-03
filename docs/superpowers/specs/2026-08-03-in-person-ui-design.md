# In-Person Meetings: UI & Near-Me Search — Design Spec

**Date:** 2026-08-03
**Status:** Approved
**Scope:** Surface the in-person meeting pool (data layer shipped 2026-08-02) as a
new third segment on the Meetings tab, built around location-based nearest-first
search, with in-person meeting detail, directions, contacts, reminders, and
simple attendance capture. Native release (4.8.0) — see Release Path.

## Background

The in-person data layer (`docs/superpowers/specs/2026-08-02-in-person-data-layer-design.md`)
is fully shipped: the app dual-fetches online + in-person pools with an
online-only hold-back projection, so existing UI renders exactly what it did
before. This spec is the deliberately deferred UI/UX follow-up — the first
consumer that opts into the in-person pool.

The RecoverySky API (v0.6.0, in-person serving branch) adds two PostGIS-backed
geo endpoints (common v2.4.1 adds the server-side `geom` generated geography
column + GiST index; nothing app-facing changed in common):

- **`GET /schedules/nearby`** — the list surface. `/schedules/daily` response
  shape (envelope `timestamp`, `iso_dow`, `count`, `schedules`; live-entry keys
  `sid`, `meeting`, `millis`, `duration_ms`, `continuous`, `data`) with
  `distance_m` added per entry. Required: `lat`, `lon`, `radius` (meters,
  ≤100 000), `iso_dow`. Optional: `fellowship` (comma-separated codes).
  Sorted millis-ascending; client re-sorts by `distance_m` for nearest-first.
  Uncached. `venueType` accepts only `in_person` (the default) — the app does
  not send it (`online` → 400).
- **`GET /meetings/nearby`** — the map surface (flat, nearest-first, `iso_dow`
  *optional*). **Not used in this release**; reserved for the deferred map
  follow-up.

Confirmed with the API team (2026-08-03):
- **There is no `limit` param on `/schedules/nearby`.** It was removed because
  `iso_dow` is required on this route, so a limit would cap geo candidates
  *before* the day filter — silently truncating results (measured: only
  ~12–15% of nearby meetings match a given weekday). `radius` is the bound;
  the client holds the whole list and can slice for render caps if ever
  needed. Note: unknown query params are silently stripped by the server's
  Zod layer — a sent `limit` would "work" while doing nothing. Do not send one.
- **`distance_m` will be emitted as `number` or omitted — never `null`.** The
  API team is tightening their emitter at our request. App types it
  `distance_m?: number` and defensively sorts entries missing `distance_m`
  last (regression on their side degrades to "unsorted entry at the bottom,"
  never a crash).
- **None of this is in prod yet.** The nearby routes exist only on the
  in-person serving branch (dev :4000). See Release Path hard gate.

## Decisions (from brainstorming)

1. **Third segment on the Meetings tab: Live | In-Person | Search.** The
   existing "Listings" segment is *relabeled* "Search" (i18n-only; route keys
   and file names unchanged). In-person meetings get a dedicated surface
   rather than venue badges wedged into Live/Search — they are attended, not
   joined, and distance/address/directions are their first-class citizens.
   Live and Search keep their online-only projections untouched.
2. **Location-first from day one.** The segment is built around
   `/schedules/nearby` nearest-first results. Requires `expo-location` →
   native 4.8.0 release.
3. **List-only v1.** No map. Get Directions deep-links to the platform maps
   app — no `react-native-maps` dependency. The map surface
   (`/meetings/nearby` pins) is a deferred follow-up.
4. **Degrade to day-browse when location is unavailable** (denied, services
   off, fix timeout, or nearby fetch failure): browse the full in-person pool
   via `getDailySchedules(day, fellowship, "in_person")` — no distances,
   slim banner offering to enable location. The segment always works;
   location makes it better.
5. **Controls: day picker + radius picker.** Defaults: today, 25 km. Radius
   options 10/25/50/100 km (displayed in miles on imperial locales). Radius
   choice persisted (MMKV storage helpers) — it is a preference, not location
   data. Fellowship filtering follows the profile preference
   (`profileStore.fellowship`), exactly as the Search segment does — no new
   in-screen fellowship control.
6. **Simple "I'm here" attendance capture** in the detail popup for
   attendance-enabled users. No timer, no presence verification — physical
   presence can't be measured; record the meeting's `duration_ms` as credit,
   tagged `source: "in-person"`.
7. **Hybrid pairs stay two records** (no linkage exists). The In-Person
   segment shows the in-person record with an informational "also meets
   online" indicator only.

## Design

### 1. Segment plumbing & the rename

- `MeetingsSegment` (`app/navigators/navigationTypes.ts`) becomes
  `"live" | "inperson" | "listings"`. The third segment's **route key stays
  `"listings"`** — the rename to "Search" is label-only, so stored navigation
  state, deep links, and every `navigate("Meetings", { segment: "listings" })`
  call site keep working untouched.
- `MeetingsScreen.tsx`: `SEGMENTS` gains the middle `inperson` entry; the
  hardcoded two-segment index↔key ternary generalizes to an array lookup. A
  third stay-mounted content `<View>` wraps `InPersonContent` (same
  display:none hiding as Live/Search — state preservation + background
  behavior consistent with the existing pattern).
- The "force live segment when `meetingId` is present" effect is unchanged;
  in-person deep-link records are already dropped by the data-layer fix wave.
- i18n: `meetingsScreen:listingsSegment` value → "Search" / "Buscar"; new
  `meetingsScreen:inPersonSegment` → "In-Person" / "En persona". Sweep other
  user-facing "Listings" strings (titles, accessibility labels) — labels only,
  no key or route renames. `ListingsScreen.tsx` keeps its filename
  (deliberate: file rename churns history for zero user value).
- `SegmentedControl` handles three equal-width segments as-is; "In-Person" /
  "En persona" fit at typical widths.

### 2. Data flow: location, hook, fallback

**API layer** (`app/services/api/index.ts`):

- New `getNearbySchedules({ lat, lon, radius, iso_dow, fellowship? })` →
  `GET /schedules/nearby`, returning the standard discriminated union
  (`{ kind: "ok", data } | GeneralApiProblem`). No `limit`, no `venueType`
  sent (see Background).
- Schedule entry types extend with `distance_m?: number` — no new type family.

**Location** (`expo-location`):

- Permission requested **lazily on first activation of the In-Person
  segment** — never at app start; users who don't touch the segment are never
  prompted.
- One `getCurrentPositionAsync` fix at balanced accuracy per refresh; ~10 s
  timeout → fallback mode.
- **Coordinates live in memory only** — never MMKV, never SQLite, sent
  nowhere except as `/schedules/nearby` query params.

**`useNearbySchedules` hook** — three-mode state machine:

| Mode | Trigger | Behavior |
|---|---|---|
| `locating` | permission/fix in flight | loading state |
| `nearby` | coords acquired | `getNearbySchedules(...)`, client re-sort by `distance_m` ascending |
| `fallback` | denied / services off / fix timeout / nearby fetch failed after retry | `getDailySchedules(day, fellowship, "in_person")`, millis order, banner |

- Inputs: `selectedDay`, `radius`, `profileStore.fellowship`; any change
  refetches. Pull-to-refresh re-fixes location then refetches.
- Radius default 25 km, persisted via `app/utils/storage` helpers
  (key: `inperson.radius`).
- Maintenance mode: fetches early-return using the same gate pattern as
  `ListingsScreen.fetchDailySchedules`; the maintenance-exit refresh applies.

**Pure logic module** — `nearbyLogic.ts` (zero runtime `@/` imports,
type-only imports fine, vitest-covered):

- Mode resolution: (permission, fix, fetch outcomes) → mode.
- Query param building (radius km→m, fellowship pass-through).
- Distance sort — entries missing `distance_m` sort last.
- Distance formatting: `distance_m` → "0.3 mi" / "480 m" / "12 km"; miles vs.
  km by device locale.
- Directions URL builder (see §3).

### 3. UI: list, controls, popup

**`InPersonContent`** (new `app/screens/InPersonScreen.tsx`, exporting
`InPersonContent` per the Live/Listings convention):

- **Controls row**: Day selector (defaults today) + Radius selector
  ("Within 25 km" → modal with 10/25/50/100 km) in the Listings
  selector-button style. The day-selector modal is **extracted from
  `ListingsScreen` into a shared `DaySelectorModal` component** both screens
  use (targeted improvement; fallback: replicate the pattern if extraction
  proves entangled). Radius modal reuses the same modal-selector chrome.
- **List**: `FlatList` of new `InPersonScheduleRow` components — meeting
  name, time, fellowship color accent (visually matching Listings rows),
  venue name + city line, right-aligned distance badge in nearby mode, small
  "also online" glyph when `hybrid`. Header extracted as a standalone
  observer component (house rule — no inline `ListHeaderComponent`).
- **States**: locating spinner; nearby-empty ("No in-person meetings within
  25 km on Tuesday — try a wider radius", tap-through to radius picker);
  fallback banner ("Enable location for nearby results" — tap re-requests
  permission, or deep-links to OS Settings when permanently denied);
  pull-to-refresh.

**`InPersonPopup`** (new, deliberately small — NOT `SchedulePopup`, which is
1,170 lines of online-specific machinery: Zoom join, external timer,
passwords. Scaffolding *patterns* are shared — modal shell, focus auto-close —
not the file):

- **Venue block**: `venueName`, `formattedAddress`, `locationInfo` (human
  directions text), `approximate` caveat line when flagged.
- **Get Directions**: `Linking.openURL` — Apple Maps on iOS, `geo:` URI on
  Android, Google Maps web URL fallback; prefers lat/lng, falls back to
  encoded address. Pure builder in `nearbyLogic.ts`.
- **Contacts**: `contacts[]` rendered with tappable phone/email via
  `Linking`.
- **Schedule + reminders**: reuse `ScheduleGrid` + `ReminderEditorModal`
  exactly as `SchedulePopup` does, including the maintenance-mode block on
  reminder creation.
- **"I'm here"** (shown when `profileStore.attendanceEnabled`): writes an
  attendance record — credit = meeting `duration_ms`, JSON-tagged
  `source: "in-person"` — through the `app/db/repositories.ts` choke point
  (so it enqueues to the sync outbox), fires
  `meetingEvents.completed("in-person")` (review-prompt tally) and
  `attendanceEvents` `"created"`. Button flips to a logged ✓ state; a
  same-meeting-same-day guard prevents accidental double-logs. Modeled on
  `externalAttendance.saveTimerAttendance` but in its own small service
  (e.g. `app/services/inPerson/attendance.ts`) — no timer, no minimum-credit
  gate.

### 4. Error handling

Philosophy: the segment always works.

- Nearby fetch fails after standard retry → **degrade to fallback mode**
  with a "Couldn't load nearby results" banner (same slot as the no-location
  banner, tap to retry). Never a dead screen while day-browse still works.
- Both nearby and fallback fetches fail → standard error state with retry
  (mirrors Listings today).
- Location permanently denied → banner deep-links to OS Settings.
- "I'm here" write failure → toast (existing pattern); the durable sync
  outbox owns eventual cloud delivery.
- Maintenance mode → fetch gates + reminder block as in §2/§3;
  `MaintenanceBanner` renders above everything as usual.
- No new error kinds; existing `GeneralApiProblem` handling reused.

## Release Path (native — 4.8.0)

- `expo-location` is a new native module **and** requires `app.json` plugin
  config + permission strings (`NSLocationWhenInUseUsageDescription`,
  `ACCESS_FINE_LOCATION`). Privacy copy: used only to find nearby meetings,
  never stored or shared.
- Therefore: `npm run minor` (4.7.0 → 4.8.0) + **manual `runtimeVersion`
  bump in `app.json` to 4.8.0**, then `release:ios` / `release:android`.
- **Hard gate: the API nearby routes must be deployed to prod before store
  submission.** Dev/TestFlight builds against dev/staging are fine
  meanwhile. Add to `docs/PRODUCTION_CHECKLIST.md`.
- The uncommitted `@recoverysky-org/common ^2.4.1` bump lands with this work
  (JS-only; no independent runtime impact).
- App Store privacy questionnaire: add location — not linked to identity,
  app-functionality only.
- CHANGELOG: entries under `[Unreleased]` during development → `[4.8.0]` at
  cut.

## Testing

**Vitest** (`nearbyLogic.test.ts`):

- Mode-resolution matrix: grant/deny/services-off/timeout × fetch
  success/failure combinations.
- Query param building (km→m conversion, fellowship pass-through, no
  `limit`/`venueType` keys present).
- Distance sort: ascending; missing `distance_m` sorts last.
- Distance formatting: metric/imperial, sub-km/sub-mile thresholds.
- Directions URL builder: iOS/Android/web-fallback shapes; lat/lng vs.
  address-only inputs.

**Manual smoke checklist:**

- Grant flow → nearest-first list with distances.
- Deny flow → day-browse + banner; banner → permission re-request;
  permanently denied → Settings deep-link.
- Revoke permission mid-session; airplane mode; API-down (nearby fetch fail
  → fallback banner).
- Radius change refetches; radius persists across restart.
- "I'm here" → record visible in Attendance tab, `sync_queue` row present,
  double-log guard, review-tally event.
- Reminder create from `InPersonPopup`; blocked under maintenance mode.
- Spanish locale sweep of all new strings.
- Three-segment regression: `navigate("Meetings", { segment: "listings" })`
  lands on Search; Home/notification deep links unaffected; `meetingId`
  deep link still forces Live.

## Out of scope (deferred)

- Map surface (`/meetings/nearby`, `react-native-maps`) — next release.
- Manual location entry / geocoded city search.
- Presence verification (geofence check-in) for attendance.
- Hybrid pair linkage or merged hybrid display.
- Venue badges inside Live/Search online lists (hold-back stays).
- WS `/ws/schedule` venue subscription.
