# Location Permission Drift & Presence Telemetry — Design

**Date:** 2026-08-12
**Status:** Draft, awaiting approval

## Goal

Two defects found while tracing what happens when a user picks **"Allow Once"**
(iOS) / **"Only this time"** (Android) on the system location prompt.

1. **`profileStore.locationEnabled` can outlive the OS grant it was written
   from.** The reconciliation that fixes this only runs on a
   `background → active` AppState transition. A one-time grant most often dies
   with the *process*, which produces no such transition — so Settings →
   Permissions shows **Location ON for a permission the app no longer holds**,
   indefinitely.
2. **Four of the five outcomes of the "I'm Here" presence check emit no
   telemetry.** `inperson_attendance_started` fires only on `verified`
   (`InPersonPopup.tsx:455`); `out-of-range`, `no-venue-coords`, `denied`, and
   `fix-failed` each return after an `Alert.alert` with nothing recorded. The
   failure mode in (1) lands squarely in the `denied` arm, so today it is
   invisible in Umami — we cannot measure the bug we are fixing.

Both fixes are JS-only. Neither touches native shape, so this ships as an OTA
and **must not** bump `runtimeVersion`.

## Background: what exists

### The two consents

`locationEnabled` is deliberately a *second, independent* consent layered on
top of the OS grant — see D4/D5 of
`2026-08-08-settings-permissions-section-design.md`. The OS says "you may"; our
toggle says "I want you to". `decideLocationGate`'s `confirm-in-app` branch
exists precisely for OS-granted-but-toggle-off. **Nothing in this spec changes
that model** — it only makes the toggle stop claiming a grant we don't have.

### Where `locationEnabled` is written `true`

| Site | Trigger |
|---|---|
| `useLocationGate.ts:119` | `setLocationEnabled(granted.granted)` after the OS prompt |
| `useLocationGate.ts:145` | User accepts the `confirm-in-app` dialog (web `window.confirm`) |
| `useLocationGate.ts:162` | User accepts the `confirm-in-app` dialog (native `Alert`) |
| `SettingsScreen.tsx:354` | Permissions toggle, `confirm-in-app` branch — OS already granted |
| `SettingsScreen.tsx:365` | Permissions toggle, `prompt-os` branch |
| `InPersonPopup.tsx:411` | "I'm Here" self-heal (D8) — written **before** the check runs |

Six write sites against one clear site is the asymmetry that makes this fail:
every path that can turn the flag on is a path that can strand it.

### Where it is written `false`

Exactly one place: the resume sync at `app.tsx:944-949`, inside an
`AppState.addEventListener("change", …)` callback that only acts on
`inactive|background → active`. **There is no read at startup** — the effect
installs a listener and nothing more.

### Why "only once" is the case that breaks it

Neither platform tells us the grant is temporary. iOS reports
`authorizedWhenInUse` for "Allow Once" exactly as for "While Using the App";
Android reports granted for "Only this time". `toOsStatus` sees
`granted: true`, and `useLocationGate.ts:119` persists that as durable in-app
consent. When the grant lapses, both platforms revert to askable
(`granted: false, canAskAgain: true`), which `toOsStatus` maps to
`"undetermined"` → `decideLocationGate` → `"prompt-os"`. The **gate** is
therefore always correct; only the persisted flag goes stale.

### What the stale flag does and does not cost

**It does not leak position.** Every consumer re-reads the OS before touching a
coordinate — `useDeviceLocation.ts:202`, `useNearbySchedules.ts:341`,
`usePresenceCheck.ts:80`. A stale `true` clears the in-app gate and is then
correctly refused by the OS. Verified by inspection of all three; this is the
reason the defect is cosmetic rather than a privacy incident.

**It does cost:**
- Settings → Permissions renders `value={locationEnabled}`
  (`PermissionsSection.tsx:109`) straight from the store, so the switch lies.
- `effectiveViewMode` (`InPersonScreen.tsx:877-885`) gates the map on
  `locationEnabled`. A stale `true` plus a persisted `viewMode: "map"` mounts a
  MapLibre surface and `NativeUserLocation` puck with no grant — a map centred
  on nothing, instead of the list fallback that same expression exists to
  provide. The comment at `:868` anticipated the toggle-*off* case but not
  stale-*true*.

