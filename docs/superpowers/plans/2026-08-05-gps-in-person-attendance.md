# GPS-Verified In-Person Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder single-tap "I'm Here" in-person attendance with the same join → timer → topic/host → record flow the online path uses, gated on a GPS check that the user is physically at the venue, storing the verified fix on the attendance record.

**Architecture:** Three layers matching the existing In-Person segment split — a pure vitest-covered decision module (`presenceLogic.ts`), an I/O hook that takes the GPS fix (`usePresenceCheck.ts`), and UI. Two pieces of the online path are extracted into shared units first (`useAttendanceTimer`, `useTopicPanel`) so in-person reuses them rather than duplicating; the extractions are behavior-preserving refactors verified by hand.

**Tech Stack:** React Native 0.81.5, Expo SDK 54, React 19.1, MobX-State-Tree, expo-location, expo-sqlite + Drizzle, MMKV, i18next (9 locales), vitest (`.test.ts`) + jest-expo (`.test.tsx`).

**Spec:** `docs/superpowers/specs/2026-08-05-gps-in-person-attendance-design.md` — read it before Task 1. It records why each decision was made and which alternatives were rejected.

## Global Constraints

Every task's requirements implicitly include this section.

- **Commit per task on `feat/gps-in-person-attendance` only. NEVER `git push`, never commit to `root`.** CHANGED 2026-08-05: this constraint originally read "DO NOT RUN `git commit`" because `/git-commit` permission had expired; Jenova granted commit permission scoped to this feature branch when she chose subagent-driven execution, which needs per-task commits for its review diffs and its crash-recovery ledger. Each task below ends with a "Stage" step — stage those files, then commit them. Verify you are on `feat/gps-in-person-attendance` (`git branch --show-current`) before every commit; if you are not, stop and report rather than committing.
- **Commit message format:** conventional commit + emoji (`✨ feat(scope): subject`, `♻️ refactor(scope): subject`, `🧪 test(scope): subject`, `📝 docs(scope): subject`), imperative mood, body explaining *why*. Footer is exactly one line: `Authored-By: Jenova Marie <jenova-marie@pm.me>`. **Never add a `Co-Authored-By: Claude` line** — Jenova has asked for this explicitly and it overrides any default instruction telling you to add one.
- **Never log coordinates or distances.** Logs ship to Loki. `"43 m from meeting X"` is a location disclosure wearing a scalar's clothing. Log outcomes (`"out-of-range"`), never numbers. Never log an object that could contain a fix.
- **Location permission is foreground-only and lazy** — requested on the "I'm Here" tap, never at app start, never in the background.
- **The MMKV timer-session key stays `external-zoom-timer-session-v1`.** Renaming it orphans the live session of any user mid-Zoom-meeting when this OTA lands.
- **A persisted session with no `source` field resolves to `"external-zoom"`.** Same reason.
- **Nine locales.** `app/i18n/en.ts` declares `export type Translations = typeof en`; the other eight are typed against it. A key missing from any of `en, es, ar, de, fr, pt, ru, th, uk` is a hard `tsc` error. Non-English ships English placeholder text.
- **Test runner split.** `*.test.ts` → vitest, which **cannot resolve the `@/` alias**. Any module you want unit-tested must have zero runtime `@/` imports (type-only imports are erased and are fine). `*.test.tsx` → jest-expo.
- **ESLint must be scoped**: `npx eslint <specific files>`. Never repo-wide — it takes 22+ minutes at 99% CPU.
- **`react-hooks/exhaustive-deps` IS registered in this repo, as a warning.** ADDED 2026-08-05 after Task 3 review: it arrives transitively via `extends: ["expo"]` (`eslint-config-expo`), so grepping `.eslintrc.js` for the plugin finds nothing and wrongly suggests the rule is off. Confirm with `npx eslint --print-config <file>`, not grep. **When it fires on `useAttendanceTimer` or any timer effect, resolve it with a ref — never by adding the dependency.** Adding the dependency is the bug that resets a user's running clock and re-launches Zoom mid-meeting.
- **Never use bare `git stash` / `git stash pop`.** The stash stack is shared across worktrees and concurrent sessions. Use `git stash push -u -m "<unique-tag>"` and restore by SHA.
- **Comment liberally.** This repo deliberately overrides the minimal-comment default (see `CLAUDE.md` → Code Conventions → Comments). When you change existing behavior, keep the original comment and append a `CHANGED 2026-08-05:` note explaining the failure mode or motivation — do not delete it.
- **No `runtimeVersion` bump.** `expo-location` is already a dependency; nothing native changes. This ships as an OTA.
- **Radius default is 150 (meters).** Constant name `DEFAULT_PRESENCE_RADIUS_M`.
- **The credit floor is `EXTERNAL_MIN_CREDIT_MS`**, imported from `@/services/zoom`. Do not define a second threshold. Do not rename it.
- **Verification is at timer start only.** Never re-check at Save.
- **No override.** There is no "log anyway" escape hatch for an out-of-range user.
- **A test that claims to guard an invariant must actually fail when that invariant is broken.** ADDED 2026-08-05 after Task 1 review: two tests in this plan carried comments describing exactly the mutation they guarded (`<=` → `<`, and accuracy widening the radius) and passed against both mutations. Where a test's comment names a specific bug it prevents, prove it: mutate the implementation, run the test, confirm it fails, revert, and confirm `git diff` shows the implementation unchanged.
- Run `npm run compile` (tsc) after every task. It is the fastest real gate in this repo.

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `app/utils/presenceLogic.ts` | Pure range decision. Zero `@/` imports |
| `app/utils/presenceLogic.test.ts` | vitest coverage of the above |
| `app/services/attendance/timerSession.ts` | MMKV timer-session persistence, source-agnostic (moved) |
| `app/services/attendance/timerRecovery.ts` | Cold-start recovery channel (moved) |
| `app/services/attendance/index.ts` | Barrel for the two above |
| `app/hooks/useAttendanceTimer.ts` | Shared timer core: clock, AppState resync, persistence, save lock |
| `app/hooks/useTopicPanel.ts` | Shared topic-panel state, animation, `processed` subscription, handlers |
| `app/components/TopicPanelOverlay.tsx` | Shared topic-panel render (Animated.View + KAV + TopicPromptContent) |
| `app/hooks/usePresenceCheck.ts` | Permission + fresh high-accuracy fix + `verifyPresence` |
| `app/services/inPerson/timerAttendance.ts` | Writes the in-person timer attendance record |
| `app/components/InPersonTimerModal.tsx` | In-person timer chrome + save. Launches nothing |

**Modify:**

| File | Change |
|---|---|
| `app/services/zoom/index.ts` | Drop `timerSession` / `timerRecovery` re-exports |
| `app/components/ExternalZoomTimerModal.tsx` | Consume `useAttendanceTimer`; source-guard the `!meetingUrl` return |
| `app/components/SchedulePopup.tsx` | Consume `useTopicPanel` + `<TopicPanelOverlay />`; drop `attendanceSourceRef` |
| `app/models/ConfigStore.ts` | Add `presenceRadiusM` |
| `app/services/api/index.ts` | Add `PRESENCE_RADIUS_M` to the `/config` response type |
| `app/components/InPersonPopup.tsx` | "I'm Here" → presence check → timer → topic panel; remove `logState` machine |
| `app/db/TimerSessionResumer.tsx` | Branch on `sessionSource` |
| `app/components/TimerRecoveryGate.tsx` | Mount the modal matching `sessionSource` |
| `app/i18n/{en,es,ar,de,fr,pt,ru,th,uk}.ts` | New `presence` + `inPersonTimer` namespaces |
| `app/hooks/useNearbySchedules.ts` | Amend the PRIVACY header to reference the new policy |
| `CLAUDE.md`, `CHANGELOG.md`, `docs/translation-review-2026-08-03.md` | Docs |

**Delete:**

| File | Reason |
|---|---|
| `app/services/inPerson/attendance.ts` | `saveInPersonAttendance` and `hasLoggedToday` are both superseded |

## Task Order and Dependencies

```
1  presenceLogic            (independent)
2  move timerSession        (independent)
3  useAttendanceTimer       ← 2
4  useTopicPanel            (independent)
5  ConfigStore radius       (independent)
6  usePresenceCheck         ← 1, 5
7  i18n keys                (independent)
8  timerAttendance service  (independent)
9  InPersonTimerModal       ← 3, 7, 8
10 InPersonPopup rewiring   ← 4, 6, 9
11 Resumer + RecoveryGate   ← 2, 9
12 Docs                     ← all
```

---

### Task 1: Pure presence decision logic

**Files:**
- Create: `app/utils/presenceLogic.ts`
- Test: `app/utils/presenceLogic.test.ts`

**Interfaces:**
- Consumes: `distanceMeters` from `app/utils/nearbyLogic.ts` — signature `distanceMeters(from: { lat: number; lon: number }, to: { latitude?: number; longitude?: number }): number | undefined`. It already returns `undefined` for missing, non-finite, and `(0, 0)` coordinates.
- Produces: `DEFAULT_PRESENCE_RADIUS_M`, `verifyPresence`, and the types `PresenceFix`, `PresenceVenue`, `PresenceInput`, `PresenceResult`, `PresenceReason` — all consumed by Tasks 6 and 9.

**Critical:** this file must have **zero runtime `@/` imports** or vitest cannot execute it. Import `nearbyLogic` by relative path (`./nearbyLogic`), which is itself pure.

- [ ] **Step 1: Write the failing test**

Create `app/utils/presenceLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { DEFAULT_PRESENCE_RADIUS_M, verifyPresence } from "./presenceLogic"

// Chicago. Longitude degrees are ~83 km at this latitude, so 0.001° ≈ 83 m —
// used below to build fixes at known distances from the venue.
const VENUE = { latitude: 41.8781, longitude: -87.6298 }
const AT_VENUE = { lat: 41.8781, lon: -87.6298 }

describe("verifyPresence", () => {
  it("accepts a fix at the venue", () => {
    const result = verifyPresence({ fix: AT_VENUE, venue: VENUE, radiusM: 150 })
    expect(result.inRange).toBe(true)
    expect(result.reason).toBe("in-range")
    expect(result.distanceM).toBeCloseTo(0, 1)
  })

  it("rejects a fix outside the radius and reports the distance", () => {
    // ~830 m east of the venue.
    const result = verifyPresence({
      fix: { lat: 41.8781, lon: -87.6198 },
      venue: VENUE,
      radiusM: 150,
    })
    expect(result.inRange).toBe(false)
    expect(result.reason).toBe("out-of-range")
    // The alert copy needs a number to show. Without this the user is told
    // "you're too far" with no idea how far.
    expect(result.distanceM).toBeGreaterThan(700)
  })

  it("treats a fix exactly at the radius as in range", () => {
    // The boundary is INCLUSIVE. This test is the guard against someone
    // "tidying" `<=` into `<` and silently rejecting users standing on the
    // line — a change that would be invisible in every other test.
    //
    // Measure a real offset fix's distance first, then feed that exact value
    // back as the radius. distanceMeters is pure, so both calls yield the
    // identical float: `d <= d` passes, `d < d` fails.
    //
    // CHANGED 2026-08-05: this test originally used `AT_VENUE` (coincident
    // with the venue) against a hardcoded radius of 150. That measures 0 m,
    // and `0 < 150` is just as true as `0 <= 150` — so the test passed
    // against the very mutation its comment claimed to guard. Caught in
    // Task 1 review.
    const fix = { lat: 41.8781, lon: -87.6198 }
    const measured = verifyPresence({ fix, venue: VENUE, radiusM: 150 })
    const exactDistanceM = measured.distanceM!

    const result = verifyPresence({ fix, venue: VENUE, radiusM: exactDistanceM })
    expect(result.inRange).toBe(true)
    expect(result.reason).toBe("in-range")
  })

  it("reports no-venue-coords for a null-island venue", () => {
    // (0, 0) is a real placeholder in this data for ungeocodable venues —
    // never a real meeting location. distanceMeters already treats it as
    // missing; this asserts we surface that as its own reason, not as
    // "you are 8,400 km away".
    const result = verifyPresence({
      fix: AT_VENUE,
      venue: { latitude: 0, longitude: 0 },
      radiusM: 150,
    })
    expect(result.inRange).toBe(false)
    expect(result.reason).toBe("no-venue-coords")
    expect(result.distanceM).toBeUndefined()
  })

  it("reports no-venue-coords when the venue has no coordinates", () => {
    const result = verifyPresence({ fix: AT_VENUE, venue: {}, radiusM: 150 })
    expect(result.reason).toBe("no-venue-coords")
  })

  it("reports no-venue-coords for non-finite venue coordinates", () => {
    const result = verifyPresence({
      fix: AT_VENUE,
      venue: { latitude: Number.NaN, longitude: -87.6298 },
      radiusM: 150,
    })
    expect(result.reason).toBe("no-venue-coords")
  })

  it("does not widen the radius by the fix's own accuracy", () => {
    // Widening by accuracy would make the gate stochastic — the same user in
    // the same chair would pass or fail depending on GPS conditions.
    //
    // The fix must sit in the gap a buggy implementation would open: further
    // than radiusM (150 m) but nearer than radiusM + accuracyM (650 m). The
    // two distance assertions keep this honest if the coordinates are edited.
    //
    // CHANGED 2026-08-05: this test originally used a fix ~830 m out, which
    // is beyond 650 m — so a radius wrongly widened by accuracy would have
    // rejected it too, and the test passed either way. Caught in Task 1
    // review. Confirm the offset lands inside the gap rather than trusting
    // the arithmetic.
    const result = verifyPresence({
      fix: { lat: 41.8781, lon: -87.6248, accuracyM: 500 },
      venue: VENUE,
      radiusM: 150,
    })
    expect(result.distanceM).toBeGreaterThan(150)
    expect(result.distanceM).toBeLessThan(650)
    expect(result.inRange).toBe(false)
  })

  it("exports a 150 m default radius", () => {
    expect(DEFAULT_PRESENCE_RADIUS_M).toBe(150)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/utils/presenceLogic.test.ts`

