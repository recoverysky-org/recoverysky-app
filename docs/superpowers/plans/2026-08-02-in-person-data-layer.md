# In-Person Meetings App Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull in-person meeting data into app memory alongside online meetings (dual-fetch & merge), with zero visible UI change (hold-back: existing consumers keep seeing online-only).

**Architecture:** The API layer gains an optional `venueType` query param on the three schedule methods plus an any-venue lookup wrapper. `MeetingContext` and `ListingsScreen` each fetch both pools (`online` + `in_person`) per refresh and merge them in memory; the arrays existing UI reads are projected to online-only until the UI/UX design lands. Pure merge/projection logic lives in a new alias-free module so vitest can test it.

**Tech Stack:** React Native / Expo 54, apisauce, `@recoverysky-org/common` v2.0.0 types, vitest (pure `.ts` unit tests).

**Spec:** `docs/superpowers/specs/2026-08-02-in-person-data-layer-design.md` — read it first.

## Global Constraints

- **Vitest has no `@/` path alias.** Unit-tested modules must have ZERO runtime `@/` imports (type-only imports are erased and safe). See `app/services/sync/syncLogic.ts` header for the house pattern.
- **Comment style:** this repo comments liberally — non-obvious gates, invariants, and "don't fix this" traps get call-site comments (see CLAUDE.md "Comments"). When changing commented code, update the comment; keep original functional comments and append a dated CHANGED note.
- **Hold-back invariant:** no in-person record may become visible in any existing UI surface in this piece. `liveMeetings` (MeetingContext) and the Listings render path stay online-only.
- **Venue semantics (common v2.0.0):** `venueType` is `""` (legacy online) / `"online"` / `"in_person"`. Legacy `""` **is online** and must remain visible. `hybrid` is a boolean field, not a venue type. The server also accepts a vestigial `hybrid` filter value — the app must NOT use it.
- **Server contract:** omitted `venueType` param = `online`. Cross-pool `/schedules/meeting/:mid` lookups 404.
- Gates: `npm run compile` (tsc), `npm run test:unit -- <file>` (vitest), `npm run lint:check`, `npm run lint:deps`.

---

### Task 1: Pure pool helpers (`app/context/meetingPools.ts`)

**Files:**
- Create: `app/context/meetingPools.ts`
- Test: `app/context/meetingPools.test.ts` (colocated; vitest auto-discovers `**/*.test.ts`)

**Interfaces:**
- Consumes: nothing (pure module, zero imports).
- Produces (used by Tasks 3 and 4):
  - `interface PoolOutcome<T> { ok: boolean; items: T[] }`
  - `interface MergedPools<T> { items: T[]; bothFailed: boolean; onlineFailed: boolean; inPersonFailed: boolean }`
  - `mergePools<T>(online: PoolOutcome<T>, inPerson: PoolOutcome<T>): MergedPools<T>`
  - `isInPersonVenue(venueType: string): boolean`
  - `projectOnline<T extends { venueType: string }>(items: T[]): T[]`

- [ ] **Step 1: Write the failing test**

Create `app/context/meetingPools.test.ts`:

```typescript
import { describe, expect, it } from "vitest"

import { isInPersonVenue, mergePools, projectOnline } from "./meetingPools"

const m = (id: string, venueType: string) => ({ id, venueType })

describe("mergePools", () => {
  it("concatenates both pools online-first when both succeed", () => {
    const merged = mergePools(
      { ok: true, items: [m("a", ""), m("b", "online")] },
      { ok: true, items: [m("c", "in_person")] },
    )
    expect(merged.items.map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(merged.bothFailed).toBe(false)
    expect(merged.onlineFailed).toBe(false)
    expect(merged.inPersonFailed).toBe(false)
  })

  it("returns the surviving pool when one fails, without flagging bothFailed", () => {
    const merged = mergePools(
      { ok: false, items: [] },
      { ok: true, items: [m("c", "in_person")] },
    )
    expect(merged.items.map((x) => x.id)).toEqual(["c"])
    expect(merged.bothFailed).toBe(false)
    expect(merged.onlineFailed).toBe(true)
    expect(merged.inPersonFailed).toBe(false)
  })

  it("flags bothFailed with empty items when both pools fail", () => {
    const merged = mergePools({ ok: false, items: [] }, { ok: false, items: [] })
    expect(merged.items).toEqual([])
    expect(merged.bothFailed).toBe(true)
  })

  it("ignores items on a failed pool (defensive: a failed outcome must not leak rows)", () => {
    const merged = mergePools(
      { ok: false, items: [m("stale", "online")] },
      { ok: true, items: [m("c", "in_person")] },
    )
    expect(merged.items.map((x) => x.id)).toEqual(["c"])
  })
})

describe("isInPersonVenue", () => {
  it("is true only for the literal in_person venue type", () => {
    expect(isInPersonVenue("in_person")).toBe(true)
    expect(isInPersonVenue("")).toBe(false)
    expect(isInPersonVenue("online")).toBe(false)
    expect(isInPersonVenue("hybrid")).toBe(false) // no such rows post-v2.0.0, but never treat as in-person
  })
})

describe("projectOnline", () => {
  it("excludes in_person and keeps everything else, including legacy empty-string rows", () => {
    const items = [m("a", ""), m("b", "online"), m("c", "in_person")]
    expect(projectOnline(items).map((x) => x.id)).toEqual(["a", "b"])
  })

  it("returns a new array (callers must not receive shared mutable state)", () => {
    const items = [m("a", "online")]
    expect(projectOnline(items)).not.toBe(items)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- app/context/meetingPools.test.ts`
Expected: FAIL — cannot resolve `./meetingPools`

- [ ] **Step 3: Write minimal implementation**

Create `app/context/meetingPools.ts`:

```typescript
/**
 * Pure meeting-pool logic — dual-fetch merge and the online-only hold-back
 * projection for in-person meeting data.
 *
 * ZERO runtime imports (not even type-only needed) — this file is
 * vitest-tested and vitest has no path-alias config (see the project testing
 * convention in CLAUDE.md and app/services/sync/syncLogic.ts).
 *
 * Venue semantics (common v2.0.0): meetings carry venueType `""` (legacy
 * online rows scraped before VenueType existed), `"online"`, or
 * `"in_person"`. The legacy `""` IS online and must stay visible wherever
 * online meetings show. `"hybrid"` is not a venue type anymore (v2.0.0 moved
 * it to a boolean `hybrid` field) — it is matched here only so a stale row
 * can never be misclassified as in-person.
 */

/** Result of one venue pool's fetch after retries. */
export interface PoolOutcome<T> {
  ok: boolean
  items: T[]
}

export interface MergedPools<T> {
  /** Successful pools concatenated, online first. */
  items: T[]
  /** True only when BOTH pools failed — the only case the UI shows an error. */
  bothFailed: boolean
  onlineFailed: boolean
  inPersonFailed: boolean
}

/**
 * Merge the two venue pools into one in-memory list.
 *
 * Failed pools contribute nothing even if they carry items — a failed
 * retry outcome may hold a stale/partial result and must not leak rows.
 */
export function mergePools<T>(online: PoolOutcome<T>, inPerson: PoolOutcome<T>): MergedPools<T> {
  const items: T[] = [
    ...(online.ok ? online.items : []),
    ...(inPerson.ok ? inPerson.items : []),
  ]
  return {
    items,
    bothFailed: !online.ok && !inPerson.ok,
    onlineFailed: !online.ok,
    inPersonFailed: !inPerson.ok,
  }
}

/** True only for the literal in-person venue type. */
export function isInPersonVenue(venueType: string): boolean {
  return venueType === "in_person"
}

/**
 * Hold-back projection: what pre-in-person UI surfaces render. Excludes
 * in_person rows and nothing else (legacy "" rows are online — see module
 * header). When the in-person UI/UX lands, consumers switch off this
 * projection deliberately, surface by surface.
 */
export function projectOnline<T extends { venueType: string }>(items: T[]): T[] {
  return items.filter((item) => !isInPersonVenue(item.venueType))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- app/context/meetingPools.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/context/meetingPools.ts app/context/meetingPools.test.ts
git commit -m "✨ feat(meetings): pure pool merge + online hold-back projection"
```

