# Meetings Filter Bar + Live "Starts In" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Fellowship + Language into one remembered filter bar above the Meetings segments, and add a Live "Starts In" selector backed by `GET /schedules/at_next`.

**Architecture:** A `MeetingFiltersContext` owned by `MeetingsScreen` holds the two values (MMKV-persisted, following Settings via the `preferences_changed` event). Every segment reads it and reports its loaded list so the bar can offer that segment's languages. Starts In is a `SegmentedPill` on Live, driven by a separate `useAtNextSchedules` hook, and ships behind `__DEV__` until the API route exists. Every decision lives in two pure, vitest-covered modules.

**Tech Stack:** React Native 0.81 / Expo 54, MobX-State-Tree + mobx-react-lite, MMKV (`@/utils/storage`), apisauce, i18next, Vitest (pure `.ts`) + jest-expo (`.tsx`).

**Spec:** `docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md`

## Global Constraints

- Work on a branch, `feat/meetings-filter-bar`, created from `root`. Other sessions share this checkout, so stage **named paths only**: never `git add -A`, never `git stash`.
- Never run `npm run lint` (it rewrites the whole repo). Lint only the files you touched: `npx eslint --fix <paths>`.
- A `*.test.ts` file runs under Vitest and must import **no runtime `@/`** (type-only imports are OK). A `*.test.tsx` file runs under jest.
- Every new i18n key goes in **all nine** locale files: `en es ar de fr pt ru th uk`. The non-English files may use English text as a placeholder, but the key must exist in each or `tsc` fails.
- Fellowship has **no "All"** option. Language has an "All" option, stored as `null`.
- MMKV keys: `meetings.fellowship` and `meetings.language`.
- Starts In options are exactly `Live · 15 · 30 · 45 · 60`, the default is `live`, the choice is not persisted, and it resets on every visit.
- API: `GET /schedules/at_next` with query params `offset`, `starts_at` (device now, truncated to the minute, ISO), `tz`, `venueType=online`. **No `fellowship` param.**
- `const startsInVisible = __DEV__` until the API ships.
- No `runtimeVersion` bump. This is all JS.
- House comment style: when you change behaviour, keep the old comment and append `CHANGED 2026-09-26: <why>`.
- Commits use gitmoji + conventional scope, e.g. `✨ feat(meetings): …`, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Cold-start hydration race.** `profileStore.fellowship` is `"AA"` until `ProfileHydrator` loads the real value from SQLite. With no MMKV value saved, the bar must show the *hydrated* fellowship, not freeze on `"AA"`. Pinned by `resolveFellowship` being derived during render, never seeded into state (Task 1 tests + Task 4 note).
2. **A saved fellowship this build no longer offers** (`EXPO_PUBLIC_FELLOWSHIPS` drops RD). The bar must fall back to Settings, then to the first active fellowship, and must never send an unknown fellowship to the API (Task 1).
3. **A remembered language that is absent from the current list.** It stays selectable and clearable, and the list shows "Show all languages" instead of a bare "no meetings" (Tasks 1, 4, 5, 6, 7).
4. **Continuous 24/7 rooms (`millis === 0`) in an at_next response.** They must not appear as "starting". `pruneStarted` drops them (Task 2 test).
5. **Switching 60 → 15 while a request is still in flight.** The stale 60-minute response must not land under 15. Guarded by the sequence ref and by clearing on offset change (Task 8).

---

### Task 1: Pure filter logic (`meetingFiltersLogic.ts`)

**Files:**
- Create: `app/utils/meetingFiltersLogic.ts`
- Test: `app/utils/meetingFiltersLogic.test.ts`

**Interfaces:**
- Produces:
  - `LANGUAGE_DISPLAY_NAMES: Readonly<Record<string, string>>`
  - `getLanguageDisplayName(code: string): string`
  - `resolveFellowship(i: { persisted: string | null; saved: string | undefined; active: readonly string[] }): string`
  - `parsePersistedLanguage(raw: string | null): string | null`
  - `type LanguageCarrier = { language?: string | null }`
  - `buildLanguageOptions(meetings: readonly LanguageCarrier[], selected: string | null): string[]`
  - `matchesLanguage(meeting: LanguageCarrier, selected: string | null): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/meetingFiltersLogic.test.ts
import { describe, expect, it } from "vitest"

import {
  buildLanguageOptions,
  getLanguageDisplayName,
  matchesLanguage,
  parsePersistedLanguage,
  resolveFellowship,
} from "./meetingFiltersLogic"

const ACTIVE = ["AA", "NA", "CMA"] as const

describe("resolveFellowship", () => {
  it("prefers the persisted bar value when it is still offered", () => {
    expect(resolveFellowship({ persisted: "NA", saved: "AA", active: ACTIVE })).toBe("NA")
  })

  it("follows the saved Settings value when nothing is persisted", () => {
    // Hydration race: this is re-evaluated each render, so a later hydrated
    // `saved` wins without anything being written.
    expect(resolveFellowship({ persisted: null, saved: "CMA", active: ACTIVE })).toBe("CMA")
  })

  it("ignores a persisted value this build no longer offers", () => {
    expect(resolveFellowship({ persisted: "RD", saved: "NA", active: ACTIVE })).toBe("NA")
  })

  it("falls back to the first active fellowship when neither is usable", () => {
    expect(resolveFellowship({ persisted: "RD", saved: "", active: ACTIVE })).toBe("AA")
    expect(resolveFellowship({ persisted: null, saved: undefined, active: ACTIVE })).toBe("AA")
  })
})

describe("parsePersistedLanguage", () => {
  it("returns null for missing or empty values (= all languages)", () => {
    expect(parsePersistedLanguage(null)).toBeNull()
    expect(parsePersistedLanguage("")).toBeNull()
  })

  it("normalizes to uppercase", () => {
    expect(parsePersistedLanguage("es")).toBe("ES")
  })

  it("rejects junk rather than filtering on it", () => {
    expect(parsePersistedLanguage("español")).toBeNull()
    expect(parsePersistedLanguage("E1")).toBeNull()
  })
})

describe("buildLanguageOptions", () => {
  it("returns sorted unique uppercase codes", () => {
    const meetings = [{ language: "es" }, { language: "EN" }, { language: "es" }, { language: null }, {}]
    expect(buildLanguageOptions(meetings, null)).toEqual(["EN", "ES"])
  })

  it("always keeps the current selection, even when absent from the list", () => {
    expect(buildLanguageOptions([{ language: "EN" }], "FR")).toEqual(["EN", "FR"])
  })

  it("returns only the selection for an empty list", () => {
    expect(buildLanguageOptions([], "ES")).toEqual(["ES"])
    expect(buildLanguageOptions([], null)).toEqual([])
  })
})

describe("matchesLanguage", () => {
  it("matches everything when no language is selected", () => {
    expect(matchesLanguage({ language: "RU" }, null)).toBe(true)
    expect(matchesLanguage({}, null)).toBe(true)
  })

  it("compares case-insensitively", () => {
    expect(matchesLanguage({ language: "es" }, "ES")).toBe(true)
  })

  it("rejects a meeting with a different or missing language", () => {
    expect(matchesLanguage({ language: "EN" }, "ES")).toBe(false)
    expect(matchesLanguage({}, "ES")).toBe(false)
  })
})

describe("getLanguageDisplayName", () => {
  it("returns the native name for a known code", () => {
    expect(getLanguageDisplayName("ES")).toBe("Español")
  })

  it("falls through to the raw code for an unknown one", () => {
    expect(getLanguageDisplayName("XX")).toBe("XX")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- app/utils/meetingFiltersLogic.test.ts`
Expected: FAIL, "Failed to resolve import ./meetingFiltersLogic"

- [ ] **Step 3: Write the implementation**

