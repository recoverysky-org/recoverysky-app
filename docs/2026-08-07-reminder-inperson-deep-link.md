# Change Request: route in-person reminder taps to the In-Person popup

**Date:** 2026-08-07
**For:** app team
**From:** api
**Size:** one line, plus two stale comments
**Blocked on:** nothing — the API half has shipped

---

## What users get

Tapping a reminder for an **in-person** meeting should open that meeting's
In-Person popup, which already carries the directions button that opens the
device's maps app. Today it opens nothing at all.

## What's broken

`InPersonPopup` renders a Directions button backed by `buildDirectionsUrl()`
(`app/utils/nearbyLogic.ts:248`) — Apple Maps on iOS, `geo:` on Android, Google
Maps on web. That button works. A reminder tap simply never reaches it.

The deep-link chain is:

```
push data { screen, segment, meetingId }
  → app.tsx handleNotificationData
      → navigate("Meetings", { segment, meetingId })   ← segment respected ✅
      → setPendingMeetingId(meetingId)                 ← target defaults to "live" ❌
  → InPersonContent: peekPendingMeetingId("inperson") → undefined
  → nothing opens
```

`setPendingMeetingId(id, target)` defaults `target` to `"live"`
(`app/navigators/navigationUtilities.ts:231`). `app.tsx:591` calls it with the
id only. `peekPendingMeetingId` filters by target *by design* — both popups are
mounted at once, so an untagged id would be raced for — which means
`InPersonContent`'s effect (`app/screens/InPersonScreen.tsx:596`) reads
`undefined` and no-ops forever.

So the user lands on the correct segment with no popup. Before the API change
they landed on the **Live** segment, which discards in-person records outright,
so this has never worked for in-person meetings.

## What changed on the API side

`src/services/reminderSender.ts` now sends `segment` in the push `data`:

| Field | Value |
|---|---|
| `screen` | `"Meetings"` (unchanged) |
| `segment` | **new** — `"inperson"` when `meetings."venueType" = 'in_person'`, else `"live"` |
| `meetingId` | unchanged |
| `mid` | unchanged (legacy alias) |
| `scheduled_for` | unchanged |
| `occurrence_id` | unchanged |

`segment` is derived with `matchesVenueFilter()`, so legacy rows carrying
`venueType = ''` correctly resolve to `"live"`. A reminder with no linked
meeting, or a since-deleted one, also resolves to `"live"` — identical to the
pre-change behaviour, so nothing regresses while this sits unapplied.

Contract documented in `../api/docs/REMINDERS_ALGORITHM.md` §"The Deep-Link
Payload Contract".

## The fix

`app/app.tsx:591`:

```diff
  if (data.meetingId) {
    params.meetingId = data.meetingId
-   setPendingMeetingId(data.meetingId)
+   setPendingMeetingId(data.meetingId, data.segment === "inperson" ? "inperson" : "live")
    trackEvent("notification_meeting_opened", { screen: data.screen })
  }
```

Narrowing explicitly rather than casting `data.segment`: the push payload is
`Record<string, string>` on the wire, and an unrecognised value must fall to
`"live"` rather than address a target that no component consumes.

`addClickHandler` and `getLastNotificationResponse`
(`app/services/notifications/expoNotificationService.ts:273`, `:303`) already
declare `segment?: string` in their data types, and `app.tsx:588` already
forwards it as a route param — so no type or navigation changes are needed.
Both the warm-start and cold-start paths run through `handleNotificationData`,
so the single edit covers both.

## Two comments that are now wrong

Worth correcting in the same commit, since both assert the assumption this
change breaks:

1. `app/screens/MeetingsScreen.tsx:61-63` — *"Fall back to `live` when no segment
   is supplied — push-notification deep links pass meetingId alone and are
   always live."* The fallback is still right; the reason is not. Reminder
   deep links now pass a segment and are not always live.

2. `app/navigators/navigationUtilities.ts:214` — *"The target defaults to
   `live` everywhere, which is why the notification path in app.tsx and
   LiveContent needed no changes."* The notification path now needs the change
   above.

## Verifying

The awkward part is that reminders fire on a server sweep, so end-to-end takes
a real scheduled reminder. Cheapest real check:

1. Create a reminder on an **in-person** meeting a few minutes out
   (`POST /reminders`), with `REMINDER_SCHEDULER_ENABLED` and
   `REMINDER_SENDER_ENABLED` on in the target environment.
2. Background the app, wait for the push, tap it.
3. Expect: Meetings tab → In-Person segment → that meeting's popup, with the
   Directions button present. Tapping it opens the device maps app.
4. Repeat with an online meeting and confirm Live still opens SchedulePopup.

Faster local loop, no server: call `handleNotificationData` directly, or send
yourself an Expo push with
`{"screen":"Meetings","segment":"inperson","meetingId":"<real in-person id>"}`
via <https://expo.dev/notifications>.

Regression to watch: a reminder for an online meeting must still open
SchedulePopup on Live. The `"live"` fallback covers old API builds that send no
`segment` at all.

## Not in scope

- Notification **text** still doesn't mention the venue — a reminder reads
  "X starts in 15 minutes" with no location hint. Deliberately left alone; it
  touches every reminder's wording and deserves its own decision.
- The `/notifications` subscription system is untouched. It uses a different
  payload contract (`type`, `delivery_id`, `action`, `action_payload`) and has
  no meeting deep link at all.
