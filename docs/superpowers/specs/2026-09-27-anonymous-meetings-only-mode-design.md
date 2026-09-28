# Anonymous (guest) mode: Meetings only, Android only

Status: DRAFT, 2026-09-27. Branch `feat/anonymous-auth` (worktree `.claude/worktrees/guest-mode`),
cut from `feat/passwordless-auth` @ 5c2c14d. Builds on that branch's login screen and owner gate.

## Why

Most Android installs never get past the login screen. An account is required for everything the app
stores about a person, but browsing and joining a meeting stores nothing. This mode lets Android users
open the app, find a meeting, and join it without signing in.

## What an anonymous user gets

- **Only the Meetings tab:** Online, In-Person and Search, and joining meetings through the external
  Zoom app. No Home, Attendance or Settings tabs, and no onboarding.
- **Nothing about them is stored or tracked.** They get no user id and no local rows. No clean time,
  90-in-90, attendance, reminders, theme color, favorites or meeting ratings (all out of scope for v1).
- **On a borrowed or shared phone the app shows meetings and nothing else.** No data belonging to the
  device owner is visible.
- **The mode persists across relaunches.** An anonymous user lands on Meetings until they choose to
  sign in.
- **Android only.** iOS requires an authenticated account, so the entry point is never rendered on iOS.

Hidden features become sign-in prompts, since converting guests to accounts is the point. At minimum,
the Meetings header shows a persistent "Sign in" affordance.

## Identity model (the core decision)

The old anonymous login (`loginAnonymously()`) is **not** revived. It set `userId = deviceId` and
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

### Removing the old anonymous concept entirely (decided 2026-09-27)

`isGuest` is a new concept, not a rename. The old anonymous concept is removed completely: code,
comments, types and strings. No `isAnonymous` / `loginAnonymously` / "anonymous user" wording is
left behind to be mistaken for a live path. The ~59 references across `app/` include:
- store: the `isAnonymous` prop, `loginAnonymously()`, and the `isAuthenticated` anonymous branch
- `useAuth0Wrapper.loginAnonymously`, the `loadStoredAuth0` anonymous-restore branch, and
  `LoginScreen`'s `"anonymous"` action / commented-out button
- the `setupRootStore` cold-start reset, plus the worktree's owner-stamp guard comment that
  explains itself in terms of anonymous snapshots
- the readers in sync (`gate()`, the reaction), `rcIdentityLogic`, `pushRegistrationLogic`,
  `userTokenRefresher`, `emailAttributeLogic`, `ownerLogic`, `BackupPassRunner`, the app.tsx
  shortName→Auth0 reaction, and the Settings anonymous branches ("Anonymous user", "Login to
  Subscribe")
- the `"anonymous"` uid fallbacks in the timer modals, `en.ts` `continueAnonymously` /
  `anonymousUser` in all nine locales, and `platformStrings*.ts`
- the tests that cover these branches

Each reader either loses its anonymous branch (its "signed in" check already excludes guests,
because a guest has no `userId` and no session) or, where a guest-specific check is still needed,
reads `isGuest`. Per the Comments convention, rewritten comments explain the change
("CHANGED 2026-09-27: anonymous login removed; guests have no userId") rather than silently
dropping history where the history still explains a guard.

**Verify during implementation:** MST's handling of the now-unknown `isAnonymous` key in persisted
MMKV snapshots (it must be dropped silently, not throw on `applySnapshot`).

This removal:
- closes TODO 7cc1b9e ("the device id is never a user identity");
- fixes a live bug: legacy Android installs that used the old anonymous login (Dec 2025 to May 2026)
  keep `userId = deviceId` after the cold-start reset, and `rcIdentityFor()` returns it, so
  `SubscriptionProvider` calls `Purchases.logIn(deviceId)`.

**Legacy snapshot hydration.** In `setupRootStore`, an MMKV snapshot with `userId === deviceId` and no
stored credentials is a leftover anonymous session. Clear `userId` and `isAnonymous`, and land the
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
| `useZoomMeeting.ts:170` `userName: config.userName ?? profileStore.displayName` | `?un=` prefill joins the Zoom meeting under the device owner's name | no name sent |
| `SchedulePopup.handleJoin` (`:421`, `:468`) | shows `ExternalZoomTimerModal` when `attendanceEnabled` | open Zoom directly, no timer |
| `SchedulePopup` / `InPersonPopup` reminder cells | reminders need a user | hidden |
| `InPersonPopup` "I'm Here" presence check | writes attendance | hidden |
| `ProfileStore.themeColor` | owner's accent color | default theme |
| Location gate `confirm-in-app` writes `profileStore.locationEnabled` | a device setting, not personal data | unchanged: same as today, writes `locationEnabled` (decided 2026-09-28) |
| `MeetingFilterBar` / `MeetingFiltersContext` default from `profileStore.fellowship` and the MMKV `meetings.fellowship` / `meetings.language` picks | would show the owner's fellowship and language picks | guest starts on All fellowships / all languages and never reads or writes the owner's picks (decided 2026-09-28) |
| Deep links / notification taps into other tabs | would navigate to screens a guest doesn't have | ignored, or routed to Meetings |

## App-wide pieces mounted in `app.tsx`

Each runs regardless of tab. Verify each one's guest behavior; none may write or send user data.

- `SubscriptionProvider`: skip RevenueCat configuration for guests, so no throwaway `$RCAnonymousID`
  customers are created.
- `initializeNotifications`: no permission prompt and no token registration for guests.
- `ProfileHydrator`, `ChatHydrator`, `ReportPollingResumer`, `TimerSessionResumer`, `SyncResumer`,
  `BackupPassRunner`, `TimerRecoveryGate`: expected to bail without a session. Confirm each.
- `AnnouncementGate`, rating engine: suppress for guests in v1.
- Umami / Sentry / logger: no user id. The logger already carries `deviceId` on every line, which is
  enough to count guest sessions. Add an `authMode: "guest"` attribute or event for the funnel.

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
2. **Filters:** guests get all filters. They start on All fellowships / all languages and never
   inherit the owner's fellowship or remembered picks.
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