```ts
// app/utils/meetingFiltersLogic.ts
/**
 * Pure logic for the Meetings tab's shared filter bar (Fellowship + Lang).
 *
 * ADDED 2026-09-26. The two filters used to live inside each segment, with
 * three different behaviours: Live held a browse-only override, In-Person held
 * another inside useNearbySchedules, and Search wrote straight to
 * `profileStore.fellowship`, silently changing the user's Settings. They now
 * live once, above the segmented control, in MeetingFiltersContext. This module
 * holds every decision that context and the segments make, so vitest can cover
 * them.
 *
 * Deliberately free of runtime `@/` imports (CLAUDE.md "Test Runner Split").
 * Spec: docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md
 */

/**
 * ISO 639-1 codes (uppercase) → native display names.
 * MOVED 2026-09-26 verbatim from ListingsScreen.tsx so all three segments share
 * one table.
 */
export const LANGUAGE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  EN: "English",
  ES: "Español",
  FR: "Français",
  PT: "Português",
  DE: "Deutsch",
  RU: "Русский",
  AR: "العربية",
  TH: "ไทย",
  IT: "Italiano",
  JA: "日本語",
  KO: "한국어",
  ZH: "中文",
  NL: "Nederlands",
  PL: "Polski",
  SV: "Svenska",
  HE: "עברית",
  HI: "हिन्दी",
  TR: "Türkçe",
  UK: "Українська",
  FA: "فارسی",
}

/** Native name for a code; an unknown code shows as itself rather than blank. */
export function getLanguageDisplayName(code: string): string {
  return LANGUAGE_DISPLAY_NAMES[code] ?? code
}

/**
 * The fellowship the bar shows.
 *
 * Precedence: the value the user picked in the bar (persisted), then their
 * Settings fellowship, then the first fellowship this build offers.
 * Each candidate must be in `active`: a build can drop a fellowship via
 * EXPO_PUBLIC_FELLOWSHIPS, and sending a retired code to the nearby/daily
 * endpoints would return an empty list with no way to explain it.
 *
 * This is called during render, never used to seed state. `saved` is
 * `profileStore.fellowship`, which reads "AA" until ProfileHydrator loads the
 * real value from encrypted SQLite. Deriving it every render lets the
 * hydrated value flow through. Seeding state from it would freeze the
 * pre-hydration default.
 */
export function resolveFellowship(i: {
  persisted: string | null
  saved: string | undefined
  active: readonly string[]
}): string {
  if (i.persisted && i.active.includes(i.persisted)) return i.persisted
  if (i.saved && i.active.includes(i.saved)) return i.saved
  return i.active[0] ?? ""
}

/**
 * MMKV value → language code, or null for "all languages".
 * Junk that isn't a 2–3 letter code reads as "all" rather than as a filter
 * that could never match anything.
 */
export function parsePersistedLanguage(raw: string | null): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  return /^[A-Z]{2,3}$/.test(code) ? code : null
}

/** The only field these helpers read. Structural, so every meeting shape fits. */
export type LanguageCarrier = { language?: string | null }

/**
 * Options for the Lang picker: the languages present in `meetings`, plus the
 * current selection whether or not it is present. Without that, a remembered
 * "ES" on a list with no Spanish meetings would vanish from the picker. The
 * user could then neither see what is filtering the list nor clear it.
 */
export function buildLanguageOptions(
  meetings: readonly LanguageCarrier[],
  selected: string | null,
): string[] {
  const codes = new Set<string>()
  for (const m of meetings) {
    if (m.language) codes.add(m.language.toUpperCase())
  }
  if (selected) codes.add(selected)
  return Array.from(codes).sort()
}

/** `null` = all languages. Meeting data mixes case, so compare uppercased. */
export function matchesLanguage(meeting: LanguageCarrier, selected: string | null): boolean {
  if (!selected) return true
  return meeting.language?.toUpperCase() === selected
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- app/utils/meetingFiltersLogic.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add app/utils/meetingFiltersLogic.ts app/utils/meetingFiltersLogic.test.ts
git commit -m "✨ feat(meetings): pure logic for the shared fellowship/language filters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure Starts In logic (`atNextLogic.ts`)

**Files:**
- Create: `app/utils/atNextLogic.ts`
- Test: `app/utils/atNextLogic.test.ts`

**Interfaces:**
- Produces:
  - `type StartsIn = "live" | "15" | "30" | "45" | "60"` (strings, because `SegmentedPill<T extends string>`)
  - `type AtNextOffset = 15 | 30 | 45 | 60`
  - `STARTS_IN_OPTIONS: readonly StartsIn[]`
  - `offsetOf(s: StartsIn): AtNextOffset | null`
  - `buildStartsAt(now: Date): string`
  - `pruneStarted<T extends { millis: number }>(items: readonly T[], nowMs: number): T[]`
  - `sortByStart<T extends { millis: number }>(items: readonly T[]): T[]`
  - `classifyAtNextProblem(kind: string): "hide-for-session" | "show-error"`
  - `isShowEdge(prev: boolean | undefined, next: boolean): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/atNextLogic.test.ts
import { describe, expect, it } from "vitest"

import {
  buildStartsAt,
  classifyAtNextProblem,
  isShowEdge,
  offsetOf,
  pruneStarted,
  sortByStart,
  STARTS_IN_OPTIONS,
} from "./atNextLogic"

describe("STARTS_IN_OPTIONS / offsetOf", () => {
  it("offers Live then 15/30/45/60 in order", () => {
    expect(STARTS_IN_OPTIONS).toEqual(["live", "15", "30", "45", "60"])
  })

  it("maps live to no offset and the rest to numbers", () => {
    expect(offsetOf("live")).toBeNull()
    expect(offsetOf("15")).toBe(15)
    expect(offsetOf("45")).toBe(45)
  })
})

describe("buildStartsAt", () => {
  it("truncates to the minute as ISO 8601", () => {
    expect(buildStartsAt(new Date("2026-09-26T19:08:42.123Z"))).toBe("2026-09-26T19:08:00.000Z")
  })

  it("leaves an exact minute unchanged", () => {
    expect(buildStartsAt(new Date("2026-09-26T19:08:00.000Z"))).toBe("2026-09-26T19:08:00.000Z")
  })
})

describe("pruneStarted", () => {
  const now = 1_000_000
  it("drops meetings at or before now and keeps later ones", () => {
    const items = [{ millis: now - 1 }, { millis: now }, { millis: now + 1 }]
    expect(pruneStarted(items, now)).toEqual([{ millis: now + 1 }])
  })

  it("drops continuous 24/7 rooms (millis 0), which never 'start'", () => {
    expect(pruneStarted([{ millis: 0 }, { millis: now + 60_000 }], now)).toEqual([
      { millis: now + 60_000 },
    ])
  })
})

describe("sortByStart", () => {
  it("sorts ascending without mutating the input", () => {
    const input = [{ millis: 3 }, { millis: 1 }, { millis: 2 }]
    expect(sortByStart(input)).toEqual([{ millis: 1 }, { millis: 2 }, { millis: 3 }])
    expect(input[0].millis).toBe(3)
  })
})

describe("classifyAtNextProblem", () => {
  it("treats not-found as the endpoint not being deployed", () => {
    expect(classifyAtNextProblem("not-found")).toBe("hide-for-session")
  })

  it("shows an error for everything else", () => {
    for (const kind of ["timeout", "server", "unauthorized", "cannot-connect", "unknown"]) {
      expect(classifyAtNextProblem(kind)).toBe("show-error")
    }
  })
})

