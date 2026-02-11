# Meeting Attendance Flow

How the Zoom SDK native events drive attendance tracking in RecoverySky.

## Zoom SDK Events We Subscribe To

Five native callbacks are bridged via `NativeEventEmitter` in `zoomEvents.ts`:

| Event                    | Payload                          | When it fires                              |
|--------------------------|----------------------------------|--------------------------------------------|
| `onMeetingStateChange`   | `{ state, stateName }`           | Every SDK state transition                 |
| `onMeetingError`         | `{ errorCode, message }`         | Join errors **and** success (code 0)       |
| `onMeetingJoinConfirmed` | *(none)*                         | Server accepted the join request           |
| `onMeetingEndedReason`   | `{ reason, reasonName }`         | Meeting session terminated                 |
| `onAuthReturn`           | `{ errorCode, success, message }`| SDK auth/JWT validation result             |

### Meeting State Codes (`onMeetingStateChange`)

```
Code  Name               Meaning
────  ─────────────────  ──────────────────────────────────────
 0    idle               No active meeting
 1    connecting         TCP/TLS handshake in progress
 2    waitingForHost     Joined before host started the meeting
 3    inMeeting          ★ User is in the live meeting room
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

### Meeting End Reasons (`onMeetingEndedReason`)

```
Reason Name                  When
───────────────────────────  ─────────────────────────────────
selfLeave                    User tapped "Leave Meeting"
removedByHost                Host kicked the user
endedByHost                  Host ended the meeting for all
joinBeforeHostTimeout        Waited too long for host
freeMeetingTimeout           40-minute free meeting limit
noAttendee                   Last participant left
hostStartedAnotherMeeting    Host's other meeting took over
connectionBroken             Network failure
unknown                      Unmapped native code
```

## SDK State Flows

### Direct Join (no waiting room)

```
connecting (1)
  │
  ├── onMeetingJoinConfirmed
  ├── onMeetingError { code: 0, message: "success" }
  │
  ▼
inMeeting (3)          ◄── attendance START timestamp
  │
  ▼
disconnecting (4)
  │
  ├── onMeetingEndedReason { reason: "selfLeave" }   ◄── attendance END timestamp
  │
  ▼
ended (7)              ◄── processAttendance() fires here
```

### Waiting Room Flow (most real meetings)

The SDK fires **two full cycles**. The first cycle covers the waiting room,
the second covers the actual meeting.

```
┌─── CYCLE 1: Waiting Room ───────────────────────────────────────┐
│                                                                  │
│  connecting (1)                                                  │
│    │                                                             │
│    ├── onMeetingJoinConfirmed                                    │
│    ├── onMeetingError { code: 0 }                                │
│    │                                                             │
│    ▼                                                             │
│  inWaitingRoom (10)        User sees "Please wait, the host      │
│    │                       will let you in soon"                  │
│    ▼                                                             │
│  reconnecting (5)          SDK internally transitions             │
│    │                                                             │
│    ├── onMeetingEndedReason { reason: "selfLeave" }              │
│    │                                                             │
│    ▼                                                             │
│  ended (7)                 ⚠ First "ended" — but user was        │
│                            never inMeeting! Context kept alive.  │
└──────────────────────────────────────────────────────────────────┘

┌─── CYCLE 2: Actual Meeting ─────────────────────────────────────┐
│                                                                  │
│  connecting (1)                                                  │
│    │                                                             │
│    ├── onMeetingError { code: 0 }                                │
│    │                                                             │
│    ▼                                                             │
│  inMeeting (3)             ◄── attendance START                  │
│    │                                                             │
│    ▼                                                             │
│  disconnecting (4)                                               │
│    │                                                             │
│    ├── onMeetingEndedReason { reason: "selfLeave" }              │
│    │                       ◄── attendance END                    │
│    ▼                                                             │
│  ended (7)                 ◄── processAttendance() fires here    │
└──────────────────────────────────────────────────────────────────┘
```

### Join Failure

```
connecting (1)
  │
  ├── onMeetingError { code: <non-zero>, message: "..." }
  │
  ▼
