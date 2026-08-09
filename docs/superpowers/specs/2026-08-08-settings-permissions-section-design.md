# Settings → Permissions Section — Design

**Date:** 2026-08-08
**Status:** Approved for planning

## Goal

Give users a single place in Settings to turn location and push notifications
on and off, and make the In-Person tab ask for location up front instead of
silently degrading when it can't get a fix.

Two problems today:

1. **There is no location control anywhere in the app.** `useNearbySchedules`
   asks for OS permission the first time the In-Person segment opens, and
   `usePresenceCheck` asks again on "I'm Here". Once granted, a user has no
   in-app way to say "stop using my location" — only device Settings.
2. **Push notifications are ungated.** The Notifications section is always
   visible and always operable, even though its main payload — meeting
   reminders — is already premium-gated at the point of creation
   (`SchedulePopup` / `InPersonPopup.handleCellPress`).

## Background: what exists

- **`profileStore.notificationsEnabled`** — `types.optional(types.boolean, true)`
  at `app/models/ProfileStore.ts:70`, MMKV-persisted.
  `SettingsScreen.handleNotificationsToggle` (`:289-305`) requests OS permission
  when switched on and **reverts itself to false if denied**. This
  request-then-revert shape is the pattern the new Location toggle copies.
- **Two independent location consumers**, sharing no code path:
  - `useNearbySchedules` — requests foreground permission on In-Person segment
    activation, sorts/filters by distance, and already falls back to a
    day-browse mode (fellowship + day, no distances) when denied. Exposes
    `canAskAgain` and a tappable permission banner.
  - `usePresenceCheck` — requests permission for the "I'm Here" GPS check.
    `InPersonPopup.tsx:466-481` already handles `denied` with an alert that
    deep-links to device Settings when `canAskAgain` is false.
- **`InPersonScreen` receives `active` and `visible` props** from
  `MeetingsScreen`. `active` latches true the first time the segment is opened;
  `visible` tracks the currently-shown segment. The permission gate below hooks
  onto segment activation, which is where the existing location request already
  fires.
- **Subscription state** is already in scope in `SettingsScreen` — `isPremium`
  and `hasAttendance` are destructured from `useSubscription()` at `:209-216`.

## Decisions

### D1 — Rename the section to "Permissions"

The existing "Notifications" section becomes "Permissions" and holds both rows.
Its `Ionicons` glyph changes from `notifications-outline` to a neutral
`lock-closed-outline`. The `onLayout={trackSection("notifications")}` analytics
tag becomes `trackSection("permissions")`.

### D2 — Push Notifications is gated on `isPremium`

Push exists mainly to deliver meeting reminders, and reminder creation is
already premium-gated. Gating the delivery channel on the same entitlement
keeps one story rather than two.

**Non-premium presentation: the row stays visually active, not greyed.** This
is deliberate and differs from the greyed-out pattern used for the Import row
and the maintenance-disabled Send button. A live-looking control draws more
taps into the subscription funnel than a dead grey one does. Tapping anywhere
on the row — label, hint, or switch — opens the paywall instead of toggling.

Implementation note: the row is wrapped in a `Pressable` with the `Switch`
rendered `pointerEvents="none"` for non-premium users, so the whole row is one
tap target and the switch thumb never animates to a value that immediately
snaps back. Do **not** use the `Switch` `disabled` prop — it greys the control,
which is the thing this decision rejects.

**Accepted consequence:** a non-premium user who already has
`notificationsEnabled === true` keeps receiving push and cannot turn it off
in-app, because every tap routes to the paywall. Their off switch is
iOS/Android system notification settings. Accepted knowingly rather than
special-cased.

### D3 — `notificationsEnabled` default changes `true` → `false`

Only affects **new installs**. Existing users have a persisted MMKV value that
wins over the default, so nobody's current notification state changes on
upgrade.

`ProfileStore.ts:491-492` sets `notificationsEnabled = true` on a reset/import
path. That line must change to `false` alongside the default, or a reset would
re-enable push for a non-premium user who then cannot turn it off (D2).

### D4 — New `profileStore.locationEnabled`, default `false`

MMKV-persisted alongside the other display toggles, with a
`setLocationEnabled(value: boolean)` action matching `setNotificationsEnabled`.

It is a real app-level switch, not a mirror of OS state. When false, the app
does not request or use position **at all** — `useNearbySchedules` short-circuits
before calling `requestForegroundPermissionsAsync()`, and `usePresenceCheck`
is unreachable (see D5).

### D5 — The In-Person segment is the gate

Location is dealt with when the user opens In-Person, before any meeting list
renders. "I'm Here" is downstream and is never reached in an ungated state.

"Segment activation" here means **the segment becoming visible** — the
`visible` prop flipping true — not the `active` latch, which only fires once
per mount and would give a once-ever prompt rather than the every-visit one
D7 requires.

On **every** such activation while `locationEnabled` is false, read the OS
status with the **non-prompting** `getForegroundPermissionsAsync()` and
branch:

| OS status | Action |
|---|---|
| `undetermined` | System permission prompt. Granted → set `locationEnabled` true. |
| `granted` | In-app confirm ("turn the setting on?"). Confirmed → set `locationEnabled` true. |
| `denied` | Alert offering to open device Settings via `Linking.openSettings()`. |

The `granted` branch is what handles both the user who turned the setting off
in Permissions and the user returning from device Settings — identically,
without needing to know which they are. There is no separate migration for
existing users: their next In-Person visit hits the `granted` branch and asks
them once.

### D6 — Declining shows no meeting list