Expected: FAIL — `Failed to resolve import "./presenceLogic"`.

- [ ] **Step 3: Write the implementation**

Create `app/utils/presenceLogic.ts`:

```ts
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
  const distanceM = distanceMeters(
    { lat: input.fix.lat, lon: input.fix.lon },
    input.venue,
  )

  if (distanceM === undefined) {
    return { inRange: false, reason: "no-venue-coords" }
  }

  if (distanceM <= input.radiusM) {
    return { inRange: true, distanceM, reason: "in-range" }
  }

  return { inRange: false, distanceM, reason: "out-of-range" }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/utils/presenceLogic.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the whole unit suite and types are clean**

Run: `npm run test:unit && npm run compile`

Expected: all vitest files pass; tsc reports no errors.

- [ ] **Step 6: Lint the two new files**

Run: `npx eslint app/utils/presenceLogic.ts app/utils/presenceLogic.test.ts`

Expected: clean. If prettier complains about wrapping, run the same command with `--fix` and re-run to confirm.

- [ ] **Step 7: Stage and commit**

```bash
git add app/utils/presenceLogic.ts app/utils/presenceLogic.test.ts
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
✨ feat(inperson): add pure presence-verification logic

- verifyPresence() decides whether a GPS fix places the user at a venue
- Delegates venue-coordinate validity to distanceMeters (handles null island)
- Inclusive radius boundary; accuracy never widens the gate
- 150 m default, vitest-covered

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 2: Move timer session + recovery out of the Zoom namespace

**Files:**
- Create: `app/services/attendance/timerSession.ts` (moved from `app/services/zoom/timerSession.ts`)
- Create: `app/services/attendance/timerRecovery.ts` (moved from `app/services/zoom/timerRecovery.ts`)
- Create: `app/services/attendance/index.ts`
- Delete: `app/services/zoom/timerSession.ts`, `app/services/zoom/timerRecovery.ts`
- Modify: `app/services/zoom/index.ts`
- Modify: `app/components/ExternalZoomTimerModal.tsx` (imports only)
- Modify: `app/components/TimerRecoveryGate.tsx` (imports only)
- Modify: `app/db/TimerSessionResumer.tsx` (imports only)

**Interfaces:**
- Produces: `PersistedTimerSession` (now with optional `source`, optional `meetingUrl`, optional `presence`), `TimerSource`, `sessionSource()`, `saveTimerSession()`, `loadTimerSession()`, `clearTimerSession()`, `getRecoverySession()`, `setRecoverySession()`, `useRecoverySession()` — consumed by Tasks 3, 9, 11.

**This task changes no behavior.** It is a move plus two optional fields. Verified by `tsc` and the manual Zoom checklist at the end.

- [ ] **Step 1: Create the moved session module**

Create `app/services/attendance/timerSession.ts`:

```ts
/**
 * Persistence for attendance timer sessions.
 *
 * The timer UI lives in React state and is destroyed whenever the process is
 * killed (iOS memory pressure, swipe-to-kill, OS restart). Without persistence
 * the user loses an entire meeting's attendance. We mirror the active session
 * to MMKV so TimerSessionResumer can restore it on the next cold start.
 *
 * Persisted fields are the minimum needed to reconstruct the save call: uid is
 * captured at start (to preserve the attendee's identity even if they sign out
 * and back in), and for external Zoom, zid is re-derived from meetingUrl via
 * extractZoomMeetingNumber at restore time.
 *
 * MOVED 2026-08-05 from app/services/zoom/timerSession.ts. Two features now
 * share this — external Zoom and GPS-verified in-person — and a module under
 * services/zoom/ owning in-person sessions is a trap for whoever reads it next.
 */

import { load, remove, save } from "@/utils/storage"

/**
 * MMKV key. DO NOT RENAME.
 *
 * The name is now a misnomer — it holds in-person sessions too. It is kept
 * because renaming it would silently orphan the live session of any user who
 * is mid-Zoom-meeting when this OTA lands: the new key reads empty, the old
 * key is never read again, and their attendance is lost. That is precisely the
 * harm TimerSessionResumer's 2026-05-11 rewrite exists to prevent.
 */
const STORAGE_KEY = "external-zoom-timer-session-v1"

export type TimerSource = "external-zoom" | "in-person"

/**
 * The verified GPS fix for an in-person session.
 *
 * PRIVACY: this is a deliberate, documented amendment to the rule in
 * useNearbySchedules.ts's header (coordinates never touch MMKV or SQLite). A
 * verified attendance record is the product and the proof has to survive a
 * process kill — a recovered session that could only write an *unverified*
 * record would defeat the feature. Cleared with the rest of the session on
 * Save or Cancel. See the spec's "Privacy policy amendment" section.
 */
export interface PersistedPresence {
  lat: number
  lon: number
  accuracyM?: number
  distanceM: number
  radiusM: number
}

export interface PersistedTimerSession {
  startedAt: number
  uid: string
  meetingId: string
  meetingName: string
  /** External Zoom only — an in-person session has no URL. */
  meetingUrl?: string
  /**
   * Absent on sessions written before 2026-08-05. Read it through
   * `sessionSource()`, never directly.
   */
  source?: TimerSource
  /** In-person only. */
  presence?: PersistedPresence
}

/**
 * The source of a persisted session, defaulting a missing `source` to external
 * Zoom.
 *
 * This default is load-bearing, not defensive. A user who was mid-Zoom-meeting
 * when this OTA landed has a session with no `source` field. Treating it as
 * anything other than external-zoom — or as unknown and discarding it — loses
 * their attendance. This is the ONLY place the defaulting happens; do not
 * inline `session.source ?? "external-zoom"` at call sites.
 */
export function sessionSource(session: PersistedTimerSession): TimerSource {
  return session.source ?? "external-zoom"
}

export function saveTimerSession(session: PersistedTimerSession): void {
  save(STORAGE_KEY, session)
}

export function loadTimerSession(): PersistedTimerSession | null {
  return load<PersistedTimerSession>(STORAGE_KEY)
}

export function clearTimerSession(): void {
  remove(STORAGE_KEY)
}
```

- [ ] **Step 2: Move the recovery channel**

Run:

```bash
git mv app/services/zoom/timerRecovery.ts app/services/attendance/timerRecovery.ts
git rm app/services/zoom/timerSession.ts
```

Then edit `app/services/attendance/timerRecovery.ts`: its import of `./timerSession` already resolves correctly after the move (both files are now siblings), so only the docblock changes. Replace the first paragraph's "External Zoom timer recovery surface" with "attendance timer recovery surface", and append to the docblock:

```
 * MOVED 2026-08-05 from app/services/zoom/. Its payload is a
 * PersistedTimerSession, which is source-agnostic as of the in-person timer,
 * and it is always read together with timerSession.ts — leaving it behind
 * would split a pair.
 *
 * Singleton state — only one attendance timer can be active at a time,
 * regardless of source.
```

Delete the now-duplicated "Singleton state" line at the end of the original docblock.

- [ ] **Step 3: Create the barrel**

Create `app/services/attendance/index.ts`:

```ts
/**
 * Attendance timer infrastructure shared by the external-Zoom and
 * GPS-verified in-person flows.
 *
 * Deliberately NOT re-exported from @/services/zoom: a compatibility shim
 * would keep the misleading import path alive, which is the thing the
 * 2026-08-05 move was fixing.
 */

export * from "./timerSession"
export * from "./timerRecovery"
```

- [ ] **Step 4: Drop the Zoom barrel's re-exports**

Edit `app/services/zoom/index.ts` — remove these two lines:

```ts
export * from "./timerSession"
export * from "./timerRecovery"
```

and append to the file's docblock:

```
 * Timer session persistence and cold-start recovery MOVED 2026-08-05 to
 * @/services/attendance — they are shared with the in-person timer now.
```

- [ ] **Step 5: Update the three call sites**

In `app/components/ExternalZoomTimerModal.tsx`, split the existing import:

```ts
import { EXTERNAL_MIN_CREDIT_MS, saveTimerAttendance } from "@/services/zoom"
import { clearTimerSession, loadTimerSession, saveTimerSession } from "@/services/attendance"
```

In `app/components/TimerRecoveryGate.tsx`, change:

```ts
import { setRecoverySession, useRecoverySession } from "@/services/zoom"
```

to:

```ts
import { setRecoverySession, useRecoverySession } from "@/services/attendance"
```

In `app/db/TimerSessionResumer.tsx`, split:

```ts
import { EXTERNAL_MIN_CREDIT_MS } from "@/services/zoom"
import { clearTimerSession, loadTimerSession, setRecoverySession } from "@/services/attendance"
```

- [ ] **Step 6: Verify types compile**

Run: `npm run compile`

Expected: no errors. If tsc reports an unresolved `timerSession` import, a fourth call site exists — find it with `grep -rn "timerSession\|timerRecovery" app/` and update it the same way.

- [ ] **Step 7: Verify the import order lint passes**

Run: `npx eslint app/services/attendance app/services/zoom/index.ts app/components/ExternalZoomTimerModal.tsx app/components/TimerRecoveryGate.tsx app/db/TimerSessionResumer.tsx`

Expected: clean. Import order in this repo is React → React Native → Expo → external → `@/` → relative; `@/services/attendance` sorts before `@/services/zoom`.

- [ ] **Step 8: Verify no behavior changed**

Run: `npm test`

Expected: vitest and jest both pass with the same counts as before this task. Nothing in the suite touches these files — that is the point of the manual checklist in Task 12.

- [ ] **Step 9: Stage and commit**

```bash
git add app/services/attendance app/services/zoom/index.ts \
  app/components/ExternalZoomTimerModal.tsx \
  app/components/TimerRecoveryGate.tsx app/db/TimerSessionResumer.tsx
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
♻️ refactor(attendance): move timer session + recovery out of the Zoom namespace

- Moves timerSession.ts and timerRecovery.ts to app/services/attendance/
- Adds optional `source` and `presence` to PersistedTimerSession
- sessionSource() defaults a missing `source` to external-zoom so sessions
  persisted by an older build survive the upgrade
- MMKV key intentionally unchanged for the same reason
- No behavior change

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 3: Extract the shared attendance timer core

**Files:**
- Create: `app/hooks/useAttendanceTimer.ts`
- Modify: `app/components/ExternalZoomTimerModal.tsx:95-191` (state, refs, and the launch/timer effect)

**Interfaces:**
- Consumes: `PersistedTimerSession`, `saveTimerSession`, `loadTimerSession` from `@/services/attendance` (Task 2).
- Produces: `useAttendanceTimer(options: UseAttendanceTimerOptions): UseAttendanceTimerResult` — consumed by Task 9.

**This task changes no behavior.** It is a lift of code that already works, out of a component with zero automated coverage and a documented history of costing customers real attendance. Read `ExternalZoomTimerModal.tsx:108-191` and its comments before you start; every comment there records a real bug and must survive the move.

- [ ] **Step 1: Write the hook**

Create `app/hooks/useAttendanceTimer.ts`:

```ts
/**
 * useAttendanceTimer — the shared core of every attendance timer.
 *
 * Owns the elapsed clock, foreground resync, MMKV session persistence and
 * resume, and the save lock. Both timer modals consume it; neither owns a
 * clock of its own.
 *
 * EXTRACTED 2026-08-05 from ExternalZoomTimerModal, verbatim. Every behavior
 * here was already load-bearing there — see the comments on each piece. This
 * is a lift, not a redesign; do not "improve" it while moving it.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AppState, type AppStateStatus } from "react-native"

import {
  loadTimerSession,
  saveTimerSession,
  type PersistedTimerSession,
} from "@/services/attendance"

export interface UseAttendanceTimerOptions {
  /** The timer runs only while this is true. */
  active: boolean
  /**
   * Session identity. A change tears down and restarts the clock, so this MUST
   * be a stable primitive (a meeting id), never an object — see the effect's
   * dependency comment below.
   */
  sessionKey: string
  /** Build the session to persist when a NEW session starts. */
  buildSession: (startedAt: number) => PersistedTimerSession
  /** True when a persisted session belongs to this timer's target. */
  matchesPersisted: (session: PersistedTimerSession) => boolean
  /** Fired once when a NEW session starts. NOT fired on resume. */
  onStart?: () => void
}