---

### Task 2: API layer `venueType` params + any-venue lookup

**Files:**
- Modify: `app/services/api/index.ts` (LiveSchedule block ~line 130; `getLiveSchedules` ~line 550; `getDailySchedules` ~line 594; `getScheduleByMeetingId` ~line 640)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3–5):
  - `export type VenueFilter = "online" | "in_person"`
  - `getLiveSchedules(venueType?: VenueFilter)` — same return type as today
  - `getDailySchedules(iso_dow: number, fellowship: string, venueType?: VenueFilter)` — same return type
  - `getScheduleByMeetingId(mid: string, venueType?: VenueFilter)` — same return type
  - `getScheduleByMeetingIdAnyVenue(mid: string): Promise<{ kind: "ok"; schedule: LiveSchedule } | GeneralApiProblem>`

- [ ] **Step 1: Add the `VenueFilter` type**

In `app/services/api/index.ts`, directly above `export interface LiveSchedule` (~line 130), add:

```typescript
/**
 * App-side venue filter for the schedules endpoints (server param
 * `venueType`). Omitted = the server serves online (its default — protects
 * deployed builds). The server also accepts a vestigial `hybrid` value
 * (pre-common-v2.0.0 leftover); the app intentionally does not model it —
 * hybrid is a boolean field on the meeting now, not a venue pool.
 */
export type VenueFilter = "online" | "in_person"
```

- [ ] **Step 2: Thread the param through the three GET methods**

`getLiveSchedules` — change the signature and params:

```typescript
  async getLiveSchedules(
    venueType?: VenueFilter,
  ): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    await this.waitForAttestation()
    // Get device timezone in IANA format (e.g., "America/New_York")
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    log.debug("Fetching live schedules from API", { tz, venueType })

    const params: Record<string, string> = { tz }
    if (venueType) params.venueType = venueType
```

(the rest of the method body is unchanged)

`getDailySchedules` — add the third parameter and param plumbing:

```typescript
  async getDailySchedules(
    iso_dow: number,
    fellowship: string,
    venueType?: VenueFilter,
  ): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    await this.waitForAttestation()
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    log.debug("Fetching daily schedules from API", { iso_dow, fellowship, tz, venueType })

    const params: Record<string, string | number> = { iso_dow, fellowship, tz }
    if (venueType) params.venueType = venueType
```

(the rest of the method body is unchanged)

`getScheduleByMeetingId` — add the second parameter; the existing call has no params object, so add one:

```typescript
  async getScheduleByMeetingId(
    mid: string,
    venueType?: VenueFilter,
  ): Promise<{ kind: "ok"; schedule: LiveSchedule } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching schedule by meeting ID", { mid, venueType })

    const response = await this.recoverySkyApi.get<{
      schedules: LiveSchedule[]
    }>(`/schedules/meeting/${mid}`, venueType ? { venueType } : undefined)
```

(the rest of the method body is unchanged)

- [ ] **Step 3: Add the any-venue lookup wrapper**

Directly below `getScheduleByMeetingId`, add:

```typescript
  /**
   * Look up a schedule by meeting ID across both venue pools.
   *
   * The server's venueType param defaults to online and cross-pool lookups
   * 404 — but deep-link callers (push notification → meeting popup) only
   * have a mid and don't know which pool it lives in. Try online first
   * (overwhelmingly the common case for anything reachable today), then
   * retry in_person on a miss. Only "not-found" / "bad-data" trigger the
   * retry: transport-level failures (timeout, cannot-connect, server) would
   * fail identically on the second call, so retrying would just double the
   * user's wait.
   */
  async getScheduleByMeetingIdAnyVenue(
    mid: string,
  ): Promise<{ kind: "ok"; schedule: LiveSchedule } | GeneralApiProblem> {
    const online = await this.getScheduleByMeetingId(mid, "online")
    if (online.kind === "ok") return online
    if (online.kind !== "not-found" && online.kind !== "bad-data") return online

    log.debug("Meeting not in online pool, retrying in_person", { mid })
    return this.getScheduleByMeetingId(mid, "in_person")
  }
```

