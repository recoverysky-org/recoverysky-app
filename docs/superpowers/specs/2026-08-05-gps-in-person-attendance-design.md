# GPS-Verified In-Person Attendance — Design

**Date:** 2026-08-05
**Status:** Approved (design); implementation plan pending

## Goal

Replace the placeholder "I'm Here" single-tap in-person attendance with the
same join → timer → topic/host → record flow the online (external Zoom) path
already uses, gated on a GPS check that the user is physically at the venue.
The verified fix is stored on the attendance record.

## Summary of decisions

Every item below was decided explicitly during brainstorming. Where an
alternative was rejected, the reason is recorded so it isn't re-litigated.

| Decision | Choice | Rejected alternative |
|---|---|---|
| Where coordinates are stored | `events[].json` on the attendance record | A real `latitude`/`longitude` column (three-repo change: common-lib model → JSON schema → Drizzle PG + SQLite → migrations, plus the API's `/sync` wire schema); verify-but-don't-store |
| Out-of-range behavior | Hard gate, no override | Widened radius for `approximate` venues; soft gate with "I'm here anyway" |
| Venue with no usable coordinates | Same hard gate — cannot verify, cannot log | Fall through to unverified logging |
| Radius | 150 m, from `configStore` with a hardcoded default | Fixed compile-time constant |
| Record lifecycle | MMKV session at start, complete record written at Save (mirrors external Zoom exactly) | Unprocessed SQLite row written at start |
| Minimum credit | `EXTERNAL_MIN_CREDIT_MS`, the same floor online uses | No floor (today's in-person behavior) |
| GPS check timing | At start only | Also at Save |
| Code structure | Extract a shared `useAttendanceTimer`; a separate `InPersonTimerModal` | Add an in-person mode to `ExternalZoomTimerModal` |
| Topic panel | Extract `useTopicPanel` + `<TopicPanelOverlay />`, used by both popups | Duplicate the wiring; unify both popups under one shell component |

**Why start-only GPS:** humans forget to end timers. A check at Save would
block a user in a basement with no signal from recording attendance they had
already earned — worse than the start-side failure, because the time is
already spent. This is the same "keep them whole, let them trim it later"
principle that produced the long-attendance notice instead of a hard cap.

**Why a hard gate:** in-person meetings are required to carry valid
coordinates. Source data with missing or approximate geocodes will be cleaned
upstream rather than worked around in the client. One rule — "we could not
verify you are here" — covers out-of-range and missing-coordinates alike, with
different copy but the same outcome.

## Privacy policy amendment (read this before implementing)

`app/hooks/useNearbySchedules.ts` carries a header calling this
non-negotiable:

> Raw coordinates live in `coordsRef` and nowhere else. Not React state, not
> MMKV, not SQLite. They leave the device only as `/schedules/nearby` query
> params.

**This feature deliberately amends that rule.** A verified attendance record
is the product; the proof has to be durable. As of this design:

- The user's fix **is** written to encrypted SQLite (the attendance record's
  `events[].json`).
- It **is** pushed to the RecoverySky API when cloud backup is on — `events`
  is part of `ServerAttendanceRecord` in `app/services/sync/syncLogic.ts` and
  is sent verbatim.
- It **is** written to MMKV for the lifetime of a running timer session, so a
  process kill mid-meeting doesn't lose the verification.

Everything else in the old rule stands unchanged:

- **The `/schedules/nearby` browse path is untouched.** Its coordinates still
  live only in a ref and are still scrubbed from Sentry breadcrumbs and query
  logs (`app/utils/scrubQuery.ts`, `scrubEventBreadcrumbs`).
- **Nothing here is logged.** Not the fix, not the distance. "43 m from
  meeting X" is a location disclosure wearing a scalar's clothing, and logs
  ship to Loki. Log the outcome (`"out-of-range"`), never the number.
- **Permission stays lazy and foreground-only.** It is requested on the "I'm
  Here" tap, never at app start, never in the background.
- The MMKV session is cleared on Save or Cancel, exactly as the Zoom session
  is today.

`useNearbySchedules.ts`'s header must be updated to reference this document
rather than left asserting a rule the app no longer follows.

## Architecture

Three layers, split along the line the repo already uses for the In-Person
segment (`nearbyLogic.ts` pure, `useNearbySchedules.ts` I/O):

### 1. Pure decision logic — `app/utils/presenceLogic.ts`

Zero runtime `@/` imports so vitest can execute it. Imports `distanceMeters`
from `./nearbyLogic` by relative path (also pure).

```ts
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
  /** Undefined only when the venue has no usable coordinates. */
  distanceM?: number
  reason: PresenceReason
}

export function verifyPresence(input: PresenceInput): PresenceResult
```

Rules:

- `distanceMeters()` already treats `(0, 0)`, non-finite, and missing
  latitude/longitude as "no usable coordinates" and returns `undefined`. That
  is the single source of venue-coordinate validity — do not add a second
  check here.
- `undefined` distance → `{ inRange: false, reason: "no-venue-coords" }`.
- Otherwise in range when `distanceM <= radiusM`. **Inclusive** — a user
  measured at exactly the radius is in.
- `distanceM` is returned on the out-of-range branch so the caller can tell
  the user how far they are.
- The fix's own `accuracyM` does **not** widen the radius. It is recorded on
  the attendance record for audit, not used in the decision. Widening by
  accuracy would make the gate stochastic — the same user in the same chair
  would pass or fail depending on GPS conditions.

### 2. I/O — `app/hooks/usePresenceCheck.ts`

```ts
export type PresenceCheckOutcome =
  | { status: "verified"; fix: PresenceFix; distanceM: number; radiusM: number }
  | { status: "out-of-range"; distanceM: number; radiusM: number }
  | { status: "no-venue-coords" }
  | { status: "denied"; canAskAgain: boolean }
  | { status: "fix-failed" }

export function usePresenceCheck(): {
  check: (venue: PresenceVenue) => Promise<PresenceCheckOutcome>
  isChecking: boolean
}
```

- Calls `Location.requestForegroundPermissionsAsync()` on `check()`, never
  earlier.
- Takes **one fresh fix** via `Location.getCurrentPositionAsync({ accuracy:
  Location.Accuracy.Highest })`.
  - `Highest`, not `Balanced`: `useNearbySchedules` uses `Balanced` because
    its consumer is a 10 km radius filter. 150 m is two orders of magnitude
    tighter and needs the better fix.
  - **Never seed from `getLastKnownPositionAsync()`.** `useNearbySchedules`
    does, and is right to — a slightly stale position cannot change which
    meetings fall inside a 10 km radius. Here a cached position is a
    verification hole: it could be from the user's home twenty minutes ago.
    A presence gate must use a position taken now.
- Raced against a timeout, same platform split and rationale as
  `useNearbySchedules.FIX_TIMEOUT_MS`: 20 s on Android (the fused provider
  routinely needs longer for a first fresh fix on a cold process indoors),
  10 s on iOS. Constant name: `PRESENCE_FIX_TIMEOUT_MS`. The timeout handle is
  cleared in `finally` on both outcomes.
- Reads the radius from `configStore.presenceRadiusM`.
- The fix lives in a local variable / ref for the duration of the call and is
  returned only inside a `verified` outcome. It never enters React state.
- Never throws. Every failure is an outcome.

### 3. Shared timer core — `app/hooks/useAttendanceTimer.ts`

Lifted verbatim from `ExternalZoomTimerModal` — this is an extraction, not a
rewrite. It owns:

- the `startedAt` / `elapsed` state and the 1 s interval;
- the `AppState` `"active"` resync (JS intervals drift or pause when
  backgrounded);
- MMKV persistence on a new session and adoption of a persisted session on
  resume (`isResume` — a resumed session must NOT re-run the caller's
  `onStart`, which is what stops the Zoom path re-launching Zoom on top of a
  live call);
- the synchronous save-lock ref (`saving` state is for visuals only; a
  same-tick double-tap passes a state-based guard twice and creates two
  attendance records).

```ts
export interface UseAttendanceTimerOptions {
  /** Timer runs only while true. */
  active: boolean
  /** Session identity. A change tears down and restarts the clock. */
  sessionKey: string
  /** Build the session to persist when a NEW session starts. */
  buildSession: (startedAt: number) => PersistedTimerSession
  /** True when a persisted session belongs to this timer's target. */
  matchesPersisted: (session: PersistedTimerSession) => boolean
  /** Fired once when a NEW session starts. Not fired on resume. */
  onStart?: () => void
}

export interface UseAttendanceTimerResult {
  startedAt: number | null
  elapsed: number
  isResume: boolean
  /** Synchronous lock. Returns false when a save is already in flight. */
  beginSave: () => boolean
  endSave: () => void
}
```

`ExternalZoomTimerModal` passes `onStart` to launch Zoom; `InPersonTimerModal`
passes nothing — the only behavioral difference between the two timers.

The effect must continue to depend on stable primitives, never on a meeting
object: the parent inlines the meeting prop as a fresh literal every render,
and depending on it tore down and restarted the timer on every parent
re-render — resetting the elapsed counter to 00:00 and re-launching Zoom. That
bug is already fixed; the extraction must not reintroduce it.

### 4. Shared topic panel — `app/hooks/useTopicPanel.ts` + `app/components/TopicPanelOverlay.tsx`

Extracted from `SchedulePopup`. The hook owns:

- `topicActive` and the `{ attendanceId, mid }` context ref;
- both `Animated.Value`s — `topicProgress` (native driver, panel translate +
  opacity) and `cardExpansion` (**non**-native, because `minHeight` /
  `maxHeight` / `borderTopLeftRadius` / `borderTopRightRadius` are layout
  props and are not native-drivable);
- the parallel-animation effect and the reset-on-open effect;
- the `attendanceEvents` `"processed"` subscription: on a valid `processed`
  event for this meeting, slide the panel in when
  `profileStore.enableMeetingTopic` is on, otherwise emit `"acknowledged"`
  immediately;
- `handleTopicSave` / `handleTopicSkip`, including the
  `dismissKeyboardAndSettle()` call that must run **before**
  `setTopicActive(false)`.

```ts
export function useTopicPanel(options: {
  visible: boolean
  meetingId?: string
  meetingName?: string
  /** Prompt for a host as well as a topic. True for both callers today. */
  includeHost: boolean
}): {
  topicActive: boolean
  /** Spread onto the popup's own Animated.View card. */
  cardAnimatedStyle: Animated.WithAnimatedObject<ViewStyle>
  /** onLayout for the popup's card — measures the slide distance. */
  onCardLayout: (event: LayoutChangeEvent) => void
  /** Spread onto <TopicPanelOverlay />. */
  panelProps: TopicPanelOverlayProps
}
```

```ts
export interface TopicPanelOverlayProps {
  active: boolean
  meetingName?: string
  includeHost: boolean
  /** Native-driver translate + opacity, produced by the hook. */
  progress: Animated.Value
  /** Card height measured by onCardLayout; the panel translates by exactly this. */
  contentHeight: number
  onSave: (result: { topic: string; host?: string }) => void
  onSkip: () => void
}
```

`<TopicPanelOverlay />` renders the `Animated.View` + `KeyboardAvoidingView`
(`behavior="padding"` on **both** platforms — the keyboard-controller KAV
normalizes via the native event stream, and `"height"` on Android
double-resized against the OS and the parent's layout animation) + the
existing `TopicPromptContent`.

**Why this extraction is worth doing.** Not the eighty lines.
`dismissKeyboardAndSettle()` exists because dismissing the keyboard
concurrently with the slide-out had three layout systems mutating one subtree
on a single frame — keyboard-controller's Reanimated KAV, the
`translateY`/`cardExpansion` tween, and the `topicActive` reconcile — and
Reanimated's per-frame shadow-tree clone read a prop map the others had just
freed, giving `EXC_BAD_ACCESS` in `folly::dynamic::hash`. A second
hand-written copy of this panel would have to independently remember to
serialize hide-then-slide. In the hook, it is structurally unforgettable.

**What stays in each popup.** The `"acknowledged"` subscription and the
confirmation UI it drives — `SchedulePopup` has an animated banner,
`InPersonPopup` uses a toast. Those are genuinely different and are not
extracted. `SchedulePopup`'s existing single `attendanceEvents` subscription
loses its `"processed"` branch and keeps its `"acknowledged"` branch.

**`includeHost` becomes a caller prop**, replacing
`attendanceSourceRef.current === "external"`. Both callers pass `true` — an
in-person meeting has a chair, and the ref only ever held `"external"` after
the 4.5.0 SDK removal. The ref is deleted.

### 5. In-person save — `app/services/inPerson/timerAttendance.ts`

Replaces `saveInPersonAttendance` in `app/services/inPerson/attendance.ts`.
Modeled on `app/services/zoom/externalAttendance.ts` — same create → events →
`markProcessed`-with-retry → `meetingEvents` sequence.

```ts
export interface InPersonTimerAttendanceInput {
  uid: string
  mid: string
  zid: string
  meetingName: string
  startedAt: number
  endedAt: number
  presence: {
    lat: number
    lon: number
    accuracyM?: number
    distanceM: number
    radiusM: number
  }
}
```

- `credit = endedAt - startedAt`; `valid = credit >= EXTERNAL_MIN_CREDIT_MS`.

  That constant is defined in `app/services/zoom/externalAttendance.ts` (as an
  alias of the env-driven `MIN_CREDIT_MS`) and re-exported from
  `app/services/zoom`. In-person imports it from there rather than defining a
  second threshold — one floor, one place to retune. Its `EXTERNAL_` prefix is
  now a misnomer; renaming it is deliberately **not** part of this work,
  because it is read by `ExternalZoomTimerModal` and `TimerSessionResumer` and
  a rename buys nothing but churn in files this design is already touching.
  A comment at the definition notes both consumers.
- Keeps the `markProcessed` retry-with-backoff loop (`[500, 1500, 4500]` ms)
  from `saveInPersonAttendance`. It exists because a transient DB error
  between `create` and `markProcessed` leaves an orphaned unprocessed record
  the user can neither see nor recover.
- Emits `attendanceEvents` `"created"` then `"processed"` (with `source:
  "in-person"`), and `meetingEvents.completed("in-person")` for the rating
  tally — gated on `valid`, matching the external-Zoom path.
- **Nothing in this file logs the fix or the distance.**

**The record's event JSON:**

```json
{
  "source": "in-person",
  "verified": true,
  "lat": 41.8781,
  "lon": -87.6298,
  "accuracyM": 12,
  "distanceM": 43,
  "radiusM": 150
}
```

`radiusM` is recorded deliberately: a year from now you can tell whether a
record was verified under a 150 m rule or a retuned one without correlating
against server config history.

### 6. Session persistence — `app/services/attendance/timerSession.ts`

**Moved** from `app/services/zoom/timerSession.ts`. Once two features share
it, a module under `services/zoom/` owning in-person sessions is a trap.

```ts
export type TimerSource = "external-zoom" | "in-person"

export interface PersistedTimerSession {
  startedAt: number
  uid: string
  meetingId: string
  meetingName: string
  /** External Zoom only. */
  meetingUrl?: string
  /** Absent on sessions persisted before this release — see sessionSource(). */
  source?: TimerSource
  /** In-person only. The verified fix, needed to write the record at Save. */
  presence?: {
    lat: number
    lon: number
    accuracyM?: number
    distanceM: number
    radiusM: number
  }
}

/** Legacy sessions have no `source`; they are always external Zoom. */
export function sessionSource(session: PersistedTimerSession): TimerSource
```

**Two things that must not change:**

1. **The MMKV key stays `external-zoom-timer-session-v1`.** Renaming it
   silently orphans the session of any user who is mid-Zoom-meeting when this
   OTA lands. The name is now a misnomer; a comment explains why it is kept.
2. **A session with no `source` must resolve to `"external-zoom"`.** Same
   user, same failure: `TimerSessionResumer`'s 2026-05-11 rewrite exists
   precisely because dropping a live session cost customers real attendance.
   `sessionSource()` is the only place this defaulting happens.

`meetingUrl` becomes optional, so `ExternalZoomTimerModal`'s existing
`!meetingUrl` early-return must move behind a source check — an in-person
session legitimately has no URL and must not be dropped by it.

**`timerRecovery.ts` moves with it**, to `app/services/attendance/timerRecovery.ts`.
It is the cold-start recovery channel (`setRecoverySession` /
`useRecoverySession`) and its payload is a `PersistedTimerSession`, so it is
already source-agnostic; leaving it behind would split a pair that is always
read together. `app/services/zoom/index.ts` drops its
`export * from "./timerSession"` and `export * from "./timerRecovery"` lines,
and the four call sites (`ExternalZoomTimerModal`, `TimerSessionResumer`,
`TimerRecoveryGate`, `externalAttendance`) import from the new barrel. No
compatibility re-export — a shim would leave the misleading import path alive,
which is the thing the move is fixing.

## Data flow

### Happy path

1. User opens `InPersonPopup` and taps **I'm Here**. The button is still gated
   on `profileStore.attendanceEnabled`.
2. Button enters a checking state. `usePresenceCheck.check(meeting)` runs:
   permission → fresh high-accuracy fix → `verifyPresence`.
3. `verified` → `InPersonTimerModal` mounts over the popup. `useAttendanceTimer`
   persists the session (including `presence`) and starts the clock. **Nothing
   is launched** — the only structural difference from the Zoom timer.
4. User returns and taps **Save**. Below `EXTERNAL_MIN_CREDIT_MS` the button is
   disabled, exactly as the Zoom timer's is.
5. `saveInPersonTimerAttendance` writes the record and emits `"processed"`.
6. `useTopicPanel`'s subscription slides the topic/host panel in (when
   `enableMeetingTopic` is on), otherwise emits `"acknowledged"` immediately.
7. `handleTopicSave` → `attendanceRepo.update({ meetingTopic, meetingHost })` →
   `"acknowledged"` → the popup's toast fires.
8. The write goes through `app/db/repositories.ts` like every other mutation,
   so it enqueues to the sync outbox normally.

### Rejection paths

No record is written and no timer starts in any of these.

| Outcome | User sees |
|---|---|
| `out-of-range` | Alert naming the distance and the required radius, both via `formatDistance()` |
| `no-venue-coords` | Alert: we can't verify your location for this meeting |
| `denied` | Alert; routes to `Linking.openSettings()` when `canAskAgain` is false, matching `useNearbySchedules`'s banner-tap behavior |
| `fix-failed` | Alert: couldn't get your location, try again. Retryable |

The popup stays open in every case so the user can retry without re-navigating.

`formatDistance(distanceM, useMiles)` already exists in `nearbyLogic.ts`.
`useMiles` is **not** available to `InPersonPopup` — `useNearbySchedules`
returns it, but the popup does not consume that hook (it receives a `meeting`
prop from `InPersonScreen`). The popup resolves it itself the same way the
hook does, memoized once because the locale's measurement system is fixed for
the process lifetime:

```ts
const useMiles = useMemo(() => getLocales()[0]?.measurementSystem === "us", [])
```

### Cold-start recovery

`TimerSessionResumer` reads the session, applies the existing 6-hour staleness
cap, and calls `setRecoverySession`. `TimerRecoveryGate` branches on
`sessionSource(session)` and mounts either `ExternalZoomTimerModal` or
`InPersonTimerModal`, pre-seeded.

**Topic capture is skipped on the recovery path — for both sources.** The gate
mounts at app root with no popup behind it, so there is no `useTopicPanel`
host; `onSaved` just closes. This is today's Zoom behavior, unchanged, and
in-person matches it.

The in-person recovery path saves using the `presence` block persisted at
start. This is why the fix must be in the session: without it a recovered
session could only write an unverified record.

## Error handling

| Case | Behavior |
|---|---|
| Permission denied | Alert; Settings route when `!canAskAgain`. No record |
| Fix times out or fails | Alert, retryable. No record |
| Out of range | Alert with distance. No record. No override |
| Venue has no usable coordinates | Alert, distinct copy. No record |
| `attendanceRepo.create` fails | Return `{ ok: false }`; modal closes; **session kept** so the resumer can recover it |
| `markProcessed` fails | Retry ×3 with `[500, 1500, 4500]` ms backoff, then surface |
| Topic save fails | Logged; `"acknowledged"` still emitted — the attendance is already durable and must not be held hostage to an optional field |

**There is deliberately no maintenance-mode gate.** Every other in-person path
has one (`MeetingContext.refreshLiveMeetings`, `ListingsScreen.fetchDailySchedules`,
`SchedulePopup.handleCellPress`, `useReportSender.send`), so its absence here
will read as an oversight to a reviewer and needs a comment at the call site.
The reasoning: the GPS check needs no server, attendance is local-first, and
the write queues to the sync outbox like any other mutation. Blocking would
deny a user the attendance they are standing in the room for because a server
is down.

## Configuration

`ConfigStore` gains:

- `presenceRadiusM: number` — from `/config`, hardcoded default
  `DEFAULT_PRESENCE_RADIUS_M` (150).

Rationale for 150 m: phone GPS is 5–20 m outdoors but 30–100 m indoors, and
recovery meetings are always indoors — often in a church basement or hospital
wing. Tighter rejects real attendees; looser is theater. Server-sourced so it
can be retuned without a build, the same pattern as `reviewEnabled`.

Like every other `ConfigStore` field, it is **not** persisted to MMKV. The
hardcoded default applies until `/config` resolves — a user who taps "I'm
Here" before config loads is checked against 150 m, which is the intended
value anyway.

## Removals

- `saveInPersonAttendance` and `hasLoggedToday` in
  `app/services/inPerson/attendance.ts`, along with `InPersonPopup`'s
  `logState` machine, its sequence-guarded `hasLoggedToday` probe
  (`probeSeqRef`), and its `savingInFlightRef`.

  **This is deliberate, not an oversight.** The same-local-day guard existed
  because a single tap wrote a finished record and a second tap would silently
  duplicate it. Under the timer flow a second tap starts a timer, which is
  exactly what the online path does and what a user who left and came back
  would expect. Online has no same-day guard; in-person now matches.

- `attendanceSourceRef` in `SchedulePopup` — replaced by the `includeHost`
  prop.

## Internationalization

New keys in all nine locales (`en`, `es`, `ar`, `de`, `fr`, `pt`, `ru`, `th`,
`uk`). `en.ts` declares `type Translations = typeof en` and every other locale
is typed against it, so a missing key is a hard `tsc` error — every key must
exist in all nine files before the build passes.

Keys needed, under a new `presence` namespace:

- `presence:outOfRangeTitle`, `presence:outOfRangeMessage` (interpolates
  `{{distance}}` and `{{radius}}`, both pre-formatted by `formatDistance`)
- `presence:noVenueCoordsTitle`, `presence:noVenueCoordsMessage`
- `presence:deniedTitle`, `presence:deniedMessage`, `presence:openSettings`
- `presence:fixFailedTitle`, `presence:fixFailedMessage`
- `presence:checking` (the "I'm Here" button's checking state)
- `inPersonTimer:title`, `inPersonTimer:hint` (interpolates `{{minutes}}`)

Non-English locales ship English placeholder text and are appended to
`docs/translation-review-2026-08-03.md` for native-speaker review. Translation
review is a release blocker per `docs/PRODUCTION_CHECKLIST.md`.

## Testing

### Automated — vitest (`app/utils/presenceLogic.test.ts`)

`presenceLogic.ts` has zero `@/` runtime imports specifically so vitest can
reach it.

- inside the radius → `inRange: true`, `reason: "in-range"`
- outside → `inRange: false`, `reason: "out-of-range"`, and `distanceM` is
  present so the alert has a number to show
- **exactly at the radius → in range** (the boundary is inclusive; this test
  is the guard against someone "fixing" `<=` to `<`)
- venue at `(0, 0)` → `"no-venue-coords"` (null island is a real placeholder
  in this data, not a real venue)
- venue with missing / non-finite `latitude` or `longitude` →
  `"no-venue-coords"`
- a large `accuracyM` does **not** widen the radius — the guard against
  making the gate stochastic
- `distanceM` is `undefined` only on the `no-venue-coords` branch

### Manual — required, and the reason is structural

`ExternalZoomTimerModal`, `SchedulePopup`, `TimerSessionResumer` and
`TimerRecoveryGate` have **zero automated coverage** — they import `@/`, which
vitest cannot resolve, and no component tests exist for them. This design
refactors all four. `ExternalZoomTimerModal` in particular has a documented
history of costing customers real attendance (the 2026-05-11
`TimerSessionResumer` rewrite). Both checklists below are mandatory before
release.

**Zoom path — proving it is unchanged:**

1. Join a meeting with attendance on → timer starts, Zoom launches.
2. Background the app for 2 minutes, return → elapsed time is correct
   (`AppState` resync).
3. Save above the credit floor → record written, topic panel slides in.
4. With the keyboard open, tap Save on the topic panel → panel slides out, no
   crash. (This is the `folly::dynamic::hash` case.)
5. Skip the topic panel → banner fires.
6. Save with topic capture disabled in Settings → banner fires immediately, no
   panel.
7. Cancel above the credit floor → confirm dialog appears with Keep
   Running / Save / Discard.
8. Kill the app mid-session, relaunch → `TimerRecoveryGate` remounts the Zoom
   timer with the accumulated elapsed time and does **not** re-launch Zoom.
9. Card grows to full screen when the panel opens and shrinks back when it
   closes.

**Legacy session compatibility:**

10. Start a Zoom timer on the **previous** build, install this one over it
    (OTA), relaunch → the session (which has no `source` field) is recovered
    as external Zoom, not dropped.

**In-person path:**

11. At the venue, tap "I'm Here" → permission prompt on first use only →
    timer starts, nothing launches.
12. Save above the floor → record written with the `presence` event JSON;
    topic/host panel appears.
13. Inspect the stored record: `lat`/`lon`/`accuracyM`/`distanceM`/`radiusM`
    are present and correct.
14. Away from the venue → alert states the distance in the device's units, no
    timer, no record.
15. Deny permission → alert; deny permanently → alert routes to Settings.
16. Airplane mode / no GPS → `fix-failed` alert, retryable.
17. Kill the app mid-in-person-session, relaunch → timer recovers, Save writes
    a record that still carries the original verified fix.
18. Tap "I'm Here" twice in the same second → one timer, one record.
19. Log the same meeting twice in one day → two records (the same-day guard is
    gone by design).
20. With maintenance mode on → the flow still works end to end.

**Privacy verification:**

21. Grep the Loki logs for the session: no coordinates, no distance values.
22. Trigger a Sentry event during the flow: no coordinates in breadcrumbs.

## Release

**JS-only — no `runtimeVersion` bump.** `expo-location` is already a
dependency, nothing native is added or changed, and no `app.json` /
Podfile / Gradle config is touched. This ships as an OTA via `npm run update`.

`CHANGELOG.md` entry under `[Unreleased]`, describing the user-visible change:
in-person attendance is now timed and location-verified, and records store
where it was confirmed.

## Non-goals

Explicitly out of scope, recorded so they are not re-proposed mid-implementation:

- A real `latitude`/`longitude` column on the attendance model. Revisit only
  if server-side geospatial queries over attendance become a product
  requirement; it is a three-repo change with a SQLite migration.
- Re-verifying position at Save.
- Any override or "log anyway" escape hatch.
- Special handling for `approximate` venues or venues with no coordinates —
  the source data is being cleaned instead.
- Background location, geofencing, or auto-detection of arrival.
- Unifying `SchedulePopup` and `InPersonPopup` under a shared shell component.
  Their cards differ in real ways (`InPersonPopup` wraps its body in a
  `ScrollView` because the venue block, directions button, and contacts list
  overflow the 85% cap and clipped the CTA). Revisit only with test coverage
  in place.