describe("isShowEdge", () => {
  it("fires on hidden → visible and on a visible first render", () => {
    expect(isShowEdge(false, true)).toBe(true)
    expect(isShowEdge(undefined, true)).toBe(true)
  })

  it("does not fire while staying visible or when hiding", () => {
    expect(isShowEdge(true, true)).toBe(false)
    expect(isShowEdge(true, false)).toBe(false)
    expect(isShowEdge(false, false)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- app/utils/atNextLogic.test.ts`
Expected: FAIL, "Failed to resolve import ./atNextLogic"

- [ ] **Step 3: Write the implementation**

```ts
// app/utils/atNextLogic.ts
/**
 * Pure logic for Live's "Starts In" selector (GET /schedules/at_next).
 *
 * ADDED 2026-09-26. The API owns the window math: it interprets `offset`
 * against `starts_at`. The app only builds `starts_at`, prunes meetings that
 * have begun since the last fetch, sorts, and decides what a failure means.
 * Free of runtime `@/` imports so vitest can run it (CLAUDE.md "Test Runner
 * Split"). Spec: docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md
 */

/** Selector values. Strings, because SegmentedPill is typed `T extends string`. */
export type StartsIn = "live" | "15" | "30" | "45" | "60"

/** Minutes the API accepts for `offset`. */
export type AtNextOffset = 15 | 30 | 45 | 60

/** Selector order. `live` leads because it is the default (today's list). */
export const STARTS_IN_OPTIONS: readonly StartsIn[] = ["live", "15", "30", "45", "60"]

/** `null` for `live`: that view comes from MeetingContext, not at_next. */
export function offsetOf(s: StartsIn): AtNextOffset | null {
  return s === "live" ? null : (Number(s) as AtNextOffset)
}

/**
 * `starts_at` param: device now, truncated to the minute, ISO 8601 (UTC "Z").
 * Truncating makes every request within the same minute identical, which
 * keeps them cacheable server-side.
 */
export function buildStartsAt(now: Date): string {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString()
}

/**
 * Drop entries whose start has passed (`millis <= nowMs`).
 * Runs on a 60 s tick between fetches, so a 15-minute list never shows a
 * meeting that already began. Also drops continuous rooms (`millis === 0`,
 * shown as "24h" by MeetingRow): an always-open room has no upcoming start, so
 * it doesn't belong in a "starting soon" list even if the API returns one.
 */
export function pruneStarted<T extends { millis: number }>(items: readonly T[], nowMs: number): T[] {
  return items.filter((i) => i.millis > nowMs)
}

/** Soonest first. A "starting soon" list is a countdown, not a ranking. */
export function sortByStart<T extends { millis: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.millis - b.millis)
}

/**
 * What a failed at_next fetch means for the UI.
 * `not-found` = this API build has no route yet (the `startsInVisible` flag
 * was flipped before the deploy), so hide the selector for the session and
 * show Live. Anything else is a real failure worth a retry prompt. Transport
 * retries already happened inside retryWithBackoff before this is asked.
 */
export function classifyAtNextProblem(kind: string): "hide-for-session" | "show-error" {
  return kind === "not-found" ? "hide-for-session" : "show-error"
}

/**
 * True when the Live segment has just come on screen: hidden → visible, or a
 * visible first render (`prev` undefined). Keyed on the edge, never on a store
 * value. See CLAUDE.md "The trap, hit twice".
 */
export function isShowEdge(prev: boolean | undefined, next: boolean): boolean {
  return next && prev !== true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- app/utils/atNextLogic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/utils/atNextLogic.ts app/utils/atNextLogic.test.ts
git commit -m "✨ feat(live): pure logic for the Starts In selector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: API method + shared schedule→meeting mapper

**Files:**
- Modify: `app/services/api/index.ts` (after `getLiveSchedules`, ~L940)
- Modify: `app/context/MeetingContext.tsx` (L56 `retryWithBackoff`; the map at ~L338–347)
- Modify: `app/screens/LiveScreen.tsx` (the slow-path `meetingWithTrex` literal, ~L200–209)

**Interfaces:**
- Consumes: `AtNextOffset` (Task 2). Import it **type-only**: `app/services/api/` must stay a dependency leaf.
- Produces:
  - `api.getAtNextSchedules(offset: AtNextOffset, startsAt: string): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem>`
  - `export function toMeetingWithTrex(s: LiveSchedule): MeetingWithTrex` from `@/context/MeetingContext`
  - `export async function retryWithBackoff` (now exported) from `@/context/MeetingContext`

No automated test: `api/index.ts` and `MeetingContext.tsx` import `@/`, so vitest can't load them. `npm run compile` and the existing suite are the gate, and Task 8 exercises the method.

- [ ] **Step 1: Add the API method**

In `app/services/api/index.ts`, add at the top with the other type imports:

```ts
import type { AtNextOffset } from "@/utils/atNextLogic"
```

Then add directly after `getLiveSchedules`:

```ts
  /**
   * Get online meetings starting within `offset` minutes of `startsAt`.
   *
   * ADDED 2026-09-26 for Live's "Starts In" selector. Same response shape as
   * /schedules/live, but `millis` is each meeting's upcoming start. The API
   * owns the window math. Fellowship is deliberately NOT sent: the Meetings
   * filter bar applies it on-device, so switching fellowship never refetches.
   * Callers gate on `startsInVisible` until the route is deployed; a 404 from
   * an older API build is the caller's signal to hide the selector.
   *
   * @param offset - 15 | 30 | 45 | 60 minutes
   * @param startsAt - ISO 8601 reference time (see atNextLogic.buildStartsAt)
   */
  async getAtNextSchedules(
    offset: AtNextOffset,
    startsAt: string,
  ): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    log.debug("Fetching at_next schedules from API", { offset, startsAt, tz })

    const params: Record<string, string | number> = {
      offset,
      starts_at: startsAt,
      tz,
      venueType: "online",
    }

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/at_next", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("API request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || !Array.isArray(response.data.schedules)) {
      log.warn("Invalid at_next response data format")
      return { kind: "bad-data" }
    }

    return { kind: "ok", schedules: response.data.schedules, count: response.data.count }
  }
```

- [ ] **Step 2: Export `retryWithBackoff` and extract `toMeetingWithTrex`**

In `app/context/MeetingContext.tsx`, change `async function retryWithBackoff<T>(` to `export async function retryWithBackoff<T>(`.

Add this function above `MeetingProvider` (make sure `LiveSchedule` is imported as a type from `@/services/api`; add it to the existing import if it's missing):

```ts
/**
 * API schedule entry → the row shape every Meetings surface renders.
 * EXTRACTED 2026-09-26: this literal was written out twice (here and in
 * LiveScreen's deep-link slow path), and the at_next hook needed a third copy.
 * Prefer the schedule-level password over the meeting-level one; the API
 * provides it per schedule.
 */
export function toMeetingWithTrex(s: LiveSchedule): MeetingWithTrex {
  return {
    ...s.meeting,
    password: s.password || s.meeting.password || "",
    passwordEnc: s.passwordEnc || s.meeting.passwordEnc || "",
    feedback: feedbackCache.get(s.meeting.id),
    sid: s.sid,
    millis: s.millis,
    duration_ms: s.duration_ms ?? 0,
    scheduleData: s.data,
  }
}
```

Replace the inline map in `refreshLiveMeetings` (keep its comment line above it):

```ts
      // Convert API schedules to MeetingWithTrex.
      const meetings: MeetingWithTrex[] = outcome.result.schedules.map(toMeetingWithTrex)
```

In `app/screens/LiveScreen.tsx`'s slow path, replace the `const meetingWithTrex: MeetingWithTrex = { … }` literal with:

```ts
          const meetingWithTrex = toMeetingWithTrex(s)
```

and change the import to `import { useMeetings, toMeetingWithTrex, type MeetingWithTrex } from "@/context/MeetingContext"`. If `feedbackCache` is now unused in LiveScreen, drop it from the `@/db` import. `liveEvents` stays.

- [ ] **Step 3: Verify**

Run: `npm run compile && npx eslint --fix app/services/api/index.ts app/context/MeetingContext.tsx app/screens/LiveScreen.tsx && npm run lint:deps`
Expected: no type errors, no lint errors, no new dependency-cruiser violations.

- [ ] **Step 4: Commit**

```bash
git add app/services/api/index.ts app/context/MeetingContext.tsx app/screens/LiveScreen.tsx
git commit -m "✨ feat(api): getAtNextSchedules + shared schedule→meeting mapper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Filter context, filter bar, language empty state, mount in MeetingsScreen

**Files:**
- Create: `app/context/MeetingFiltersContext.tsx`
- Create: `app/components/MeetingFilterBar.tsx`
- Create: `app/components/LanguageEmptyState.tsx`
- Test: `app/components/MeetingFilterBar.test.tsx`
- Test: `app/components/LanguageEmptyState.test.tsx`
- Modify: `app/screens/MeetingsScreen.tsx`
- Modify: `app/i18n/{en,es,ar,de,fr,pt,ru,th,uk}.ts` (the `meetingsScreen` block)

**Interfaces:**
- Consumes: `resolveFellowship`, `parsePersistedLanguage`, `buildLanguageOptions`, `getLanguageDisplayName`, `LanguageCarrier` (Task 1).
- Produces:
  - `MeetingFiltersProvider: FC<PropsWithChildren>`
  - `useMeetingFilters(): MeetingFiltersValue` where

    ```ts
    interface MeetingFiltersValue {
      fellowship: string
      language: string | null
      setFellowship: (value: string) => void
      setLanguage: (value: string | null) => void
      reportMeetings: (segment: MeetingsSegment, meetings: readonly LanguageCarrier[]) => void
      meetingsBySegment: Partial<Record<MeetingsSegment, readonly LanguageCarrier[]>>
    }
    ```
  - `MeetingFilterBar` with props `{ fellowship: string; fellowshipOptions: readonly string[]; language: string | null; languageOptions: readonly string[]; onSelectFellowship: (v: string) => void; onSelectLanguage: (v: string | null) => void }`
  - `LanguageEmptyState` with props `{ language: string; onShowAll: () => void }`
  - i18n keys: `meetingsScreen:filterFellowship`, `filterLang`, `filterLanguageA11y`, `allLanguages`, `selectLanguage`, `noMeetingsInLanguage` (`{{language}}`), `showAllLanguages`

- [ ] **Step 1: Add i18n keys**

In `app/i18n/en.ts`, append inside `meetingsScreen: { … }` after `listingsSegment`:

```ts
    // Shared filter bar above the segments (ADDED 2026-09-26). "Lang" rather
    // than "Language" for the same half-width reason as Search's old cell.
    filterFellowship: "Fellowship",
    filterLang: "Lang",
    filterLanguageA11y: "Language",
    allLanguages: "All",
    selectLanguage: "Select Language",
    noMeetingsInLanguage: "No {{language}} meetings here",
    showAllLanguages: "Show all languages",
```

Add the identical block (English text) to the `meetingsScreen` block of each of `es.ts ar.ts de.ts fr.ts pt.ts ru.ts th.ts uk.ts`.

- [ ] **Step 2: Write the failing component tests**

```tsx
// app/components/MeetingFilterBar.test.tsx
import { fireEvent, render, screen } from "@testing-library/react-native"

import { MeetingFilterBar } from "./MeetingFilterBar"

// Resolve against the real `en` catalogue so a11y labels are asserted as a
// screen reader says them. Same pattern as MapListToggle.test.tsx.
jest.mock("react-i18next", () => {
  const en = require("@/i18n/en").default
  const resolve = (key: string, params?: Record<string, string | number>) => {
    const [ns, path] = key.split(":")
    const value = (path ?? "")
      .split(".")
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], en[ns])
    if (typeof value !== "string") return key
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params?.[name] ?? `{{${name}}}`))
  }
  return { useTranslation: () => ({ t: resolve }) }
})

const baseProps = {
  fellowship: "NA",
  fellowshipOptions: ["AA", "NA", "CMA"],
  language: null as string | null,
  languageOptions: ["EN", "ES"],
  onSelectFellowship: jest.fn(),
  onSelectLanguage: jest.fn(),
}

describe("MeetingFilterBar", () => {
  beforeEach(() => jest.clearAllMocks())

  it("announces both current values", () => {
    render(<MeetingFilterBar {...baseProps} language="ES" />)
    expect(screen.getByLabelText("Fellowship, NA")).toBeTruthy()
    expect(screen.getByLabelText("Language, Español")).toBeTruthy()
  })

  it("announces 'All' when no language is selected", () => {
    render(<MeetingFilterBar {...baseProps} />)
    expect(screen.getByLabelText("Language, All")).toBeTruthy()
  })

  it("offers no 'All' fellowship option", () => {
    render(<MeetingFilterBar {...baseProps} />)
    fireEvent.press(screen.getByTestId("filter-bar-fellowship"))
    expect(screen.queryByTestId("fellowship-option-all")).toBeNull()
    expect(screen.getByTestId("fellowship-option-CMA")).toBeTruthy()
  })

  it("reports a fellowship pick", () => {
    render(<MeetingFilterBar {...baseProps} />)
    fireEvent.press(screen.getByTestId("filter-bar-fellowship"))
    fireEvent.press(screen.getByTestId("fellowship-option-CMA"))
    expect(baseProps.onSelectFellowship).toHaveBeenCalledWith("CMA")
  })

  it("reports a language pick and the 'All' pick as null", () => {
    render(<MeetingFilterBar {...baseProps} language="EN" />)
    fireEvent.press(screen.getByTestId("filter-bar-language"))
    fireEvent.press(screen.getByTestId("language-option-ES"))
    expect(baseProps.onSelectLanguage).toHaveBeenLastCalledWith("ES")

    fireEvent.press(screen.getByTestId("filter-bar-language"))
    fireEvent.press(screen.getByTestId("language-option-all"))
    expect(baseProps.onSelectLanguage).toHaveBeenLastCalledWith(null)
  })

  it("marks the selected option for screen readers", () => {
    render(<MeetingFilterBar {...baseProps} />)
    fireEvent.press(screen.getByTestId("filter-bar-fellowship"))
    expect(screen.getByTestId("fellowship-option-NA").props.accessibilityState?.selected).toBe(true)
    expect(screen.getByTestId("fellowship-option-AA").props.accessibilityState?.selected).toBe(false)
  })
})
```

```tsx
// app/components/LanguageEmptyState.test.tsx
import { fireEvent, render, screen } from "@testing-library/react-native"

import { LanguageEmptyState } from "./LanguageEmptyState"

jest.mock("react-i18next", () => {
  const en = require("@/i18n/en").default
  const resolve = (key: string, params?: Record<string, string | number>) => {
    const [ns, path] = key.split(":")
    const value = (path ?? "")
      .split(".")
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], en[ns])
    if (typeof value !== "string") return key
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params?.[name] ?? `{{${name}}}`))
  }
  return { useTranslation: () => ({ t: resolve }) }
})