- [ ] **Step 4: Typecheck**

Run: `npm run compile`
Expected: clean (no output beyond the script banner)

- [ ] **Step 5: Manual contract smoke (server must be running on :4000)**

Optional but cheap — verifies the param names match the live server:

```bash
KEY=$(grep -E "^(API_KEY|AUTH_KEY|DEVICE_AUTH_KEY)" ../api/.env | head -1 | cut -d= -f2)
curl -s -H "X-API-Key: $KEY" "http://localhost:4000/schedules/live?tz=America/Chicago&venueType=in_person" | head -c 200
```

Expected: JSON with `"count"` > 0 and schedules whose meetings carry `venueType: "in_person"`.

- [ ] **Step 6: Commit**

```bash
git add app/services/api/index.ts
git commit -m "✨ feat(api): venueType param on schedule endpoints + any-venue mid lookup"
```

---

### Task 3: MeetingContext dual fetch + hold-back

**Files:**
- Modify: `app/context/MeetingContext.tsx` (types ~lines 111–142, `refreshLiveMeetings` effect ~lines 224–295, context value ~lines 301–317)

**Interfaces:**
- Consumes: `mergePools`, `projectOnline`, `PoolOutcome` from `./meetingPools` (Task 1); `api.getLiveSchedules(venueType)` (Task 2).
- Produces: `MeetingContextType` gains `allLiveMeetings: MeetingWithTrex[]` (merged pool). `liveMeetings` keeps its name and type but becomes the online-only projection — existing consumers (`LiveScreen`, `MainNavigator`) are untouched.

- [ ] **Step 1: Add imports and extend the context type**

In `app/context/MeetingContext.tsx` add to the imports:

```typescript
import { mergePools, projectOnline, type PoolOutcome } from "./meetingPools"
```

In `MeetingContextType`, add above `liveMeetings`:

```typescript
  /**
   * Both venue pools merged (online + in_person). In-person UI reads this.
   * Populated since the in-person data-layer piece (2026-08-02 spec);
   * existing surfaces keep reading `liveMeetings` (online-only hold-back).
   */
  allLiveMeetings: MeetingWithTrex[]
```

- [ ] **Step 2: Rework `refreshLiveMeetings` to dual-fetch and merge**

Replace the body of `refreshLiveMeetings` from the `log.debug("Refreshing live meetings from API...")` line down to the final `log.info("✓ Live meetings ready", ...)` with:

```typescript
      log.debug("Refreshing live meetings from API...")
      setIsLoading(true)
      setError(null)

      // Dual-fetch: one call per venue pool, in parallel, each with its own
      // retry budget. retryWithBackoff never rejects, so Promise.all is safe.
      // (2026-08-02 in-person data-layer spec: dual-fetch & merge.)
      const [onlineOutcome, inPersonOutcome] = await Promise.all([
        retryWithBackoff(
          () => api.getLiveSchedules("online"),
          (result) => result.kind === "ok",
          "getLiveSchedules(online)",
        ),
        retryWithBackoff(
          () => api.getLiveSchedules("in_person"),
          (result) => result.kind === "ok",
          "getLiveSchedules(in_person)",
        ),
      ])

      // Convert API schedules to MeetingWithTrex (same mapping both pools).
      const toMeetings = (schedules: LiveSchedule[]): MeetingWithTrex[] =>
        schedules.map((s) => ({
          ...s.meeting,
          // Prefer schedule-level password over meeting-level (API provides it per-schedule)
          password: s.password || s.meeting.password || "",
          passwordEnc: s.passwordEnc || s.meeting.passwordEnc || "",
          feedback: feedbackCache.get(s.meeting.id),
          sid: s.sid,
          millis: s.millis,
          duration_ms: s.duration_ms ?? 0,
          scheduleData: s.data,
        }))

      const toPool = (
        outcome: Awaited<ReturnType<typeof retryWithBackoff<Awaited<ReturnType<typeof api.getLiveSchedules>>>>>,
      ): PoolOutcome<MeetingWithTrex> => {
        if ("result" in outcome && outcome.result.kind === "ok") {
          return { ok: true, items: toMeetings(outcome.result.schedules) }
        }
        return { ok: false, items: [] }
      }

      const merged = mergePools(toPool(onlineOutcome), toPool(inPersonOutcome))

      // Only a total failure surfaces as an error — one pool failing
      // degrades gracefully to the other (spec decision 4).
      if (merged.bothFailed) {
        setError("Network error: live schedules unavailable")
        setAllLiveMeetings([])
        setIsLoading(false)
        return
      }
      if (merged.onlineFailed || merged.inPersonFailed) {
        log.warn("One venue pool failed; serving partial live data", {
          onlineFailed: merged.onlineFailed,
          inPersonFailed: merged.inPersonFailed,
        })
      }

      setAllLiveMeetings(merged.items)
      setLastRefresh(new Date())
      setIsLoading(false)

      log.info("✓ Live meetings ready", {
        total: merged.items.length,
        inPerson: merged.items.filter((m) => m.venueType === "in_person").length,
      })
```

Notes for the implementer:
- The old single-outcome handling (`"error" in outcome`, `outcome.result.kind !== "ok"`, the `schedules.length === 0` early return, and the old `newLiveMeetings` mapping) is fully replaced by the block above. An empty merged list is a valid success (no live meetings) — no special-casing needed.
- If the `Awaited<ReturnType<...>>` outcome type annotation fights tsc, type the helper against the concrete union instead:
  `{ result: Awaited<ReturnType<typeof api.getLiveSchedules>>; attempts: number } | { error: string; attempts: number }`.
- `m.venueType === "in_person"` on a `VenueType`-typed field may need `String(m.venueType) === "in_person"` — or reuse `isInPersonVenue(m.venueType)` from `./meetingPools`, which takes `string` and avoids the enum-vs-literal comparison entirely. Prefer the helper.

- [ ] **Step 3: Rename the state and derive the projection**

Replace the state declaration:

```typescript
  // Live meetings data — the merged pool (both venues). What existing UI
  // consumes is the derived online-only projection below (hold-back).
  const [allLiveMeetings, setAllLiveMeetings] = useState<MeetingWithTrex[]>([])

  // Hold-back projection: pre-in-person surfaces (LiveScreen, MainNavigator
  // badge) render online-only until the in-person UI/UX design lands. Do NOT
  // switch consumers to allLiveMeetings without that design.
  const liveMeetings = useMemo(() => projectOnline(allLiveMeetings), [allLiveMeetings])
```

Then update the two error paths and the context value:
- both-failed path already uses `setAllLiveMeetings([])` (Step 2).
- Context value gains `allLiveMeetings` and keeps `liveMeetings`:

```typescript
  const value = useMemo<MeetingContextType>(
    () => ({
      allLiveMeetings,
      liveMeetings,
      isLoading,
      lastRefresh,
      refresh,
      apiStatus,
      error,
    }),
    [allLiveMeetings, liveMeetings, isLoading, lastRefresh, refresh, apiStatus, error],
  )
```

Also update the trailing render log to `{ liveCount: liveMeetings.length, allCount: allLiveMeetings.length, isLoading }`.

- [ ] **Step 4: Typecheck and unit suite**