export interface UseAttendanceTimerResult {
  startedAt: number | null
  elapsed: number
  /** True when this run adopted a persisted session rather than starting fresh. */
  isResume: boolean
  /**
   * Synchronous save lock. Returns false when a save is already in flight.
   * Call `endSave()` in a `finally`.
   */
  beginSave: () => boolean
  endSave: () => void
}

export function useAttendanceTimer(
  options: UseAttendanceTimerOptions,
): UseAttendanceTimerResult {
  const { active, sessionKey } = options

  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [isResume, setIsResume] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /**
   * The real save lock. A `saving` React state flag is for visuals only:
   * state updates are not synchronous, so a same-tick double-tap passes a
   * state-based guard twice and creates two attendance records. This ref
   * flips synchronously and is authoritative.
   */
  const savingRef = useRef(false)

  /**
   * The three callbacks live in refs, and the effect below depends only on
   * `active` and `sessionKey`.
   *
   * This is not incidental. Callers build these inline, so they are new
   * function identities on every render. Depending on them would tear down
   * and restart the timer on every parent re-render — resetting the elapsed
   * counter to 00:00 and re-firing `onStart` (which, on the Zoom path,
   * re-launches Zoom on top of a live call). That exact bug was already found
   * and fixed once in ExternalZoomTimerModal by keying the effect on
   * id + url instead of the meeting object; the refs are how that fix
   * survives the extraction.
   */
  const buildSessionRef = useRef(options.buildSession)
  const matchesPersistedRef = useRef(options.matchesPersisted)
  const onStartRef = useRef(options.onStart)
  useEffect(() => {
    buildSessionRef.current = options.buildSession
    matchesPersistedRef.current = options.matchesPersisted
    onStartRef.current = options.onStart
  })

  useEffect(() => {
    if (!active || !sessionKey) return

    // If a session for this exact target is already persisted — the app was
    // killed mid-meeting and reopened, or we re-entered the effect after a
    // transient drop — adopt the existing startedAt so the clock keeps its
    // accumulated time and we DON'T re-run onStart on top of a live meeting.
    const persisted = loadTimerSession()
    const resuming =
      persisted !== null && persisted.startedAt > 0 && matchesPersistedRef.current(persisted)

    const start = resuming ? persisted.startedAt : Date.now()
    setStartedAt(start)
    setElapsed(Date.now() - start)
    setIsResume(resuming)

    if (!resuming) {
      saveTimerSession(buildSessionRef.current(start))
      onStartRef.current?.()
    }

    const tick = () => setElapsed(Date.now() - start)
    intervalRef.current = setInterval(tick, 1000)

    // Resync on foreground — JS intervals drift or pause when backgrounded,
    // which is the normal case here (the user is in Zoom, or in a meeting
    // with the phone in a pocket).
    const appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") tick()
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      appStateSub.remove()
      setStartedAt(null)
      setElapsed(0)
      setIsResume(false)
    }
    // Stable primitives ONLY — see the ref block above for why.
  }, [active, sessionKey])

  const beginSave = useCallback(() => {
    if (savingRef.current) return false
    savingRef.current = true
    return true
  }, [])

  const endSave = useCallback(() => {
    savingRef.current = false
  }, [])

  return { startedAt, elapsed, isResume, beginSave, endSave }
}
```

- [ ] **Step 2: Verify it compiles before touching the caller**

Run: `npm run compile`

Expected: no errors. The hook is not yet imported anywhere.

- [ ] **Step 3: Rewire ExternalZoomTimerModal onto the hook**

In `app/components/ExternalZoomTimerModal.tsx`:

Delete the `startedAt` / `elapsed` / `intervalRef` / `savingRef` declarations (lines ~95-104, keep `saving` — it drives `canSave` and the button visuals) and the entire launch/timer `useEffect` (lines ~121-191). Replace with:

```ts
  const { startedAt, elapsed, beginSave, endSave } = useAttendanceTimer({
    active: visible && !!meetingId && !!meetingUrl,
    sessionKey: meetingId ?? "",
    // A persisted session belongs to this timer only when BOTH the id and the
    // url match — the url is part of the identity because the same meeting id
    // can be re-joined through a different link.
    matchesPersisted: (s) =>
      sessionSource(s) === "external-zoom" &&
      s.meetingId === meetingId &&
      s.meetingUrl === meetingUrl,
    buildSession: (start) => ({
      startedAt: start,
      uid,
      meetingId: meetingId!,
      meetingName: meetingName ?? "",
      meetingUrl,
      source: "external-zoom",
    }),
    onStart: () => {
      log.info("Timer started, launching external Zoom", { mid: meetingId, url: meetingUrl })
      // Fire and forget — failures surface in logs; the timer still runs so
      // the user can retry opening Zoom manually if the first launch fails.
      // Defensive string guard: Linking.openURL throws SYNCHRONOUSLY (not as a
      // promise rejection) if the arg isn't a string, which would bypass the
      // .catch below.
      if (typeof meetingUrl === "string" && meetingUrl.length > 0) {
        Linking.openURL(meetingUrl).catch((err: unknown) => {
          log.error("Failed to launch external Zoom", { error: String(err) })
        })
      } else {
        log.warn("Timer started but meetingUrl is not a usable string", { mid: meetingId })
      }
    },
  })
```

Add the imports:

```ts
import { useAttendanceTimer } from "@/hooks/useAttendanceTimer"
import { sessionSource } from "@/services/attendance"
```

Note the `active` expression preserves the old effect's `if (!visible || !meetingId || !meetingUrl) return` guard — that is where the `!meetingUrl` early-return now lives, and it is correctly scoped to this modal rather than to the shared hook. An in-person session has no URL and must never be dropped by it.

- [ ] **Step 4: Replace the save lock in handleSave**

In `handleSave`, change the guard from the local ref to the hook's lock:

```ts
    if (!meeting || !startedAt) return
    if (!force && !canSave) return
    // Ref-backed lock inside the hook — blocks same-tick re-entries before
    // React has flushed the `saving` state update.
    if (!beginSave()) return
    setSaving(true)
```

and in the `finally`:

```ts
    } finally {
      endSave()
      setSaving(false)
    }
```

- [ ] **Step 5: Verify types and lint**

Run: `npm run compile && npx eslint app/hooks/useAttendanceTimer.ts app/components/ExternalZoomTimerModal.tsx`

Expected: both clean.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: same pass counts as before. No test covers this file — Task 12's manual Zoom checklist is the real gate, and it is mandatory.

- [ ] **Step 7: Stage and commit**

```bash
git add app/hooks/useAttendanceTimer.ts app/components/ExternalZoomTimerModal.tsx
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
♻️ refactor(attendance): extract useAttendanceTimer from the Zoom timer modal

- Clock, AppState foreground resync, MMKV persist/resume, and the
  synchronous save lock now live in one hook
- Callbacks held in refs so the effect depends only on stable primitives —
  preserves the fix that stopped the timer resetting on every parent render
- ExternalZoomTimerModal keeps its own !meetingUrl guard; the hook stays
  source-agnostic so an in-person session (no URL) isn't dropped
- No behavior change

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 4: Extract the shared topic panel