describe("LanguageEmptyState", () => {
  it("names the language by its native name and clears on tap", () => {
    const onShowAll = jest.fn()
    render(<LanguageEmptyState language="ES" onShowAll={onShowAll} />)
    expect(screen.getByText("No Español meetings here")).toBeTruthy()
    fireEvent.press(screen.getByRole("button", { name: "Show all languages" }))
    expect(onShowAll).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm run test:component -- app/components/MeetingFilterBar.test.tsx app/components/LanguageEmptyState.test.tsx`
Expected: FAIL, "Cannot find module './MeetingFilterBar'" / "'./LanguageEmptyState'"

- [ ] **Step 4: Write `MeetingFilterBar`**

```tsx
// app/components/MeetingFilterBar.tsx
/**
 * MeetingFilterBar: the Fellowship | Lang bar above the Meetings segments.
 *
 * ADDED 2026-09-26. Fellowship and Language apply to all three segments, so
 * they live here once instead of inside each segment's own filter grid.
 * Presentational only: values and options arrive as props, picks leave as
 * callbacks, and nothing here reads a store or context. That lets the jest
 * test mount it bare (the PermissionsSection pattern). The only local state
 * is which modal is open.
 *
 * Fellowship has no "All": In-Person and Search send it as a server fetch
 * param, and "All" would mean an unfiltered fetch of every fellowship.
 * Language does, stored as `null`.
 *
 * Cell + modal chrome copied from InPersonListHeader / InPersonScreen, kept as
 * a local copy for the same reason those files keep theirs.
 */
import { FC, useState } from "react"
import {
  Modal,
  Pressable,
  ScrollView,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { getLanguageDisplayName } from "@/utils/meetingFiltersLogic"

export interface MeetingFilterBarProps {
  fellowship: string
  fellowshipOptions: readonly string[]
  /** `null` = all languages */
  language: string | null
  languageOptions: readonly string[]
  onSelectFellowship: (value: string) => void
  onSelectLanguage: (value: string | null) => void
}

export const MeetingFilterBar: FC<MeetingFilterBarProps> = ({
  fellowship,
  fellowshipOptions,
  language,
  languageOptions,
  onSelectFellowship,
  onSelectLanguage,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const [open, setOpen] = useState<"fellowship" | "language" | null>(null)
  const close = () => setOpen(null)

  const languageLabel = language
    ? getLanguageDisplayName(language)
    : t("meetingsScreen:allLanguages")

  const renderOption = (
    testID: string,
    label: string,
    isSelected: boolean,
    onPress: () => void,
  ) => (
    <TouchableOpacity
      key={testID}
      testID={testID}
      style={[themed($modalOption), isSelected && themed($modalOptionSelected)]}
      onPress={() => {
        onPress()
        close()
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={label}
    >
      <Text style={[themed($modalOptionText), isSelected && themed($modalOptionTextSelected)]}>
        {label}
      </Text>
      {isSelected && <Ionicons name="checkmark" size={18} color={theme.colors.tint} />}
    </TouchableOpacity>
  )

  return (
    <View style={themed($row)}>
      <TouchableOpacity
        testID="filter-bar-fellowship"
        style={themed($cell)}
        onPress={() => setOpen("fellowship")}
        accessibilityRole="button"
        accessibilityLabel={`${t("meetingsScreen:filterFellowship")}, ${fellowship}`}
      >
        <Text style={themed($cellLabel)}>{t("meetingsScreen:filterFellowship")}</Text>
        <View style={$cellValueRow}>
          <Text style={themed($cellValue)} numberOfLines={1}>
            {fellowship}
          </Text>
          <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        testID="filter-bar-language"
        style={themed($cell)}
        onPress={() => setOpen("language")}
        accessibilityRole="button"
        accessibilityLabel={`${t("meetingsScreen:filterLanguageA11y")}, ${languageLabel}`}
      >
        <Text style={themed($cellLabel)}>{t("meetingsScreen:filterLang")}</Text>
        <View style={$cellValueRow}>
          <Text style={themed($cellValue)} numberOfLines={1}>
            {languageLabel}
          </Text>
          <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
        </View>
      </TouchableOpacity>

      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={themed($modalOverlay)} onPress={close}>
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>
              {open === "fellowship"
                ? t("settingsScreen:selectFellowship")
                : t("meetingsScreen:selectLanguage")}
            </Text>
            <ScrollView bounces={false}>
              {open === "fellowship" &&
                fellowshipOptions.map((f) =>
                  renderOption(`fellowship-option-${f}`, f, f === fellowship, () =>
                    onSelectFellowship(f),
                  ),
                )}
              {open === "language" && (
                <>
                  {renderOption(
                    "language-option-all",
                    t("meetingsScreen:allLanguages"),
                    language === null,
                    () => onSelectLanguage(null),
                  )}
                  {languageOptions.map((code) =>
                    renderOption(
                      `language-option-${code}`,
                      getLanguageDisplayName(code),
                      code === language,
                      () => onSelectLanguage(code),
                    ),
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "stretch",
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
  gap: spacing.sm,
})
const $cell: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderRadius: 8,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
})
const $cellLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})
const $cellValueRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  flexShrink: 1,
}
const $cellValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.tint,
  flexShrink: 1,
})
const $modalOverlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.5)",
  justifyContent: "center",
  alignItems: "center",
})
const $modalContent: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 12,
  padding: spacing.md,
  minWidth: 200,
  maxWidth: "80%",
  maxHeight: "70%",
})
const $modalTitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 18,
  fontWeight: "700",
  color: colors.text,
  marginBottom: spacing.md,
  textAlign: "center",
})
const $modalOption: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.sm,
  borderRadius: 8,
})
const $modalOptionSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
})
const $modalOptionText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})
const $modalOptionTextSelected: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontWeight: "600",
})
```

- [ ] **Step 5: Write `LanguageEmptyState`**

```tsx
// app/components/LanguageEmptyState.tsx
/**
 * Empty state for "the list has meetings, but none in the selected language".
 *
 * ADDED 2026-09-26. The language filter is remembered across restarts and
 * shared by all three segments, so it is routinely stale: "ES" chosen on Live
 * yesterday, applied to a nearby list with no Spanish meetings today. A bare
 * "No meetings" would blame the wrong thing. This names the filter and offers
 * the one tap that clears it. Shared by Live, In-Person and Search.
 */
import { FC } from "react"
import { TextStyle, TouchableOpacity, View, ViewStyle } from "react-native"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { getLanguageDisplayName } from "@/utils/meetingFiltersLogic"

export interface LanguageEmptyStateProps {
  language: string
  onShowAll: () => void
}

export const LanguageEmptyState: FC<LanguageEmptyStateProps> = ({ language, onShowAll }) => {
  const { t } = useTranslation()
  const { themed } = useAppTheme()

  return (
    <View style={themed($container)}>
      <Text style={themed($message)}>
        {t("meetingsScreen:noMeetingsInLanguage", { language: getLanguageDisplayName(language) })}
      </Text>
      <TouchableOpacity
        style={themed($button)}
        onPress={onShowAll}
        accessibilityRole="button"
        accessibilityLabel={t("meetingsScreen:showAllLanguages")}
      >
        <Text style={themed($buttonText)}>{t("meetingsScreen:showAllLanguages")}</Text>
      </TouchableOpacity>
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  paddingVertical: spacing.xl,
  paddingHorizontal: spacing.lg,
  gap: spacing.md,
})
const $message: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.textDim,
  textAlign: "center",
})
const $button: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: colors.tint,
})
const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  fontWeight: "600",
  color: colors.tint,
})
```

- [ ] **Step 6: Run the component tests**

Run: `npm run test:component -- app/components/MeetingFilterBar.test.tsx app/components/LanguageEmptyState.test.tsx`
Expected: PASS

- [ ] **Step 7: Write `MeetingFiltersContext`**

```tsx
// app/context/MeetingFiltersContext.tsx
/**
 * MeetingFiltersContext: the Meetings tab's shared Fellowship + Language.
 *
 * ADDED 2026-09-26. Owned by MeetingsScreen and read by all three segments.
 * Both values are a *browse* selection: remembered in MMKV, never written back
 * to `profileStore.fellowship`. (Search used to write it, which silently
 * changed the user's Settings.)
 *
 * Fellowship storage holds only an explicit pick. `null` means "follow
 * Settings", and the shown value is derived every render by resolveFellowship.
 * That is what survives the cold-start race: `profileStore.fellowship` reads
 * "AA" until ProfileHydrator loads the real value, and deriving it lets the
 * hydrated value through, where seeding state would have frozen "AA".
 *
 * Follows Settings through liveEvents `preferences_changed` (reason
 * "fellowship"), emitted only by ProfileStore.setFellowship(), i.e. a real
 * user change in Settings or Onboarding. It must NOT become a MobX reaction on
 * profileStore.fellowship: hydration assigns that field directly on every cold
 * start, so a reaction would wipe the remembered pick at every launch.
 *
 * Spec: docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md
 */
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { observer } from "mobx-react-lite"

