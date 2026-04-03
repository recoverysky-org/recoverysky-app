# Meeting Attendance Flow

How the Zoom SDK native events drive attendance tracking in RecoverySky.

## Zoom SDK Events

Five native callbacks are bridged via `NativeEventEmitter` in `zoomEvents.ts`.
The `useZoomEvents` hook subscribes using stable refs to avoid re-subscription on handler changes.

| Event                    | Payload                          | When it fires                              |
|--------------------------|----------------------------------|--------------------------------------------|
| `onMeetingStateChange`   | `{ state, stateName }`           | Every SDK state transition                 |
| `onMeetingError`         | `{ errorCode, message }`         | Join errors **and** success (code 0)       |
| `onMeetingJoinConfirmed` | *(none)*                         | Server accepted the join request           |
| `onMeetingEndedReason`   | `{ reason, reasonName }`         | Meeting session terminated (logging only)  |
| `onAuthReturn`           | `{ errorCode, success, message }`| SDK auth/JWT validation result             |

`onMeetingEndedReason` is used for logging and `meetingEvents.completed()` housekeeping.
It is **not used** by the attendance algorithm — see [Synthetic End Event](#synthetic-end-event).

### Meeting State Codes (`onMeetingStateChange`)

```
Code  Name               Meaning
----  -----------------  ----------------------------------------
 0    idle               No active meeting
 1    connecting         TCP/TLS handshake in progress
 2    waitingForHost     Joined before host started the meeting
 3    inMeeting          * User is in the live meeting room
 4    disconnecting      Teardown in progress
 5    reconnecting       Network blip, SDK is retrying
 6    failed             Unrecoverable join failure
 7    ended              Meeting session fully closed
 8    locked             Host locked the meeting
 9    unlocked           Host unlocked the meeting
10    inWaitingRoom      User is in the host's waiting room
11    webinarPromote     Promoted to panelist
12    webinarDePromote   Demoted from panelist
13    joinBreakoutRoom   Entered a breakout room
14    leaveBreakoutRoom  Left a breakout room
```

### Meeting End Reasons

Real reasons come from the native `onMeetingEndedReason` callback. The synthetic
`*selfLeave` reason is injected by JS — see [Synthetic End Event](#synthetic-end-event).

All reasons grant attendance **except** `joinBeforeHostTimeout` (user never entered
the meeting):

| Reason                      | Grants Attendance | Meaning                             |
|-----------------------------|-------------------|-------------------------------------|
| `selfLeave`                 | yes               | User tapped "Leave Meeting"         |
| `endedByHost`               | yes               | Host ended the meeting for all      |
| `removedByHost`             | yes               | Host kicked the user                |
| `connectionBroken`          | yes               | Network failure                     |
| `freeMeetingTimeout`        | yes               | 40-minute free meeting limit        |
| `hostStartedAnotherMeeting` | yes               | Host's other meeting took over      |
| `noAttendee`                | yes               | Last participant left               |
| `unknown`                   | yes               | Unmapped native code                |
| `*selfLeave`                | yes               | Synthetic — injected by JS handler  |
| `joinBeforeHostTimeout`     | **no**            | Timed out waiting, never in meeting |

## SDK State Flows

### Direct Join (no waiting room)

```
connecting (1)
  |
  +-- onMeetingJoinConfirmed
  +-- onMeetingError { code: 0, message: "success" }
  |
  v
inMeeting (3)          <-- wasInMeeting = true
  |                        meetingContext.inMeetingAt = Date.now()
  |
  v
disconnecting (4)
  |
  v
ended (7)              <-- inject synthetic *selfLeave
                           processAttendance() fires
                           meetingEvents.completed() fires
```

### Waiting Room Flow (most real meetings)

The SDK fires **two full cycles**. The first cycle covers the waiting room,
the second covers the actual meeting.

```
+--- CYCLE 1: Waiting Room ------------------------------------------+
|                                                                     |
|  connecting (1)                                                     |
|    |                                                                |
|    +-- onMeetingJoinConfirmed                                       |
|    +-- onMeetingError { code: 0 }                                   |
|    |                                                                |
|    v                                                                |
|  inWaitingRoom (10)        User sees "Please wait, the host         |
|    |                       will let you in soon"                     |
|    v                                                                |
|  reconnecting (5)          SDK internally transitions                |
|    |                                                                |
|    v                                                                |
|  ended (7)                 ! inMeetingAt is null -- user was never   |
|                            in meeting. Context kept alive.           |
+---------------------------------------------------------------------+

+--- CYCLE 2: Actual Meeting ----------------------------------------+
|                                                                     |
|  connecting (1)                                                     |
|    |                                                                |
|    +-- onMeetingError { code: 0 }                                   |
|    |                                                                |
|    v                                                                |
|  inMeeting (3)             <-- attendance START                     |
|    |                                                                |
|    v                                                                |
|  disconnecting (4)                                                  |
|    |                                                                |
|    v                                                                |
|  ended (7)                 <-- inject synthetic *selfLeave          |
|                                processAttendance() fires            |
+---------------------------------------------------------------------+
```

### Join Failure

```
connecting (1)
  |
  +-- onMeetingError { code: <non-zero>, message: "..." }
  |
  v
disconnecting (4)
  |
  v
ended (7)              <-- inMeetingAt is null, no processing
```

## Attendance Algorithm

Implemented in `ZoomMeetingProvider.tsx` -> `ZoomSDKConsumer`.

### Data Structures

```typescript
/** Tracks a single join attempt — module-level, survives provider remounts */
interface MeetingContext {
  attendanceId: string      // SQLite record ID (UUID)
  uid: string               // Auth0 user ID or "anonymous"
  mid: string               // Our internal meeting ID
  zid: string               // Zoom meeting number joined
  userName: string           // Display name sent to Zoom
  joinedAt: number           // Date.now() when joinMeeting() called
  inMeetingAt: number | null // Date.now() when inMeeting state reached
  events: AttendanceEvent[]  // All SDK events collected during this join
}

interface AttendanceEvent {
  timestamp: number          // Date.now()
  message: string            // Event category (e.g. "Meeting state")
  json: string               // Stringified payload
}
```

`meetingContext` and `wasInMeeting` are **module-level variables** (not React state or refs).
This is intentional — if `ZoomSDKConsumer` remounts (e.g., SDK reinit via key change),
event listeners on the new instance still see the context set by the old instance's `joinMeeting`.

### Step-by-Step Flow

```
1. User taps "Join Meeting"
   +-- SchedulePopup.handleJoin()

2. joinMeeting(config) is called
   +-- Check/request camera & audio permissions
   +-- Resolve ZID (override env var or meeting's own ZID)
   +-- IF profileStore.attendanceEnabled:
   |     +-- Create attendance record in SQLite (status: unprocessed, valid: false)
   |     +-- IF create fails: log error, skip context setup (no attendance for this meeting)
   |     +-- ELSE: set module-level meetingContext, emit attendanceEvents "created"
   +-- ELSE: skip attendance record creation entirely
   +-- Generate Zoom JWT for this meeting
   +-- Fetch ZAK token (authenticated or anonymous via /zak/me)
   +-- Call zoom.joinMeeting({ meetingNumber, userName, password, zoomAccessToken })

3. SDK events stream in, each one:
   +-- Appended to meetingContext.events[] (in-memory)
   +-- Persisted to SQLite via attendanceRepo.addEvent() (fire-and-forget)

4. onMeetingStateChange("inMeeting")
   +-- wasInMeeting = true
   +-- meetingContext.inMeetingAt = Date.now() (only if not already set — preserves
   |   original join time across reconnections)

5. onMeetingStateChange("ended" or "idle")
   +-- IF meetingContext.inMeetingAt is null (never reached inMeeting):
   |     Skip processing, keep context for next SDK cycle
   |     (handles waiting room flow)
   |
   +-- IF meetingContext.inMeetingAt is set:
         +-- Null meetingContext immediately (prevents double processing)
         +-- Inject synthetic "Meeting ended" { reasonName: "*selfLeave" }
         +-- processAttendance() on the captured context
```

### Synthetic End Event

`processAttendance()` requires a `"Meeting ended"` event in the buffer to calculate
the end timestamp. Previously this event came only from the native `onMeetingEndedReason`
callback, which is a separate native callback from `onMeetingStateChange`. When the
state change fires before the end reason (a race condition on iOS), the end event is
missing and the record is silently marked `valid: false`.

The fix: the JS `onMeetingStateChange` handler injects a synthetic `"Meeting ended"`
event with `reasonName: "*selfLeave"` into the buffer **synchronously, before**
calling `processAttendance()`. The `*` prefix marks it as synthetic.

```typescript
// In onMeetingStateChange handler, when state is "ended" or "idle":
if (meetingContext && meetingContext.inMeetingAt) {
  const ctx = meetingContext
  meetingContext = null  // null immediately to prevent double processing

  addEvent("Meeting ended", { reason: 0, reasonName: "*selfLeave" })
  processAttendance(ctx)
    .catch((err) => log.error("processAttendance failed", { error: String(err) }))
}
```

This guarantees `processAttendance()` always finds an end event via `findLast`.
The existing `findLast` call works unchanged — no two-pass search needed — because
the synthetic uses the same `"Meeting ended"` message format.

Nulling `meetingContext` synchronously prevents double processing if "ended" and
"idle" fire in quick succession. The captured `ctx` reference keeps the data alive
for the async `processAttendance()` call.

If the real `onMeetingEndedReason` already fired, both events are in the buffer.
`findLast` picks the synthetic (added last). This is fine — the reason name is
metadata; the timestamp is what matters for credit calculation, and both events
have effectively the same timestamp (same JS tick).

### processAttendance()

```
1. Find start event (first match -- waiting room never produces "inMeeting",
   so first match is always from the real meeting; survives reconnections):
   events.find(e => e.message === "Meeting state"
                  && JSON.parse(e.json).state === "inMeeting")

2. Find end event (last match -- skips stale waiting room ends, picks synthetic):
   events.findLast(e => e.message === "Meeting ended")

3. If either is missing:
   +-- markProcessed(valid: false, credit: 0) with fallback timestamps
   +-- Emit attendanceEvents "processed" with valid: false

4. Calculate credit:
   credit_ms = endEvent.timestamp - startEvent.timestamp
   valid     = credit_ms >= MIN_CREDIT_MS (default 1 minute)

5. Save to SQLite:
   +-- attendanceRepo.markProcessed({ start, end, credit, valid })

6. Notify:
   +-- Emit attendanceEvents "processed" with valid flag
   +-- IF invalid (too short): show "meeting too short" alert
       (with "don't show again" option)
```

### Minimum Credit Threshold

```
MIN_CREDIT_MS = 1 * 60 * 1000   // 1 minute
```

Configurable via `EXPO_PUBLIC_MIN_CREDIT_MINUTES` env var.
Meetings shorter than the threshold are saved with `valid: false`.

## Key Files

| File | Role |
|------|------|
| `app/services/zoom/ZoomMeetingProvider.tsx` | Main provider: join logic, event handling, attendance processing |
| `app/services/zoom/zoomEvents.ts` | Native event bridge, type definitions, `useZoomEvents` hook |
| `app/services/zoom/zoomTypes.ts` | `ZoomJoinConfig` interface |
| `app/services/zoom/generateJwt.ts` | JWT generation for SDK auth |
| `app/services/zoom/permissions.ts` | Camera/audio permission checks |
| `app/services/zak/` | ZAK token fetching (authenticated + anonymous) |
| `app/db/repositories.ts` | `attendanceRepo` — SQLite CRUD for attendance records |
| `app/db/attendanceEvents.ts` | Pub/sub for attendance lifecycle events |
| `app/db/meetingEvents.ts` | Pub/sub for meeting completion (triggers housekeeping) |

## Historical Bugs

### Waiting Room Broke Attendance

Before the fix, the `ended` handler always called `processAttendance()` and
nulled out `meetingContext`. When a meeting had a waiting room, the first
SDK cycle (waiting room) triggered `ended` before `inMeeting` was ever
reached. Attendance was processed with `hasStart: false`, marked `valid: false`,
and the context was destroyed. The second cycle (actual meeting) had no context
left to track.

**Fix:** On `ended`, check `meetingContext.inMeetingAt`. If null,
the user was never in the meeting — skip processing and keep the context alive
for the next SDK cycle.

### Stale End Event Made Attendance Invalid

Even after the waiting room fix above, a subtler bug remained.
When the context was kept alive across SDK cycles, the event buffer accumulated
events from **both** cycles. `processAttendance()` used `events.find()` (first
match) for both start and end events. In a waiting room flow:

- The first "Meeting ended" came from cycle 1 (waiting room teardown)
- The first "inMeeting" came from cycle 2 (actual meeting)

This meant `endEvent.timestamp < startEvent.timestamp`, producing a **negative
credit** (rounded to 0 minutes, `valid: false`) even though the user attended
the full meeting.

**Fix:** Changed end event search from `events.find()` to `events.findLast()`.
Note: the start event search was also changed to `findLast` at the same time,
but this introduced the reconnection bug below. The start event now uses `find()`
(first match) — safe because waiting room cycles never produce `"inMeeting"`.

### Missing End Event Race Condition

`onMeetingEndedReason` and `onMeetingStateChange` are separate native callbacks.
On iOS, `onMeetingEndedReason` is a separate delegate method whose ordering relative
to `onMeetingStateChange(ended)` is not guaranteed by the Zoom SDK. If the state
change fires first, `processAttendance()` runs without an end event in the buffer
and marks the record `valid: false`.

On Android, the native patch synthesizes `onMeetingEndedReason` inside the same
`onMeetingStatusChanged` callback (guaranteed ordering), but this doesn't help iOS.

**Fix:** Inject a synthetic `"Meeting ended"` event with `reasonName: "*selfLeave"`
from the JS `onMeetingStateChange` handler, synchronously before calling
`processAttendance()`. See [Synthetic End Event](#synthetic-end-event).

### Reconnection Reset Start Timestamp

When a user has a network blip mid-meeting (`inMeeting → reconnecting → inMeeting`),
the `onMeetingStateChange("inMeeting")` handler overwrote `meetingContext.inMeetingAt`
with the new timestamp. Combined with `findLast` for the start event, credit was
measured from the reconnect instead of the original join. A 5-minute network blip
cost the user 5 minutes of credit.

**Fix:** Don't overwrite `inMeetingAt` if already set. Use `find()` (first match)
instead of `findLast()` for the start event. Waiting room cycles never produce an
`"inMeeting"` event, so the first match is always from the real meeting.

### Create Failure Left Orphaned Context

If `attendanceRepo.create()` failed, the error was logged but `meetingContext` was
still set with an `attendanceId` that had no SQLite row. Later, `markProcessed()`
silently failed on the non-existent record. User attended the meeting but no
attendance was recorded.

**Fix:** Skip `meetingContext` setup if `create()` fails.

### Double Processing on Rapid State Changes

If `"ended"` and `"idle"` fired in quick succession, `meetingContext` was still
non-null when the second event arrived (nulled asynchronously in `.then()`).
`processAttendance()` ran twice on the same record.

**Fix:** Capture context locally and null `meetingContext` synchronously before
the async `processAttendance()` call.

### Attendance Toggle During Meeting

`processAttendance()` re-checked `profileStore.attendanceEnabled` at processing
time. If the user toggled attendance off mid-meeting, the record was created but
never processed — stuck invisible with `valid: false`.

**Fix:** Remove the `attendanceEnabled` check from `processAttendance()`. The
gate at creation time in `joinMeeting()` is sufficient.
