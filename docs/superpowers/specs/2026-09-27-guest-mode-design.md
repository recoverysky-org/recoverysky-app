# Guest mode: Meetings only, Android only

Status: implemented on `feat/guest-mode` (2026-10-11); the on-device pass (plan Task 9 Step 4) is
pending. Drafted 2026-09-27 on that branch (worktree `.claude/worktrees/guest-mode`), which was cut
from `feat/passwordless-auth` @ 5c2c14d and builds on its login screen and owner gate. The plan,
`docs/superpowers/plans/2026-09-28-guest-mode.md`, ends with "Execution notes" listing the rulings
that changed it.

Naming (2026-10-11): this feature is **guest mode** everywhere: code, copy, docs and commits.
"Anonymous" named the old device-id login, which this work deletes. Renamed from
`2026-09-27-anonymous-meetings-only-mode-design.md`; the branch was `feat/anonymous-auth`.

## Why

Most Android installs never get past the login screen. An account is required for everything the app
stores about a person, but browsing and joining a meeting records nothing personal. This mode lets
Android users open the app, find a meeting, and join it without signing in.

## What a guest gets

- **Only the Meetings tab:** Online, In-Person and Search, and joining meetings through the external
  Zoom app. No Home, Attendance or Settings tabs, and no onboarding. CHANGED 2026-10-11 (Jenova): a
  guest's first visit opens with four onboarding cards (Welcome, Install Zoom, Your Privacy Matters,
  Open Source), tracked by their own flag so a later real sign-in still gets all six.
- **No account, and nothing personal is recorded.** They get no user id and no local rows: no clean
  time, 90-in-90, attendance, reminders, theme color, favorites or meeting ratings (all out of scope
  for v1). The phone keeps only device settings: that guest mode is on and its first-visit cards
  were seen, the Meetings tab's filter and view choices (shared with the device owner), the location
  permission choice, and that the legal agreements were accepted. Logs and analytics carry no user id. CHANGED 2026-10-11: this said
  "Nothing about them is stored or tracked", which the persisted flag and those settings contradict.
- **On a borrowed or shared phone the app shows meetings and nothing else.** No data belonging to the
  device owner is visible. ADDED 2026-10-11: device settings are shared (the Meetings filter picks,
  the In-Person view, sort order and radius, the location permission), so per Decision 2 a guest can
  see the device's last bar pick. Nothing personal of the owner's is shown.
- **The mode persists across relaunches.** A guest lands on Meetings until they choose to
  sign in.
- **Android only.** iOS requires an authenticated account, so the entry point is never rendered on iOS.

Hidden features become sign-in prompts, since converting guests to accounts is the point. At minimum,
the Meetings header shows a persistent "Sign in" affordance.

## Identity model (the core decision)

The old device-id login (`loginAnonymously()`) is **not** revived. It set `userId = deviceId` and
`isAuthenticated = true`. That device-id identity leaked into RevenueCat, Sentry, Umami, the sync
queue owner and reminder uids (audit of 2026-09-27). The new mode:

- Adds a persisted `isGuest` flag to `AuthenticationStore`.
- Keeps `userId` undefined and `isAuthenticated` false. Every consumer keyed on `isAuthenticated`,
  `userId` or "has a session" therefore already does nothing for guests: sync, push registration,
  RevenueCat identity, report polling and the Auth0 profile reaction.
- Has `AppNavigator` route guests to a guest navigator that holds only the Meetings stack.
- Clears `isGuest` on any real sign-in (the Auth0 sync effect) and on the Sign-in button, which
  sends the user to Login.

No migration on sign-in is needed, because a guest has nothing to migrate.

**Guest mode never sets `userId`.** Nothing in guest mode needs an identity, and nothing stands in
for one: no device-id identity, no placeholder uid, no hashed id. Anything that needs `userId` is
by definition not a guest feature.

### Removing the old device-id login entirely (decided 2026-09-27)

`isGuest` is a new concept, not a rename. The old device-id login is removed completely: code,
comments, types and strings. No `isAnonymous` / `loginAnonymously` / "anonymous user" wording is
left behind to be mistaken for a live path. The ~59 references across `app/` include:
- store: the `isAnonymous` prop, `loginAnonymously()`, and its branch in `isAuthenticated`
- `useAuth0Wrapper.loginAnonymously`, the `loadStoredAuth0` restore branch for it, and
  `LoginScreen`'s `"anonymous"` action / commented-out button