import { liveEvents } from "@/db"
import { useProfileStore } from "@/models"
import type { MeetingsSegment } from "@/navigators/navigationTypes"
import { ACTIVE_FELLOWSHIPS } from "@/utils/fellowships"
import {
  parsePersistedLanguage,
  resolveFellowship,
  type LanguageCarrier,
} from "@/utils/meetingFiltersLogic"
import { loadString, remove, saveString } from "@/utils/storage"

const FELLOWSHIP_KEY = "meetings.fellowship"
const LANGUAGE_KEY = "meetings.language"

export interface MeetingFiltersValue {
  /** Always a member of ACTIVE_FELLOWSHIPS. */
  fellowship: string
  /** `null` = all languages. */
  language: string | null
  setFellowship: (value: string) => void
  setLanguage: (value: string | null) => void
  /**
   * Each segment reports its loaded list (after fellowship, before the
   * language filter) so the bar can offer that segment's languages without
   * fetching anything itself.
   */
  reportMeetings: (segment: MeetingsSegment, meetings: readonly LanguageCarrier[]) => void
  meetingsBySegment: Partial<Record<MeetingsSegment, readonly LanguageCarrier[]>>
}

const MeetingFiltersContext = createContext<MeetingFiltersValue | null>(null)

export const MeetingFiltersProvider: FC<PropsWithChildren> = observer(
  function MeetingFiltersProvider({ children }) {
    const profileStore = useProfileStore()
    const [persistedFellowship, setPersistedFellowship] = useState<string | null>(() =>
      loadString(FELLOWSHIP_KEY),
    )
    const [language, setLanguageState] = useState<string | null>(() =>
      parsePersistedLanguage(loadString(LANGUAGE_KEY)),
    )
    const [meetingsBySegment, setMeetingsBySegment] = useState<
      Partial<Record<MeetingsSegment, readonly LanguageCarrier[]>>
    >({})

    // Read during render so this observer re-renders when hydration lands.
    const fellowship = resolveFellowship({
      persisted: persistedFellowship,
      saved: profileStore.fellowship,
      active: ACTIVE_FELLOWSHIPS,
    })

    useEffect(() => {
      const unsubscribe = liveEvents.subscribe((event) => {
        if (event.type === "preferences_changed" && event.reason === "fellowship") {
          // Drop the bar's own pick so it follows the new Settings value.
          setPersistedFellowship(null)
          remove(FELLOWSHIP_KEY)
        }
      })
      return () => {
        unsubscribe()
      }
    }, [])

    const setFellowship = useCallback((value: string) => {
      setPersistedFellowship(value)
      saveString(FELLOWSHIP_KEY, value)
    }, [])

    const setLanguage = useCallback((value: string | null) => {
      const code = value ? value.toUpperCase() : null
      setLanguageState(code)
      if (code) saveString(LANGUAGE_KEY, code)
      else remove(LANGUAGE_KEY)
    }, [])

    // Identity check keeps a re-report of the same array from re-rendering
    // every consumer.
    const reportMeetings = useCallback(
      (segment: MeetingsSegment, meetings: readonly LanguageCarrier[]) => {
        setMeetingsBySegment((prev) =>
          prev[segment] === meetings ? prev : { ...prev, [segment]: meetings },
        )
      },
      [],
    )

    const value = useMemo<MeetingFiltersValue>(
      () => ({
        fellowship,
        language,
        setFellowship,
        setLanguage,
        reportMeetings,
        meetingsBySegment,
      }),
      [fellowship, language, setFellowship, setLanguage, reportMeetings, meetingsBySegment],
    )

    return <MeetingFiltersContext.Provider value={value}>{children}</MeetingFiltersContext.Provider>
  },
)

export function useMeetingFilters(): MeetingFiltersValue {
  const ctx = useContext(MeetingFiltersContext)
  if (!ctx) throw new Error("useMeetingFilters must be used inside MeetingFiltersProvider")
  return ctx
}
```

- [ ] **Step 8: Mount the provider and bar in `MeetingsScreen`**

In `app/screens/MeetingsScreen.tsx`:

1. Add imports:

```ts
import { MeetingFilterBar } from "@/components/MeetingFilterBar"
import { MeetingFiltersProvider, useMeetingFilters } from "@/context/MeetingFiltersContext"
import { ACTIVE_FELLOWSHIPS } from "@/utils/fellowships"
import { buildLanguageOptions } from "@/utils/meetingFiltersLogic"
```

2. Add this component above `MeetingsScreen`:

```tsx
/**
 * The filter bar bound to MeetingFiltersContext. ADDED 2026-09-26.
 * Language options come from the ACTIVE segment's loaded list, so the picker
 * offers what the user is looking at, not the union of three tabs.
 */
const ConnectedFilterBar: FC<{ activeSegment: MeetingsSegment }> = function ConnectedFilterBar({
  activeSegment,
}) {
  const { fellowship, language, setFellowship, setLanguage, meetingsBySegment } =
    useMeetingFilters()
  const languageOptions = buildLanguageOptions(meetingsBySegment[activeSegment] ?? [], language)

  return (
    <MeetingFilterBar
      fellowship={fellowship}
      fellowshipOptions={ACTIVE_FELLOWSHIPS}
      language={language}
      languageOptions={languageOptions}
      onSelectFellowship={(value) => {
        setFellowship(value)
        trackEvent("meetings_fellowship_changed", { fellowship: value })
      }}
      onSelectLanguage={(value) => {
        setLanguage(value)
        trackEvent("meetings_language_changed", { language: value ?? "all" })
      }}
    />
  )
}
```

3. Wrap the returned tree and render the bar **above** the segmented control:

```tsx
  return (
    <MeetingFiltersProvider>
      <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($container)}>
        {/* Shared filters (ADDED 2026-09-26): above the segments because they
            apply to all three. See MeetingFiltersContext. */}
        <View style={themed($header)}>
          <ConnectedFilterBar activeSegment={activeSegment} />
          <SegmentedControl
            segments={SEGMENTS}
            selectedIndex={selectedIndex}
            onChange={handleSegmentChange}
          />
        </View>
        {/* …the three content views, unchanged… */}
      </Screen>
    </MeetingFiltersProvider>
  )
```

- [ ] **Step 9: Verify**

Run: `npm run compile && npx eslint --fix app/context/MeetingFiltersContext.tsx app/components/MeetingFilterBar.tsx app/components/LanguageEmptyState.tsx app/components/MeetingFilterBar.test.tsx app/components/LanguageEmptyState.test.tsx app/screens/MeetingsScreen.tsx app/i18n/*.ts && npm test`
Expected: all green. (The segments still show their own pickers until Tasks 5–7; that duplication is expected at this point.)

- [ ] **Step 10: Commit**

```bash
git add app/context/MeetingFiltersContext.tsx app/components/MeetingFilterBar.tsx app/components/LanguageEmptyState.tsx app/components/MeetingFilterBar.test.tsx app/components/LanguageEmptyState.test.tsx app/screens/MeetingsScreen.tsx app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts
git commit -m "✨ feat(meetings): shared fellowship/language filter bar above the segments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Live reads the shared filters

**Files:**
- Modify: `app/screens/LiveScreen.tsx`

**Interfaces:**
- Consumes: `useMeetingFilters()` (Task 4), `matchesLanguage` (Task 1), `LanguageEmptyState` (Task 4).

- [ ] **Step 1: Remove the segment's own fellowship picker**

In `LiveScreen.tsx`, delete:
- the `SELECTABLE_FELLOWSHIPS` const and its doc comment, plus the `ACTIVE_FELLOWSHIPS` import
- the `filterFellowship` / `fellowshipModalVisible` state (~L84–86)
- the `{/* Fellowship Selector - single line */}` `TouchableOpacity` and the whole `{/* Fellowship Selector Modal */}` `<Modal>` (~L294–354)
- the now-unused styles (`$selectorButton`, `$selectorLabel`, `$selectorValueRow`, `$selectorValue`, and every `$modal*`) and unused imports (`TouchableOpacity`, `Modal`, `Pressable`, plus `Ionicons` if nothing else uses it). Let `npm run compile` + eslint confirm.

Change the `preferences_changed` handler so it only refreshes (the context now owns the reset):

```ts
  // Subscribe to live events — reset local filter when Settings preference changes
  // CHANGED 2026-09-26: the fellowship reset moved to MeetingFiltersContext,
  // which owns the shared filter for all three segments. This keeps only the
  // refresh.
  useEffect(() => {
    const unsubscribe = liveEvents.subscribe((event) => {
      if (event.type === "preferences_changed" || event.type === "refresh_requested") {
        refresh()
      }
    })
    return unsubscribe
  }, [refresh])
```

- [ ] **Step 2: Filter by the shared values and report the list**

Replace the `filteredMeetings` memo with:

```ts
  const { fellowship, language, setLanguage, reportMeetings } = useMeetingFilters()

  // Filter meetings by local fellowship filter (not the saved preference)
  // CHANGED 2026-09-26: fellowship and language come from the shared Meetings
  // filter bar (MeetingFiltersContext). Two stages so the bar's language
  // options reflect this fellowship's meetings, not every fellowship's.
  const fellowshipMeetings = useMemo(
    () => (fellowship ? liveMeetings.filter((m) => m.fellowship === fellowship) : liveMeetings),
    [liveMeetings, fellowship],
  )
  const filteredMeetings = useMemo(
    () => fellowshipMeetings.filter((m) => matchesLanguage(m, language)),
    [fellowshipMeetings, language],
  )

  useEffect(() => {
    reportMeetings("live", fellowshipMeetings)
  }, [reportMeetings, fellowshipMeetings])