### A second drift source, not cold-start specific

`InPersonPopup.handlePresence` sets `locationEnabled = true` at `:410-412`
*before* awaiting `check()`. When the outcome is `denied`, the flag is left on
with no OS grant — same drift, immediately, on a warm process. Today only a
background round-trip clears it.

## Decisions

### D1 — Reconcile lazily, never at startup

**Constraint: no location call of any kind — not even a non-prompting read —
before the app is fully running and the user has navigated.** This is the rule
`useNearbySchedules` and `useDeviceLocation` already state in their headers
("this hook never acquires on mount"; "the prompt is lazy and caller-driven").
A startup reconciliation read was the first design considered and is
**rejected**: it would have made this the only code in the app that touches the
location subsystem during boot, for a cosmetic fix.

Instead, reconcile at three points that are already user-driven. Revoke-only in
all three: if the OS says no and our flag says yes, write `false`, never the
reverse — auto-enabling would answer the in-app consent question on the user's
behalf, exactly what `app.tsx:935-943` argues against for the resume path.

| # | Site | New OS call? |
|---|---|---|
| a | `useNearbySchedules.acquireLocation`, denial path (`:341-345`) | **No** — `perm.granted` is already in hand |
| b | `usePresenceCheck.check`, denial path (`:80-84`) | **No** — `perm.granted` is already in hand |
| c | `SettingsScreen`, on tab **focus** | One `getForegroundPermissionsAsync` (never prompts), only when the user navigates to Settings |

(a) and (b) add **zero** location calls — they reuse a permission response the
app has already received and currently throws away. (c) is the only new read in
the design, and it fires on a screen the user deliberately navigated to, which
is unambiguously "fully running and navigated".

Each site is also where its symptom is actually reachable: (c) is the only place
the switch is rendered; (a) is what leaves `effectiveViewMode` stuck on `"map"`;
(b) is the `denied` arm that D4 creates.

**This supersedes the race described in the first draft.** Every reconciliation
now happens with a permission answer obtained at that moment, in response to a
user action, so there is no stale read that can clobber a fresh grant. The
accepted risk is retired rather than mitigated.

Rejected alternatives:

- **Derive `locationEnabled` from the OS at read time.** Collapses the two
  consents into one and deletes the `confirm-in-app` branch. That is a redesign
  of an approved model, not a bug fix.
- **Have `PermissionsSection` read live OS status.** Fixes only the display; the
  map-mode edge at `InPersonScreen.tsx:877` reads the store and would still be
  wrong. It also puts an async OS call into a component whose whole design point
  (per the permissions spec) is that it is presentational and prop-driven.

### D1a — Why `SettingsScreen` needs a focus listener, not a mount effect

Settings is a tab screen: it mounts once and stays mounted behind the other
tabs. A `useEffect(…, [])` would run exactly once per app launch — before the
user has likely visited Settings, and never again. `navigation.addListener("focus", …)`
is the pattern `AttendanceScreen` already uses for section routing, and it is
what makes the switch truthful *every* time the user looks at it.

### D2 — Extract the revoke predicate into `locationGateLogic.ts`

```ts
/**
 * Should the in-app Location toggle be forced off to match the OS?
 *
 * One-directional by design: true only when we claim a grant the OS does not
 * give us. The false→true direction is a *consent* question that only the user
 * can answer (see decideLocationGate's "confirm-in-app" branch).
 */
export function shouldRevokeLocationFlag(input: {
  osGranted: boolean
  locationEnabled: boolean
}): boolean {
  return !input.osGranted && input.locationEnabled
}
```

The predicate is two terms, so extraction is not about complexity — it is about
having **one** definition shared by the startup and resume call sites. The
defect being fixed *is* a reconciliation that exists on one path and not the
other; leaving two hand-written copies invites the same class of bug back.
`locationGateLogic.ts` is already vitest-covered and already free of runtime
`@/` imports, so this costs nothing to test.

### D3 — Location only; notifications stay on resume-sync alone

The same effect syncs notification permission bidirectionally, and that sync has
side effects — `optInNotifications()` / `optOutNotifications()` both hit the
`/push-tokens/` API. Extending it to fire on every cold start would add a
network call to app launch for every user, which is a materially different
change from reading a permission. Notification drift on cold start is a real but
separate issue; noted in "Out of scope".

