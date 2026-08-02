# In-Person Meetings: App Data Layer — Design Spec

**Date:** 2026-08-02
**Status:** Approved
**Scope:** Pull in-person meeting data into app memory alongside online meetings.
UI/UX for displaying, joining, and attending in-person meetings is **explicitly
deferred** to a follow-up design. No visible behavior changes in this piece.

## Background

`@recoverysky-org/common` **v2.0.0** (installed) models in-person meetings:

- `venueType`: `VenueType` enum — `NONE ("")` / `IN_PERSON` / `ONLINE`. The
  former `HYBRID` member was **removed** in v2.0.0.
- `hybrid: boolean` — new in v2.0.0. True when the meeting also meets the other
  way (online ↔ in-person). A hybrid meeting is **two records** — one online
  (Zoom-keyed), one in-person (venue-keyed) — both `hybrid = true`, with **no
  linkage field** between them.
- Venue display block: `venueName`, `street`, `city`, `state`, `postalCode`,
  `country`, `formattedAddress`, `locationInfo`, `region`, `latitude`,
  `longitude` (numbers on the wire), `approximate`.
- `contacts: Contact[]` — published human contacts.
- `zid` widened: a 9–11 digit Zoom ID **or** `p:<host>:<source-key>` in-person
  key (shared `zidSchema`). SQLite migrations 0051–0053 add all columns and
  auto-run via `useMigrations` — no app DB work needed.

The RecoverySky API (in-person serving branch, running on dev :4000) exposes:

- Query param `venueType` on `/schedules/live`, `/schedules/daily`,
  `/schedules/meeting/:mid` (and `/meetings/*`, WS): **omitted = `online`**
  (protects deployed builds), `in_person` returns the in-person pool. The
  server also accepts a vestigial `hybrid` value (pre-v2.0.0 leftover); the
  app does not use it.
- Meeting wire shape: flat common-v2 fields including the venue block,
  `contacts`, and `hybrid`. Source-provenance fields stay server-side.
  `external` is pinned `false` for non-online venues.
- Cross-pool lookups 404: `/schedules/meeting/:mid?venueType=online` does not
  find an in-person meeting, and vice versa.

Verified live against dev :4000 (2026-08-02): 66 in-person schedules served,
3 of them `hybrid: true`, with real venue data and numeric lat/lng.

## Decisions (from brainstorming)

1. **Fetch model: dual-fetch & merge.** Each refresh makes two calls —
   `venueType=online` and `venueType=in_person` — and merges the results into
   one in-memory pool. Records self-describe via `venueType` / `hybrid`.
2. **Hold-back: existing consumers keep seeing online-only.** Both pools live
   in memory, but the arrays existing UI reads remain filtered to online until
   the UI/UX design lands. Zero visible change from this piece.
3. **Hybrid pairs stay two records.** No linkage field exists; the data layer
   does not attempt to merge or relate them.
4. **Graceful degradation.** If one pool's fetch fails, the other still
   populates; the context `error` is set only when **both** fail.

## Design

### 1. API layer (`app/services/api/index.ts`)

- Export `type VenueFilter = "online" | "in_person"` (app-side contract; the
  server's `hybrid` filter value is intentionally not represented).
- `getLiveSchedules(venueType?: VenueFilter)` — adds `venueType` to the query
  params when provided. Response handling unchanged.
- `getDailySchedules(iso_dow, fellowship, venueType?: VenueFilter)` — same.
- `getScheduleByMeetingId(mid, venueType?: VenueFilter)` — same.
- No type changes to `LiveSchedule` / `MeetingWithTrex`: `MeetingWithTrex
  extends meeting`, so the v2.0.0 fields are already present on the type and
  now simply arrive populated.

### 2. MeetingContext (`app/context/MeetingContext.tsx`)

`refreshLiveMeetings` fetches both pools in parallel, each wrapped in the
existing `retryWithBackoff`:

- `Promise.all` over `getLiveSchedules("online")` and
  `getLiveSchedules("in_person")` (via `Promise.allSettled`-style handling of
  the retry outcomes — both outcomes inspected, neither rejects the other).
- Merge: concatenate successful pools into one array of `MeetingWithTrex`,
  mapped exactly as today (schedule-level password preference, feedback cache
  join, `sid`/`millis`/`duration_ms`/`scheduleData`).
- Failure semantics: one pool failed → other pool still populates, log a
  warning, `error` stays `null`. Both failed → current behavior (`error` set,
  empty list).
- Context shape: new `allLiveMeetings: MeetingWithTrex[]` (merged pool);
  existing `liveMeetings` becomes the online-only projection of it
  (`venueType !== "in_person"`), so every existing consumer (LiveScreen,
  HomeScreen, deep-link lookups) renders exactly what it renders today.
  When the UI work lands, consumers opt into `allLiveMeetings` (or venue-aware
  selectors) deliberately.

### 3. Listings daily fetch (`app/screens/ListingsScreen.tsx`)

`fetchDailySchedules` performs the same dual-fetch & merge with
`getDailySchedules(day, fellowship, venueType)`. The screen keeps rendering
the online-only projection until the UI design lands; the merged pool is held
in state alongside it. Local-time sort applies to the merged pool once so the
future UI inherits correct ordering.

### 4. Deep-link lookup fallback

`getScheduleByMeetingId` callers (LiveScreen `pendingMeetingId` navigation
from notifications/subscription returns) don't know which pool a `mid` lives
in. The lookup tries `online` first (overwhelmingly the common case for
anything reachable today), and on a miss retries with `in_person`. Implemented
as a small wrapper so callers stay one-call.

### 5. Merge logic extraction & testing

Per the repo's vitest constraint (no `@/` runtime imports in unit-tested
code), the pure pieces — pool merge, online-only projection, retry-outcome →
pool/error resolution — are extracted into a small pure module (e.g.
`app/context/meetingPools.ts`) with type-only imports, unit-tested with
vitest:

- merge of two successful pools (order, mapping passthrough)
- one-pool-failure → partial data, no error
- both-failure → error
- online projection excludes `venueType === "in_person"` and nothing else
  (legacy `""` rows are online and must remain visible)

Manual smoke test against dev :4000 (in-person pool populated, hold-back
verified: no in-person rows visible in Live/Listings UI).

## Error handling

No new error kinds. Existing `retryWithBackoff` and `GeneralApiProblem`
handling reused per call. Partial-failure logging via the existing module
loggers.

## Out of scope (parked for the UI/UX design)

- All display work: venue badges, address/contacts rendering, hybrid badge,
  Get Directions, in-person attendance capture, venue filters, geo/near-me.
- Switching any consumer to the merged pool.
- Hybrid pair linkage.
- WS `/ws/schedule` venue subscription (app uses REST polling today).