- the `setupRootStore` cold-start reset, plus the worktree's owner-stamp guard comment that
  explains itself in terms of device-id-login snapshots
- the readers in sync (`gate()`, the reaction), `rcIdentityLogic`, `pushRegistrationLogic`,
  `userTokenRefresher`, `emailAttributeLogic`, `ownerLogic`, `BackupPassRunner`, the app.tsx
  shortName→Auth0 reaction, and the Settings branches for it ("Anonymous user", "Login to
  Subscribe")
- the `"anonymous"` uid fallbacks in the timer modals, `en.ts` `continueAnonymously` /
  `anonymousUser` in all nine locales, and `platformStrings*.ts`
- the tests that cover these branches

Each reader either loses its device-id-login branch (its "signed in" check already excludes guests,
because a guest has no `userId` and no session) or, where a guest-specific check is still needed,
reads `isGuest`. Per the Comments convention, rewritten comments explain the change
("CHANGED 2026-10-11: device-id login removed; guests have no userId") rather than silently
dropping history where the history still explains a guard.

**Verify during implementation:** MST's handling of the now-unknown `isAnonymous` key in persisted
MMKV snapshots (it must be dropped silently, not throw on `applySnapshot`).

This removal:
- closes TODO 7cc1b9e ("the device id is never a user identity");
- fixes a live bug: legacy Android installs that used the old device-id login (Dec 2025 to May 2026)
  keep `userId = deviceId` after the cold-start reset, and `rcIdentityFor()` returns it, so
  `SubscriptionProvider` calls `Purchases.logIn(deviceId)`.

**Legacy snapshot hydration.** In `setupRootStore`, an MMKV snapshot with `userId === deviceId` and no
stored credentials is a leftover device-id-login session. Clear `userId` and `isAnonymous`, and land the
user on Login. Do not convert them to guests; they were never guests.

The `platformStrings` "Continue Anonymously" copy should be reworded for the new mode. Keep the
`platformStrings.ios.ts` stripping, since the Apple rejection was about the bundled text.

## Navigator

`AppNavigator` order becomes:

1. Maintenance / outage
2. authenticated → Onboarding / Main
3. foreign session → WrongAccount
4. `isGuest` → Guest
5. Login

WrongAccount keeps precedence over Guest, so a wrong-account state is never masked.

The guest navigator reuses `MeetingsScreen` (segmented control + `MeetingFilterBar`, all three
segments), wrapped in a screen with the Sign-in header action. It has no tab bar.

## Leaks inside the Meetings tab

Hiding tabs is not enough. These paths reach user data or write it:

| Where | Problem | Guest behavior |
|---|---|---|
| `useZoomMeeting.ts:170` `userName: config.userName ?? profileStore.displayName` | `?un=` prefill joins the Zoom meeting under the device owner's name | removed 2026-10-11: no join link carries a name |
| `SchedulePopup.handleJoin` (`:421`, `:468`) | shows `ExternalZoomTimerModal` when `attendanceEnabled` | open Zoom directly, no timer |
| `SchedulePopup` / `InPersonPopup` reminder cells | reminders need a user | hidden |
| `InPersonPopup` "I'm Here" presence check | writes attendance | hidden |
| `ProfileStore.themeColor` | owner's accent color | default theme |
| Location gate `confirm-in-app` writes `profileStore.locationEnabled` | a device setting, not personal data | unchanged: same as today, writes `locationEnabled` (decided 2026-09-28) |
| `MeetingFilterBar` / `MeetingFiltersContext` | fellowship + language pickers | guests get the full filter bar as today, but the fellowship defaults to **AA** instead of the owner's Settings fellowship (`resolveFellowship`'s `saved` input is `"AA"` for a guest). A pick made in the bar is remembered as today. Decided 2026-09-28 |
| Deep links / notification taps into other tabs | would navigate to screens a guest doesn't have | ignored, or routed to Meetings |

## App-wide pieces mounted in `app.tsx`