Run: `npm run compile && npm run test:unit`
Expected: clean compile; all vitest tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/context/MeetingContext.tsx
git commit -m "✨ feat(meetings): dual-fetch venue pools into MeetingContext with online hold-back"
```

---

### Task 4: Listings daily dual fetch + hold-back

**Files:**
- Modify: `app/screens/ListingsScreen.tsx` (state ~line 120, `fetchDailySchedules` ~lines 198–258, derived data ~lines 148–154 and 266–273)

**Interfaces:**
- Consumes: `mergePools`, `projectOnline`, `PoolOutcome` from `@/context/meetingPools` (Task 1 — note: screens import via the `@/` alias; only the *tested module itself* must stay alias-free); `api.getDailySchedules(day, fellowship, venueType)` (Task 2).
- Produces: no exported interface changes. Internal state `allMeetings` (merged) with `meetings` derived online-only.

- [ ] **Step 1: Add imports**

```typescript
import { mergePools, projectOnline, type PoolOutcome } from "@/context/meetingPools"
```

- [ ] **Step 2: Replace the `meetings` state with merged + projection**

Replace `const [meetings, setMeetings] = useState<MeetingWithTrex[]>([])` with:

```typescript
  // Merged venue pools (online + in_person) for the selected day. The list
  // the screen renders is the online-only projection below (hold-back) until
  // the in-person UI/UX design lands. (2026-08-02 in-person data-layer spec.)
  const [allMeetings, setAllMeetings] = useState<MeetingWithTrex[]>([])
  const meetings = useMemo(() => projectOnline(allMeetings), [allMeetings])
```

Every existing read of `meetings` (`availableLanguages`, `filteredMeetings`, the `isLoading && meetings.length === 0` header check) is untouched — they now read the projection.

- [ ] **Step 3: Rework `fetchDailySchedules`**

Replace the body from `setIsLoading(true)` through the `finally` block with:

```typescript
    setIsLoading(true)
    setError(null)

    try {
      // Dual-fetch: one call per venue pool (2026-08-02 in-person spec).
      const [onlineResult, inPersonResult] = await Promise.all([
        api.getDailySchedules(selectedDay, fellowship, "online"),
        api.getDailySchedules(selectedDay, fellowship, "in_person"),
      ])

      const toMeetings = (schedules: LiveSchedule[]): MeetingWithTrex[] =>
        schedules.map((s: LiveSchedule) => ({
          ...s.meeting,
          feedback: null,
          sid: s.sid,
          millis: s.millis,
          duration_ms: s.duration_ms ?? 0,
          scheduleData: s.data,
        }))

      const toPool = (
        result: Awaited<ReturnType<typeof api.getDailySchedules>>,
      ): PoolOutcome<MeetingWithTrex> =>
        result.kind === "ok"
          ? { ok: true, items: toMeetings(result.schedules) }
          : { ok: false, items: [] }

      const merged = mergePools(toPool(onlineResult), toPool(inPersonResult))

      // Only a total failure is an error; one pool failing degrades to the
      // other (spec decision 4).
      if (merged.bothFailed) {
        const kind = onlineResult.kind !== "ok" ? onlineResult.kind : inPersonResult.kind
        log.error("API getDailySchedules failed for both venue pools", { kind })
        setError(`Error: ${kind}`)
        setAllMeetings([])
        return
      }
      if (merged.onlineFailed || merged.inPersonFailed) {
        log.warn("One venue pool failed for daily schedules; serving partial data", {
          onlineFailed: merged.onlineFailed,
          inPersonFailed: merged.inPersonFailed,
        })
      }

      // Sort the merged pool once by local time (hour:minute), not UTC millis,
      // so the future in-person UI inherits correct ordering.
      const sorted = [...merged.items].sort((a, b) => {
        const aLocal = DateTime.fromMillis(a.millis).toLocal()
        const bLocal = DateTime.fromMillis(b.millis).toLocal()
        const aMinutes = aLocal.hour * 60 + aLocal.minute
        const bMinutes = bLocal.hour * 60 + bLocal.minute
        return aMinutes - bMinutes
      })

      setAllMeetings(sorted)
      log.debug("Loaded daily schedules", {
        total: sorted.length,
        day: selectedDay,
      })
    } catch (err) {
      log.error("Exception fetching daily schedules", { error: String(err) })
      setError("Failed to load schedules")
      setAllMeetings([])
    } finally {
      setIsLoading(false)
    }