### D4 — Keep the optimistic "I'm Here" write; reconcile it on refusal

`InPersonPopup.tsx:410-412` writes `locationEnabled = true` *before* awaiting
`check()`. Moving that write to after a successful check was considered and
**rejected**: the tap-is-consent semantics are D8 of an approved spec, and the
honest reading is that the flag means "I'm willing" while the OS means "you
may". A user who taps "I'm Here" has expressed willingness whatever the OS then
says.

What was wrong is that nothing undid the write when the OS refused. D1(b)
closes that inside `usePresenceCheck`'s denial path, so the optimistic write
stands when the OS agrees and is reconciled the moment it doesn't. The write
site itself is unchanged.

### D5 — One `inperson_presence_failed` event, fired before the switch

Place the call immediately after `await check(...)` and **before** the `switch`,
not inside the four rejection arms:

```ts
const outcome = await check({ latitude: meeting.latitude, longitude: meeting.longitude })

// Fired here, not in the four rejection arms below, so it is exhaustive by
// construction: a new PresenceCheckOutcome status is tracked the moment it
// exists, and no branch can be added without telemetry. TypeScript narrows
// `outcome.status` to the union minus "verified", so the payload type follows
// the source of truth automatically.
if (outcome.status !== "verified") {
  trackEvent("inperson_presence_failed", { reason: outcome.status })
}

switch (outcome.status) { /* unchanged */ }
```

Four separate events were rejected: the failure total should be a single number,
and a new outcome status would otherwise fragment the funnel silently.

### D6 — Payload is `{ reason }` and nothing else

`distanceM` and `radiusM` are both in scope at the fire site and are both
excluded. Distance is derived from the user's position and is exactly what the
privacy rule in `InPersonPopup.tsx:447` and the `InPersonScreen.tsx` header
name; radius is server config, recoverable from `/config` history without
riding on the event.

`canAskAgain` on the `denied` arm was considered — it would separate
"temporarily lapsed" (the only-once case) from "permanently refused". Excluded
for now: one column answers "is 'I'm Here' working?", which is the question we
currently cannot answer at all. Revisit if `denied` turns out to dominate the
reason split.

**No venue id, ever** — it is a location proxy, and paired with the Umami `id`
field it reveals where a specific person physically was. Same rule as
Group 3a in `EVENTS.md`.

## Files

| File | Change |
|---|---|
| `app/utils/locationGateLogic.ts` | Add `shouldRevokeLocationFlag` (D2) |
| `app/utils/locationGateLogic.test.ts` | Cover the new predicate |
| `app/app.tsx` | Refactor the existing resume write onto the shared predicate. **No startup read** (D1) |
| `app/hooks/useNearbySchedules.ts` | Revoke on the existing denial path (D1a) |
| `app/hooks/usePresenceCheck.ts` | Revoke on the existing denial path (D1b, D4) |
| `app/screens/SettingsScreen.tsx` | Focus-listener reconciliation (D1c) |
| `app/components/InPersonPopup.tsx` | `inperson_presence_failed` (D5/D6) |
| `EVENTS.md` | Promote `inperson_presence_failed` out of the proposed section into **Group 4 (Attendance)**, directly beneath `inperson_attendance_started` — the two are the complete outcome space of one presence check, so they belong adjacent. Group 3a is the browse/filter layer and is the wrong home |
| `CHANGELOG.md` | `Fixed` entry for the drift; the analytics addition is not user-visible |

**No i18n changes.** Neither fix adds a user-facing string, so this avoids the
nine-file locale change that any new key would force.

## Testing

### Automated — vitest, `app/utils/locationGateLogic.test.ts`

`shouldRevokeLocationFlag` across all four input combinations, with the
`osGranted: true, locationEnabled: false` case asserted explicitly as `false`
— that is the `confirm-in-app` state, and a predicate that returned `true`
there would silently delete the second consent layer.

### Manual — required

The drift itself cannot be unit-tested: it lives in an AppState listener over a
native permission. Matrix, per platform:

1. **Cold-start reconciliation (the fix).** Grant "Allow Once" → use In-Person →
   force-quit → relaunch → open Settings → Permissions. **Location must read
   OFF.** This is the failing case today.