disconnecting (4)
  │
  ├── onMeetingEndedReason { reason: "..." }
  │
  ▼
ended (7)              ◄── processAttendance() saves valid: false
```

## Attendance Algorithm

Implemented in `ZoomMeetingProvider.tsx` → `ZoomSDKConsumer`.

### Data Structures

```typescript
/** Tracks a single join attempt */
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

### Step-by-Step Flow

```
1. User taps "Join Meeting"
   └─► SchedulePopup.handleJoin()

2. joinMeeting(config) is called
   ├─► Check/request camera & audio permissions
   ├─► Resolve ZID (override env var or meeting's own ZID)
   ├─► Create attendance record in SQLite (status: unprocessed)
   ├─► Store MeetingContext in meetingContextRef
   ├─► Generate Zoom JWT for this meeting
   ├─► Fetch ZAK token (authenticated or anonymous)
   └─► Call zoom.joinMeeting({ meetingNumber, userName, password, zoomAccessToken })

3. SDK events stream in, each one:
   ├─► Appended to MeetingContext.events[]
   └─► Persisted to SQLite via attendanceRepo.addEvent()

4. onMeetingStateChange("inMeeting")
   └─► Set meetingContextRef.current.inMeetingAt = Date.now()

5. onMeetingEndedReason fires
   └─► "Meeting ended" event added to context

6. onMeetingStateChange("ended")
   ├─► IF inMeetingAt is null (never reached inMeeting):
   │     Skip processing, keep context for next SDK cycle
   │     (handles waiting room flow)
   │
   └─► IF inMeetingAt is set:
         └─► processAttendance()
```

### processAttendance()

```
1. Skip entirely if profileStore.attendanceEnabled is false

2. Find start event (last match — survives multi-cycle joins):
   events.findLast(e => e.message === "Meeting state"
                      && JSON.parse(e.json).state === "inMeeting")

3. Find end event (last match — skips stale waiting room ends):
   events.findLast(e => e.message === "Meeting ended")

4. If either is missing:
   └─► markProcessed(valid: false, credit: 0)

5. Calculate credit:
   credit_ms = endEvent.timestamp - startEvent.timestamp
   valid     = credit_ms >= MIN_CREDIT_MS (1 minute)

6. Save to SQLite:
   └─► attendanceRepo.markProcessed({ start, end, credit, valid })

7. Notify UI:
   ├─► valid: show success toast
   └─► invalid (too short): show "meeting too short" alert
       (with "don't show again" option)
```

### Minimum Credit Threshold

```
MIN_CREDIT_MS = 1 * 60 * 1000   // 1 minute
```

Meetings shorter than 1 minute are saved with `valid: false` and a warning
dialog is shown (unless the user has dismissed it permanently).

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

## Historical Bug: Waiting Room Broke Attendance

Before the fix, the `ended` handler always called `processAttendance()` and
nulled out `meetingContextRef`. When a meeting had a waiting room, the first
SDK cycle (waiting room) triggered `ended` before `inMeeting` was ever
reached. Attendance was processed with `hasStart: false`, marked `valid: false`,
and the context was destroyed. The second cycle (actual meeting) had no context
left to track.

**Fix:** On `ended`, check `meetingContextRef.current.inMeetingAt`. If null,
the user was never in the meeting — skip processing and keep the context alive
for the next SDK cycle.

## Historical Bug: Stale End Event Made Attendance Invalid

Even after the waiting room fix above, a subtler bug remained.
When the context was kept alive across SDK cycles, the event buffer accumulated
events from **both** cycles. `processAttendance()` used `events.find()` (first
match) for both start and end events. In a waiting room flow:

- The first "Meeting ended" came from cycle 1 (waiting room teardown)
- The first "inMeeting" came from cycle 2 (actual meeting)

This meant `endEvent.timestamp < startEvent.timestamp`, producing a **negative
credit** (rounded to 0 minutes, `valid: false`) even though the user attended
the full meeting.

**Fix:** Changed both `events.find()` calls to `events.findLast()` so that
`processAttendance()` always picks the final inMeeting/ended pair from the
last SDK cycle — the one representing the actual meeting session.