If the user declines any branch of D5, the segment renders the existing
permission banner and **no meetings**. This is a change from today, where a
denied user still gets the day-browse fallback (fellowship + day, no
distances).

The list/map toggle must be hidden in this state — a map with no meetings and
no idea where the user is has nothing to show. This is a new suppression
condition, unrelated to the existing style-URL kill switch in
`shouldShowMapToggle`, and belongs in `InPersonScreen` alongside the banner.

### D7 — Prompt fires on every segment entry

While `locationEnabled` is false, the D5 branch runs on every In-Person
segment activation, not once per launch or once ever.

### D8 — "I'm Here" keeps a silent self-heal

The one reachable bad state is `locationEnabled === false` with OS `granted`
(e.g. the user toggled it off in Permissions mid-session without leaving the
tab). "I'm Here" sets `locationEnabled` true and continues, with no dialog.
Tapping that button is an explicit request for GPS-verified attendance — it
does nothing else — so the tap is the consent.

### D9 — Settings toggle escalates only as far as the OS requires

`handleLocationToggle(true)` reads OS status first:

| OS status | Action |
|---|---|
| `granted` | Set the boolean. Nothing else. |
| `undetermined` | Request permission. Granted → set true; denied → leave false. |
| `denied` | Alert + `Linking.openSettings()`. Leave false. |

`handleLocationToggle(false)` sets the boolean false and nothing more. The app
stops using location; the OS grant is untouched (an app cannot revoke its own
permission).

## Components

| File | Change |
|---|---|
| `app/models/ProfileStore.ts` | Add `locationEnabled` prop (default false) + `setLocationEnabled` action. Change `notificationsEnabled` default to false and the reset path at `:491-492`. |
| `app/screens/SettingsScreen.tsx` | Rename section, add Location row + `handleLocationToggle`, wrap the Notifications row for the non-premium paywall tap. |
| `app/hooks/useNearbySchedules.ts` | Short-circuit before requesting permission when `locationEnabled` is false. |
| `app/screens/InPersonScreen.tsx` | Segment-activation permission gate (D5); render banner instead of list when declined (D6). |
| `app/components/InPersonPopup.tsx` | "I'm Here" self-heal (D8). |
| `app/i18n/*.ts` (nine files) | New keys — see below. |

### Pure-logic extraction

The D5 branch is a pure decision — `(locationEnabled, osStatus) → action` —
with no I/O. It goes in a new `app/utils/locationGateLogic.ts` with **zero
runtime `@/` imports**, so vitest can cover it (see CLAUDE.md "Test Runner
Split"). The I/O half — reading OS status, showing dialogs, opening
Settings — stays in the screen/hook, matching the `presenceLogic.ts` /
`usePresenceCheck.ts` split this codebase already uses.

```ts
export type LocationGateAction = "proceed" | "prompt-os" | "confirm-in-app" | "open-settings"

export function decideLocationGate(input: {
  locationEnabled: boolean
  osStatus: "granted" | "denied" | "undetermined"
}): LocationGateAction
```

## i18n

New keys in `app/i18n/en.ts` and **all eight other locales** — a missing key is
a hard `tsc` error, not a runtime fallback, so every key is a nine-file change.
English text may stand in for the other eight pending translation.

- `settingsScreen:permissionsSection` — "Permissions" (replaces
  `notificationsSection`)
- `settingsScreen:enableLocation` — "Location"
- `settingsScreen:locationHint` — what it's used for
- `settingsScreen:notificationsPremiumTitle` / `…Message` — the paywall prompt
  copy for D2
- `location:gateConfirmTitle` / `…Message` — the D5 `granted` confirm
- `location:gateDeniedTitle` / `…Message` — the D5 `denied` alert
- `location:emptyNeedsLocation` — the D6 banner copy

`presence:*` keys already exist for the "I'm Here" path and are unchanged.

## Testing

- **Vitest** — `locationGateLogic.test.ts` covering all six
  `(locationEnabled × osStatus)` combinations.
- **Jest** — `SettingsScreen` row rendering for premium vs non-premium: the
  non-premium switch must not be `disabled`, and a row tap must call the
  paywall rather than `setNotificationsEnabled`.
- **Manual, on device** — the full D5 matrix requires real OS permission
  states, which neither runner can produce. Note that the In-Person map cannot
  be exercised on the iOS Simulator at all (see
  `docs/superpowers/plans/2026-08-07-in-person-map-view-manual-qa.md`), so the
  declined-state rendering must be verified on hardware.

## Accepted risks

**App Store Guideline 5.1.1.** D6 makes the In-Person tab unusable for a user
who permanently denies location, and in-person meetings do not technically
require location to be listed — fellowship + day is sufficient, which is what
the current fallback does. Gating content on a permission it doesn't strictly
need is the shape of thing 5.1.1 rejections cite. Accepted knowingly; the
counter-argument is that proximity is core to the feature's purpose.

**Repeat prompting.** D7 combined with a `denied`/`canAskAgain: false` user
means the "open device Settings" alert appears on every In-Person visit, over a
permanently empty tab. Accepted knowingly.

Both were raised during design and chosen deliberately. If either surfaces in
review or in the wild, the smallest reversal is D6 → keep the day-browse
fallback, and D7 → once per app launch.

## Out of scope

- Background location. Everything here is foreground-only, matching
  `useNearbySchedules`' existing posture.
- Changing what location data is stored. The privacy accounting in
  `useNearbySchedules.ts`'s header is unchanged: browse coordinates stay
  ref-only, and the attendance path keeps persisting its verified fix by design.
- Any change to the `recoverysky-attendance` entitlement or the Attendance
  section.