2. **Warm-resume reconciliation (must not regress).** Grant "Allow Once" →
   background until the grant lapses → foreground → Settings shows OFF.
3. **No false revoke.** Grant "While Using the App" → force-quit → relaunch →
   Settings still reads ON, and In-Person loads nearby meetings without a
   re-prompt.
4. **`confirm-in-app` survives.** OS granted, toggle manually off → open
   In-Person → the in-app confirm dialog appears (not a device-settings
   deep-link, not the OS prompt).
5. **Map degrade.** With `viewMode` persisted as `"map"`, run case 1 → the
   segment opens as a **list**, not an empty map.
6. **Presence telemetry.** Force each of the four arms and confirm one
   `inperson_presence_failed` per attempt with the right `reason`:
   `denied` (revoke in device Settings mid-session), `out-of-range` (any meeting
   > `presenceRadiusM` away), `fix-failed` (Airplane Mode with location
   services off), `no-venue-coords` (a meeting row with null lat/lon).
7. **`verified` stays clean.** A successful check fires
   `inperson_attendance_started` and **no** `inperson_presence_failed`.
8. **No location call at boot (the D1 constraint).** Cold-start the app with a
   granted permission and sit on the Home tab without navigating. Confirm via
   the native permission log — iOS: Settings → Privacy → Location Services →
   the app shows no new access arrow; Android: `adb shell dumpsys location`
   shows no request from our package — that nothing touched the location
   subsystem. Then open Settings and confirm a read *does* occur. This is the
   assertion that keeps a future contributor from "helpfully" restoring the
   startup sync.
9. **Map degrade via the In-Person path (D1a).** Run case 1 but open the
   In-Person segment instead of Settings: the nearby banner appears **and** the
   segment falls back to the list, proving the revoke fired from
   `acquireLocation` rather than from the Settings focus listener.

Umami verification: confirm no event payload anywhere in the reason split
carries a coordinate, a distance, or a venue id.

## Accepted risks

**A stale flag survives until the user reaches one of the three sites.** With no
startup read (D1), a cold-started app can hold `locationEnabled: true` against a
lapsed grant until the user opens Settings, the In-Person segment, or taps "I'm
Here". This is accepted deliberately: the flag is inert while stale — every
consumer re-reads the OS before touching a coordinate (`useDeviceLocation.ts:202`,
`useNearbySchedules.ts:341`, `usePresenceCheck.ts:80`), so it cannot produce an
ungated fix. Reconciling it *before* anyone can observe it would mean a boot-time
location call, which the constraint in D1 rules out and which is a worse trade
than a briefly-stale boolean nobody is looking at.

**The only-once user is re-prompted every launch, and sees their Settings toggle
turn itself off each session.** Correct — it is what "only once" means — but it
looks like a malfunction from outside. Not addressed here; D6's excluded
`canAskAgain` field is what would let us measure how many users are in this
state before deciding whether it deserves in-app copy.

**The `denied` reconciliations (D1a/D1b) write during a render-triggering
callback.** Both flip an observable the surrounding screens read. Verified
non-looping: `acquireLocation` early-returns when the flag is false, so it cannot
re-enter; `InPersonScreen`'s `visible`-edge effect is keyed on a per-visit ref
rather than the flag; and `wasLocationEnabledRef` fires only on the false→true
edge, which a revoke never produces. A future edit that keys any of those effects
on `locationEnabled` directly would re-open this — see the CLAUDE.md note about
that exact trap.

## Out of scope

- **The other five proposed in-person events** (`inperson_popup_viewed`,
  `inperson_location_gate`, `inperson_nearby_failed`, `inperson_nearby_empty`,
  `inperson_map_marker_tapped`, `inperson_timer_cancelled`). They stay in
  `EVENTS.md`'s proposed section pending separate sign-off.
- **Notification permission drift on cold start** (D3).
- **The 24 implemented-but-undocumented events and the stale `zoom_connected`
  entry** found in the 2026-08-11 audit — a documentation pass, tracked
  separately.
- **Changing the two-consent model** (D1) or the tap-is-consent self-heal (D4).

## Release

JS-only. Ships via `npm run update` (OTA). **Do not bump `runtimeVersion`** —
no native dependency, config, plugin, or `app.json` native key is touched.