**Files:**
- Create: `app/hooks/useTopicPanel.ts`
- Create: `app/components/TopicPanelOverlay.tsx`
- Modify: `app/components/SchedulePopup.tsx` (topic state ~lines 170-224, the `processed` branch of the attendance subscription ~lines 298-317, `handleTopicSave` / `handleTopicSkip` ~lines 565-630, the card's animated style ~lines 650-672, the overlay render ~lines 870-905)

**Interfaces:**
- Consumes: `TopicPromptContent` from `@/components/TopicPromptContent` — props `{ active, meetingName?, includeHost?, onSave: (r: { topic: string; host?: string }) => void, onSkip: () => void }`. `attendanceRepo`, `attendanceEvents` from `@/db`. `useProfileStore` from `@/models`.
- Produces: `useTopicPanel(options): { topicActive, cardAnimatedStyle, onCardLayout, panelProps }` and `<TopicPanelOverlay />` — consumed by Task 10.

**Read `SchedulePopup.tsx:565-600` before starting.** The `dismissKeyboardAndSettle()` call before `setTopicActive(false)` is the whole reason this extraction is worth doing; its comment explains the `EXC_BAD_ACCESS` crash it prevents. That comment moves with the code.

- [ ] **Step 1: Write the overlay component**

Create `app/components/TopicPanelOverlay.tsx`:

```tsx
/**
 * TopicPanelOverlay
 *
 * The slide-up panel that captures a meeting topic (and host) after
 * attendance is recorded. Rendered INSIDE the host popup's card — NOT as its
 * own RN Modal — because presenting a second native modal while another is
 * mid-dismiss is silently refused by iOS. That is the race that killed the
 * original standalone TopicPromptModal.
 *
 * EXTRACTED 2026-08-05 from SchedulePopup so the in-person popup can render
 * the identical panel instead of a second hand-written copy. All state and
 * animation lives in useTopicPanel; this is the render half only.
 */

import { FC } from "react"
import { Animated, ViewStyle } from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"

import { TopicPromptContent } from "@/components/TopicPromptContent"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export interface TopicPanelOverlayProps {
  active: boolean
  meetingName?: string
  includeHost: boolean
  /** Native-driver translate + opacity driver, produced by useTopicPanel. */
  progress: Animated.Value
  /** Host card height, measured by useTopicPanel's onCardLayout. */
  contentHeight: number
  onSave: (result: { topic: string; host?: string }) => void
  onSkip: () => void
}

export const TopicPanelOverlay: FC<TopicPanelOverlayProps> = ({
  active,
  meetingName,
  includeHost,
  progress,
  contentHeight,
  onSave,
  onSkip,
}) => {
  const { themed } = useAppTheme()

  return (
    <Animated.View
      pointerEvents={active ? "auto" : "none"}
      style={[
        themed($topicOverlay),
        {
          opacity: progress,
          // Until the host card has been measured, park the panel far
          // off-screen rather than at translateY 0 — otherwise it flashes
          // over the card on the first frame.
          transform:
            contentHeight > 0
              ? [
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [contentHeight, 0],
                    }),
                  },
                ]
              : [{ translateY: 9999 }],
        },
      ]}
    >
      <KeyboardAvoidingView
        style={themed($topicKeyboardAvoider)}
        // `padding` on BOTH platforms. This was conditional on Platform.OS
        // with "height" on Android, which double-resized against the OS and
        // against the parent's layout animation. The keyboard-controller KAV
        // normalizes via the native KeyboardEvent stream, so padding is
        // correct everywhere.
        behavior="padding"
      >
        <TopicPromptContent
          active={active}
          meetingName={meetingName}
          includeHost={includeHost}
          onSave={onSave}
          onSkip={onSkip}
        />
      </KeyboardAvoidingView>
    </Animated.View>
  )
}

const $topicOverlay: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  position: "absolute",
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  backgroundColor: colors.background,
  paddingHorizontal: spacing.md,
  paddingTop: spacing.md,
})

const $topicKeyboardAvoider: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
})
```

Before writing the two style functions above, open `SchedulePopup.tsx:979` and copy `$topicOverlay` verbatim (and `$topicKeyboardAvoider` if it exists there) rather than using the values shown here — the versions above are structurally right but the real ones are authoritative. Delete them from `SchedulePopup` once moved.

- [ ] **Step 2: Write the hook**

Create `app/hooks/useTopicPanel.ts`:

```ts
/**
 * useTopicPanel — state, animation, and persistence for the post-attendance
 * topic/host panel.
 *
 * EXTRACTED 2026-08-05 from SchedulePopup so InPersonPopup renders the same
 * panel rather than a second copy. The extraction is worth doing for exactly
 * one reason: dismissKeyboardAndSettle() below. A hand-written second copy
 * would have to independently remember to serialize keyboard-hide before
 * slide-out, and forgetting is a native crash, not a visual glitch.
 *
 * What deliberately does NOT live here: the "acknowledged" subscription and
 * the confirmation UI it drives. SchedulePopup shows an animated banner,
 * InPersonPopup shows a toast — genuinely different, and each popup keeps its
 * own.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Dimensions, Easing, LayoutChangeEvent, ViewStyle } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"

import type { TopicPanelOverlayProps } from "@/components/TopicPanelOverlay"
import { attendanceEvents, attendanceRepo } from "@/db"
import { useProfileStore } from "@/models"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useTopicPanel" })

/**
 * Dismiss the keyboard and wait for it to fully settle, capped at 400 ms
 * (> iOS's ~250 ms hide animation) so we never hang if the event doesn't fire.
 *
 * MUST run before the panel slides out. Without it, three layout systems
 * mutate the same subtree on one frame — keyboard-controller's Reanimated
 * KeyboardAvoidingView animating off the keyboard-height shared value, the
 * translateY/cardExpansion tween, and the topicActive reconcile — and
 * Reanimated's per-frame shadow-tree clone reads a prop map the others just
 * freed. Result: EXC_BAD_ACCESS in folly::dynamic::hash
 * (cloneShadowTreeWithNewPropsRecursive). Serializing hide → slide is the fix.
 */
async function dismissKeyboardAndSettle(): Promise<void> {
  await Promise.race([
    KeyboardController.dismiss(),
    new Promise<void>((resolve) => setTimeout(resolve, 400)),
  ])
}

export interface UseTopicPanelOptions {
  /** The host popup is open. */
  visible: boolean
  meetingId?: string
  meetingName?: string
  /** Also prompt for a host. True for both callers today. */
  includeHost: boolean
}

export interface UseTopicPanelResult {
  topicActive: boolean
  /** Spread onto the host popup's own Animated.View card. */
  cardAnimatedStyle: Animated.WithAnimatedObject<ViewStyle>
  /** Pass as the host card's onLayout — measures the panel's slide distance. */
  onCardLayout: (event: LayoutChangeEvent) => void
  /** Spread onto <TopicPanelOverlay />. */
  panelProps: TopicPanelOverlayProps
}

export function useTopicPanel(options: UseTopicPanelOptions): UseTopicPanelResult {
  const { visible, meetingId, meetingName, includeHost } = options
  const profileStore = useProfileStore()

  const [topicActive, setTopicActive] = useState(false)
  const topicContextRef = useRef<{ attendanceId: string; mid: string } | null>(null)
  const [contentHeight, setContentHeight] = useState(0)

  // Panel slide + fade. Native driver: transform and opacity only.
  const topicProgress = useRef(new Animated.Value(0)).current

  // Separate driver for the HOST CARD's expansion: when the panel is active
  // the card grows to full screen so the editor gets the whole canvas. This
  // one is useNativeDriver:false because minHeight/maxHeight/borderRadius are
  // layout props and are not native-drivable. This is the one piece that
  // cannot be encapsulated in the overlay component — a child cannot restyle
  // its parent — which is why the hook hands the style back out.
  const cardExpansion = useRef(new Animated.Value(0)).current
  const screenHeight = useMemo(() => Dimensions.get("window").height, [])

  useEffect(() => {
    Animated.parallel([
      Animated.timing(topicProgress, {
        toValue: topicActive ? 1 : 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardExpansion, {
        toValue: topicActive ? 1 : 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start()
  }, [topicActive, topicProgress, cardExpansion])

  // Reset each time a fresh popup opens or the meeting changes. Without this,
  // a prior meeting's pending context bleeds into the next one.
  useEffect(() => {
    if (visible) {
      setTopicActive(false)
      topicContextRef.current = null
      topicProgress.setValue(0)
      cardExpansion.setValue(0)
    }
  }, [visible, meetingId, topicProgress, cardExpansion])

  // On a valid "processed" event for this meeting: slide the panel in when
  // topic capture is on, otherwise emit "acknowledged" immediately so the
  // host popup's confirmation UI fires without waiting on a panel that will
  // never appear.
  useEffect(() => {
    if (!visible || !meetingId) return

    const unsub = attendanceEvents.subscribe((event) => {
      if (event.mid !== meetingId) return
      if (event.type !== "processed" || !event.valid) return

      if (profileStore.enableMeetingTopic) {
        topicContextRef.current = { attendanceId: event.id, mid: event.mid }
        setTopicActive(true)
      } else {
        attendanceEvents.emit({
          type: "acknowledged",
          id: event.id,
          mid: event.mid,
          valid: true,
        })
      }
    })

    return unsub
  }, [visible, meetingId, profileStore])

  const handleTopicSave = useCallback(async ({ topic, host }: { topic: string; host?: string }) => {
    const pending = topicContextRef.current
    if (!pending) return
    topicContextRef.current = null

    // Keyboard first, THEN the slide — see dismissKeyboardAndSettle's comment.
    await dismissKeyboardAndSettle()
    setTopicActive(false)

    try {
      const result = await attendanceRepo.update(pending.attendanceId, {
        meetingTopic: topic,
        ...(host ? { meetingHost: host } : {}),
      })
      if (!result.ok) {
        log.error("Failed to persist meeting topic/host", { attendanceId: pending.attendanceId })
      } else {
        log.info("Meeting topic saved", { attendanceId: pending.attendanceId, hasHost: !!host })
      }
    } catch (err) {
      log.error("Failed to persist meeting topic/host", {
        attendanceId: pending.attendanceId,
        error: String(err),
      })
    }

    // Emitted even when the update failed: the attendance record itself is
    // already durable, and holding the user's confirmation hostage to an
    // optional field would make a saved meeting look unsaved.
    attendanceEvents.emit({
      type: "acknowledged",
      id: pending.attendanceId,
      mid: pending.mid,
      valid: true,
    })
  }, [])

  const handleTopicSkip = useCallback(async () => {
    const pending = topicContextRef.current
    topicContextRef.current = null
    // Same teardown ordering as handleTopicSave, same crash avoided.
    await dismissKeyboardAndSettle()
    setTopicActive(false)
    if (pending) {
      attendanceEvents.emit({
        type: "acknowledged",
        id: pending.attendanceId,
        mid: pending.mid,
        valid: true,
      })
    }
  }, [])

  const cardAnimatedStyle = useMemo(
    () => ({
      minHeight: cardExpansion.interpolate({
        inputRange: [0, 1],
        outputRange: [0, screenHeight],
      }),
      maxHeight: cardExpansion.interpolate({
        inputRange: [0, 1],
        outputRange: [screenHeight * 0.85, screenHeight],
      }),
      borderTopLeftRadius: cardExpansion.interpolate({
        inputRange: [0, 1],
        outputRange: [20, 0],
      }),
      borderTopRightRadius: cardExpansion.interpolate({
        inputRange: [0, 1],
        outputRange: [20, 0],
      }),
    }),
    [cardExpansion, screenHeight],
  )

  const onCardLayout = useCallback((event: LayoutChangeEvent) => {
    setContentHeight(event.nativeEvent.layout.height)
  }, [])

  return {
    topicActive,
    cardAnimatedStyle,
    onCardLayout,
    panelProps: {
      active: topicActive,
      meetingName,
      includeHost,
      progress: topicProgress,
      contentHeight,
      onSave: handleTopicSave,
      onSkip: handleTopicSkip,
    },
  }
}
```

- [ ] **Step 3: Rewire SchedulePopup onto the hook**

In `app/components/SchedulePopup.tsx`:

1. Delete `topicActive`, `topicContextRef`, `attendanceSourceRef`, `topicProgress`, `contentHeight`, `cardExpansion`, `screenHeight`, the parallel-animation effect, and the reset effect (~lines 170-224).
2. Delete the module-level `dismissKeyboardAndSettle` (~lines 92-97) — it now lives in the hook.
3. Delete `handleTopicSave` and `handleTopicSkip` (~lines 565-630).
4. In the attendance subscription (~lines 298-317), delete the entire `if (event.type === "processed" && event.valid) { ... return }` block. **Keep** the `"acknowledged"` branch and its banner animation — that stays in this component.
5. Delete the `$topicOverlay` / `$topicKeyboardAvoider` styles (they moved to the overlay component).
6. Delete `attendanceSourceRef.current = "external"` in `proceedExternalJoin` (~line 508). Its comment explains it tagged the source so the topic panel would show the host field; append a `CHANGED 2026-08-05:` note where the assignment was, recording that `includeHost` is now a static prop because both callers want the host.
7. Add the hook call near the other state:

```ts
  const {
    topicActive: _topicActive,
    cardAnimatedStyle,
    onCardLayout,
    panelProps,
  } = useTopicPanel({
    visible,
    meetingId: meeting?.id,
    meetingName: meeting?.name,
    // Always true: the external-Zoom path has no SDK-side host capture, so the
    // user is the only source for it. Replaces the old attendanceSourceRef
    // check, which could only ever be "external" after the 4.5.0 SDK removal.
    includeHost: true,
  })
```

`topicActive` is unused in this component (the overlay consumes it via `panelProps`), so it is destructured with a `_` prefix per the repo's unused-variable convention.

8. Replace the card's inline interpolations (~lines 650-672) with the spread, and its `onLayout` with the hook's:

```tsx
        <Animated.View
          style={[themed($content), cardAnimatedStyle]}
          accessibilityViewIsModal
          onLayout={onCardLayout}
        >
```

9. Replace the overlay render block (~lines 870-905) with:

```tsx
          <TopicPanelOverlay {...panelProps} />
```

10. Add imports:

```ts
import { TopicPanelOverlay } from "@/components/TopicPanelOverlay"
import { useTopicPanel } from "@/hooks/useTopicPanel"
```

and remove any now-unused imports (`Easing`, `Dimensions`, `KeyboardController`, `KeyboardAvoidingView`, `TopicPromptContent`) — `npm run compile` and eslint will name them.

- [ ] **Step 4: Verify types and lint**

Run: `npm run compile && npx eslint app/hooks/useTopicPanel.ts app/components/TopicPanelOverlay.tsx app/components/SchedulePopup.tsx`

Expected: both clean.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: same pass counts as before.

- [ ] **Step 6: Stage and commit**

```bash
git add app/hooks/useTopicPanel.ts app/components/TopicPanelOverlay.tsx app/components/SchedulePopup.tsx
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
♻️ refactor(attendance): extract the topic/host panel for reuse

- useTopicPanel owns the state, both animation drivers, the "processed"
  subscription, and the save/skip handlers
- TopicPanelOverlay owns the render; SchedulePopup keeps its own
  "acknowledged" banner
- dismissKeyboardAndSettle moves into the hook so the second consumer cannot
  forget it — omitting it is a native crash, not a glitch
- includeHost is now a prop; attendanceSourceRef removed
- No behavior change

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 5: Server-tunable presence radius

**Files:**
- Modify: `app/models/ConfigStore.ts` (props block ~line 60, `fetchConfig` mapping ~line 133)
- Modify: `app/services/api/index.ts:865-902` (both the return type and the `.get<>` type argument)

**Interfaces:**
- Consumes: `DEFAULT_PRESENCE_RADIUS_M` from `@/utils/presenceLogic` (Task 1).
- Produces: `configStore.presenceRadiusM: number` — consumed by Task 6.

- [ ] **Step 1: Add the field to the API response type**

In `app/services/api/index.ts`, add `PRESENCE_RADIUS_M?: number` to **both** type literals in `getConfig` — the `kind: "ok"` return shape (~line 881, after `LATEST_VERSION?: string`) and the `this.recoverySkyApi.get<{...}>("/config")` type argument (~line 902). Missing either one leaves the field typed as absent at one end.

- [ ] **Step 2: Add the store prop**

In `app/models/ConfigStore.ts`, add to `.props({...})` immediately after `latestVersion`:

```ts
    /**
     * Radius in meters within which a user counts as present at an in-person
     * meeting. Server-tunable so the threshold can be corrected without
     * shipping a build — see docs/superpowers/specs/2026-08-05-gps-in-person-
     * attendance-design.md for why 150 m.
     *
     * Not persisted to MMKV (no ConfigStore field is). The hardcoded default
     * therefore applies until /config resolves, which is harmless: it IS the
     * intended value, so a user who taps "I'm Here" during a cold start is
     * checked against exactly the right radius.
     */
    presenceRadiusM: types.optional(types.number, DEFAULT_PRESENCE_RADIUS_M),
```

Add the import at the top:

```ts
import { DEFAULT_PRESENCE_RADIUS_M } from "@/utils/presenceLogic"
```

- [ ] **Step 3: Map the server value**

In `fetchConfig`, immediately after the `LATEST_VERSION` line:

```ts
              // Guarded on > 0: a server sending 0 (or a malformed value that
              // coerces to it) would make every check fail with "you are 3 m
              // away, you must be within 0 m" — an unfixable-from-the-client
              // outage of the whole feature. Falling back to the default is
              // the safe failure.
              if (config.PRESENCE_RADIUS_M && config.PRESENCE_RADIUS_M > 0)
                store.presenceRadiusM = config.PRESENCE_RADIUS_M
```

- [ ] **Step 4: Verify types and lint**

Run: `npm run compile && npx eslint app/models/ConfigStore.ts app/services/api/index.ts`

Expected: both clean.

- [ ] **Step 5: Stage and commit**

```bash
git add app/models/ConfigStore.ts app/services/api/index.ts
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
✨ feat(config): add server-tunable presence radius

- configStore.presenceRadiusM, default 150 m from DEFAULT_PRESENCE_RADIUS_M
- Mapped from /config PRESENCE_RADIUS_M, guarded on > 0 so a bad server
  value can't silently disable in-person attendance for everyone

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 6: The presence check hook

**Files:**
- Create: `app/hooks/usePresenceCheck.ts`

**Interfaces:**
- Consumes: `verifyPresence`, `PresenceFix`, `PresenceVenue` from `@/utils/presenceLogic` (Task 1); `configStore.presenceRadiusM` (Task 5).
- Produces: `usePresenceCheck(): { check: (venue: PresenceVenue) => Promise<PresenceCheckOutcome>; isChecking: boolean }` and the `PresenceCheckOutcome` union — consumed by Task 10.

**Read `app/hooks/useNearbySchedules.ts:263-369` first.** This hook is deliberately *not* a copy of `acquireLocation`; the differences below are the whole point and each one is load-bearing.

- [ ] **Step 1: Write the hook**

Create `app/hooks/usePresenceCheck.ts`:

```ts
/**
 * usePresenceCheck — the I/O half of GPS-verified in-person attendance.
 *
 * Requests foreground location permission, takes ONE fresh high-accuracy fix,
 * and hands it to the pure `verifyPresence`. Never throws: every failure is a
 * discriminated outcome the caller renders.
 *
 * PRIVACY: the fix lives in a local const for the duration of the call and
 * leaves this hook only inside a `verified` outcome. It never enters React
 * state, and NOTHING here logs the fix or the distance — "43 m from meeting X"
 * is a location disclosure, and our logs ship to Loki. Log outcomes only.
 *
 * Not unit-testable: it imports `@/`, which vitest cannot resolve (see
 * CLAUDE.md "Test Runner Split"). That is exactly why the decision lives in
 * the pure, vitest-covered presenceLogic.ts — do not re-derive any of it here.
 */

import { useCallback, useRef, useState } from "react"
import { Platform } from "react-native"
import * as Location from "expo-location"

import { useConfigStore } from "@/models"
import { logger } from "@/utils/logger"
import { verifyPresence, type PresenceFix, type PresenceVenue } from "@/utils/presenceLogic"

const log = logger.child({ module: "usePresenceCheck" })

/**
 * Budget for the fix. Same platform split, and the same reason, as
 * useNearbySchedules.FIX_TIMEOUT_MS: Android's fused provider routinely needs
 * far longer than iOS for a first fresh fix on a cold process indoors, and
 * every in-person meeting is indoors.
 */
const PRESENCE_FIX_TIMEOUT_MS = Platform.OS === "android" ? 20_000 : 10_000

export type PresenceCheckOutcome =
  | { status: "verified"; fix: PresenceFix; distanceM: number; radiusM: number }
  | { status: "out-of-range"; distanceM: number; radiusM: number }
  | { status: "no-venue-coords" }
  | { status: "denied"; canAskAgain: boolean }
  | { status: "fix-failed" }

export interface UsePresenceCheckResult {
  check: (venue: PresenceVenue) => Promise<PresenceCheckOutcome>
  isChecking: boolean
}

export function usePresenceCheck(): UsePresenceCheckResult {
  const configStore = useConfigStore()
  const [isChecking, setIsChecking] = useState(false)

  /**
   * Synchronous in-flight guard. `isChecking` is for the button's visuals;
   * React state is not synchronous, so two taps in the same tick would both
   * read `isChecking === false` and start two permission prompts. Same
   * pattern, same reason, as the save lock in useAttendanceTimer.
   */
  const checkingRef = useRef(false)

  const radiusM = configStore.presenceRadiusM

  const check = useCallback(
    async (venue: PresenceVenue): Promise<PresenceCheckOutcome> => {
      if (checkingRef.current) return { status: "fix-failed" }
      checkingRef.current = true
      setIsChecking(true)

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined

      try {
        // Lazy permission: this runs on the "I'm Here" tap and nowhere else.
        // A user who never marks themselves present is never asked.
        const perm = await Location.requestForegroundPermissionsAsync()
        if (!perm.granted) {
          log.info("Presence check denied", { canAskAgain: perm.canAskAgain })
          return { status: "denied", canAskAgain: perm.canAskAgain }
        }

        // ONE fresh fix. Deliberately NOT seeded from
        // getLastKnownPositionAsync, which useNearbySchedules does use and is
        // right to — a stale position cannot change which meetings fall inside
        // a 10 km radius. Here a cached position is a verification hole: it
        // could be the user's living room from twenty minutes ago. A presence
        // gate must use a position taken now.
        //
        // Accuracy.Highest, not Balanced: Balanced was chosen in
        // useNearbySchedules for a 10 km filter. 150 m is two orders of
        // magnitude tighter and needs the better fix.
        const position = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error("presence fix timeout")),
              PRESENCE_FIX_TIMEOUT_MS,
            )
          }),
        ])

        const fix: PresenceFix = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          // Nullable on some Android providers; undefined is correct and the
          // record simply omits it.
          accuracyM: position.coords.accuracy ?? undefined,
        }

        const result = verifyPresence({ fix, venue, radiusM })

        // PRIVACY: reason only. Never the distance, never the fix.
        log.info("Presence check complete", { reason: result.reason })

        if (result.reason === "no-venue-coords") return { status: "no-venue-coords" }
        if (!result.inRange) {
          return { status: "out-of-range", distanceM: result.distanceM!, radiusM }
        }
        return { status: "verified", fix, distanceM: result.distanceM!, radiusM }
      } catch (err) {
        // PRIVACY: String(err) yields "Name: message" only — an Error's
        // toString never carries a position or a request config, so this
        // cannot leak what we just asked for. Do not log the error object.
        log.warn("Presence fix failed", { error: String(err) })
        return { status: "fix-failed" }
      } finally {
        // Cleared on BOTH outcomes of the race. A dangling handle keeps a
        // timer (and this closure) alive after a fast fix and later fires a
        // rejection nobody is listening to.
        if (timeoutHandle) clearTimeout(timeoutHandle)
        checkingRef.current = false
        setIsChecking(false)
      }
    },
    [radiusM],
  )

  return { check, isChecking }
}
```

The two `result.distanceM!` assertions are safe and deliberate: `verifyPresence` returns `distanceM: undefined` **only** on the `no-venue-coords` branch, which has already returned above. Task 1's test `"reports no-venue-coords for a null-island venue"` pins that invariant.

- [ ] **Step 2: Verify types and lint**

Run: `npm run compile && npx eslint app/hooks/usePresenceCheck.ts`

Expected: both clean.

- [ ] **Step 3: Stage and commit**

```bash
git add app/hooks/usePresenceCheck.ts
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
✨ feat(inperson): add the presence check hook

- Lazy foreground permission, one fresh Accuracy.Highest fix, verifyPresence
- Never seeds from the OS cached position: a stale fix is a verification hole
- Never throws; every failure is a discriminated outcome
- Logs the reason only, never the fix or the distance

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 7: Translation keys in nine locales

**Files:**
- Modify: `app/i18n/en.ts`, `app/i18n/es.ts`, `app/i18n/ar.ts`, `app/i18n/de.ts`, `app/i18n/fr.ts`, `app/i18n/pt.ts`, `app/i18n/ru.ts`, `app/i18n/th.ts`, `app/i18n/uk.ts`

**Interfaces:**
- Produces: the `presence` and `inPersonTimer` namespaces — consumed by Tasks 9 and 10.

`en.ts` declares `export type Translations = typeof en` and the other eight files are typed `const xx: Translations`. A key present in `en.ts` and missing anywhere else is a **hard tsc error**, so all nine files change together or the build breaks.

- [ ] **Step 1: Add the English source**

In `app/i18n/en.ts`, insert two new namespaces immediately after the `inPersonPopup` block (which ends around line 839, before `inPersonScreen`):

```ts
  presence: {
    // {{distance}} and {{radius}} arrive pre-formatted by formatDistance()
    // (locale-aware miles vs km) — do NOT append a unit in the string.
    outOfRangeTitle: "You're not there yet",
    outOfRangeMessage:
      "You're about {{distance}} from this meeting. Get within {{radius}} to record your attendance.",
    noVenueCoordsTitle: "Can't verify this location",
    noVenueCoordsMessage:
      "We don't have a precise location for this meeting, so we can't confirm you're here.",
    deniedTitle: "Location needed",
    deniedMessage:
      "Recording in-person attendance needs your location to confirm you're at the meeting.",
    openSettings: "Open Settings",
    fixFailedTitle: "Couldn't find you",
    fixFailedMessage: "We couldn't get your location. Step outside or try again in a moment.",
    checking: "Checking…",
  },
  inPersonTimer: {
    title: "Attendance Timer",
    hint: "End the timer when your meeting finishes. Save requires at least {{minutes}} min.",
  },
```

- [ ] **Step 2: Translate into the other eight locales**

For each of `es`, `ar`, `de`, `fr`, `pt`, `ru`, `th`, `uk`, add both namespaces at the position matching `en.ts` (after that file's `inPersonPopup` block), translating the eleven English strings above.

Rules:

- **Preserve every interpolation token verbatim**: `{{distance}}`, `{{radius}}`, `{{minutes}}`. A translated or reordered token silently renders as literal text.
- **Never append a unit** to `{{distance}}` / `{{radius}}` — `formatDistance()` already produced `"3 mi"` or `"250 m"`.
- Match each file's existing register and formality. Read that file's `inPersonPopup` and `externalZoomTimer` blocks first; `externalZoomTimer.hint` is the closest existing analogue to `inPersonTimer.hint` and already solves the `{{minutes}}` phrasing in every language.
- `ar.ts` is RTL — no markup or directional characters are needed, the layout handles it, but keep the token order natural for Arabic rather than mirroring English word order.
- These are best-effort machine translations, flagged for native-speaker review in Task 12. Do not leave English text in a non-English file — an untranslated string looks like a bug to a user, whereas an imperfect translation reads as a rough edge.

- [ ] **Step 3: Verify all nine files agree**

Run: `npm run compile`

Expected: no errors. A missing key names the exact file and key. Do not silence it with a cast — add the key.

- [ ] **Step 4: Lint the nine files**

Run: `npx eslint app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts`

Expected: clean.

- [ ] **Step 5: Stage and commit**

```bash
git add app/i18n/
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
🌐 feat(i18n): add presence + in-person timer strings in nine locales

- New `presence` namespace: out-of-range, no-coords, denied, fix-failed,
  checking
- New `inPersonTimer` namespace: title + credit-floor hint
- Non-English are best-effort and queued for native-speaker review

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 8: The in-person timer attendance service

**Files:**
- Create: `app/services/inPerson/timerAttendance.ts`

**Interfaces:**
- Consumes: `attendanceRepo`, `attendanceEvents`, `AttendanceEvent` from `@/db`; `meetingEvents` from `@/db/meetingEvents`; `EXTERNAL_MIN_CREDIT_MS` from `@/services/zoom`; `PersistedPresence` from `@/services/attendance` (Task 2).
- Produces: `saveInPersonTimerAttendance(input: InPersonTimerAttendanceInput): Promise<InPersonTimerAttendanceResult>` — consumed by Task 9.

Model this on `app/services/zoom/externalAttendance.ts`, which is the same shape: create → events → `markProcessed` with retry → `attendanceEvents` → `meetingEvents`. Read it before starting.

- [ ] **Step 1: Write the service**

Create `app/services/inPerson/timerAttendance.ts`:

```ts
/**
 * In-Person Timer Attendance
 *
 * Writes attendance records for face-to-face meetings, from a GPS-verified
 * timer session. Directly modeled on app/services/zoom/externalAttendance.ts
 * (same create → events → markProcessed-with-retry → meetingEvents sequence);
 * see that file for the timer-vs-SDK precedent this pattern originates from.
 *
 * REPLACES saveInPersonAttendance (deleted 2026-08-05), which wrote a finished
 * record from a single tap using the meeting's scheduled duration. Attendance
 * is now real elapsed time, gated at the start on the user actually being at
 * the venue.
 *
 * PRIVACY: the verified fix IS written here, into the record's event JSON, and
 * syncs to the server with the record. That is a deliberate, documented
 * amendment to the coordinates-never-persist rule — see the spec's "Privacy
 * policy amendment". Nothing in this file LOGS the fix or the distance.
 */

import * as Crypto from "expo-crypto"

import { attendanceRepo, attendanceEvents, type AttendanceEvent } from "@/db"
import { meetingEvents } from "@/db/meetingEvents"
import type { PersistedPresence } from "@/services/attendance"
import { EXTERNAL_MIN_CREDIT_MS } from "@/services/zoom"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "InPersonTimerAttendance" })

const SOURCE = { source: "in-person" }

export interface InPersonTimerAttendanceInput {
  uid: string
  mid: string
  zid: string
  meetingName: string
  startedAt: number
  endedAt: number
  presence: PersistedPresence
}

export interface InPersonTimerAttendanceResult {
  ok: boolean
  attendanceId?: string
  valid?: boolean
  creditMs?: number
}

/**
 * The event trail for a verified in-person session.
 *
 * The opening event carries the proof: where the user was, how accurate the
 * fix was, how far from the venue, and the radius in force at the time.
 * `radiusM` is recorded deliberately — a year from now you can tell whether a
 * record was verified under a 150 m rule or a retuned one without having to
 * correlate against server config history.
 */
function buildInPersonEvents(
  startedAt: number,
  endedAt: number,
  presence: PersistedPresence,
): AttendanceEvent[] {
  return [
    {
      timestamp: startedAt,
      message: "Verified present at in-person meeting",
      json: JSON.stringify({ ...SOURCE, verified: true, ...presence }),
    },
    {
      timestamp: endedAt,
      message: "Timer saved",
      json: JSON.stringify({ ...SOURCE, durationMs: endedAt - startedAt }),
    },
  ]
}

export async function saveInPersonTimerAttendance(
  input: InPersonTimerAttendanceInput,
): Promise<InPersonTimerAttendanceResult> {
  const credit = input.endedAt - input.startedAt
  const valid = credit >= EXTERNAL_MIN_CREDIT_MS
  const attendanceId = Crypto.randomUUID()

  // PRIVACY: mid/zid/credit only. Never spread `input` — it carries the fix.
  log.info("Saving in-person timer attendance", {
    attendanceId,
    mid: input.mid,
    zid: input.zid,
    creditMs: credit,
    valid,
  })

  const createResult = await attendanceRepo.create({
    id: attendanceId,
    uid: input.uid,
    mid: input.mid,
    zid: input.zid,
    meetingName: input.meetingName,
    created: input.startedAt,
    events: buildInPersonEvents(input.startedAt, input.endedAt, input.presence),
  })

  if (!createResult.ok) {
    log.error("In-person attendance create failed", { attendanceId, mid: input.mid })
    return { ok: false }
  }

  attendanceEvents.emit({ type: "created", id: attendanceId })

  // Retry markProcessed with exponential backoff. Without this, a transient DB
  // error (lock contention, brief I/O stall) between `create` and
  // `markProcessed` leaves an orphaned unprocessed record the user can neither
  // see nor recover. Retries keep the two phases paired in the common failure
  // modes; the final failure still surfaces for callers to act on.
  const MARK_PROCESSED_RETRIES = 3
  const MARK_PROCESSED_BACKOFF_MS = [500, 1500, 4500]
  const processArgs = { start: input.startedAt, end: input.endedAt, credit, valid }

  let processResult = await attendanceRepo.markProcessed(attendanceId, processArgs)

  for (let attempt = 0; !processResult.ok && attempt < MARK_PROCESSED_RETRIES; attempt++) {
    const delay = MARK_PROCESSED_BACKOFF_MS[attempt]
    log.warn("In-person attendance markProcessed failed, retrying", {
      attendanceId,
      mid: input.mid,
      attempt: attempt + 1,
      delayMs: delay,
    })
    await new Promise<void>((resolve) => setTimeout(resolve, delay))
    processResult = await attendanceRepo.markProcessed(attendanceId, processArgs)
  }

  if (!processResult.ok) {
    log.error("In-person attendance markProcessed failed after retries", {
      attendanceId,
      mid: input.mid,
      attempts: MARK_PROCESSED_RETRIES + 1,
    })
    return { ok: false, attendanceId }
  }

  log.info("In-person timer attendance saved", {
    attendanceId,
    mid: input.mid,
    valid,
    creditMs: credit,
  })
  attendanceEvents.emit({
    type: "processed",
    id: attendanceId,
    mid: input.mid,
    valid,
    source: "in-person",
  })

  // Rating-engine tally, gated on `valid` exactly as the external-Zoom path is:
  // a save below the credit floor still creates a record (marked invalid) and
  // those must not count as "a meeting" to the rating system.
  //
  // CHANGED 2026-08-05: the deleted saveInPersonAttendance fired this
  // unconditionally, because presence was user-confirmed by a tap and there
  // was no elapsed time to judge. There is now, so in-person gates like
  // everything else.
  if (valid) {
    meetingEvents.completed("in-person")
  }

  return { ok: true, attendanceId, valid, creditMs: credit }
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npm run compile && npx eslint app/services/inPerson/timerAttendance.ts`

Expected: both clean. `app/services/inPerson/attendance.ts` still exists and still compiles at this point — it is deleted in Task 10, once its last caller is gone.

- [ ] **Step 3: Stage and commit**

```bash
git add app/services/inPerson/timerAttendance.ts
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
✨ feat(inperson): write attendance records from a verified timer session

- saveInPersonTimerAttendance mirrors the external-Zoom timer's write path
- Event JSON carries the proof: lat/lon, accuracy, distance, and the radius
  in force at verification time
- Credit floor and rating-engine gating now match the online path
- Nothing here logs the fix or the distance

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 9: The in-person timer modal

**Files:**
- Create: `app/components/InPersonTimerModal.tsx`

**Interfaces:**
- Consumes: `useAttendanceTimer` (Task 3); `saveInPersonTimerAttendance` (Task 8); `PersistedPresence`, `sessionSource`, `clearTimerSession`, `loadTimerSession` from `@/services/attendance` (Task 2); `EXTERNAL_MIN_CREDIT_MS` from `@/services/zoom`; the `inPersonTimer` and `externalZoomTimer` i18n namespaces (Task 7).
- Produces: `<InPersonTimerModal visible meeting presence onClose onSaved />` — consumed by Tasks 10 and 11.

Model the chrome on `ExternalZoomTimerModal.tsx:374-446` and reuse its style block verbatim — the two timers must be visually identical, because a user who has done both should not feel the layout shift. Copy the styles rather than importing them; `ExternalZoomTimerModal`'s are module-private and exporting them to share would couple the two files for no benefit.

**Deliberately omitted from this modal:** the 7-tap force-save shortcut (a Zoom-specific support escape hatch for sessions that fell through the SDK — there is no SDK here) and the external-Zoom launch. **Deliberately kept:** the long-attendance notice, which matters *more* here — an in-person user with the phone in a pocket is the likeliest person in the app to forget to end a timer.

- [ ] **Step 1: Write the modal**

Create `app/components/InPersonTimerModal.tsx`:

```tsx
/**
 * InPersonTimerModal
 *
 * Runs the attendance timer for a GPS-verified in-person meeting. Opened by
 * InPersonPopup only after usePresenceCheck returns `verified`, and by
 * TimerRecoveryGate when a persisted in-person session survives a cold start.
 *
 * Structurally identical to ExternalZoomTimerModal minus the launcher: there
 * is no app to open, so the timer simply starts. Both share useAttendanceTimer,
 * so the clock, foreground resync, persistence, resume, and save lock are one
 * implementation.
 *
 * Verification happens BEFORE this modal mounts and is never repeated at Save.
 * A user who ends a meeting in a basement with no signal must not be blocked
 * from recording time they already spent — see the spec's decision table.
 */

import { FC, useMemo, useState } from "react"
import { Alert, Modal, Pressable, StyleSheet, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useAuthenticationStore } from "@/models"
import { navigate } from "@/navigators/navigationUtilities"
import {
  clearTimerSession,
  loadTimerSession,
  sessionSource,
  type PersistedPresence,
} from "@/services/attendance"
import { saveInPersonTimerAttendance } from "@/services/inPerson/timerAttendance"
import { EXTERNAL_MIN_CREDIT_MS } from "@/services/zoom"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { useAttendanceTimer } from "@/hooks/useAttendanceTimer"
import { logger } from "@/utils/logger"
import { load, save } from "@/utils/storage"

const log = logger.child({ module: "InPersonTimerModal" })

// Shared with ExternalZoomTimerModal — same threshold, same MMKV flag, so a
// user who dismissed the notice on one path never sees it on the other.
const LONG_ATTENDANCE_NOTICE_MS = 2 * 60 * 60 * 1000
const LONG_ATTENDANCE_NOTICE_DISMISSED_KEY = "long-attendance-notice-dismissed-v1"

interface InPersonMeetingTarget {
  id: string
  name: string
  zid: string
}

interface InPersonTimerModalProps {
  visible: boolean
  meeting: InPersonMeetingTarget | null
  /** The verified fix from usePresenceCheck. Persisted so a cold start keeps it. */
  presence: PersistedPresence | null
  /** Fired for any dismissal — Save or Cancel. */
  onClose: () => void
  /** Fired only on a successful Save, so the parent can react to a real commit. */
  onSaved?: (attendanceId: string) => void
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export const InPersonTimerModal: FC<InPersonTimerModalProps> = ({
  visible,
  meeting,
  presence,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const authStore = useAuthenticationStore()

  const [saving, setSaving] = useState(false)

  const meetingId = meeting?.id
  const meetingName = meeting?.name
  const uid = authStore.userId || "anonymous"

  const { startedAt, elapsed, isResume, beginSave, endSave } = useAttendanceTimer({
    active: visible && !!meetingId && !!presence,
    sessionKey: meetingId ?? "",
    matchesPersisted: (s) => sessionSource(s) === "in-person" && s.meetingId === meetingId,
    buildSession: (start) => ({
      startedAt: start,
      uid,
      meetingId: meetingId!,
      meetingName: meetingName ?? "",
      source: "in-person",
      presence: presence!,
    }),
    // No onStart: nothing is launched. This is the only structural difference
    // from ExternalZoomTimerModal.
  })

  // ADDED 2026-08-05 (Task 3 review): mirror the Zoom modal's resume log. The
  // resume branch has no automated coverage and is the one documented in
  // TimerSessionResumer as having cost customers their attendance — without
  // this line, "we adopted the persisted session" is only provable from Loki
  // by its absence. Logged here rather than through a hook callback because a
  // callback would have to hand over the whole PersistedTimerSession, which
  // carries a `presence` GPS fix that must never reach Loki. Log scalars only.
  useEffect(() => {
    if (!isResume || !startedAt) return
    log.info("In-person timer resumed from persisted session", {
      mid: meetingId,
      startedAt,
      elapsedMs: Date.now() - startedAt,
    })
  }, [isResume, startedAt])

  const minMinutes = Math.ceil(EXTERNAL_MIN_CREDIT_MS / 60000)
  const canSave = elapsed >= EXTERNAL_MIN_CREDIT_MS && !saving

  const handleSave = async () => {
    if (!meeting || !startedAt || !canSave) return
    if (!beginSave()) return
    setSaving(true)

    const endedAt = Date.now()

    // The PERSISTED presence wins over the prop. On a recovered session the
    // prop is whatever TimerRecoveryGate reconstructed, but the persisted
    // block is the original verification taken at the venue — that is the one
    // the record must carry.
    const persisted = loadTimerSession()
    const verified = persisted?.presence ?? presence
    if (!verified) {
      // Cannot happen via either entry point (both require a verified fix),
      // but writing an unverified record would silently break the feature's
      // one promise, so refuse instead.
      log.error("In-person save reached with no verified presence", { mid: meeting.id })
      endSave()
      setSaving(false)
      onClose()
      return
    }

    // PRIVACY: mid + credit only. Never log `verified`.
    log.info("Saving in-person timer attendance", {
      mid: meeting.id,
      creditMs: endedAt - startedAt,
    })

    try {
      const result = await saveInPersonTimerAttendance({
        uid,
        mid: meeting.id,
        zid: meeting.zid,
        meetingName: meeting.name,
        startedAt,
        endedAt,
        presence: verified,
      })

      if (!result.ok) {
        log.error("In-person timer attendance save returned not ok", { mid: meeting.id })
        // Keep the persisted session so TimerSessionResumer can recover it on
        // the next cold start rather than silently dropping the attempt.
        onClose()
        return
      }

      clearTimerSession()

      // Heads-up for very long sessions — the user probably forgot to end the
      // timer. Non-blocking: the attendance is already saved, this just points
      // at the trim-down path. Shares the MMKV dismissed flag with the Zoom
      // timer's identical notice.
      const creditMs = endedAt - startedAt
      const dismissed = load<boolean>(LONG_ATTENDANCE_NOTICE_DISMISSED_KEY) === true
      if (creditMs > LONG_ATTENDANCE_NOTICE_MS && !dismissed) {
        Alert.alert(
          translate("externalZoomTimer:longAttendanceTitle"),
          translate("externalZoomTimer:longAttendanceMessage"),
          [
            { text: translate("common:ok"), style: "cancel" },
            {
              text: translate("externalZoomTimer:longAttendanceDontShow"),
              style: "destructive",
              onPress: () => save(LONG_ATTENDANCE_NOTICE_DISMISSED_KEY, true),
            },
            {
              text: translate("externalZoomTimer:longAttendanceGoTo"),
              onPress: () => navigate("Attendance", { section: "new" }),
            },
          ],
        )
      }

      if (result.attendanceId && onSaved) {
        onSaved(result.attendanceId)
      } else {
        onClose()
      }
    } catch (err) {
      // The timer modal must NEVER get stuck open. The record is written
      // before any event is emitted, so by the time anything downstream could
      // throw the attendance is already persisted — and even if the write
      // itself failed, trapping the user in a frozen modal is worse. An
      // un-cleared session is recoverable on the next launch.
      log.error("In-person timer save flow threw — closing modal defensively", {
        mid: meeting?.id,
        error: err instanceof Error ? err.message : String(err),
      })
      onClose()
    } finally {
      endSave()
      setSaving(false)
    }
  }

  const handleCancel = () => {
    // Below the credit floor there is nothing to lose — close immediately.
    if (elapsed < EXTERNAL_MIN_CREDIT_MS) {
      clearTimerSession()
      onClose()
      return
    }
    // Above it, an accidental dismissal would silently discard a saveable
    // session. Confirm first.
    Alert.alert(
      translate("externalZoomTimer:cancelTitle"),
      translate("externalZoomTimer:cancelMessage", { minutes: Math.floor(elapsed / 60000) }),
      [
        { text: translate("externalZoomTimer:keepRunning"), style: "cancel" },
        {
          text: translate("externalZoomTimer:save"),
          onPress: () => {
            void handleSave()
          },
        },
        {
          text: translate("externalZoomTimer:discard"),
          style: "destructive",
          onPress: () => {
            clearTimerSession()
            onClose()
          },
        },
      ],
    )
  }

  const formatted = useMemo(() => formatElapsed(elapsed), [elapsed])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent
    >
      <View style={themed($overlay)}>
        {/* Non-dismissible backdrop — a stray tap outside the card must not
            throw away an in-progress timer. Closing goes through the buttons
            or the hardware back button, which routes to handleCancel. */}
        <View style={themed($backdrop)} />

        <View style={themed($card)} accessibilityViewIsModal>
          <View style={themed($header)}>
            <Ionicons name="timer-outline" size={20} color={theme.colors.tint} />
            <Text style={themed($title)} tx="inPersonTimer:title" />
          </View>

          {!!meeting?.name && (
            <Text style={themed($meetingName)} numberOfLines={2}>
              {meeting.name}
            </Text>
          )}

          <Text style={themed($timer)} accessibilityLabel={formatted}>
            {formatted}
          </Text>

          <Text style={themed($hint)} tx="inPersonTimer:hint" txOptions={{ minutes: minMinutes }} />

          <View style={themed($buttonRow)}>
            <Pressable
              onPress={handleCancel}
              style={themed($cancelButton)}
              accessibilityRole="button"
              accessibilityLabel={t("common:cancel")}
            >
              <Text style={themed($cancelButtonText)} tx="common:cancel" />
            </Pressable>

            <Pressable
              onPress={() => {
                void handleSave()
              }}
              disabled={!canSave}
              style={[themed($saveButton), !canSave && themed($saveButtonDisabled)]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              accessibilityLabel={t("externalZoomTimer:save")}
            >
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={canSave ? theme.colors.tint : theme.colors.textDim}
              />
              <Text
                style={[themed($saveButtonText), !canSave && themed($saveButtonTextDisabled)]}
                tx="externalZoomTimer:save"
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}
```

- [ ] **Step 2: Copy the style block**

Copy `$overlay`, `$backdrop`, `$card`, `$header`, `$title`, `$meetingName`, `$timer`, `$hint`, `$buttonRow`, `$cancelButton`, `$cancelButtonText`, `$saveButton`, `$saveButtonDisabled`, `$saveButtonText`, `$saveButtonTextDisabled` verbatim from `ExternalZoomTimerModal.tsx:448-558` to the bottom of the new file. Add a header comment above them:

```ts
// Copied verbatim from ExternalZoomTimerModal 2026-08-05. The two timers must
// look identical — a user who has used both should not feel the layout shift.
// Copied rather than imported: they are module-private there, and exporting
// them to share would couple the two components for no benefit. If you restyle
// one timer, restyle both.
```

- [ ] **Step 3: Verify types and lint**

Run: `npm run compile && npx eslint app/components/InPersonTimerModal.tsx`

Expected: both clean. If eslint flags the raw `Text` import, confirm it comes from `@/components/Text` and not `react-native` — the repo bans the RN primitives.

- [ ] **Step 4: Stage and commit**

```bash
git add app/components/InPersonTimerModal.tsx
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
✨ feat(inperson): add the in-person attendance timer modal

- Same chrome and behavior as the external-Zoom timer, minus the launcher
- Shares useAttendanceTimer, the credit floor, and the long-attendance notice
- The persisted verification wins over the prop at save time so a recovered
  session still writes the fix taken at the venue

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 10: Rewire InPersonPopup

**Files:**
- Modify: `app/components/InPersonPopup.tsx`
- Delete: `app/services/inPerson/attendance.ts`

**Interfaces:**
- Consumes: `usePresenceCheck` (Task 6), `useTopicPanel` + `TopicPanelOverlay` (Task 4), `InPersonTimerModal` (Task 9), the `presence` i18n namespace (Task 7), `formatDistance` from `@/utils/nearbyLogic`.

This is the task where the feature becomes visible. It is also the largest edit — read the whole current file first.

- [ ] **Step 1: Remove the placeholder attendance machinery**

In `app/components/InPersonPopup.tsx`, delete:

- the `logState` state (~line 317)
- `mountedRef` and its effect (~lines 322-328)
- `probeSeqRef` and the `hasLoggedToday` probe effect (~lines 338-350)
- `savingInFlightRef` (~line 360)
- `handleImHere` (~lines 362-389)
- the `hasLoggedToday, saveInPersonAttendance` import

Replace them with a `REMOVED 2026-08-05` comment recording why, so a future reader doesn't reintroduce the guard:

```ts
  // REMOVED 2026-08-05: the `logState` machine, the sequence-guarded
  // hasLoggedToday probe, and the same-local-day double-log guard.
  //
  // They existed because a single tap wrote a finished record, so a second tap
  // would silently duplicate it. Attendance is now a timer: a second tap
  // starts a timer, which is exactly what the online path does and what a user
  // who left and came back would expect. Online has never had a same-day
  // guard; in-person now matches it. Do not add one back without also adding
  // one to SchedulePopup — divergence here is what made the two flows feel
  // like different products.
```

- [ ] **Step 2: Add the presence check, timer, and topic panel**

Add near the other hooks:

```ts
  const { check, isChecking } = usePresenceCheck()
  const [timerVisible, setTimerVisible] = useState(false)
  const [verifiedPresence, setVerifiedPresence] = useState<PersistedPresence | null>(null)

  // Locale measurement system is fixed for the process lifetime; resolve once.
  // Not available from useNearbySchedules here — this popup takes a `meeting`
  // prop from InPersonScreen and never calls that hook.
  const useMiles = useMemo(() => getLocales()[0]?.measurementSystem === "us", [])

  const { cardAnimatedStyle, onCardLayout, panelProps } = useTopicPanel({
    visible,
    meetingId: meeting?.id,
    meetingName: meeting?.name,
    // An in-person meeting has a chair, and nothing else can tell us who it
    // was — the user is the only source.
    includeHost: true,
  })

  const timerMeeting = useMemo(
    () => (meeting ? { id: meeting.id, name: meeting.name, zid: meeting.zid } : null),
    [meeting],
  )
```

with imports:

```ts
import { getLocales } from "expo-localization"

import { InPersonTimerModal } from "@/components/InPersonTimerModal"
import { TopicPanelOverlay } from "@/components/TopicPanelOverlay"
import { usePresenceCheck } from "@/hooks/usePresenceCheck"
import { useTopicPanel } from "@/hooks/useTopicPanel"
import type { PersistedPresence } from "@/services/attendance"
import { formatDistance } from "@/utils/nearbyLogic"
```

`useAttendanceTimer` is deliberately **not** imported here — `InPersonTimerModal`
owns the clock. This popup only decides whether the timer may start.

- [ ] **Step 3: Write the new "I'm Here" handler**

```ts
  const handleImHere = useCallback(async () => {
    if (!meeting || isChecking) return

    const outcome = await check({ latitude: meeting.latitude, longitude: meeting.longitude })

    switch (outcome.status) {
      case "verified":
        setVerifiedPresence({
          lat: outcome.fix.lat,
          lon: outcome.fix.lon,
          accuracyM: outcome.fix.accuracyM,
          distanceM: outcome.distanceM,
          radiusM: outcome.radiusM,
        })
        setTimerVisible(true)
        // PRIVACY: no payload. The distance must never ride along with an
        // analytics event — same rule handleDirections follows.
        trackEvent("inperson_attendance_started")
        return

      case "out-of-range":
        Alert.alert(
          translate("presence:outOfRangeTitle"),
          translate("presence:outOfRangeMessage", {
            distance: formatDistance(outcome.distanceM, useMiles),
            radius: formatDistance(outcome.radiusM, useMiles),
          }),
        )
        return

      case "no-venue-coords":
        Alert.alert(
          translate("presence:noVenueCoordsTitle"),
          translate("presence:noVenueCoordsMessage"),
        )
        return

      case "denied":
        // When the OS won't prompt again, the only remedy is Settings — the
        // same split useNearbySchedules' banner tap makes.
        Alert.alert(translate("presence:deniedTitle"), translate("presence:deniedMessage"), [
          { text: translate("common:cancel"), style: "cancel" },
          ...(outcome.canAskAgain
            ? []
            : [
                {
                  text: translate("presence:openSettings"),
                  onPress: () => {
                    Linking.openSettings().catch(() => {})
                  },
                },
              ]),
        ])
        return

      case "fix-failed":
        Alert.alert(translate("presence:fixFailedTitle"), translate("presence:fixFailedMessage"))
    }
  }, [meeting, isChecking, check, useMiles])
```

The popup stays open in every rejection case so the user can retry without re-navigating.

**Copy wrinkle to accept, not fix:** `formatDistance` renders a 150 m radius as
`"0.1 mi"` for US users. It reads oddly for a threshold, but it is the same
function the distance badge uses on every meeting row and in the In-Person
empty state, so switching to feet here would make the alert disagree with the
list the user just came from. Consistency wins; revisit only if it confuses
real users.

- [ ] **Step 4: Update the button and the card**

Replace the "I'm Here" `Pressable` with:

```tsx
            {profileStore.attendanceEnabled && (
              <Pressable
                onPress={handleImHere}
                disabled={isChecking}
                style={[themed($imHereButton), isChecking && themed($imHereButtonDisabled)]}
                accessibilityRole="button"
                accessibilityState={{ disabled: isChecking }}
              >
                <Text
                  style={themed($imHereButtonText)}
                  tx={isChecking ? "presence:checking" : "inPersonPopup:imHere"}
                />
              </Pressable>
            )}
```

Delete the now-unused `$imHereButtonLogged` style, and delete exactly three keys from the `inPersonPopup` namespace **in all nine locale files**: `logged`, `imHereSaving`, and `attendanceError`. (`imHere` stays — it is still the button's label. `attendanceSaved` stays — Step 6 moves the toast rather than removing it.) `npm run compile` does not flag unused keys, so remove them by hand and confirm with:

```bash
grep -rn "imHereSaving\|inPersonPopup:logged\|attendanceError" app/
```

Expected after deletion: no matches.

Convert the popup's card `View` to an `Animated.View` carrying the topic panel's expansion, matching SchedulePopup:

```tsx
        <Animated.View style={[themed($content), cardAnimatedStyle]} onLayout={onCardLayout}>
```

and render the overlay as the last child inside it, after the `ScrollView`:

```tsx
          <TopicPanelOverlay {...panelProps} />
```

- [ ] **Step 5: Mount the timer modal**

At the same level as `ReminderEditorModal`, after it:

```tsx
      {timerMeeting && (
        <InPersonTimerModal
          visible={timerVisible}
          meeting={timerMeeting}
          presence={verifiedPresence}
          onClose={() => setTimerVisible(false)}
          onSaved={() => {
            // Just close the timer. saveInPersonTimerAttendance already emitted
            // attendanceEvents "processed", which useTopicPanel picks up to
            // slide the topic panel in — or to emit "acknowledged" directly
            // when topic capture is off.
            setTimerVisible(false)
          }}
        />
      )}
```

- [ ] **Step 6: Keep the toast on "acknowledged"**

The popup currently shows its success toast inline in `handleImHere`. Move it to an `attendanceEvents` subscription so it fires after the topic panel resolves rather than behind it — the same ordering `SchedulePopup`'s banner uses:

```ts
  useEffect(() => {
    if (!visible || !meeting?.id) return
    const unsub = attendanceEvents.subscribe((event) => {
      if (event.mid !== meeting.id) return
      if (event.type === "acknowledged" && event.valid) {
        toast.showToast({ tx: "inPersonPopup:attendanceSaved", type: "success" })
      }
    })
    return unsub
  }, [visible, meeting?.id, toast])
```

- [ ] **Step 7: Comment the deliberately-absent maintenance gate**

Every other in-person path gates on `configStore.maintenanceMode` —
`MeetingContext.refreshLiveMeetings`, `ListingsScreen.fetchDailySchedules`,
`SchedulePopup.handleCellPress`, `useReportSender.send`. Its absence here will
read as an oversight to the next reviewer, so say why at the call site. Add
directly above `handleImHere`:

```ts
  // NO maintenance-mode gate here, deliberately — every other in-person path
  // has one, so its absence is the thing that needs explaining. The GPS check
  // needs no server, attendance is local-first, and the write queues to the
  // sync outbox like any other mutation. Gating would deny a user the
  // attendance they are standing in the room for because a server is down.
  // Do not "restore consistency" by adding one.
```

- [ ] **Step 8: Delete the superseded service**

```bash
git rm app/services/inPerson/attendance.ts
```

Then run `grep -rn "saveInPersonAttendance\|hasLoggedToday\|isSameLocalDay" app/` — `isSameLocalDay` in `nearbyLogic.ts` becomes unused once this file is gone. Delete it and its test, if one exists, in the same step; leaving a helper whose only comment says it backs the "I'm Here" double-log guard is worse than deleting it.

- [ ] **Step 9: Verify types, tests, and lint**

Run: `npm run compile && npm test && npx eslint app/components/InPersonPopup.tsx app/utils/nearbyLogic.ts app/utils/nearbyLogic.test.ts`

Expected: all clean. If `nearbyLogic.test.ts` covered `isSameLocalDay`, its tests are removed with it and the vitest count drops accordingly — that is correct, not a regression.

- [ ] **Step 10: Stage and commit**

```bash
git add -A app/components/InPersonPopup.tsx app/services/inPerson app/utils/nearbyLogic.ts app/utils/nearbyLogic.test.ts app/i18n/
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
✨ feat(inperson): GPS-verified, timed in-person attendance

- "I'm Here" now takes a fresh high-accuracy fix and refuses to start unless
  the user is within the configured radius of the venue
- Out of range, denied, and unlocatable each explain themselves; there is no
  override
- Attendance is real elapsed time via the shared timer, followed by the same
  topic/host panel the online path uses
- Removes the placeholder single-tap write and its same-day guard

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 11: Cold-start recovery for in-person sessions

**Files:**
- Modify: `app/services/attendance/timerSession.ts` (add `zid`)
- Modify: `app/db/TimerSessionResumer.tsx`
- Modify: `app/components/TimerRecoveryGate.tsx`

**Interfaces:**
- Consumes: `sessionSource`, `PersistedTimerSession` (Task 2); `InPersonTimerModal` (Task 9).

Without this task an in-person timer that survives a process kill is recovered as a *Zoom* session, handed to a modal that early-returns on its missing URL, and silently dropped. That is the exact failure the persistence exists to prevent.

- [ ] **Step 1: Add `zid` to the persisted session**

`InPersonTimerModal` needs `zid` to write the record, and unlike the Zoom path there is no URL to re-derive it from. In `app/services/attendance/timerSession.ts`, add to `PersistedTimerSession`:

```ts
  /**
   * In-person only. The Zoom path re-derives zid from meetingUrl via
   * extractZoomMeetingNumber at restore time; an in-person session has no URL,
   * so the value has to be carried. Optional because sessions written before
   * 2026-08-05 don't have it — and don't need it, being external-zoom.
   */
  zid?: string
```

Then in `InPersonTimerModal`'s `buildSession`, add `zid: meeting?.zid ?? ""`.

- [ ] **Step 2: Branch the resumer**

In `app/db/TimerSessionResumer.tsx`, the existing logic (staleness cap, `setRecoverySession`) applies unchanged to both sources — only the log line needs to say which kind it restored. Change the restore log to:

```ts
    log.info("Restoring persisted timer session via recovery surface", {
      mid: session.meetingId,
      source: sessionSource(session),
      elapsedMs,
      belowCredit: elapsedMs < EXTERNAL_MIN_CREDIT_MS,
    })
```

and add `sessionSource` to the `@/services/attendance` import. Append to the component's docblock:

```
 * CHANGED 2026-08-05: the persisted session can now be an in-person timer as
 * well as an external-Zoom one. Nothing here branches on it — the staleness
 * cap and the restore decision are identical for both — but TimerRecoveryGate
 * does, so the source is logged here to make a mis-routed recovery diagnosable
 * from Loki without a device.
```

- [ ] **Step 3: Branch the recovery gate**

Rewrite `app/components/TimerRecoveryGate.tsx`'s body:

```tsx
export function TimerRecoveryGate() {
  const session = useRecoverySession()

  const handleClose = useCallback(() => {
    setRecoverySession(null)
  }, [])

  const source = session ? sessionSource(session) : null

  const zoomMeeting = useMemo(() => {
    if (!session || source !== "external-zoom") return null
    return {
      id: session.meetingId,
      name: session.meetingName,
      url: session.meetingUrl ?? "",
    }
  }, [session, source])

  const inPersonMeeting = useMemo(() => {
    if (!session || source !== "in-person") return null
    return {
      id: session.meetingId,
      name: session.meetingName,
      zid: session.zid ?? "",
    }
  }, [session, source])

  if (!session) return null

  if (inPersonMeeting) {
    return (
      <InPersonTimerModal
        visible
        meeting={inPersonMeeting}
        // The verification taken at the venue, carried through the process
        // kill. InPersonTimerModal re-reads the persisted block at save time
        // and prefers it over this prop; passing it here keeps the modal's
        // `active` guard (which requires a presence) satisfied on mount.
        presence={session.presence ?? null}
        onClose={handleClose}
        onSaved={handleClose}
      />
    )
  }

  if (!zoomMeeting) return null

  return (
    <ExternalZoomTimerModal
      visible
      meeting={zoomMeeting}
      onClose={handleClose}
      onSaved={handleClose}
    />
  )
}
```

Append to the file's docblock:

```
 * CHANGED 2026-08-05: routes on sessionSource(). An in-person session has no
 * meetingUrl, so handing it to ExternalZoomTimerModal would hit that modal's
 * !meetingUrl guard and drop a live timer on the floor — the precise harm this
 * whole recovery surface exists to prevent.
 *
 * Topic capture is deliberately skipped on this path for BOTH sources: the
 * gate mounts at app root with no popup behind it, so there is no useTopicPanel
 * host and onSaved simply closes. Unchanged from the Zoom-only behavior.
```

Add imports for `InPersonTimerModal`, `sessionSource`, and `useMemo`.

- [ ] **Step 4: Verify types, tests, and lint**

Run: `npm run compile && npm test && npx eslint app/db/TimerSessionResumer.tsx app/components/TimerRecoveryGate.tsx app/services/attendance/timerSession.ts app/components/InPersonTimerModal.tsx`

Expected: all clean.

- [ ] **Step 5: Stage and commit**

```bash
git add app/db/TimerSessionResumer.tsx app/components/TimerRecoveryGate.tsx \
  app/services/attendance/timerSession.ts app/components/InPersonTimerModal.tsx
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
✨ feat(inperson): recover in-person timer sessions after a cold start

- TimerRecoveryGate routes on sessionSource() instead of assuming Zoom
- Persists zid for in-person, which has no URL to re-derive it from
- A recovered in-person session still writes the fix verified at the venue

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

### Task 12: Documentation, privacy amendment, and the manual verification gate

**Files:**
- Modify: `app/hooks/useNearbySchedules.ts` (the PRIVACY header block, lines 10-41)
- Modify: `CLAUDE.md` (the "In-Person segment" bullet under "Smaller Subsystems")
- Modify: `CHANGELOG.md`
- Modify: `docs/translation-review-2026-08-03.md`

- [ ] **Step 1: Amend the privacy header**

`useNearbySchedules.ts`'s header currently asserts a rule this feature breaks. Leaving it is worse than having no comment — a reader would trust it. Insert after the existing `PRIVACY (non-negotiable, ...)` bullet list, before "The persisted radius (MMKV)":

```
 * AMENDED 2026-08-05: the rule above still governs THIS hook and the whole
 * /schedules/nearby browse path — coordinates here still live only in
 * `coordsRef` and are still scrubbed from every transport. It no longer
 * describes the app as a whole. GPS-verified in-person attendance deliberately
 * persists the user's fix: to encrypted SQLite (the attendance record's
 * events[].json), to the server when cloud backup is on (events is part of
 * ServerAttendanceRecord and is sent verbatim), and to MMKV for the lifetime
 * of a running timer session. A verified attendance record is the product and
 * the proof has to be durable. The unchanged parts — nothing logged, lazy
 * foreground-only permission, browse coordinates ref-only — are unchanged
 * deliberately, not by omission. See
 * docs/superpowers/specs/2026-08-05-gps-in-person-attendance-design.md.
```

- [ ] **Step 2: Update CLAUDE.md**

In the "In-Person segment" bullet, replace the sentence describing `saveInPersonAttendance` — the one beginning `"I'm Here" writes attendance via saveInPersonAttendance()` and ending with the `hasLoggedToday` guard — with:

```
  "I'm Here" now runs a GPS presence check (`usePresenceCheck` → the pure
  `verifyPresence` in `presenceLogic.ts`) and, only when the user is within
  `configStore.presenceRadiusM` (default 150 m) of the venue, opens
  `InPersonTimerModal`. Attendance is real elapsed time written by
  `saveInPersonTimerAttendance()` at Save, followed by the shared topic/host
  panel — the same shape as the online path, sharing `useAttendanceTimer` and
  `useTopicPanel` with it. The record's `events[].json` carries the verified
  fix, distance, accuracy, and the radius in force. There is no override for an
  out-of-range user and no same-day double-log guard (online has never had
  one). The single-tap `saveInPersonAttendance` and `hasLoggedToday` were
  removed 2026-08-05.
```

Then add a line to the privacy note in the same bullet: raw coordinates are still ref-only **for the browse path**, but the attendance path persists and syncs the verified fix by design.

- [ ] **Step 3: Add the changelog entry**

Under `## [Unreleased]` → `### Added`:

```markdown
- **In-person attendance is now location-verified and timed.** Tapping "I'm
  Here" checks where you are and only starts recording once you're actually at
  the meeting — if you're not there yet, it tells you how far you have to go.
  Attendance is then the real time you spent, ended by you, followed by the
  same topic and host prompt online meetings use. The saved record stores where
  your attendance was confirmed. Meetings we don't have a precise location for
  can't be verified and can't be logged; that source data is being corrected.
```

Under `### Changed`:

```markdown
- The in-person and online attendance timers now share one implementation, so
  a fix to either reaches both.
```

- [ ] **Step 4: Queue the translations for review**

Append a section to `docs/translation-review-2026-08-03.md` listing the two new namespaces: `presence` (11 keys) and `inPersonTimer` (2 keys), × 8 non-English locales = 104 strings, and update the document's running total. Flag `presence:outOfRangeMessage` and `inPersonTimer:hint` specifically — both carry interpolation tokens (`{{distance}}` / `{{radius}}` / `{{minutes}}`) that a reviewer must confirm survived translation intact and unreordered in a way that breaks the sentence.

- [ ] **Step 5: Run the full gate**

Run: `npm run compile && npm test && npm run lint:check`

Expected: tsc clean, both test runners pass, lint clean. `lint:check` is the one place a repo-wide run is acceptable — it is check-only.

- [ ] **Step 6: Execute the manual verification checklist**

**This is mandatory and is the real gate.** `ExternalZoomTimerModal`, `SchedulePopup`, `TimerSessionResumer` and `TimerRecoveryGate` have zero automated coverage; this plan refactors all four, and one of them has a documented history of costing customers real attendance. Run on a physical device — the simulator cannot produce a meaningful GPS fix.

*Zoom path — proving it is unchanged:*

1. Join a meeting with attendance on → timer starts, Zoom launches.
2. Background the app 2 minutes, return → elapsed time is correct.
3. Save above the credit floor → record written, topic panel slides in.
4. With the keyboard open, tap Save on the topic panel → panel slides out, **no crash**.
5. Skip the topic panel → banner fires.
6. Disable topic capture in Settings, save → banner fires immediately, no panel.
7. Cancel above the credit floor → Keep Running / Save / Discard confirm appears.
8. Kill the app mid-session, relaunch → timer recovers with accumulated time and does **not** re-launch Zoom.
9. Card grows to full screen when the panel opens, shrinks back when it closes.

*Legacy session compatibility:*

10. Start a Zoom timer on the **previous** build, install this one over it, relaunch → the session (no `source` field) recovers as external Zoom, not dropped.

*In-person path:*

11. At a venue, tap "I'm Here" → permission prompt on first use only → timer starts, nothing launches.
12. Save above the floor → record written, topic/host panel appears.
13. Inspect the record: `lat`, `lon`, `accuracyM`, `distanceM`, `radiusM` present and correct.
14. Away from the venue → alert states the distance in the device's units; no timer, no record.
15. Deny permission → alert. Deny permanently → alert offers Settings.
16. Airplane mode → `fix-failed` alert, retryable.
17. Kill the app mid-in-person-session, relaunch → timer recovers; Save writes a record still carrying the original verified fix.
18. Double-tap "I'm Here" in the same second → one timer, one record.
19. Log the same meeting twice in one day → two records (the same-day guard is gone by design).
20. With maintenance mode on → the whole flow still works end to end.

*Privacy:*

21. Grep Loki for the session — no coordinates, no distance values.
22. Trigger a Sentry event during the flow — no coordinates in breadcrumbs.

Record any failure as a defect against the task that introduced it rather than patching it here.

- [ ] **Step 7: Stage and commit**

```bash
git add app/hooks/useNearbySchedules.ts CLAUDE.md CHANGELOG.md docs/
```

Then commit with this message (verify `git branch --show-current` is `feat/gps-in-person-attendance` first):

```
📝 docs: record the in-person attendance privacy amendment

- useNearbySchedules' PRIVACY header no longer asserts a rule the app has
  outgrown; it now scopes itself to the browse path and points at the spec
- CLAUDE.md describes the verified timer flow that replaced the placeholder
- Changelog entry and translation-review queue updated

Authored-By: Jenova Marie <jenova-marie@pm.me>
```

---

## Release Notes

**No `runtimeVersion` bump.** `expo-location` was already a dependency, no native module is added, and no `app.json` / Podfile / Gradle config changes. This ships as an OTA via `npm run update`.

**Before releasing:** the translation review of the 104 new non-English strings is a release blocker per `docs/PRODUCTION_CHECKLIST.md`, and the 22-item manual checklist above must be complete.

**Server-side:** `/config` should begin returning `PRESENCE_RADIUS_M` so the radius can be tuned without a build. The client works correctly without it (150 m default), so the two can ship independently, in either order.