```

Imports: `import { useMeetingFilters } from "@/context/MeetingFiltersContext"`, `import { LanguageEmptyState } from "@/components/LanguageEmptyState"`, `import { matchesLanguage } from "@/utils/meetingFiltersLogic"`.

Update the mount logger's `fellowship: profileStore.fellowship || "all"` to `fellowship: fellowship || "all"`. If `profileStore` is then unused, remove `useProfileStore`.

- [ ] **Step 3: Language-aware empty state**

```tsx
  const ListEmptyComponent = useCallback(
    () =>
      // ADDED 2026-09-26: the list has meetings, just none in the selected
      // language. Say that and offer the clear.
      language && fellowshipMeetings.length > 0 ? (
        <LanguageEmptyState language={language} onShowAll={() => setLanguage(null)} />
      ) : (
        <View style={themed($emptyContainer)}>
          <Text preset="subheading" tx="liveScreen:noMeetings" style={themed($emptyText)} />
        </View>
      ),
    [themed, language, fellowshipMeetings.length, setLanguage],
  )
```

- [ ] **Step 4: Verify**

Run: `npm run compile && npx eslint --fix app/screens/LiveScreen.tsx && npm test`
Expected: green. Manual (simulator, `npm run ios`): Live has no Fellowship row. Changing Fellowship or Lang in the bar filters Live, and a language with no matches shows "Show all languages".

- [ ] **Step 5: Commit**

```bash
git add app/screens/LiveScreen.tsx
git commit -m "♻️ refactor(live): read fellowship and language from the shared filter bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: In-Person reads the shared filters

**Files:**
- Modify: `app/hooks/useNearbySchedules.ts` (~L205–215 result type, ~L230–315 signature/override)
- Modify: `app/components/InPersonListHeader.tsx` (props + the 2×2 grid, ~L40, ~L79, ~L117–127, ~L230–300)
- Modify: `app/components/InPersonListHeader.test.tsx` (baseProps)
- Modify: `app/screens/InPersonScreen.tsx`

**Interfaces:**
- Consumes: `useMeetingFilters()`, `matchesLanguage`, `LanguageEmptyState`.
- Changes: `useNearbySchedules(active: boolean, fellowship: string)`. The result drops `fellowship` and `setFellowship`. `InPersonListHeaderProps` drops `fellowshipLabel` and `onOpenFellowship`.

- [ ] **Step 1: Update the header test first (it should fail to compile)**

In `app/components/InPersonListHeader.test.tsx`, remove `fellowshipLabel: "AA",` and `onOpenFellowship: jest.fn(),` from `baseProps`, and add:

```tsx
describe("InPersonListHeader filters", () => {
  // CHANGED 2026-09-26: Fellowship moved to the shared Meetings filter bar.
  it("no longer renders its own fellowship cell", () => {
    render(<InPersonListHeader {...baseProps} />)
    expect(screen.queryByLabelText(/^Fellowship,/)).toBeNull()
  })
})
```

Run: `npm run test:component -- app/components/InPersonListHeader.test.tsx`
Expected: FAIL (the new test finds "Fellowship, …", and/or a type error about missing props).

- [ ] **Step 2: Remove the fellowship cell from `InPersonListHeader`**

Delete `fellowshipLabel` and `onOpenFellowship` from the props interface and destructuring, and delete the Fellowship `TouchableOpacity`. Lay the remaining three cells out as **one row**: Radius / Day / Time. Their values are short by construction ("25 mi", "Mon", one-word buckets). Keep the grid comment and append:

```
          CHANGED 2026-09-26: Fellowship left this grid for the shared filter
          bar above the segments (MeetingFilterBar). The remaining three cells
          fit one row, which gives the list back a row of height.
```

Run: `npm run test:component -- app/components/InPersonListHeader.test.tsx`
Expected: PASS

- [ ] **Step 3: Make fellowship an input to `useNearbySchedules`**

- Signature: `export function useNearbySchedules(active: boolean, fellowship: string): UseNearbySchedulesResult`. Add `@param fellowship` to the doc: "The Meetings filter bar's fellowship (MeetingFiltersContext). A fetch param for /schedules/nearby. Changing it refetches."
- Delete: `const savedFellowship = profileStore.fellowship`, the `fellowshipOverride` state and its doc comment, the `setFellowshipOverride(null)` reset effect, and `const fellowship = fellowshipOverride ?? savedFellowship`. Leave this note where the override lived:

```ts
  // REMOVED 2026-09-26: the local fellowship override (and its reset on a
  // Settings change) moved to MeetingFiltersContext, shared by all three
  // Meetings segments. `fellowship` is now a parameter.
```

- Remove `fellowship` and `setFellowship` from `UseNearbySchedulesResult` and from the returned object. Fix the "Read both observables during render" comment: only `maintenanceMode` is read from a store now. If `profileStore` becomes unused in the hook, remove it.

- [ ] **Step 4: Wire `InPersonScreen`**

- `const { fellowship, language, setLanguage, reportMeetings } = useMeetingFilters()`, and pass `fellowship` to `useNearbySchedules(active, fellowship)`. Remove `fellowship, setFellowship` from the hook destructuring.
- Delete `FellowshipSelectorModal` (component + props interface, ~L245–300), `fellowshipModalVisible`, `handleFellowshipSelect`, `handleOpenFellowshipModal`, `fellowshipLabel`, the `<FellowshipSelectorModal …/>` render, and `fellowshipLabel` / `onOpenFellowship` on both `InPersonListHeader` usages. Remove the `ACTIVE_FELLOWSHIPS` import if unused.
- The `if (!fellowship)` empty-state branch (~L1061) used to open the fellowship modal. Make it a plain `View` with the same text, and append `// CHANGED 2026-09-26: no longer tappable — Fellowship lives in the shared bar above the segments.`
- In the `visibleMeetings` memo, change `meetings.filter((m) => matchesShortTime(m.millis, shortTime))` to:

```ts
        : meetings.filter(
            (m) => matchesShortTime(m.millis, shortTime) && matchesLanguage(m, language),
          )
```

  Add `language` to its deps and a comment line: `// CHANGED 2026-09-26: + shared language filter, client-side like shortTime.`
- Report and detect a language-emptied list:

```ts
  useEffect(() => {
    reportMeetings("inperson", meetings)
  }, [reportMeetings, meetings])

  // ADDED 2026-09-26: true when the time bucket leaves meetings but the
  // language filter removes them all, so the empty state can blame language.
  const languageEmptied = useMemo(
    () =>
      !!language &&
      visibleMeetings.length === 0 &&
      meetings.some((m) => matchesShortTime(m.millis, shortTime)),
    [language, visibleMeetings.length, meetings, shortTime],
  )
```

- In `ListEmptyComponent`, after the location/permission and error branches and before the `emptyFallback` copy, add:

```tsx
    if (languageEmptied && language) {
      return <LanguageEmptyState language={language} onShowAll={() => setLanguage(null)} />
    }
```

  and add `languageEmptied, language, setLanguage` to its deps.
- Change `trackEvent("inperson_fellowship_changed", …)`: it goes away with `handleFellowshipSelect`.

- [ ] **Step 5: Verify**

Run: `npm run compile && npx eslint --fix app/hooks/useNearbySchedules.ts app/components/InPersonListHeader.tsx app/components/InPersonListHeader.test.tsx app/screens/InPersonScreen.tsx && npm test`
Expected: green. Manual: In-Person has no Fellowship cell. Changing Fellowship in the bar refetches nearby. Lang filters the list without a refetch. The map view still renders.

- [ ] **Step 6: Commit**

```bash
git add app/hooks/useNearbySchedules.ts app/components/InPersonListHeader.tsx app/components/InPersonListHeader.test.tsx app/screens/InPersonScreen.tsx
git commit -m "♻️ refactor(in-person): fellowship and language from the shared filter bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Search reads the shared filters (and stops rewriting Settings)

**Files:**
- Modify: `app/screens/ListingsScreen.tsx`

**Interfaces:**
- Consumes: `useMeetingFilters()`, `matchesLanguage`, `LanguageEmptyState`.

- [ ] **Step 1: Swap the sources**

- `const { fellowship, language, setLanguage, reportMeetings } = useMeetingFilters()`.
- Replace **every** `profileStore.fellowship` in this file with `fellowship`: the fetch (~L519), its deps array (~L697), `ListEmptyComponent` and its deps (~L885–915), and the `listHeader` deps (~L1184). Check with `grep -n "profileStore.fellowship" app/screens/ListingsScreen.tsx`, which must return nothing afterwards.
- Replace `selectedLanguage` with `language` everywhere, and delete the `selectedLanguage` / `languageModalVisible` / `fellowshipModalVisible` state and the `availableLanguages` memo.
- In `filteredMeetings`, change the language line to `const languageOk = matchesLanguage(m, language)` (and use it in the `if`).
- Delete `SELECTABLE_FELLOWSHIPS`, `LANGUAGE_DISPLAY_NAMES`, `getLanguageDisplayName` (they moved to meetingFiltersLogic), plus the Fellowship and Language `<Modal>`s (~L1264–1370). Remove `ACTIVE_FELLOWSHIPS` and other now-unused imports; let compile + eslint find them.
- Add the fetch-dependency note by the fetch:

```ts
    // CHANGED 2026-09-26: fellowship comes from the shared Meetings filter bar
    // (MeetingFiltersContext), not profileStore. Search used to write its picks
    // to profileStore.setFellowship, which silently changed the user's
    // Settings fellowship.
```

- [ ] **Step 2: Rework the grid**

Delete the Fellowship and Lang `TouchableOpacity` cells. The grid becomes two rows: **Venue / Radius** on top, **Day / Time** below. Keep the grid comment and append:

```
            CHANGED 2026-09-26: Fellowship and Lang left for the shared filter
            bar above the segments. Venue / Radius now share the "what and
            where" row and Day / Time stay together directly above the Custom
            start/end row.