Each runs regardless of tab. Verify each one's guest behavior; none may write or send user data.

- `SubscriptionProvider`: unchanged — a guest is identical to a signed-out user on the Login screen
  (the SDK runs on `$RCAnonymousID`, no `logIn`). Skipping init was dropped: a later sign-in relies
  on the SDK already being configured (decided 2026-10-11).
- `initializeNotifications`: no permission prompt and no token registration for guests.
- `ProfileHydrator`, `ChatHydrator`, `ReportPollingResumer`, `TimerSessionResumer`, `SyncResumer`,
  `BackupPassRunner`, `TimerRecoveryGate`: expected to bail without a session. Confirm each.
- `AnnouncementGate`, rating engine: suppress for guests in v1.
- Umami / Sentry / logger: no user id. The logger already carries `deviceId` on every line, which is
  enough to count guest sessions. Add an `authMode: "guest"` attribute or event for the funnel.

## Found during planning

- **The feedback cache.** The local favorites / ratings / join-count cache was already per device
  and shown in every Meetings list and popup, so a guest would have seen the owner's hearts and
  stars and written into them. It is suppressed while a guest via `feedbackCache.setSuppressedWhen`
  (pure, fail-closed rule in `app/db/feedbackSuppressionLogic.ts`).
- **Skipping `ProfileHydrator`.** The plan expected the skip to blank the Zoom name and to yield
  the AA filter default (the store default). Implementation (2026-10-11) showed it does neither on
  its own. An owner's profile hydrated earlier in the session stays in memory when the owner signs
  out and taps "Just join meetings", and `displayName` adds the owner's saved clean-time and
  pronoun toggles (MMKV props) even with no name. So the filter pins "AA" for a guest
  (`savedFellowshipInput`), and every Zoom join path applied `zoomPrefillName`. The skip still
  keeps a cold-started guest session free of the owner's name, recovery date and language.
  CHANGED 2026-10-11: the `un=` prefill itself is removed, for everyone (Zoom never applied it), so
  no join link carries a name and `zoomPrefillName` is gone.

The other rulings made during implementation are in the plan's "Execution notes (2026-10-11)".

## API

No changes expected. Everything a guest touches is public or device-lane only:
- `/status/ready`: public (no middleware)
- `/config`: `deviceAuth`
- `/schedules/{live,at-next,daily,nearby,meeting/:mid}`: `deviceAuth`
- `/content`, `/news`: `deviceAuth`

Verified against a local API (`prod` @ 3fe4dfb) on 2026-09-27. A guest never sends `Authorization`, so no signed-in route is
called, no 401/403 reaches CrowdSec, and no user-lane rejection can drop the device JWT.

## Decisions (2026-09-28)

1. **Location permission:** same as today. The location gate writes `profileStore.locationEnabled`.
2. **Filters:** guests get the full filter bar, working as today, except that the fellowship defaults to **AA** rather than the owner's Settings fellowship. If a build drops AA, `resolveFellowship` falls back to the build's first fellowship, as it already does.
3. **Conversion:** no automatic Login prompt. Guests see **house ads**: RecoverySky's own ads
   promoting an account (clean time, attendance reports, reminders and so on). No third-party ad
   network. Placement, content source and rotation are a separate design pass. v1 needs at least
   one ad slot in the guest Meetings screen plus the header Sign-in action.
4. **Entry copy:** the guest button on the Login screen reads **"Just join meetings"** (changed from "Just browse meetings" 2026-09-28). It is a
   new i18n key in all nine locales and is rendered only on Android.

## Docs to update with the code

The root and worktree `CLAUDE.md` both describe `isAnonymous`:
- the AuthenticationStore props list
- the Subscription section ("when signed in and not anonymous")
- the SQLite-key paragraph ("Anonymous users get a locally generated … key")

Rewrite these for guest mode as part of the cleanout. The SQLite key is per install either way, so
that paragraph should say "the key is minted locally on first launch" rather than mention a user
type. Also add a changelog entry under `[Unreleased]`.

## Out of scope

Favorites, meeting ratings, reminders, iOS, any guest-scoped storage, API changes, and the house-ad
content/rotation design (v1 ships the slot).