```

Also update the two early-return paths above this block: the maintenance-mode gate stays as-is; the no-fellowship gate's `setMeetings([])` becomes `setAllMeetings([])`.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run compile && npm run lint:check`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add app/screens/ListingsScreen.tsx
git commit -m "✨ feat(listings): dual-fetch venue pools for daily schedules with online hold-back"
```

---

### Task 5: Deep-link lookup uses the any-venue wrapper

**Files:**
- Modify: `app/screens/LiveScreen.tsx:191` (the `pendingMeetingId` slow path)

**Interfaces:**
- Consumes: `api.getScheduleByMeetingIdAnyVenue(mid)` (Task 2). Same result shape as `getScheduleByMeetingId`, so the `.then` handler is unchanged.

- [ ] **Step 1: Switch the call**

In `app/screens/LiveScreen.tsx`, the slow-path lookup:

```typescript
    // Slow path: fetch schedule data from API (meeting may not be live).
    // CHANGED 2026-08-02: any-venue lookup — the server's venueType param
    // defaults to online and cross-pool lookups 404, but a notification mid
    // may reference an in-person meeting; the wrapper retries in_person on a
    // not-found/bad-data miss.
    api
      .getScheduleByMeetingIdAnyVenue(targetId)
```

Everything else in the effect is unchanged.

- [ ] **Step 2: Typecheck**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/screens/LiveScreen.tsx
git commit -m "✨ feat(live): deep-link meeting lookup falls back across venue pools"
```

---

### Task 6: Changelog, full gates, manual smoke

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

- [ ] **Step 1: Changelog entry**

Under `## [Unreleased]` → `### Added` (create the heading if missing):

```markdown
- In-person meeting data now loads into memory alongside online meetings: the
  live and daily schedule fetches pull both venue pools (`venueType=online` +
  `venueType=in_person`) and merge them, and deep-link meeting lookups fall
  back across pools. No visible change yet — existing screens keep showing
  online meetings only until the in-person UI ships (hold-back projection);
  this is the data foundation. One pool failing degrades gracefully to the
  other instead of blanking the list.
```

- [ ] **Step 2: Full gates**

Run: `npm run compile && npm run lint:check && npm test && npm run lint:deps`
Expected: all clean. (`npm test` = vitest suite + jest component suite.)

- [ ] **Step 3: Manual smoke against dev :4000**

With `.env` pointed at the local API (`EXPO_PUBLIC_API_URL=http://<mac-ip>:4000`, Metro restarted with `--clear`) or against prod once deployed:
1. Launch the app, open the Live tab — list renders exactly as before (no in-person rows, no blanks).
2. In logs: `✓ Live meetings ready` with `total` > `liveCount` when in-person meetings are live (`inPerson` count > 0 proves the pool is in memory).
3. Listings tab, any day — renders as before; log line shows merged `total`.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "📝 docs: changelog for in-person data layer"
```

---

## Self-Review Notes

- **Spec coverage:** §1 API layer → Task 2; §2 MeetingContext → Task 3; §3 Listings → Task 4; §4 deep-link fallback → Tasks 2+5; §5 pure extraction + tests → Task 1; error handling → Tasks 3–4; manual smoke → Task 6.
- **Hold-back verified per surface:** LiveScreen and MainNavigator read `liveMeetings` (projection, Task 3); Listings renders the derived `meetings` projection (Task 4). No other `useMeetings()` consumers exist (grep-verified 2026-08-02).
- **Type consistency:** `PoolOutcome`/`MergedPools`/`mergePools`/`projectOnline`/`isInPersonVenue` names match across Tasks 1/3/4; `VenueFilter`/`getScheduleByMeetingIdAnyVenue` match across Tasks 2/3/4/5.
- **Release path when this ships:** JS-only → OTA (`npm run update`), no `runtimeVersion` bump.