```

- [ ] **Step 3: Report and the language empty state**

```ts
  useEffect(() => {
    reportMeetings("listings", meetings)
  }, [reportMeetings, meetings])

  // ADDED 2026-09-26: the time and text filters leave rows, but language
  // removes them all.
  const languageEmptied = useMemo(
    () =>
      !!language &&
      filteredMeetings.length === 0 &&
      meetings.some(
        (m) =>
          matchesSearchTime(m.millis, searchTime, startHour, endHour) &&
          matchesFreeText(haystacks.get(m) ?? buildSearchHaystack(m), queryTokens),
      ),
    [language, filteredMeetings.length, meetings, searchTime, startHour, endHour, haystacks, queryTokens],
  )
```

In `ListEmptyComponent`'s non-location branch, insert before `searchNarrowedToNothing`:

```tsx
          ) : languageEmptied && language ? (
            <LanguageEmptyState language={language} onShowAll={() => setLanguage(null)} />
```

and add `languageEmptied, language, setLanguage` to its deps. The `!fellowship` branch keeps its `listingsScreen:selectFellowship` text.

- [ ] **Step 4: Verify**

Run: `npm run compile && npx eslint --fix app/screens/ListingsScreen.tsx && npm test`
Expected: green. Manual: pick NA in the bar while Search is on screen, then open Settings. **Settings still shows your original fellowship.**

- [ ] **Step 5: Commit**

```bash
git add app/screens/ListingsScreen.tsx
git commit -m "🐛 fix(search): use the shared filter bar; stop rewriting the Settings fellowship

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Starts In on Live

**Files:**
- Modify: `app/components/SegmentedPill.tsx` (make `icon` optional)
- Create: `app/components/StartsInPill.tsx`
- Test: `app/components/StartsInPill.test.tsx`
- Create: `app/hooks/useAtNextSchedules.ts`
- Modify: `app/screens/LiveScreen.tsx`
- Modify: `app/screens/MeetingsScreen.tsx` (pass `visible` to `LiveContent`)
- Modify: `app/i18n/{en,es,ar,de,fr,pt,ru,th,uk}.ts` (the `liveScreen` block)

**Interfaces:**
- Consumes: `StartsIn`, `STARTS_IN_OPTIONS`, `offsetOf`, `buildStartsAt`, `pruneStarted`, `sortByStart`, `classifyAtNextProblem`, `isShowEdge` (Task 2); `api.getAtNextSchedules`, `toMeetingWithTrex`, `retryWithBackoff` (Task 3); `projectOnline` (`@/context/meetingPools`); `isLiveRefreshBlocked` (`@/utils/connectivityLogic`).
- Produces:
  - `StartsInPill` with props `{ value: StartsIn; disabled?: boolean; onSelect: (v: StartsIn) => void }`
  - `useAtNextSchedules(startsIn: StartsIn, visible: boolean): { meetings: MeetingWithTrex[]; isLoading: boolean; failed: boolean; unavailable: boolean; blocked: boolean; refresh: () => Promise<void> }`
  - `LiveContentProps.visible: boolean`
  - i18n: `liveScreen:startsIn`, `startsInLive`, `startsInMinutes` (`{{minutes}}`), `atNextEmpty` (`{{minutes}}`), `atNextError`

- [ ] **Step 1: Add i18n keys**

Append inside `liveScreen: { … }` in `en.ts` (after `defaultFellowship`), and the same block with English text in the other eight locale files:

```ts
    // Starts In selector (ADDED 2026-09-26). "Live" is today's in-progress list.
    startsIn: "Starts in",
    startsInLive: "Live",
    startsInMinutes: "{{minutes}} min",
    atNextEmpty: "No meetings starting in the next {{minutes}} minutes",
    atNextError: "Couldn't load upcoming meetings. Tap to retry.",
```

- [ ] **Step 2: Make `SegmentedPill`'s icon optional**

In `app/components/SegmentedPill.tsx`, change `icon: IoniconName` to:

```ts
  /** Optional: text-only pills (e.g. Starts In's "15 min") omit it. ADDED 2026-09-26. */
  icon?: IoniconName
```

and the render to `{option.icon && <Ionicons name={option.icon} size={15} color={contentColor} />}`.

Run: `npm run test:component -- app/components/MapListToggle.test.tsx`
Expected: PASS (existing consumers unchanged).

- [ ] **Step 3: Write the failing `StartsInPill` test**

```tsx
// app/components/StartsInPill.test.tsx
import { fireEvent, render, screen } from "@testing-library/react-native"

import { StartsInPill } from "./StartsInPill"

jest.mock("react-i18next", () => {
  const en = require("@/i18n/en").default
  const resolve = (key: string, params?: Record<string, string | number>) => {
    const [ns, path] = key.split(":")
    const value = (path ?? "")
      .split(".")
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], en[ns])
    if (typeof value !== "string") return key
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params?.[name] ?? `{{${name}}}`))
  }
  return { useTranslation: () => ({ t: resolve }) }
})

describe("StartsInPill", () => {
  it("shows all five options with Live selected by default", () => {
    render(<StartsInPill value="live" onSelect={jest.fn()} />)
    for (const label of ["Live", "15 min", "30 min", "45 min", "60 min"]) {
      expect(screen.getByLabelText(label)).toBeTruthy()
    }
    expect(screen.getByLabelText("Live").props.accessibilityState?.selected).toBe(true)
  })

  it("reports the picked option", () => {
    const onSelect = jest.fn()
    render(<StartsInPill value="live" onSelect={onSelect} />)
    fireEvent.press(screen.getByLabelText("30 min"))
    expect(onSelect).toHaveBeenCalledWith("30")
  })

  it("blocks the minute options while disabled (maintenance)", () => {
    const onSelect = jest.fn()
    render(<StartsInPill value="live" disabled onSelect={onSelect} />)
    expect(screen.getByLabelText("15 min").props.accessibilityState?.disabled).toBe(true)
    fireEvent.press(screen.getByLabelText("15 min"))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
```

Run: `npm run test:component -- app/components/StartsInPill.test.tsx`
Expected: FAIL, "Cannot find module './StartsInPill'"

- [ ] **Step 4: Write `StartsInPill`**

```tsx
// app/components/StartsInPill.tsx
/**
 * Live's "Starts In" selector: Live · 15 · 30 · 45 · 60. ADDED 2026-09-26.
 *
 * A thin binding over SegmentedPill (like MapListToggle) so jest can mount it
 * without the screen. `disabled` greys the minute options while
 * maintenance/outage blocks fetching. SegmentedPill never disables the
 * active option, so Live stays reachable.
 */
import { FC } from "react"
import { useTranslation } from "react-i18next"

import { SegmentedPill } from "@/components/SegmentedPill"
import { STARTS_IN_OPTIONS, type StartsIn } from "@/utils/atNextLogic"

interface StartsInPillProps {
  value: StartsIn
  disabled?: boolean
  onSelect: (value: StartsIn) => void
}

export const StartsInPill: FC<StartsInPillProps> = ({ value, disabled, onSelect }) => {
  const { t } = useTranslation()

  return (
    <SegmentedPill<StartsIn>
      value={value}
      accessibilityLabel={t("liveScreen:startsIn")}
      options={STARTS_IN_OPTIONS.map((option) => ({
        value: option,
        label:
          option === "live"
            ? t("liveScreen:startsInLive")
            : t("liveScreen:startsInMinutes", { minutes: option }),
        disabled: option !== "live" && disabled,
      }))}
      onSelect={onSelect}
    />
  )
}
```

Run: `npm run test:component -- app/components/StartsInPill.test.tsx`
Expected: PASS

- [ ] **Step 5: Write `useAtNextSchedules`**

```ts
// app/hooks/useAtNextSchedules.ts
/**
 * Data for Live's Starts In view (GET /schedules/at_next). ADDED 2026-09-26.
 *
 * Deliberately separate from MeetingContext: the in-progress Live pipeline
 * (quarter-hour polling, maintenance-exit refresh) stays untouched, and this
 * only runs while the user has a minute option selected AND Live is on screen.
 *
 * - Fetches on selection, on `refresh()`, and every 5 min while shown.
 * - A 60 s tick prunes meetings that have started since the last fetch.
 * - Clears on offset change, and a sequence ref drops superseded responses,
 *   so a slow 60-min answer can never land under 15.
 * - 404 → `unavailable`: this API build has no route. The caller hides the
 *   selector for the session.
 * - Blocked by maintenance/outage the same way MeetingContext is.
 *
 * INTEGRATION REQUIREMENT: call from an `observer()` component (reads ConfigStore).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { retryWithBackoff, toMeetingWithTrex, type MeetingWithTrex } from "@/context/MeetingContext"
import { projectOnline } from "@/context/meetingPools"
import { useConfigStore } from "@/models"
import { api } from "@/services/api"
import {
  buildStartsAt,
  classifyAtNextProblem,
  offsetOf,
  pruneStarted,
  sortByStart,
  type StartsIn,
} from "@/utils/atNextLogic"
import { isLiveRefreshBlocked } from "@/utils/connectivityLogic"

/** Refetch cadence while shown: the window slides, and new meetings enter it. */
const REFETCH_MS = 5 * 60_000
/** Prune cadence: minute resolution matches `starts_at`. */
const TICK_MS = 60_000

export function useAtNextSchedules(startsIn: StartsIn, visible: boolean) {
  const configStore = useConfigStore()
  const blocked = isLiveRefreshBlocked({
    maintenanceMode: configStore.maintenanceMode,
    outageMode: configStore.outageMode,
  })
  const offset = offsetOf(startsIn)

  const [raw, setRaw] = useState<MeetingWithTrex[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [isLoading, setIsLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const seqRef = useRef(0)

  const refresh = useCallback(async () => {
    if (offset === null || blocked || unavailable) return
    const seq = ++seqRef.current
    setIsLoading(true)
    const outcome = await retryWithBackoff(
      () => api.getAtNextSchedules(offset, buildStartsAt(new Date())),
      (result) => result.kind === "ok",
      `getAtNextSchedules(${offset})`,
    )
    if (seq !== seqRef.current) return // superseded by a newer request
    setIsLoading(false)

    if ("result" in outcome && outcome.result.kind === "ok") {
      setRaw(projectOnline(outcome.result.schedules.map(toMeetingWithTrex)))
      setNowMs(Date.now())
      setFailed(false)
      return
    }
    const kind = "result" in outcome ? outcome.result.kind : "unknown"
    if (classifyAtNextProblem(kind) === "hide-for-session") {
      setUnavailable(true)
      return
    }
    // Keep the last list; the caller shows a retry prompt only if it is empty.
    setFailed(true)
  }, [offset, blocked, unavailable])

  // New offset: never show the previous window's rows under the new label.
  useEffect(() => {
    seqRef.current++
    setRaw([])
    setFailed(false)
    setIsLoading(false)
  }, [offset])

  useEffect(() => {
    if (!visible || offset === null) return
    void refresh()
    const id = setInterval(() => void refresh(), REFETCH_MS)
    return () => clearInterval(id)
  }, [visible, offset, refresh])

  useEffect(() => {
    if (!visible || offset === null) return
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [visible, offset])

  const meetings = useMemo(() => sortByStart(pruneStarted(raw, nowMs)), [raw, nowMs])

  return { meetings, isLoading, failed, unavailable, blocked, refresh }
}
```

- [ ] **Step 6: Pass `visible` from `MeetingsScreen`**

Add `import { useIsFocused } from "@react-navigation/native"` (merge with the existing `useRoute` import), then in `MeetingsScreen`:

```ts
  // ADDED 2026-09-26: Live resets Starts In on every visit, including a return
  // to the Meetings tab from another tab, which activeSegment alone can't see.
  const isFocused = useIsFocused()
```

and `<LiveContent meetingId={route.params?.meetingId} visible={isFocused && activeSegment === "live"} />`.

- [ ] **Step 7: Wire Live**

In `LiveScreen.tsx`:

```ts
/**
 * Starts In ships dark until GET /schedules/at_next is deployed (api repo).
 * Flip to `true` after the deploy: a JS-only OTA, no runtimeVersion bump.
 * If flipped too early, a 404 hides the selector for the session
 * (useAtNextSchedules → `unavailable`).
 */
const startsInVisible = __DEV__
```

Add `visible: boolean` to `LiveContentProps` with the doc line `/** True only while Live is on screen (segment AND Meetings tab focused). Drives the Starts In reset. */`, and destructure it.

Inside the component:

```ts
  const [startsIn, setStartsIn] = useState<StartsIn>("live")
  const atNext = useAtNextSchedules(startsInVisible ? startsIn : "live", visible)
  const showStartsIn = startsInVisible && !atNext.unavailable

  // Reset to Live on every visit. Keyed on the visibility edge, never on a
  // store value (CLAUDE.md "The trap, hit twice").
  const prevVisibleRef = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (isShowEdge(prevVisibleRef.current, visible)) setStartsIn("live")
    prevVisibleRef.current = visible
  }, [visible])

  // Fall back to Live when the endpoint is missing or fetching is blocked.
  useEffect(() => {
    if (atNext.unavailable || atNext.blocked) setStartsIn("live")
  }, [atNext.unavailable, atNext.blocked])

  const handleStartsInSelect = useCallback((value: StartsIn) => {
    setStartsIn(value)
    trackEvent("live_starts_in_changed", { offset: value })
  }, [])
```

Change the `fellowshipMeetings` source from Task 5 to `const source = startsIn === "live" ? liveMeetings : atNext.meetings`, filter `source` instead of `liveMeetings`, and add `source` to the memo deps. `reportMeetings("live", fellowshipMeetings)` stays as is.

Sorting: at_next rows are already in start order, and feedback ranking would scramble the countdown:

```ts
  const sortedMeetings = useMemo(
    () => (startsIn === "live" ? sortByFeedback(filteredMeetings) : filteredMeetings),
    [filteredMeetings, startsIn],
  )
```

Render the pill where the fellowship row was (below the title header):

```tsx
      {showStartsIn && (
        <View style={themed($startsInRow)}>
          <StartsInPill value={startsIn} disabled={atNext.blocked} onSelect={handleStartsInSelect} />
        </View>
      )}
```

```ts
const $startsInRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.sm,
  alignItems: "flex-start",
})
```

RefreshControl: `refreshing={startsIn === "live" ? isLoading : atNext.isLoading}` and `onRefresh={startsIn === "live" ? refresh : atNext.refresh}`.

Extend `ListEmptyComponent` (from Task 5) so the at_next branches come first:

```tsx
  const ListEmptyComponent = useCallback(() => {
    if (startsIn !== "live" && atNext.failed) {
      return (
        <Pressable
          style={themed($emptyContainer)}
          onPress={() => void atNext.refresh()}
          accessibilityRole="button"
        >
          <Text style={themed($emptyText)}>{t("liveScreen:atNextError")}</Text>
        </Pressable>
      )
    }
    if (language && fellowshipMeetings.length > 0) {
      return <LanguageEmptyState language={language} onShowAll={() => setLanguage(null)} />
    }
    return (
      <View style={themed($emptyContainer)}>
        <Text preset="subheading" style={themed($emptyText)}>
          {startsIn === "live"
            ? t("liveScreen:noMeetings")
            : t("liveScreen:atNextEmpty", { minutes: startsIn })}
        </Text>
      </View>
    )
  }, [themed, t, startsIn, atNext.failed, atNext.refresh, language, fellowshipMeetings.length, setLanguage])
```

Imports to add: `Pressable` (react-native), `StartsInPill`, `useAtNextSchedules`, `isShowEdge` and `type StartsIn` from `@/utils/atNextLogic`, `trackEvent` from `@/services/tracking`.

- [ ] **Step 8: Verify**

Run: `npm run compile && npx eslint --fix app/components/SegmentedPill.tsx app/components/StartsInPill.tsx app/components/StartsInPill.test.tsx app/hooks/useAtNextSchedules.ts app/screens/LiveScreen.tsx app/screens/MeetingsScreen.tsx app/i18n/*.ts && npm test`
Expected: green.

Manual (dev build, `npm run ios`):
- Live shows `Live · 15 · 30 · 45 · 60`.
- Against an API **without** the route, tapping 15 hides the pill and returns to Live (404 path).
- Against a local API that has it, 30 lists meetings soonest-first.
- Switching to In-Person and back resets to Live, and so does going to Settings and back.

- [ ] **Step 9: Commit**

```bash
git add app/components/SegmentedPill.tsx app/components/StartsInPill.tsx app/components/StartsInPill.test.tsx app/hooks/useAtNextSchedules.ts app/screens/LiveScreen.tsx app/screens/MeetingsScreen.tsx app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts
git commit -m "✨ feat(live): Starts In selector over /schedules/at_next (dev builds only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs, changelog, full verification

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`)
- Modify: `CLAUDE.md` ("Navigation" → the "Meetings tab segments" paragraph)

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]`, add to the matching groups (create any group that's missing):

```markdown
### Changed
- Meetings: Fellowship and Language filters moved out of the individual Live /
  In-Person / Search segments into one bar above them. Both are shared across
  the three segments and remembered across restarts; changing your fellowship
  in Settings still updates the bar.

