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

---

## Applied 2026-08-07 — with two additions

The diagnosis above is exact and every line reference in it checked out. The
one-line fix was **not sufficient**, and one hazard it created wasn't listed.

**1. `InPersonContent` needed an API slow path** (`app/screens/InPersonScreen.tsx`).
Routing the id to the `"inperson"` target only gets it to a consumer that then
throws it away. That effect had no fetch by design — its comment read *"the only
producer is the paywall round-trip, which leaves this component mounted with its
list intact"* — and a push tap breaks every clause of it:

- It can **mount** the component (cold start, or a segment never opened). At
  that moment `meetings` is `[]` and `useNearbySchedules` starts at
  `isLoading: false` (`app/hooks/useNearbySchedules.ts:215`), so the old code
  fell straight past its park-and-wait branch and dropped the id on its first
  run, logging *"Pending in-person meeting not in the current list"*. The
  one-liner alone would have changed "nothing opens" into "nothing opens, with
  a warning log".
- Even a fully loaded list is filtered by location permission, GPS fix, radius,
  day and fellowship. A reminder is for a meeting the user **chose** — one set
  at home for a venue 20 miles away is legitimately absent from a 5-mile list.

So the effect now falls back to `api.getScheduleByMeetingId(id, "in_person")`,
mirroring `LiveScreen.tsx:176-232` with the venue guard inverted (keep
in-person, drop anything else — a server that ignores `venueType` answers from
the online pool, and `InPersonPopup` on an online record has no address and no
coordinates to presence-check against). The list still wins when it has the
meeting, because only the list carries `distance_m`.

**2. The `segment` route param is narrowed too, not just the pending target.**
`app.tsx:588` passed `data.segment` through unvalidated into a
`Record<string, string>` handed to `navigate(screen as never, …)`, so every
declared param type is erased on that path. `MeetingsScreen` feeds the value
straight into `activeSegment`, and its three content views each render behind
`display: none` unless their own key matches — an unrecognised value hides all
three, leaving a blank screen under a segmented control still highlighting index
0. `"in_person"`, one underscore from the API's own `venueType` spelling, would
do it. Both the param and the target now come from `parseDeepLinkSegment` /
`pendingTargetForSegment` in the new pure module `app/utils/deepLinkLogic.ts`
(vitest-covered, 5 cases). An unrecognised value yields `undefined`, the param
is omitted, and the app behaves exactly like a build predating the field.

**Stale comments corrected:** the two named above, plus
`setPendingMeetingId`'s own docstring (`navigationUtilities.ts:226-229`, which
justified the `"live"` default by "the original caller … is a live deep link")
and the `InPersonScreen` block quoted in point 1.

**Verification.** `npm run compile`, `lint`, `lint:deps` (no new violations),
vitest 343/343, jest 28/28 — all clean. Device testing still owes the steps in
"Verifying" above, plus the three cases the slow path exists for: location
permission **denied**, user **far** from the venue, and In-Person filtered to a
**different day or fellowship**. Test cold start (force-quit) separately from
warm — they hit different orderings. One gotcha: `app.tsx:575` drops
notification taps entirely while an attendance timer is running, so don't test
with a timer up and conclude the fix failed.

JS-only — no `runtimeVersion` bump, ships as an OTA.