### Added
- Language filter on Live and In-Person (Search already had one). A remembered
  language with no matches shows a "Show all languages" shortcut instead of an
  empty list.
- Live: "Starts In" selector (Live / 15 / 30 / 45 / 60 min) backed by the new
  `GET /schedules/at_next` endpoint. Dev builds only until the API ships.

### Fixed
- Choosing a fellowship in Search no longer changes the fellowship saved in
  Settings.
```

- [ ] **Step 2: CLAUDE.md**

After the paragraph that starts "**Meetings tab segments**", add:

```markdown
**Shared filter bar** (ADDED 2026-09-26): Fellowship and Lang live in
`MeetingFilterBar` above the segmented control, not inside any segment. State
is `MeetingFiltersContext` (owned by `MeetingsScreen`, MMKV keys
`meetings.fellowship` / `meetings.language`, pure decisions in
`meetingFiltersLogic.ts`). It is a browse selection and never writes
`profileStore.fellowship`. It follows Settings through the `preferences_changed`
event, **not** a MobX reaction: hydration assigns `profileStore.fellowship` on
every cold start and a reaction would wipe the remembered pick. Segments report
their loaded list via `reportMeetings()` so the Lang picker offers the active
segment's languages. Live's **Starts In** pill (`useAtNextSchedules`,
`atNextLogic.ts`, `GET /schedules/at_next`) resets to Live on each visit and is
gated by `startsInVisible` in `LiveScreen.tsx` until the API route is deployed.
Spec: `docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md`.
```

- [ ] **Step 3: Full verification**

Run: `npm run compile && npm run lint:deps && npm test`
Expected: all green. Record the test counts.

- [ ] **Step 4: Manual checklist (simulator + one physical device)**

- [ ] Fellowship and Lang carry across Live / In-Person / Search.
- [ ] Both survive a cold start (kill the app, relaunch).
- [ ] Changing fellowship in Settings moves the bar; a plain cold start does not reset a bar pick.
- [ ] Picking a fellowship in the bar leaves Settings unchanged.
- [ ] Stale language → "Show all languages" → the list returns (on each segment).
- [ ] Starts In resets to Live on a segment switch and on returning to the tab.
- [ ] Against an API without `/schedules/at_next`: the pill hides and the view stays on Live.
- [ ] Maintenance banner on → minute options disabled, view on Live.
- [ ] VoiceOver (iOS) and TalkBack (Android): bar cells announce "Fellowship, NA" / "Language, All"; pill options announce selected state.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "📝 docs: shared meetings filter bar + Live Starts In

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
