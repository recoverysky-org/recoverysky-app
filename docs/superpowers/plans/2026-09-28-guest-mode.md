# Guest Mode (Meetings Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Android users skip sign-in with "Just join meetings". They land in a Meetings-only app that stores nothing about them (superseded: see Execution notes R32) and shows nothing belonging to the device owner. Along the way, remove the dead device-id login.

**Architecture:** Part A deletes the old device-id login (`isAnonymous` / `loginAnonymously` / `userIdentifier`) and migrates the leftover `userId === deviceId` snapshots. Part B adds:
- a persisted `isGuest` flag;
- a pure `decideAppRoute()` that `AppNavigator` uses for both branch and initial route;
- a one-tab `GuestNavigator` that reuses `MeetingsScreen`;
- per-surface guards wherever the Meetings tab reaches owner data: profile hydration, the feedback cache, popups, timer recovery, theme, and the Zoom name prefill.

A guest never has a `userId`, so every identity-driven subsystem (sync, push, RevenueCat, report polling, owner gate) already ignores them.

**Tech Stack:** React Native 0.81 / Expo 54, MobX-State-Tree, React Navigation 7, i18next. Vitest for pure `.ts`, jest-expo for `.tsx`.

**Spec:** `docs/superpowers/specs/2026-09-27-guest-mode-design.md`

## Global Constraints

- Work only in `/Users/jenova/projects/recoverysky-org/app/.claude/worktrees/guest-mode` on branch `feat/guest-mode`. Start every shell with `cd` there and check `git branch --show-current` prints `feat/guest-mode`. Subagents launch in the main checkout, not here.
- Stage named paths only. Never `git add -A`, never `git stash`. Other sessions share the stash stack.
- Lint only touched files: `npx eslint --fix <files>`. Never `npm run lint`.
- Guest mode is **Android only**. iOS requires an authenticated account. The guest entry point is never rendered on iOS, and `decideAppRoute` never returns `"Guest"` off Android.
- Guest mode **never sets `userId`**. No device-id identity, placeholder uid, or hash.
- **Naming (decided 2026-10-11):** the new feature is **guest mode**, never "anonymous". The removed feature is **the old device-id login**. No new comment, string, doc line, test name or commit message says "anonymous" or spells a removed identifier (`isAnonymous`, `loginAnonymously`, `userIdentifier`). Describe the removed thing in words instead. This plan's instructions still name those identifiers so you can find and delete them.
- The old device-id login is removed completely: code, comments, types, strings, tests. Exceptions, which keep the word because it is not ours:
  - fellowship names ("Alcoholics Anonymous" …)
  - RevenueCat's own `$RCAnonymousID` / "current user is anonymous" SDK wording
  - Zoom's own sense in the `zoomBenefitNoLogin` onboarding copy ("You will join anonymously"), translated in nine locales and out of scope
- Guest entry copy: **"Just join meetings"**. Guest fellowship default: **AA**. Location prompt behaves as today.
- No `runtimeVersion` bump: JS-only change.
- Every new i18n key exists in all nine locale files (`en es ar de fr pt ru th uk`). `npm run compile` enforces this.
- Comments follow the repo convention: when behavior changes, keep the original comment and append `CHANGED 2026-10-11: <why>`.
- New `ADDED` / `CHANGED` comments carry **2026-10-11**, the implementation date. The plan was drafted 2026-09-28; every comment block below already uses the new date.
- Line numbers in this plan date from 2026-09-28. The branch has since been rebased onto `root`, which picked up the 2026-10-01 email-verification work, so they have drifted. Locate every edit by its content, not its line number.
- Commit messages use the repo's gitmoji style and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- There is no CI. Run `npm run compile`, `npm run test:unit`, and `npm run test:component` (plus touched-file eslint) before each commit.

## Review Focus

1. **Owned device, owner signed out, stranger taps "Just join meetings":**
   - The Zoom join URL carries no `un=` name.
   - Hearts, stars and join counts are not shown or written.
   - No reminder cells are tappable, and there's no I'm Here or timer.
   - The theme is the default, not the owner's.
   - An interrupted owner timer does not pop up.

   Pinned by the Task 9 manual checklist plus unit tests in Tasks 5 and 7.
2. **Relaunch as a guest on Android** lands back in guest Meetings, not Login. Pinned by the `decideAppRoute` tests (Task 5) and the persisted `isGuest` prop (Task 5).
3. **Guest → Sign in → real sign-in:**
   - `isGuest` is cleared.
   - The profile hydrates.
   - Favorites are visible again.
   - RevenueCat logs in with the sub.

   Pinned by `decideAppRoute` (the authenticated branch wins over guest), the Task 5 store test, and the Task 9 checklist.
4. **Legacy snapshot with `userId === deviceId`** (Dec 2025–May 2026 device-id-login installs): `userId` is cleared on hydration, the device is never owner-stamped, the user lands on Login, and RevenueCat never `logIn(deviceId)`. Pinned by the `legacyIdentityLogic` tests (Task 2).
5. **iOS with a stray persisted `isGuest: true`** (restored backup, dev toggling): shows Login, never Guest. Pinned by the `decideAppRoute` tests (Task 5).

---

## File Structure

**Part A (remove the old device-id login):**
- Modify pure logic and tests:
  - `app/services/purchases/rcIdentityLogic.ts` (+ test)
  - `app/services/notifications/pushRegistrationLogic.ts` (+ test)
  - `app/services/auth/ownerLogic.ts` (+ test)
  - `app/services/purchases/emailAttributeLogic.ts` (+ test)
  - `app/services/sync/backupPassLogic.ts` (+ test)
  - `app/services/auth/userTokenRefresher.ts` (+ test)
- Create: `app/models/helpers/legacyIdentityLogic.ts` (+ `.test.ts`). Pure: is a persisted `userId` really the device id?
- Modify:
  - `app/models/AuthenticationStore.ts`
  - `app/models/helpers/setupRootStore.ts`
  - `app/services/auth/useAuth0Wrapper.ts`
  - `app/screens/LoginScreen.tsx`
  - `app/screens/SettingsScreen.tsx`
  - `app/navigators/MainNavigator.tsx`
  - `app/components/ReminderEditorModal.tsx`
  - `app/screens/SocialScreen.tsx`
  - `app/screens/HomeScreen.tsx`
  - `app/app.tsx`
  - `app/context/SubscriptionContext.tsx`
  - `app/services/sync/index.ts`
  - `app/db/BackupPassRunner.tsx`
  - `app/components/ExternalZoomTimerModal.tsx`
  - `app/components/InPersonTimerModal.tsx`
  - all nine `app/i18n/*.ts`
  - `app/i18n/platformStrings*.ts`
  - `app/i18n/index.ts`
  - comment-only edits in `AgentScreen.tsx`, `ConfigStore.ts`, `utils/deviceId.ts`, `services/encryption/sqliteKey.ts`, `utils/logger/{logger,types}.ts`, `logger.test.ts`, `hooks/useSubscriptionReturn{,.test}.ts(x)`

**Part B (guest mode):**
- Create:
  - `app/navigators/appRouteLogic.ts` (+ `.test.ts`): pure route decision
  - `app/navigators/GuestNavigator.tsx`: one-tab navigator holding `MeetingsScreen`
  - `app/components/GuestPromoBar.tsx` (+ `.test.tsx`): house-ad slot plus Sign-in button, presentational
- Modify:
  - `AuthenticationStore.ts` (`isGuest`, `enterGuest`, `exitGuest`)
  - `navigationTypes.ts`
  - `AppNavigator.tsx`
  - `MeetingsScreen.tsx`
  - `LoginScreen.tsx`
  - `useAuth0Wrapper.ts`
  - `db/ProfileHydrator.tsx`
  - `db/feedbackCache.ts`
  - `db/TimerSessionResumer.tsx`
  - `components/SchedulePopup.tsx`
  - `components/InPersonPopup.tsx`
  - `services/zoom/useZoomMeeting.ts`
  - `theme/context.tsx`
  - `app.tsx`
  - i18n files
  - `CLAUDE.md`
  - `CHANGELOG.md`
  - the spec

---

## PART A: Remove the old device-id login

### Task 1: Drop the device-id login flag from the pure decision modules

**Files:**
- Modify: `app/services/purchases/rcIdentityLogic.ts:20-33`, test `rcIdentityLogic.test.ts:10-25`
- Modify: `app/services/notifications/pushRegistrationLogic.ts` (whole fn + header), test
- Modify: `app/services/auth/ownerLogic.ts:12-31`, test `ownerLogic.test.ts:5-29`
- Modify: `app/services/purchases/emailAttributeLogic.ts`, test
- Modify: `app/services/sync/backupPassLogic.ts:25-60`, test
- Modify: `app/services/auth/userTokenRefresher.ts:12,50,218`, test `userTokenRefresher.test.ts:30,238-248`
- Modify: `app/services/auth/emailVerifyLogic.ts` (`verifyGateBlocked`), test `emailVerifyLogic.test.ts` (`describe("verifyGateBlocked …")`). ADDED to this plan 2026-10-11: the email-verification gate merged 2026-10-01, after this plan was drafted, and takes the same flag.
- Modify the callers:
  - `app/context/SubscriptionContext.tsx:207-216,270-275,378`
  - `app/app.tsx:677-682`
  - `app/services/auth/useAuth0Wrapper.ts:244-255`
  - `app/db/BackupPassRunner.tsx:74-78`
  - `app/components/VerifyEmailGate.tsx` (the `sub` line and the `verifyGateBlocked({…})` call)

**Interfaces:**
- Produces:
  - `rcIdentityFor(i: { userId: string | undefined }): string | null`
  - `pushRegistrationUserId(i: { userId: string | undefined; hasSession: boolean }): string | null`
  - `decideOwnership(i: { ownerSub: string | undefined; sessionSub: string }): OwnershipDecision`
  - `resolveEmailAttribute(i: { appUserId: string | undefined; authEmail: string }): string | null`
  - `BackupPassInput` without `anonymous`
  - `UserRefresherStore` without `isAnonymous`
  - `verifyGateBlocked` input without `isAnonymous`

- [ ] **Step 1: Rewrite the tests to the new signatures**

`rcIdentityLogic.test.ts`: replace the two `rcIdentityFor` cases with:
```ts
  it("is the Auth0 user id for a signed-in user", () => {
    expect(rcIdentityFor({ userId: "google-oauth2|123" })).toBe("google-oauth2|123")
  })

  it("is null when nobody is signed in", () => {
    expect(rcIdentityFor({ userId: undefined })).toBeNull()
    expect(rcIdentityFor({ userId: "" })).toBeNull()
  })
```
`pushRegistrationLogic.test.ts`: delete the "anonymous session" case, and remove `isAnonymous: false, ` from every remaining call.

`ownerLogic.test.ts`: delete the "never stamps or blocks an anonymous session" case, and remove `, isAnonymous: false` from the other three.

`emailAttributeLogic.test.ts`: set `const signedIn = { appUserId: "auth0|abc123", authEmail: "jenova@example.org" }`. Delete the "anonymous (device-id) user" and "app user id is just the device id" cases. Keep the rest.

`backupPassLogic.test.ts`: remove `anonymous: false,` from `ready`. Rename the case at :36 to `"skips a signed-out user without consuming the pass"` and delete its `anonymous: true` expectation.

`userTokenRefresher.test.ts`: remove `isAnonymous: false,` from `makeStore()`, and delete the whole `it("returns null without refreshing for an anonymous user", …)` block.

`emailVerifyLogic.test.ts`: remove `isAnonymous: false,` from `clear`, and delete the `["anonymous", { isAnonymous: true }]` row of the `it.each` table.

- [ ] **Step 2: Run the type check to verify it fails**

Run: `npm run compile`
Expected: FAIL. Errors in the test files, e.g. `Property 'isAnonymous' is missing in type '{ userId: string; }'`, because the implementations still require the field. (Vitest does not type-check, so `compile` is the red step here.)

- [ ] **Step 3: Update the implementations**

`rcIdentityLogic.ts`:
```ts
/**
 * The RevenueCat app user id for the current auth state: the Auth0 sub when
 * a real user is signed in, otherwise null — in which case the SDK runs on
 * its own `$RCAnonymousID`, which `logIn()` later aliases into the user's
 * customer.
 * CHANGED 2026-10-11: the old device-id login is gone, and with it the flag
 * input that kept its device id out of RevenueCat (that login stored the
 * device id in `userId`). `userId` is now only ever an Auth0 sub, and
 * setupRootStore clears a leftover device-id value on hydration
 * (legacyIdentityLogic.ts).
 */
export function rcIdentityFor(i: { userId: string | undefined }): string | null {
  if (!i.userId) return null
  return i.userId
}
```
`pushRegistrationLogic.ts`: remove the `isAnonymous` field and its `i.isAnonymous ||` check. Replace the header sentence "and `loginAnonymously()` puts the device id in `userId` too, so every signed-out or anonymous cold start" with "so every signed-out cold start". Append:
```
 * CHANGED 2026-10-11: the device-id login flag input is removed with that login.
```
`ownerLogic.ts`:
```ts
/**
 * One device, one owner. The first real sign-in adopts.
 * CHANGED 2026-10-11: the device-id login flag input (always a literal false
 * at the one call site since 2026-09-18) is gone with that login. Guests
 * (spec 2026-09-27) never reach this gate — they have no Auth0 session.
 */
export function decideOwnership(input: {
  ownerSub: string | undefined
  sessionSub: string
}): OwnershipDecision {
  if (!input.ownerSub) return "adopt"
  return input.ownerSub === input.sessionSub ? "match" : "mismatch"
}
```
`emailAttributeLogic.ts`:
- Drop `deviceId` and `isAnonymous` from `EmailAttributeInput`.
- Change the `appUserId` doc to `/** The id RevenueCat is identified with (rcIdentityFor) — an Auth0 sub or undefined. */`.
- The function becomes:
```ts
export function resolveEmailAttribute(input: EmailAttributeInput): string | null {
  const { appUserId, authEmail } = input
  if (!appUserId) return null
  const email = authEmail.trim()
  if (!EMAIL_SHAPE.test(email)) return null
  return email
}
```
- Replace the header's "`authStore.userIdentifier` (Auth0 `sub`, or the device id for anonymous users)" with "the Auth0 `sub`".
- Replace the anonymous bullet in the JSDoc with:
```
 * CHANGED 2026-10-11: both device-id guards are gone with the old device-id
 * login — `appUserId` comes from rcIdentityFor, which can no longer be a
 * device id.
```

`backupPassLogic.ts`: remove `anonymous: boolean`. Change the decision line to `if (!input.signedIn) return "skip"`, and bullet 2 to "Not eligible yet (signed out, not entitled)."

`emailVerifyLogic.ts` `verifyGateBlocked`: remove the `isAnonymous: boolean` input and its `input.isAnonymous ||` line. Append to its JSDoc:
```
 * CHANGED 2026-10-11: the device-id login flag input is gone with that login.
 * `!isAuthenticated` already blocks a signed-out user and a guest.
```

`userTokenRefresher.ts`: remove `isAnonymous: boolean` from `UserRefresherStore` and the line `if (authStore.isAnonymous) return null`. Change the header "(anonymous, signed out, or the refresh token is dead)" to "(signed out — including a guest — or the refresh token is dead)".

Callers:
- `SubscriptionContext.tsx`:
  - :211-216 becomes `resolveEmailAttribute({ appUserId: rcIdentityFor({ userId: authStore.userId }) ?? "", authEmail: authStore.authEmail })`.
  - :270-275 becomes `rcIdentityFor({ userId: authStore.userId })`.
  - :378 becomes `() => rcIdentityFor({ userId: authStore.userId })`.
  - At :207 change "(never for anonymous / device-id customers)" to "(never for a signed-out customer)".
- `app.tsx:677-682`: remove `isAnonymous: authStore.isAnonymous,`. In the comment above it, change "that getter (and `loginAnonymously()`) hands back the device id" to "that getter handed back the device id", and "every signed-out or anonymous launch" to "every signed-out launch".
- `useAuth0Wrapper.ts:244-255`: the call becomes `decideOwnership({ ownerSub: authStore.ownerSub, sessionSub: user.sub })`. Delete the "CHANGED 2026-09-18: hardcoded false…" comment block (the argument it explained no longer exists).
- `BackupPassRunner.tsx`: delete the `anonymous: authenticationStore.isAnonymous,` line.
- `VerifyEmailGate.tsx`: `const sub = authStore.userId` (the flag check is gone, because `userId` is never a device id now), and delete the `isAnonymous: authStore.isAnonymous,` line from the `verifyGateBlocked({…})` call.

- [ ] **Step 4: Verify**

Run: `npm run compile && npm run test:unit -- app/services`
Expected: compile clean; all vitest files under `app/services` PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/purchases/rcIdentityLogic.ts app/services/purchases/rcIdentityLogic.test.ts \
  app/services/notifications/pushRegistrationLogic.ts app/services/notifications/pushRegistrationLogic.test.ts \
  app/services/auth/ownerLogic.ts app/services/auth/ownerLogic.test.ts \
  app/services/purchases/emailAttributeLogic.ts app/services/purchases/emailAttributeLogic.test.ts \
  app/services/sync/backupPassLogic.ts app/services/sync/backupPassLogic.test.ts \
  app/services/auth/userTokenRefresher.ts app/services/auth/userTokenRefresher.test.ts \
  app/services/auth/emailVerifyLogic.ts app/services/auth/emailVerifyLogic.test.ts \
  app/context/SubscriptionContext.tsx app/app.tsx app/services/auth/useAuth0Wrapper.ts app/db/BackupPassRunner.tsx \
  app/components/VerifyEmailGate.tsx
git commit -m "♻️ refactor(auth): drop the device-id login flag from pure decision modules"
```

### Task 2: Legacy device-id `userId` cleanup on hydration

Installs that used the old device-id login (Android, 2025-12-26 → 2026-05-14) still carry `userId === deviceId` in MMKV. The old cold-start reset set `isAnonymous: false` and left that id in place. Today `rcIdentityFor` hands it to RevenueCat, which is a live bug.

**Files:**
- Create: `app/models/helpers/legacyIdentityLogic.ts`, `app/models/helpers/legacyIdentityLogic.test.ts`
- Modify: `app/models/helpers/setupRootStore.ts:50-77`

**Interfaces:**
- Produces: `isLegacyDeviceIdUserId(i: { userId: string | undefined; deviceId: string | undefined }): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"

import { isLegacyDeviceIdUserId } from "./legacyIdentityLogic"

describe("isLegacyDeviceIdUserId", () => {
  it("flags a userId equal to the device id (old device-id login)", () => {
    expect(isLegacyDeviceIdUserId({ userId: "3c8d8f26d5fb07b3", deviceId: "3c8d8f26d5fb07b3" })).toBe(true)
  })
  it("leaves a real Auth0 sub alone", () => {
    expect(isLegacyDeviceIdUserId({ userId: "email|abc", deviceId: "3c8d8f26d5fb07b3" })).toBe(false)
  })
  it("is false when either side is missing", () => {
    expect(isLegacyDeviceIdUserId({ userId: undefined, deviceId: "d" })).toBe(false)
    expect(isLegacyDeviceIdUserId({ userId: "d", deviceId: undefined })).toBe(false)
    expect(isLegacyDeviceIdUserId({ userId: "", deviceId: "" })).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- app/models/helpers/legacyIdentityLogic.test.ts`
Expected: FAIL, "Failed to resolve import ./legacyIdentityLogic".

- [ ] **Step 3: Implement**

`legacyIdentityLogic.ts`:
```ts
/**
 * Does the persisted `userId` hold the device id instead of an Auth0 sub?
 *
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md).
 * The removed device-id login stored `deviceId` in `userId`. An install that
 * used it (Android, 2025-12-26 → 2026-05-14) still carries that value in MMKV,
 * and every identity consumer would treat it as a signed-in user — RevenueCat
 * logged in as the device id, the exact customer split that stranded 81
 * subscriptions. A real sub always has a provider prefix ("email|", "auth0|",
 * "google-oauth2|", "apple|"), so equality with the device id is unambiguous.
 *
 * Pure, no `@/` imports (CLAUDE.md "Test Runner Split").
 */
export function isLegacyDeviceIdUserId(i: {
  userId: string | undefined
  deviceId: string | undefined
}): boolean {
  return !!i.userId && !!i.deviceId && i.userId === i.deviceId
}
```
In `setupRootStore.ts`, add `import { isLegacyDeviceIdUserId } from "./legacyIdentityLogic"`. Replace the block from the "ADDED 2026-09-17 (spec 2 §1.3)" comment through the end of the "Reset anonymous flag" `if` with:
```ts
  // ADDED 2026-10-11: clear a device id left in `userId` by the removed
  // device-id login (see legacyIdentityLogic.ts). Runs FIRST so the owner
  // stamp below and every identity reaction only ever see an Auth0 sub.
  // Replaces the old cold-start reset of that login's flag, which cleared the
  // flag but left the device id behind.
  {
    const auth = rootStore.authenticationStore
    if (isLegacyDeviceIdUserId({ userId: auth.userId, deviceId: auth.deviceId })) {
      auth.setUserId(undefined)
      log.info("Cleared legacy device-id userId")
    }
  }

  // ADDED 2026-09-17 (spec 2 §1.3): first launch after the ownership OTA on an
  // install that was signed in. Adopt the persisted account as the device
  // owner NOW, before any reaction sees the session, so the upgrade itself
  // never shows the wrong-account screen.
  // CHANGED 2026-10-11: the device-id guards that lived here (a device-id-login
  // snapshot carries userId === deviceId, and a device id must never become
  // the owner — it is unrecoverable from WrongAccountView) moved into the
  // legacy cleanup above, which empties such a userId before this runs.
  {
    const auth = rootStore.authenticationStore
    if (!auth.ownerSub && auth.userId) {
      auth.setOwner(auth.userId, auth.authEmail || undefined)
      log.info("Owner stamped from hydration")
    }
  }
```
Note: `deviceId` must already be in the snapshot at this point. It is persisted in MMKV, and `app.tsx` only writes it on first launch, after `setupRootStore`. A first launch has no legacy `userId`, so nothing is missed.

- [ ] **Step 4: Verify**

Run: `npm run test:unit -- app/models/helpers && npm run compile`
Expected: PASS. Compile still passes; `isAnonymous` still exists until Task 3.

- [ ] **Step 5: Commit**

```bash
git add app/models/helpers/legacyIdentityLogic.ts app/models/helpers/legacyIdentityLogic.test.ts app/models/helpers/setupRootStore.ts
git commit -m "🐛 fix(auth): clear legacy device-id userId on hydration"
```

### Task 3: Remove the old device-id login from the store, UI and strings

**Files:**
- Modify:
  - `app/models/AuthenticationStore.ts:29-34,86-96,114-117,221-245`
  - `app/services/auth/useAuth0Wrapper.ts:6,126-127,165-167,300-301,578-596,612,667,683-700`
  - `app/screens/LoginScreen.tsx:61-68,92,358-367,390-394,512-531`
  - `app/screens/SettingsScreen.tsx:393-395,1302-1325,1374-1378,1416-1420`
  - `app/navigators/MainNavigator.tsx:61-66,69`
  - `app/components/ReminderEditorModal.tsx:208-209`
  - `app/screens/SocialScreen.tsx:66,122`
  - `app/screens/HomeScreen.tsx:132`
  - `app/app.tsx:475,784-800,804-806,829-837`
  - `app/services/sync/index.ts:122,479`
  - `app/components/ExternalZoomTimerModal.tsx:112,203`
  - `app/components/InPersonTimerModal.tsx:89`
  - i18n: all nine locale files, `platformStrings.ts`, `platformStrings.ios.ts`, `index.ts:39`
  - comments: `AgentScreen.tsx:94,100`, `ConfigStore.ts:36`, `utils/deviceId.ts:5`, `services/encryption/sqliteKey.ts:5`, `utils/logger/logger.ts:74,168`, `utils/logger/types.ts:53`, `utils/logger/logger.test.ts:594-597,684-690`, `hooks/useSubscriptionReturn.ts:24`, `hooks/useSubscriptionReturn.test.tsx:52`

**Interfaces:**
- Consumes: Task 1 signatures.
- Produces: `AuthenticationStore` with no `isAnonymous`, `loginAnonymously`, or `userIdentifier`. `LoginScreen`'s `PendingAction` has no `"anonymous"` kind (Task 6 adds `"guest"`).

- [ ] **Step 1: Confirm MST drops the unknown `isAnonymous` key from old snapshots**

Run:
```bash
node -e 'const {types}=require("mobx-state-tree");const M=types.model({a:types.optional(types.string,"")});const m=M.create({a:"x",isAnonymous:true});console.log(JSON.stringify(require("mobx-state-tree").getSnapshot(m)))'
```
Expected: `{"a":"x"}` and no throw. If it throws, stop and report: `setupRootStore` would then need to strip the key before `applySnapshot`.

- [ ] **Step 2: Store**

In `AuthenticationStore.ts`:
- Delete the `isAnonymous` prop and its doc.
- Change the `userId` doc to `/** Auth0 user id (sub claim). Undefined when signed out or a guest — never a device id (CHANGED 2026-10-11). */`.
- In `isAuthenticated`, delete the two anonymous lines and the "Anonymous users" bullet; the doc reads "Returns true for OAuth users with a valid, non-expired access token."
- Delete the `userIdentifier` getter and the `loginAnonymously()` action.
- In `logout()`, change the log to `log.info("logout()", { hadUserId: !!store.userId })` and delete `store.isAnonymous = false`.

- [ ] **Step 3: Readers**

- `sync/index.ts:122` and `:479`: delete the `!auth.isAnonymous &&` and `!rootStore.authenticationStore.isAnonymous &&` lines.
- `app.tsx:784-800` (Umami and Sentry): replace `authStore.userIdentifier` with `authStore.userId` (4 places). Append to the Sentry comment: `CHANGED 2026-10-11: keyed on userId, not the removed getter that fell back to the device id; signed-out users and guests carry no user id.`
- `app.tsx:804-806` logger comment: "anonymous users already ride on `deviceId`" becomes "signed-out users and guests ride on `deviceId`".
- `app.tsx:829-837`: remove `isAnonymous` from the reaction's data object, the destructure, and the `if (isAnonymous) return` line. A guest never hydrates (Task 7), so `hydrated` stays false for them.
- `app.tsx:475`: change the comment to `// deviceId is attached to every log line and is the device-lane attestation key`.
- `SettingsScreen.tsx:393-395` and `ReminderEditorModal.tsx:208-209`: replace the `authStore.userIdentifier` registration with the pure guard. Import `pushRegistrationUserId` from `@/services/notifications/pushRegistrationLogic`.
```ts
        // CHANGED 2026-10-11: was keyed on a getter that fell back to the
        // device id — a signed-out tap sent POST /push-tokens/ to an
        // authenticateSignedIn route (a CrowdSec-counted 401/403).
        const pushUserId = pushRegistrationUserId({
          userId: authStore.userId,
          hasSession: !!authStore.accessToken || !!authStore.refreshToken,
        })
        if (pushUserId && authStore.deviceId) {
          loginNotificationUser(pushUserId, authStore.deviceId).catch(() => {})
        }
```
  In `ReminderEditorModal`, keep the `granted &&` condition: `if (granted && pushUserId && authStore.deviceId)`.
- `SocialScreen.tsx:66`: the local becomes `const signedInUserId = authStore.userId`; rename its use in the effect deps (≈:122) too. (Ruling 2026-10-11: a local still named `userIdentifier` would fail this task's Step 7 grep.)
- `HomeScreen.tsx:132`: delete the `isAnonymous: authStore.isAnonymous,` line.
- `ExternalZoomTimerModal.tsx:112,203` and `InPersonTimerModal.tsx:89`: replace `authStore.userId || "anonymous"` with `authStore.userId ?? ""`. Add a comment at `:112`: `// The timer is only reachable signed in (attendance lives behind Main); "" is the unreachable fallback. CHANGED 2026-10-11: was a literal placeholder uid from the removed device-id login.`
- `SettingsScreen.tsx:1302-1325`: delete the `authStore.isAnonymous ? ( … ) : (` arm (the "Login to Subscribe" button and hint), and unwrap the `<> … </>` else arm so it renders unconditionally. Delete the now-unused `saveString` import if nothing else uses it (`npx eslint` reports it).
- `SettingsScreen.tsx:1374-1378`: replace the Cloud Backup comment's "so hasAttendance implies a real (non-anonymous) identity" with "so hasAttendance implies a signed-in identity".
- `SettingsScreen.tsx:1416-1420`: `value={authStore.authEmail || authStore.userId || translate("settingsScreen:notLoggedIn")}`.
- `MainNavigator.tsx:61-66`: delete `postLoginSectionRef` and its `remove(...)`. Its only writer was the deleted Login-to-Subscribe button. `initialRouteName` becomes `"Home"`. Drop any now-unused imports (`loadString`, `remove`, `SettingsSection`, `useRef`). The Settings `<Tab.Screen>`'s `initialParams` also reads the ref (≈:199): delete that prop too (ruling 2026-10-11).

- [ ] **Step 4: Auth wrapper and Login**

`useAuth0Wrapper.ts`:
- Header :6: delete the "Handle anonymous login" bullet.
- Delete the `loginAnonymously` member of the result interface (:126-127), the `loginAnonymously` callback (:578-596), and its entry in the returned object (:667).
- `localLoading` (:165-167) was only set by `loginAnonymously`. Check with `grep -n "setLocalLoading" app/services/auth/useAuth0Wrapper.ts`. If nothing else sets it, delete it and make `const isLoading = auth0Loading`.
- :300-301: delete `// Clear anonymous flag for OAuth users` and `authStore.setProp("isAnonymous", false)`. (Task 5 puts `exitGuest()` here.)
- :612: `if (user) {`.
- `loadStoredAuth0` (:683-700): check `grep -rn loadStoredAuth0 app`. If only the definition matches (it had no callers when this plan was written), delete the function. Otherwise make it `return false` and remove the anonymous branch.

`LoginScreen.tsx`:
- Delete `| { kind: "anonymous" }`, `loginAnonymously` from the destructure, the `case "anonymous":` block, `loginAnonymously` from the `runAction` deps, the `handleAnonymousPress` callback and the 3-line comment plus eslint-disable above it, and the entire commented-out button block with its comment (:512-531).
- In the `PendingAction` doc, drop `| "anonymous"` from the historical sentence: "was a `"authenticated" | "signup"` string". `Platform` may become unused; let eslint tell you.

- [ ] **Step 5: Strings**

In all nine locale files, delete the `continueAnonymously`, `loginToSubscribe`, `loginToSubscribeHint` and `anonymousUser` keys (line numbers per file are in `grep -n "continueAnonymously\|anonymousUser\|loginToSubscribe" app/i18n/*.ts`).

In `platformStrings.ts`, set the map to `{}` (Task 6 refills it) and keep its header. In `platformStrings.ios.ts`, change the header to:
```ts
/**
 * Platform-specific i18n overrides (iOS)
 *
 * Empty on purpose — Android-only strings (the guest entry "Just join
 * meetings", spec 2026-09-27) must never enter the iOS bundle: iOS requires an
 * authenticated account, and App Store review rejected an earlier build for
 * shipping a no-account login string.
 */
```
`i18n/index.ts:39`: "(e.g. Android-only anonymous login text)" becomes "(e.g. the Android-only guest entry)".

- [ ] **Step 6: Remaining comments**

- `AgentScreen.tsx:94,100`: "X-API-Key for anonymous" becomes "X-API-Key when signed out".
- `ConfigStore.ts:36`: `/** X-API-Key device-auth fallback (dev/simulator builds) */`.
- `utils/deviceId.ts:5`: "Used to identify users across both anonymous and authenticated states." becomes "Identifies the INSTALL (device-lane attestation, log lines) — never a user (CHANGED 2026-10-11)."
- `sqliteKey.ts:5`: "Anonymous users: Generate and store a local key" becomes "Generated locally on first launch and stored in SecureStore (per install, not per user)".
- `logger.ts:74,168`, `types.ts:53`, and the comments in `logger.test.ts:594,684-688`: "anonymous user" becomes "signed-out user". Keep the test log messages `"Anonymous"`/`"Anonymous line"` renamed to `"Signed out"`/`"Signed-out line"` so no test asserts on them. Check with `grep -n '"Anonymous' app/utils/logger/logger.test.ts`.
- `useSubscriptionReturn.ts:24` and `useSubscriptionReturn.test.tsx:52`: "An anonymous user tapping Subscribe is sent through Auth0" becomes "A signed-out user tapping Subscribe is sent through Auth0".
- ADDED to this plan 2026-10-11 (found after drafting):
  - `services/api/index.ts` (≈:401), "Fresh access token, or null when anonymous / signed out." becomes "Fresh access token, or null when signed out (a guest included)."
  - `services/zoom/zoomTypes.ts` `zak` doc, "(optional - joins anonymously if not provided)" becomes "(optional — without one, Zoom joins as an unauthenticated participant)".
  - `services/sync/syncLogic.test.ts` (≈:20) fixture comment "legacy anonymous-era uid" becomes "legacy device-id-era uid". The fixture value `"device-abc"` stays.

- [ ] **Step 7: Verify nothing is left**

Run:
```bash
grep -rnE 'isAnonymous|loginAnonymously|userIdentifier|continueAnonymously|anonymousUser|loginToSubscribe|POST_LOGIN_SECTION|"anonymous"' app | grep -v node_modules
grep -rni 'anonymous' app | grep -viE 'Alcoholics|Narcotics|Crystal Meth|Marijuana|RCAnonymousID|current user is anonymous|revenueCatService|creates a new anonymous user|generate an anonymous ID|zoomBenefitNoLogin'
```
Expected: the first command prints nothing. The second prints only fellowship names, RevenueCat's own SDK wording and Zoom's `zoomBenefitNoLogin` copy, each of which you have read. List what it printed in the commit body.

Run: `npm run compile && npm test`
Expected: PASS (vitest + jest).

Run: `npx eslint --fix <every file touched in this task>`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add <every file touched in this task, by name>
git commit -m "🔥 remove(auth): delete the old device-id login"
```

### Task 4: Docs for Part A

**Files:** Modify `CLAUDE.md` (worktree root), `CHANGELOG.md`, and (ADDED to this plan 2026-10-11) the living docs in Step 1b

- [ ] **Step 1: Update `CLAUDE.md`**

- AuthenticationStore props line: remove `isAnonymous`.
- Subscription section: "the Auth0 `userId` when signed in and not anonymous" becomes "the Auth0 `userId` when signed in".
- Auth §3 SQLite key: replace "Anonymous users get a locally generated 256-bit key in SecureStore (`sqlite_encryption_key_v1`); authenticated users get it from JWT custom claims." with "The key is a locally generated 256-bit value in SecureStore (`sqlite_encryption_key_v1`), minted once per install on first launch. A JWT `sqliteKey` claim path still exists in `useAuth0Wrapper` but the production Auth0 tenant does not issue it (0 of 5,354 syncs, 2026-09-27); its no-rekey fallback would brick the DB if ever enabled (RS-024)."

  Keep the existing `CHANGED 2026-09-30` note under that paragraph (the JWT half is dormant); don't repeat its content.

- [ ] **Step 1b: Update the other living docs that describe the old login** (ADDED to this plan 2026-10-11)

- `docs/BACKUP.md`: the backup gate list ("`authenticationStore.isAuthenticated` and **not** `isAnonymous`") loses the flag clause. The pass-decision table row "Signed out, anonymous, or not entitled" becomes "Signed out (a guest included), or not entitled".
- `docs/DIAGNOSTICS.md`: in the identity-attributes intro, "(anonymous user, sign-out)" becomes "(signed out, a guest, or after sign-out)". In "Sentry and Umami are different", "Both receive `authStore.userIdentifier` (the raw sub, or `deviceId` when anonymous)" becomes "Both receive `authStore.userId` (the raw sub; nothing when signed out or a guest)". Leave "pseudonymous, not anonymous": it is the privacy term, not the feature.
- `EVENTS.md`: the `login_completed` and `login_started` rows list an `"anonymous"` method. Grep the source for each auth event's `trackEvent` call and make each row's method union match what the code sends after Task 3. Remove a row whose event no longer fires anywhere.
- `README.md` (≈:37): "with seamless key migration when upgrading from anonymous to authenticated accounts" becomes "with a key generated on your device". The rekey path is dormant (CLAUDE.md Auth §3).
- `TODO.md` "🧹 Remove the anonymous-login path (device id as a user identity)": retitle it "🧹 Remove the device-id login path (device id as a user identity)", tick its checkboxes, and add one line under the heading: "Done 2026-10-11 on `feat/guest-mode` (spec `docs/superpowers/specs/2026-09-27-guest-mode-design.md`)." Check how other finished items are marked first (`grep -n "Done\|✅\|\[x\]" TODO.md | head`) and match that.
- `docs/MEETING_ATTENDANCE_FLOW.md` (≈:153): `uid: string // Auth0 user ID or "anonymous"` becomes `uid: string // Auth0 user ID`. Leave the stale ZAK lines (≈:188, ≈:294): they describe the Zoom SDK removed in 4.5.0, in Zoom's own sense of the word.
- `docs/support/reference/device-owner.md`: the hydration-stamp conditions ("the session is not anonymous") now read in terms of the legacy cleanup: a device id left in `userId` is cleared before the stamp, so only an Auth0 sub is ever stamped. The ownership-gate note "An anonymous session never reaches the gate as anonymous …" becomes "A guest never reaches the gate: guest mode (Android only) has no Auth0 session." The RevenueCat logout line "the SDK goes back to an anonymous id" becomes "the SDK goes back to its own random customer id".

- [ ] **Step 2: Add a CHANGELOG entry**

Under `## [Unreleased]`:
```markdown
### Removed
- The dormant device-id login, hidden since May 2026. It signed a person in as the phone itself. The device id is no longer a user identity anywhere.

### Fixed
- Android installs that used the old device-id login kept the device id as their user id after every relaunch, so RevenueCat logged in as the device id — the customer split that stranded subscriptions in September. The leftover id is cleared on launch, and those users land on Login.
- Turning on notifications or setting a reminder while signed out no longer sends a guaranteed-rejected push-token registration.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CHANGELOG.md docs/BACKUP.md docs/DIAGNOSTICS.md EVENTS.md README.md TODO.md \
  docs/MEETING_ATTENDANCE_FLOW.md docs/support/reference/device-owner.md
git commit -m "📝 docs: device-id login removal"
```

---

## PART B: Guest mode

### Task 5: `isGuest` state and route decision

**Files:**
- Modify: `app/models/AuthenticationStore.ts`
- Create: `app/navigators/appRouteLogic.ts`, `app/navigators/appRouteLogic.test.ts`
- Modify: `app/services/auth/useAuth0Wrapper.ts` (accepted-session branch, where Task 3 removed `setProp("isAnonymous", false)`)

**Interfaces:**
- Produces:
  - `authStore.isGuest: boolean` (persisted)
  - `authStore.enterGuest(): void`
  - `authStore.exitGuest(): void`
  - `type AppRoute = "Maintenance" | "Onboarding" | "Main" | "WrongAccount" | "Guest" | "Login"`
  - `decideAppRoute(i: { outage: boolean; isAuthenticated: boolean; needsOnboarding: boolean; hasForeignSession: boolean; isGuest: boolean; platform: string }): AppRoute`

- [ ] **Step 1: Write the failing test**

`appRouteLogic.test.ts`:
```ts
import { describe, expect, it } from "vitest"

import { decideAppRoute } from "./appRouteLogic"

const base = {
  outage: false,
  isAuthenticated: false,
  needsOnboarding: false,
  hasForeignSession: false,
  isGuest: false,
  platform: "android",
}

describe("decideAppRoute", () => {
  it("routes a signed-out user to Login", () => {
    expect(decideAppRoute(base)).toBe("Login")
  })
  it("routes an Android guest to Guest, across relaunches (isGuest is persisted)", () => {
    expect(decideAppRoute({ ...base, isGuest: true })).toBe("Guest")
  })
  it("never routes to Guest off Android — iOS requires an account", () => {
    expect(decideAppRoute({ ...base, isGuest: true, platform: "ios" })).toBe("Login")
    expect(decideAppRoute({ ...base, isGuest: true, platform: "web" })).toBe("Login")
  })
  it("outage wins over everything", () => {
    expect(decideAppRoute({ ...base, outage: true, isGuest: true })).toBe("Maintenance")
    expect(decideAppRoute({ ...base, outage: true, isAuthenticated: true })).toBe("Maintenance")
  })
  it("a real session wins over a stale guest flag", () => {
    expect(decideAppRoute({ ...base, isAuthenticated: true, isGuest: true })).toBe("Main")
    expect(
      decideAppRoute({ ...base, isAuthenticated: true, needsOnboarding: true, isGuest: true }),
    ).toBe("Onboarding")
  })
  it("a wrong-account session is never masked by guest mode", () => {
    expect(decideAppRoute({ ...base, hasForeignSession: true, isGuest: true })).toBe(
      "WrongAccount",
    )
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- app/navigators/appRouteLogic.test.ts`
Expected: FAIL, cannot resolve `./appRouteLogic`.

- [ ] **Step 3: Implement**

`appRouteLogic.ts`:
```ts
/**
 * Which top-level route AppNavigator shows. ADDED 2026-10-11 for guest mode
 * (spec 2026-09-27-guest-mode-design.md).
 *
 * Order: outage → authenticated (Onboarding | Main) → WrongAccount → Guest →
 * Login. AppNavigator uses this for BOTH the registered screen and
 * initialRouteName — only the matching <Stack.Screen> is registered per
 * render, so the two must never diverge (see the 2026-09-18 note there).
 *
 * WrongAccount outranks Guest so a refused session is never hidden behind
 * guest browsing. Guest is Android-only: iOS requires an authenticated
 * account, so a stray persisted flag there (restored backup) falls to Login.
 *
 * Pure, no `@/` imports (CLAUDE.md "Test Runner Split").
 */
export type AppRoute = "Maintenance" | "Onboarding" | "Main" | "WrongAccount" | "Guest" | "Login"

export function decideAppRoute(i: {
  outage: boolean
  isAuthenticated: boolean
  needsOnboarding: boolean
  hasForeignSession: boolean
  isGuest: boolean
  /** Platform.OS */
  platform: string
}): AppRoute {
  if (i.outage) return "Maintenance"
  if (i.isAuthenticated) return i.needsOnboarding ? "Onboarding" : "Main"
  if (i.hasForeignSession) return "WrongAccount"
  if (i.isGuest && i.platform === "android") return "Guest"
  return "Login"
}
```
`AuthenticationStore.ts`: add the prop after `deviceId`:
```ts
    /**
     * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md).
     * Android-only "Just join meetings" mode: Meetings tab only, no userId, no
     * stored data. Persisted so a guest relaunches straight into meetings.
     * Never implies an identity — isAuthenticated stays false for a guest.
     */
    isGuest: types.optional(types.boolean, false),
```
Add these actions before `logout()`:
```ts
    /** Enter guest mode (LoginScreen "Just join meetings"). Never sets userId. */
    enterGuest() {
      log.info("enterGuest()")
      store.isGuest = true
    },
    /** Leave guest mode — the Sign-in action, or any accepted real session. */
    exitGuest() {
      if (!store.isGuest) return
      log.info("exitGuest()")
      store.isGuest = false
    },
```
In `logout()`, add `store.isGuest = false` next to `store.userId = undefined`.

`useAuth0Wrapper.ts`: in the accepted-session branch, right after `authStore.setTokens(...)`, add:
```ts
            // ADDED 2026-10-11: a real session ends guest mode. The Sign-in
            // action already cleared it; this covers a session restored or
            // completed any other way, so no stale flag outlives a sign-in.
            authStore.exitGuest()
```

- [ ] **Step 4: Verify**

Run: `npm run test:unit -- app/navigators && npm run compile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/navigators/appRouteLogic.ts app/navigators/appRouteLogic.test.ts app/models/AuthenticationStore.ts app/services/auth/useAuth0Wrapper.ts
git commit -m "✨ feat(guest): isGuest state and pure app route decision"
```

### Task 6: Guest navigator, promo bar and Login entry

**Files:**
- Create: `app/navigators/GuestNavigator.tsx`, `app/components/GuestPromoBar.tsx`, `app/components/GuestPromoBar.test.tsx`
- Modify: `app/navigators/navigationTypes.ts:63-73`, `app/navigators/AppNavigator.tsx`, `app/screens/MeetingsScreen.tsx`, `app/screens/LoginScreen.tsx`, `app/i18n/platformStrings.ts`, all nine locale files

**Interfaces:**
- Consumes: `decideAppRoute`, `authStore.enterGuest/exitGuest/isGuest` (Task 5).
- Produces:
  - `GuestNavigator` (a component)
  - `GuestPromoBar: FC<{ onSignIn: () => void }>`
  - `AppStackParamList.Guest: NavigatorScreenParams<MainTabParamList>`
  - i18n keys `guestPromo:title`, `guestPromo:body`, `guestPromo:signIn`, `loginScreen:justJoinMeetings`

- [ ] **Step 1: Write the failing component test**

`GuestPromoBar.test.tsx`:
```tsx
import { fireEvent, render } from "@testing-library/react-native"

import { GuestPromoBar } from "./GuestPromoBar"

describe("GuestPromoBar", () => {
  it("calls onSignIn when the Sign in button is pressed", () => {
    const onSignIn = jest.fn()
    const { getByTestId } = render(<GuestPromoBar onSignIn={onSignIn} />)
    fireEvent.press(getByTestId("guest-sign-in"))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it("exposes the sign-in control as a labelled button", () => {
    const { getByTestId } = render(<GuestPromoBar onSignIn={() => {}} />)
    const button = getByTestId("guest-sign-in")
    expect(button.props.accessibilityRole).toBe("button")
    expect(button.props.accessibilityLabel).toBeTruthy()
  })
})
```
Before writing it, check how sibling jest tests mount themed components. `PermissionsSection.test.tsx` is the model (`sed -n 1,40p app/components/PermissionsSection.test.tsx`). Copy its wrapper or provider setup exactly if it uses one.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:component -- app/components/GuestPromoBar.test.tsx`
Expected: FAIL, cannot find module `./GuestPromoBar`.

- [ ] **Step 3: Implement**

Add to `en.ts` as a new top-level namespace, placed alphabetically among namespaces or next to `loginScreen`:
```ts
  guestPromo: {
    title: "Get more from RecoverySky",
    body: "Track your clean time, log attendance and email meeting reports — free account.",
    signIn: "Sign in",
  },
```
In `en.ts` `loginScreen`, add `justJoinMeetings: "",`. It is empty on purpose: `platformStrings.ts` supplies the Android text, the same pattern the removed `continueAnonymously` used.

In the other eight locale files, add the same `guestPromo` block with the English text as placeholders, and `justJoinMeetings: "",` in `loginScreen`. Append these to the native-speaker review queue `docs/translation-review-2026-08-03.md`, under a new heading `## 2026-10-11 guest mode (English placeholders)`, listing the three `guestPromo` keys.

`platformStrings.ts` map:
```ts
  en: { loginScreen: { justJoinMeetings: "Just join meetings" } },
  es: { loginScreen: { justJoinMeetings: "Solo unirme a reuniones" } },
  fr: { loginScreen: { justJoinMeetings: "Juste rejoindre des réunions" } },
  pt: { loginScreen: { justJoinMeetings: "Só entrar em reuniões" } },
  ru: { loginScreen: { justJoinMeetings: "Просто присоединиться к собраниям" } },
  ar: { loginScreen: { justJoinMeetings: "الانضمام إلى الاجتماعات فقط" } },
  de: { loginScreen: { justJoinMeetings: "Nur an Meetings teilnehmen" } },
  th: { loginScreen: { justJoinMeetings: "เข้าร่วมการประชุมเท่านั้น" } },
  uk: { loginScreen: { justJoinMeetings: "Просто приєднатися до зустрічей" } },
```
Add the eight non-English `justJoinMeetings` strings to the same review-queue heading.

`GuestPromoBar.tsx` (presentational, like `PermissionsSection`: no store reads):
```tsx
/**
 * GuestPromoBar — the guest Meetings screen's house-ad slot + Sign-in action.
 *
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md,
 * decision 3). v1 ships one static house ad: RecoverySky's own copy for an
 * account, no ad network. Content/rotation is a later design pass; keep this
 * presentational (everything arrives as a prop) so that pass can swap the
 * body without touching navigation or the store.
 */
import { FC } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export interface GuestPromoBarProps {
  onSignIn: () => void
}

export const GuestPromoBar: FC<GuestPromoBarProps> = ({ onSignIn }) => {
  const { themed } = useAppTheme()
  return (
    <View style={themed($container)}>
      <View style={$copy}>
        <Text style={themed($title)} tx="guestPromo:title" />
        <Text style={themed($body)} tx="guestPromo:body" />
      </View>
      <Pressable
        testID="guest-sign-in"
        onPress={onSignIn}
        style={themed($button)}
        accessibilityRole="button"
        accessibilityLabel={translate("guestPromo:signIn")}
      >
        <Text style={themed($buttonText)} tx="guestPromo:signIn" />
      </Pressable>
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
  padding: spacing.sm,
  borderRadius: 12,
  backgroundColor: colors.card,
})

const $copy: ViewStyle = { flex: 1 }

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontWeight: "600",
  color: colors.text,
})

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $button: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  marginLeft: spacing.sm,
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.md,
  borderRadius: 16,
  backgroundColor: colors.tint,
})

const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontWeight: "600",
  color: colors.palette.neutral100,
})
```
Check the imports against siblings before relying on them: `grep -n "from \"@/components/Text\"\|translate } from" app/components/PermissionsSection.tsx`. Confirm `colors.card` and `colors.palette.neutral100` exist with `grep -n "card\|neutral100" app/theme/colors.ts`. Use whatever the siblings use.

`navigationTypes.ts`, after `Main`:
```ts
  /** ADDED 2026-10-11: Android guest mode — a one-tab navigator holding only Meetings. */
  Guest: NavigatorScreenParams<MainTabParamList>
```
`GuestNavigator.tsx`:
```tsx
/**
 * GuestNavigator — Android guest mode's whole app: the Meetings tab, alone.
 *
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md).
 * A bottom-tab navigator typed with MainTabParamList (tab bar hidden) rather
 * than a stack, so MeetingsScreen's route/param handling (`segment`,
 * `meetingId`, setParams) works unchanged — it reads
 * RouteProp<MainTabParamList, "Meetings">. Home, Attendance and Settings are
 * deliberately NOT registered: a guest has no data for them. A navigate() to
 * one of them from a stale push/deep link logs a React Navigation warning and
 * does nothing.
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"

import { MeetingsScreen } from "@/screens/MeetingsScreen"

import type { MainTabParamList } from "./navigationTypes"

const Tab = createBottomTabNavigator<MainTabParamList>()

export function GuestNavigator() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={() => null}>
      <Tab.Screen name="Meetings" component={MeetingsScreen} />
    </Tab.Navigator>
  )
}
```
If `npm run compile` rejects `component={MeetingsScreen}` because its props are the composite `MainTabScreenProps<"Meetings">` (parent `Main`, not `Guest`), register it as:
```tsx
      {/* Cast: MeetingsScreen's props name the Main stack as parent; it only
          uses the tab-level navigation/route, identical here. */}
      <Tab.Screen name="Meetings" component={MeetingsScreen as unknown as FC<BottomTabScreenProps<MainTabParamList, "Meetings">>} />
```
with `import type { FC } from "react"` and `import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs"`.

`AppNavigator.tsx`:
- Import `Platform` from `react-native`, `decideAppRoute` from `./appRouteLogic`, and `GuestNavigator` from `./GuestNavigator`.
- After `hasForeignSession`:
```ts
  // CHANGED 2026-10-11: one pure decision drives BOTH the registered screen
  // and initialRouteName (appRouteLogic.ts), now that guest mode adds a sixth
  // state. Order is unchanged for the existing five; Guest sits between
  // WrongAccount and Login.
  const route = decideAppRoute({
    outage: showOutage,
    isAuthenticated,
    needsOnboarding,
    hasForeignSession,
    isGuest: authStore.isGuest,
    platform: Platform.OS,
  })
```
- Replace the `initialRoute` ternary with `const initialRoute = route`.
- Add `isGuest: authStore.isGuest` to both log objects and the mount effect's deps.
- In the JSX, change the conditions to key off `route`:
  - `showOutage ?` becomes `route === "Maintenance" ?`
  - `isAuthenticated ? ( needsOnboarding ? …` becomes `route === "Main" || route === "Onboarding" ? ( route === "Onboarding" ? …`
  - `hasForeignSession ?` becomes `route === "WrongAccount" ?`
- Then insert before the final Login arm:
```tsx
      ) : route === "Guest" ? (
        <Stack.Screen name="Guest" component={GuestNavigator} />
```
- Keep every existing comment, appending `CHANGED 2026-10-11: keyed on decideAppRoute` to the 2026-09-18 initialRoute comment.

`MeetingsScreen.tsx`:
- Import `useAuthenticationStore` from `@/models` and `GuestPromoBar` from `@/components/GuestPromoBar`.
- Inside the component add `const authStore = useAuthenticationStore()`.
- In the `$header` View, after `<ConnectedFilterBar … />`, add:
```tsx
          {/* ADDED 2026-10-11: guest mode's house ad + Sign in. exitGuest()
              flips AppNavigator to Login (decideAppRoute). */}
          {authStore.isGuest && <GuestPromoBar onSignIn={() => authStore.exitGuest()} />}
```

`LoginScreen.tsx`:
- Add `| { kind: "guest" }` to `PendingAction`.
- In `runAction`'s switch:
```ts
          case "guest":
            // ADDED 2026-10-11 (spec 2026-09-27): no Auth0 call, no userId —
            // just the flag. Through the legal gate like every entry point.
            authStore.enterGuest()
            trackEvent("guest_mode_entered")
            return
```
- Add `authStore` to the deps if it's not already there.
- Add `const handleGuestPress = useCallback(() => gated({ kind: "guest" }), [gated])`.
- Where the old commented-out button block was, render:
```tsx
        {/* ADDED 2026-10-11: guest entry. Android only — iOS requires an
            authenticated account, and the string itself is absent from the iOS
            bundle (platformStrings.ios.ts). Choose step only, so it never sits
            under the code field. */}
        {Platform.OS === "android" && step === "choose" && (
          <Pressable
            testID="guest-button"
            accessibilityRole="button"
            accessibilityLabel={translate("loginScreen:justJoinMeetings")}
            onPress={handleGuestPress}
            disabled={isLoading}
          >
            <Text style={themed($loadingText)} tx="loginScreen:justJoinMeetings" />
          </Pressable>
        )}
```
- Ensure `Platform` and `Pressable` are imported from `react-native`.

- [ ] **Step 4: Verify**

Run: `npm run compile && npm run test:component -- app/components/GuestPromoBar.test.tsx && npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/navigators/GuestNavigator.tsx app/navigators/navigationTypes.ts app/navigators/AppNavigator.tsx \
  app/components/GuestPromoBar.tsx app/components/GuestPromoBar.test.tsx app/screens/MeetingsScreen.tsx \
  app/screens/LoginScreen.tsx app/i18n/*.ts docs/translation-review-2026-08-03.md
git commit -m "✨ feat(guest): Just join meetings entry, guest navigator and promo bar"
```

### Task 7: Keep the owner's data out of guest mode

**Files:**
- Modify: `app/db/feedbackCache.ts`
- Modify: `app/app.tsx` (right after `await setupRootStore(_rootStore)`, :472)
- Modify: `app/db/ProfileHydrator.tsx`
- Modify: `app/db/TimerSessionResumer.tsx`
- Modify: `app/theme/context.tsx`

**Interfaces:**
- Produces: `feedbackCache.setSuppressedWhen(predicate: () => boolean): void`. While the predicate is true:
  - `get` returns `null` and `getAll` returns an empty `Map`;
  - every write (`toggleLove`, `setLoveForMids`, `setRatingForMids`, `setRating`, `recordJoin`, `reconcileSchedules`) is a no-op that returns its "nothing happened" value (`false` for the boolean ones);
  - listeners are not notified.

Why each guard exists:
- **Hearts, stars and join counts** are stored per device and shown in every Meetings list and popup. A guest would see the owner's, and their taps would write into them.
- **ProfileHydrator** loads the owner's name, fellowship, recovery date and language. Skipping it gives a guest an empty `displayName` (so no Zoom `un=`) and `fellowship` stays at the store default **"AA"**. That is exactly the decided guest filter default, with no change to `MeetingFiltersContext`.
- **TimerSessionResumer** would raise the owner's interrupted attendance timer.
- **Theme:** the owner's MMKV `ignite.themeScheme` / `ignite.themeColor`.

- [ ] **Step 1: Write the failing test for the cache guard**

`feedbackCache.ts` imports `@/`, so vitest cannot load it. Extract the decision into a pure `app/db/feedbackSuppressionLogic.ts` and cover that with vitest:
```ts
// app/db/feedbackSuppressionLogic.test.ts
import { describe, expect, it } from "vitest"

import { createSuppression } from "./feedbackSuppressionLogic"

describe("createSuppression", () => {
  it("is off until a predicate is registered", () => {
    const s = createSuppression()
    expect(s.active()).toBe(false)
  })
  it("follows the registered predicate live", () => {
    const s = createSuppression()
    let guest = true
    s.setWhen(() => guest)
    expect(s.active()).toBe(true)
    guest = false
    expect(s.active()).toBe(false)
  })
  it("fails closed if the predicate throws — never leak owner feedback", () => {
    const s = createSuppression()
    s.setWhen(() => {
      throw new Error("store not ready")
    })
    expect(s.active()).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- app/db/feedbackSuppressionLogic.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`feedbackSuppressionLogic.ts`:
```ts
/**
 * Guest-mode suppression switch for feedbackCache (hearts, stars, joins).
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md).
 * The predicate is injected from app.tsx (`() => authStore.isGuest`) so
 * app/db/ gains no runtime dependency on app/models/. Fails CLOSED: if the
 * predicate throws, treat it as suppressed — showing the owner's favorites to
 * a guest is the failure this exists to prevent.
 * Pure, no `@/` imports.
 */
export function createSuppression() {
  let when: (() => boolean) | undefined
  return {
    setWhen(predicate: () => boolean) {
      when = predicate
    },
    active(): boolean {
      if (!when) return false
      try {
        return when()
      } catch {
        return true
      }
    },
  }
}
```
In `feedbackCache.ts`:
- Add `import { createSuppression } from "./feedbackSuppressionLogic"` and, at module scope, `const suppression = createSuppression()`.
- In `notifyListeners`, add a first line: `if (suppression.active()) return`.
- In the `feedbackCache` object:
  - add `setSuppressedWhen(predicate: () => boolean): void { suppression.setWhen(predicate) },` with a doc comment pointing at the logic file;
  - `get`: `if (suppression.active()) return null` first;
  - `getAll`: `if (suppression.active()) return new Map()` first;
  - `toggleLove`, `setLoveForMids`, `setRatingForMids`: `if (suppression.active()) return false` first;
  - `setRating`, `recordJoin`: `if (suppression.active()) return` first;
  - `reconcileSchedules`: `if (suppression.active()) return` first.
- Leave `loadAll`, `isLoaded`, `clear` and `subscribe` unchanged. The cache still loads for the owner's next session; it just isn't exposed.

`app.tsx`, immediately after `await setupRootStore(_rootStore)` (:472):
```ts
        // ADDED 2026-10-11: guests never see or write the device's hearts /
        // stars / join counts (spec 2026-09-27). Read live on every access, so
        // Sign in → a real session unhides them without a reload; registered
        // before any screen mounts. Import feedbackCache from "./db".
        feedbackCache.setSuppressedWhen(() => _rootStore.authenticationStore.isGuest)
```
Check first that `feedbackCache` is exported from `./db`: `grep -n feedbackCache app/db/index.ts`.

`ProfileHydrator.tsx`:
- Wrap the export in `observer` (import from `mobx-react-lite`), and read `const { profileStore, authenticationStore } = useStores()`.
- In the effect, change the guard to:
```ts
    // CHANGED 2026-10-11: skip while a guest (spec 2026-09-27). The profile
    // row is the device owner's — name (Zoom `un=` prefill), fellowship
    // (Meetings filter default), recovery date, language. Left un-hydrated, a
    // guest's fellowship is the store default "AA", which is the decided
    // guest filter default. Sign in → exitGuest() re-runs this effect.
    if (authenticationStore.isGuest) return
    if ((status === "open" || status === "seeded") && !hasHydrated.current) {
```
- Add `authenticationStore.isGuest` to the deps array.

`TimerSessionResumer.tsx`:
- Read `useAuthenticationStore()` and wrap the component in `observer`.
- In the effect, before `hasRun.current = true`, add:
```ts
    // ADDED 2026-10-11: never raise the device owner's interrupted attendance
    // timer inside guest mode (spec 2026-09-27). Not consumed — once the user
    // signs in, isGuest flips, this effect re-runs and restores it.
    if (authStore.isGuest) return
```
- Add `authStore.isGuest` to the deps.

`theme/context.tsx`:
- Make `ThemeProvider` an `observer` and read `const authStore = useAuthenticationStore()`. `ThemeProvider` sits inside `RootStoreProvider` (app.tsx:1227-1237), so the store is available.
- Compute:
```ts
  // ADDED 2026-10-11: guests get the default look (spec 2026-09-27) — the
  // saved scheme/tint are the device owner's Settings choices.
  const isGuest = authStore.isGuest
  const effectiveScheme = isGuest ? undefined : themeScheme
  const effectiveColor = isGuest ? undefined : themeColor
```
- Use `effectiveScheme` in the `themeContext` memo and `effectiveColor` in the `theme` memo and in the exported `themeColor` value. Update both memos' deps.
- If importing `@/models` from `app/theme/` creates a dependency-cruiser cycle, `npm run lint:deps` reports it. In that case, pass `isGuest` in as a `ThemeProvider` prop from `app.tsx`, which is an observer at that level, instead.

- [ ] **Step 4: Verify**

Run: `npm run test:unit -- app/db && npm run compile && npm run lint:deps && npm test`
Expected: all PASS, no new depcruise violations.

- [ ] **Step 5: Commit**

```bash
git add app/db/feedbackSuppressionLogic.ts app/db/feedbackSuppressionLogic.test.ts app/db/feedbackCache.ts \
  app/app.tsx app/db/ProfileHydrator.tsx app/db/TimerSessionResumer.tsx app/theme/context.tsx
git commit -m "🔒 feat(guest): keep the device owner's profile, favorites, timer and theme out of guest mode"
```

### Task 8: Guest-safe meeting popups and Zoom join

**Files:**
- Modify: `app/components/SchedulePopup.tsx` (:131-133, 398-404, 466-490, 657-705, 749-757, rating present-after-close at :104-114)
- Modify: `app/components/InPersonPopup.tsx` (:130-133, 832-870, 931-958)
- Modify: `app/services/zoom/useZoomMeeting.ts:165-171`
- Create: `app/services/zoom/zoomNameLogic.ts`, `app/services/zoom/zoomNameLogic.test.ts` (ADDED to this plan 2026-10-11, Step 0)

**Interfaces:**
- Consumes: `authStore.isGuest` (Task 5). The feedback suppression (Task 7) already makes `recordJoin` a no-op; the UI here hides controls so a guest never taps a dead one.

- [ ] **Step 0: Pin the guest name rule with a failing test first** (ADDED to this plan 2026-10-11: the run is TDD, and Review Focus 1's first item had no automated test)

`useZoomMeeting.ts` imports `@/`, so vitest cannot load `buildExternalZoomUrl` from there. Create a pure module and its vitest test.
```ts
// app/services/zoom/zoomNameLogic.test.ts
import { describe, expect, it } from "vitest"

import { zoomPrefillName } from "./zoomNameLogic"

describe("zoomPrefillName", () => {
  it("is the profile display name for a signed-in user", () => {
    expect(zoomPrefillName({ isGuest: false, displayName: "Jen" })).toBe("Jen")
  })
  it("is undefined for a guest, whatever the profile holds", () => {
    expect(zoomPrefillName({ isGuest: true, displayName: "Jen" })).toBeUndefined()
    expect(zoomPrefillName({ isGuest: true, displayName: undefined })).toBeUndefined()
  })
})
```
Run: `npm run test:unit -- app/services/zoom/zoomNameLogic.test.ts`
Expected: FAIL, cannot resolve `./zoomNameLogic`.

Then implement:
```ts
/**
 * The display name to prefill in a Zoom join (`?un=`), or undefined for none.
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md): a guest sends no
 * name. On a shared phone the profile belongs to the device owner, and Zoom
 * would show them joining. One rule for every join path: SchedulePopup's two
 * buildExternalZoomUrl calls and useZoomMeeting.
 * Pure, no `@/` imports (CLAUDE.md "Test Runner Split").
 */
export function zoomPrefillName(i: {
  isGuest: boolean
  displayName: string | undefined
}): string | undefined {
  return i.isGuest ? undefined : i.displayName
}
```
Run the test again. Expected: PASS. Steps 1 and 3 call `zoomPrefillName` instead of an inline ternary.

- [ ] **Step 1: SchedulePopup**

- Add `useAuthenticationStore` to its `@/models` import and `const authStore = useAuthenticationStore()` next to `useSubscription()`, then `const isGuest = authStore.isGuest`.
- **Name prefill.** In both `buildExternalZoomUrl({…})` calls (:398-404 and :478-484), change `userName: profileStore.displayName` to:
```ts
          // CHANGED 2026-10-11: no name for a guest — on a shared phone the
          // profile is the owner's and Zoom would show them joining.
          userName: zoomPrefillName({ isGuest, displayName: profileStore.displayName }),
```
- **Timer.** In `proceedExternalJoin`: `if (profileStore.attendanceEnabled && !isGuest) {`, with the comment `// Guests never log attendance (spec 2026-09-27); open Zoom directly.`
- **Heart, stars and join row** (:657-705): wrap `<View style={themed($feedbackSection)}> … </View>` in `{!isGuest && ( … )}`. Keep the Join button. If `$actionRow` uses `justifyContent: "space-between"`, check that the Join button still lays out sensibly alone. Look at the style (`grep -n "\$actionRow" -A8 app/components/SchedulePopup.tsx`), and if it would stretch or float oddly, add `isGuest && { justifyContent: "flex-end" }` to the row's style array.
- **Reminder cells** (:749-757): `onCellPress={isGuest ? undefined : handleCellPress}` and `reminderCells={isGuest ? undefined : reminderCells}` (`ScheduleGrid` renders read-only without `onCellPress`). Wrap the `tapTimesHint` `<Text>` in `{!isGuest && …}`.
- **Rating soft-ask.** At the top of `presentRatingAfterClose`, add `if (authStore.isGuest) return`, with the comment `// No review prompt for guests (spec 2026-09-27)`. The callback reads the store at call time, so no dep change is needed. `authStore` is a stable MST node; add it to the deps only if eslint asks.

- [ ] **Step 2: InPersonPopup**

- Same `authStore` / `isGuest` setup.
- Wrap the `$feedbackSection` block (:833 onward, heart + stars + joins) in `{!isGuest && ( … )}`. Keep the directions button.
- `ScheduleGrid`: `onCellPress={isGuest ? undefined : handleCellPress}` and `reminderCells={isGuest ? undefined : reminderCells}`. Hide `inPersonPopup:tapTimesHint` for guests.
- I'm Here: `{profileStore.attendanceEnabled && !isGuest && (`, with the comment `{/* CHANGED 2026-10-11: never for guests — "I'm Here" writes attendance. */}`.

- [ ] **Step 3: `useZoomMeeting.ts:170`**

```ts
          // CHANGED 2026-10-11: a guest sends no name (spec 2026-09-27); the
          // profile on a shared device belongs to its owner. ProfileHydrator
          // also skips guests, so displayName is "" anyway — belt and braces.
          userName:
            config.userName ??
            zoomPrefillName({ isGuest: authStore.isGuest, displayName: profileStore.displayName }),
```
Add `const authStore = useAuthenticationStore()` beside `profileStore` in the hook, and add `authStore` to the `useCallback` deps at :183.

- [ ] **Step 4: Verify**

Run: `npm run compile && npm test && npx eslint --fix app/components/SchedulePopup.tsx app/components/InPersonPopup.tsx app/services/zoom/useZoomMeeting.ts app/services/zoom/zoomNameLogic.ts app/services/zoom/zoomNameLogic.test.ts`
Expected: PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/SchedulePopup.tsx app/components/InPersonPopup.tsx app/services/zoom/useZoomMeeting.ts \
  app/services/zoom/zoomNameLogic.ts app/services/zoom/zoomNameLogic.test.ts
git commit -m "🔒 feat(guest): meeting popups join-only for guests, no name prefill"
```

### Task 9: Docs and on-device verification

**Files:** Modify `CLAUDE.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-09-27-guest-mode-design.md`

- [ ] **Step 1: Update `CLAUDE.md`**

- AuthenticationStore props: add `isGuest` (Android guest mode, persisted, never an identity).
- Navigation "App-level gating": the order is now outage → authenticated (Onboarding | Main) → WrongAccount → **Guest** → Login, decided by the pure `appRouteLogic.ts`.
- Add a short "### Guest mode (Android)" subsection under Navigation covering:
  - spec path;
  - `GuestNavigator` (Meetings only, tab bar hidden);
  - `GuestPromoBar` as the house-ad slot;
  - what is suppressed and where: `ProfileHydrator`, `feedbackCache.setSuppressedWhen`, `TimerSessionResumer`, `ThemeProvider`, the popups, the Zoom `un=`;
  - "never sets userId";
  - the rule that **any new Meetings-tab feature that reads or writes local user data needs an `isGuest` guard**.

- [ ] **Step 1b: Support knowledge base and event catalog** (ADDED to this plan 2026-10-11; CLAUDE.md asks for `docs/support/` in the same change as any auth behaviour change)

- `docs/support/reference/sign-in-methods.md`: replace the "No guest button on the login screen" bullet with a **Guest mode (Android only)** bullet: the choose step offers "Just join meetings", which opens a Meetings-only guest mode with no account, nothing stored (superseded: see Execution notes R32) and the device owner's data hidden. "Sign in" on the Meetings screen returns to the login screen. iOS has no guest mode.
- `docs/support/reference/email-verification.md`: the "Anonymous (guest) session" row becomes "Guest mode (Android)": no account at all, so nothing to verify.
- New problem doc `docs/support/problems/only-meetings-showing.md` and reply `docs/support/replies/only-meetings-showing.md`. Copy the section structure of an existing pair (`problems/signed-out-unexpectedly.md` and its reply). Symptom: "I only see Meetings" / "my clean time, attendance and Settings are gone". Cause: the user tapped "Just join meetings", so the app is in guest mode. Solution: tap Sign in on the Meetings screen and sign in the way they did before; their data never left the phone. Diagnose from what the user describes (no tab bar, the promo card with Sign in). Guests carry no user id, so Loki has no hash to search.
- `docs/support/README.md`: add that symptom row to the table, and a **guest mode** row to the glossary.
- `EVENTS.md`: add `guest_mode_entered` (Umami, no data, `app/screens/LoginScreen.tsx`) to the Authentication table.

- [ ] **Step 2: Add a CHANGELOG entry**

Under `[Unreleased]` `### Added`:
```markdown
- Android: "Just join meetings" on the Login screen opens a Meetings-only guest mode — browse Online, In-Person and Search and join, with no account. Nothing about a guest is stored, the device owner's name, favorites, theme and attendance never show, and a house ad plus Sign in button invite them to create an account. iOS still requires an account.
```
(The snippet's "Nothing about a guest is stored" is superseded: see Execution notes R32.)

- [ ] **Step 3: Update the spec**

- In the "App-wide pieces" list, replace the RevenueCat bullet: "`SubscriptionProvider`: unchanged — a guest is identical to a signed-out user on the Login screen (the SDK runs on `$RCAnonymousID`, no `logIn`). Skipping init was dropped: a later sign-in relies on the SDK already being configured."
- Add a "Found during planning" note: the local favorites / ratings / join-count cache was already per device and shown in every list, so it's suppressed via `feedbackCache.setSuppressedWhen`. Also, skipping `ProfileHydrator` both blanks the Zoom name and yields the AA filter default.

- [ ] **Step 4: Verify on a device**

Manual: Jenova runs this on a device. An agent cannot sign in as the owner or drive the device UI (ruling 2026-10-11). The docs task does not run it; the branch hand-off lists it as the remaining gate.

Run `npm run android`. The device must have the app signed in as an owner who has favorites, a custom theme color and a display name.

1. Sign out. Login shows **Just join meetings**. Tap it and accept the terms if asked. You should land on Meetings with no tab bar and the promo bar showing.
2. Filter bar fellowship shows **AA**, unless the bar already remembers a pick on this device (MMKV `meetings.fellowship`), which a guest shares by design (spec Decision 2). CHANGED 2026-10-11: see R25 in the execution notes below.
3. Open a live meeting: no heart, stars, join count, reminder hint or tappable cells. Tap Join. In Zoom, the name field is empty or Zoom's default, not the owner's name.
4. Open an In-Person meeting: no heart/stars and no I'm Here. The location prompt behaves as before.
5. The theme is the default: dark, with the default tint. CHANGED 2026-10-11: this line said "follows the system light/dark setting", but since 2026-09-28 an unsaved scheme means dark, so a guest gets the fresh-install look.
6. Kill and relaunch: you're back in guest Meetings.
7. Tap **Sign in**: Login appears. Sign in as the owner: Main with all tabs, and favorites, theme and name are back.
8. `adb logcat | grep -i "push-tokens\|401\|403"` during steps 1–6 shows no user-lane requests.
9. iOS simulator (`npm run ios`): Login has no guest button.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md docs/superpowers/specs/2026-09-27-guest-mode-design.md EVENTS.md \
  docs/support/README.md docs/support/reference/sign-in-methods.md docs/support/reference/email-verification.md \
  docs/support/problems/only-meetings-showing.md docs/support/replies/only-meetings-showing.md
git commit -m "📝 docs: guest mode (Android)"
```

---

## Execution notes (2026-10-11)

The rulings made while this plan was executed on `feat/guest-mode`, in order: what was decided, and why. Where a ruling replaced code or text this plan spells out, the bullet names the superseded step. **Don't copy a superseded snippet when reusing this plan;** the code on the branch is the reference. Rulings marked "already in this plan" were folded into the text above before their task ran.

- **R1.** The feature is "guest mode" everywhere, and the spec, the plan and the branch were renamed to match; the removed feature is "the old device-id login". The old word survives only where it is not ours: fellowship names, RevenueCat's `$RCAnonymousID` and SDK wording, Zoom's `zoomBenefitNoLogin` onboarding copy, and the stale ZAK lines in `docs/MEETING_ATTENDANCE_FLOW.md`. Why: Jenova's direction; the Zoom copy is translated nine-locale text in Zoom's own sense. Already in this plan (Global Constraints).
- **R2.** New comments never spell the removed identifiers or the old word, so the plan's comment blocks were reworded. Why: Task 3's own final grep requires it, and so does R1. Already in this plan.
- **R3.** Task 1 also removed the old login's flag from `verifyGateBlocked` (and its test) and from `VerifyEmailGate.tsx`. Why: the email-verification gate merged after the plan was drafted, and Task 3 would otherwise have broken compile. Already in this plan.
- **R4.** SocialScreen's local became `signedInUserId`. Why: a local named after the removed identity getter fails Task 3's grep. Already in this plan.
- **R5.** Task 3 also deleted the Settings tab's `initialParams` read of the post-login section ref. Why: the plan named only the ref's declaration and `initialRouteName`. Already in this plan.
- **R6.** Task 3 also reworded comments in `services/api/index.ts`, `zoomTypes.ts` and the `syncLogic.test.ts` fixture, overriding the plan's exception for that fixture comment. Why: R1. Already in this plan.
- **R7.** The docs work also covered BACKUP.md, DIAGNOSTICS.md, EVENTS.md, README.md, TODO.md, MEETING_ATTENDANCE_FLOW.md (the `uid` line) and the support knowledge base (device-owner, sign-in-methods, email-verification, a new only-meetings-showing problem and reply, and its README). Why: Jenova asked for the docs to be updated, and CLAUDE.md requires `docs/support/` to change with any auth behaviour change. Already in this plan.
- **R8.** Tasks 4 and 9 ran as one docs dispatch after Task 8, still as two commits. Why: the same files and the same kind of work, and the branch merges as a unit.
- **R9.** Task 8 added a pure `zoomPrefillName` (`app/services/zoom/zoomNameLogic.ts`), written test-first and used by all three join paths. Why: Jenova asked for TDD, and Review Focus 1's top item (no Zoom `un=` for a guest) had no automated test. Already in this plan (Task 8 Step 0).
- **R10.** Task 9 Step 4, the on-device pass, is Jenova's. Why: an agent cannot sign in as the owner or drive the device. Already in this plan.
- **R11.** RevenueCat initialisation is unchanged for guests; the plan won over the spec, and the spec was amended. Why: a later Sign in needs the SDK configured without a reload, and a guest is the same as a signed-out user on Login, who already runs on `$RCAnonymousID`. Already in this plan (Task 9 Step 3 amends the spec).
- **R12.** New ADDED/CHANGED comments carry 2026-10-11, the implementation date, not the plan's 2026-09-28. Why: it matches the repo's dated-comment log. Already in this plan.
- **R13.** Commit trailers name the model that authored each commit. Why: the repo history carries several models' trailers, so one fixed name would misattribute. Supersedes the fixed `Co-Authored-By` line in this plan's Global Constraints.
- **R14.** Task 1 kept `decideOwnership`'s `linkedSubs` input and its `relinked` outcome. Why: the plan's snippet predates them (spec 2 §7, merged 2026-09-30), and following it literally would have deleted a shipped feature. Supersedes Task 1 Step 3's `ownerLogic.ts` snippet and its `useAuth0Wrapper` call.
- **R15.** Task 3 also handled two readers the plan predates: push registration, which had moved out of SettingsScreen into `app/hooks/usePermissionToggles.ts`, and SettingsScreen's memoised account-description branch for the old login's sessions. Why: both read the flag or the getter Task 3 deletes, so compile would break. Supersedes Task 3 Step 3's SettingsScreen registration edit; that code now lives in `usePermissionToggles.ts`.
- **R16.** The legacy cleanup clears a device-id `userId` unconditionally, as the plan says, not only "with no stored credentials", as the spec says. Why: the old login never held Auth0 credentials, and any real session rewrites `userId` from the Auth0 user on its next sync.
- **R17.** Task 7's theme guard: use the direct `@/models` import in `app/theme/context.tsx` only if it adds no dependency-cruiser cycle, and otherwise give `ThemeProvider` an `isGuest` prop fed by a small observer wrapper in `app.tsx`. The wrapper (`GuestAwareThemeProvider`) was used, because the import added four cycles. Why: the plan's fallback was wrong, since `App()` is not an observer and a plain prop would go stale when the flag flips. Supersedes Task 7 Step 3's `theme/context.tsx` snippet (an observer reading the store) and its fallback note.
- **R18.** Task 3's commit body cites the second grep's remaining lines by file and line instead of quoting them. Why: the brief said to list them, and the naming rule forbids the old word in commit messages.
- **R19.** Task 6's own concerns were fixed before review: no bottom safe-area inset once the tab bar is hidden, touch targets under 48 dp (the promo pill and the Login guest link), and a light-theme Sign in label below 4.5:1 contrast. Why: they were correctness and accessibility gaps in the guest UI it had just built. Supersedes Task 6 Step 3's `GuestNavigator` (no `sceneStyle`) and GuestPromoBar's `$button` / `$buttonText` styles.
- **R20.** Deep links don't resolve for guests in v1; deferred to the final review and the device pass. Why: the spec allows "ignored" for v1.
- **R21.** GuestPromoBar's `$container` uses `marginTop`, not `marginBottom`. Why: in the Meetings header each element carries the gap above it, and the plan's style left the card flush under the filter cells. Supersedes Task 6 Step 3's `$container`.
- **R22.** The Login guest entry got its own tappable style, like the password link, instead of `$loadingText`. Why: guest mode's only entry must read as tappable, and `$loadingText` is the "Opening browser…" status style, with no tap cue. Supersedes the style in Task 6 Step 3's Login `<Pressable>` snippet.
- **R23.** The `guestPromo.*` strings stay in all nine locale files and ship in the iOS bundle. Why: the Android-only rule exists because App Store review rejected a no-account login string; these strings pitch an account, and the entry string itself stays in `platformStrings`.
- **R24.** Task 4's CHANGELOG "Fixed" line about signed-out push registration from Settings and reminders became an accurate "Changed" line, with no tracker tag. Why: those screens are reachable only signed in, and RS-012 (the real pre-sign-in noise) was fixed in 4.10.1-4, so tagging it would wrongly move its fix release. No tracker issue exists for the RevenueCat device-id login or for guest mode. Supersedes Task 4 Step 2's second Fixed bullet.
- **R25.** An owner profile already in memory when guest mode starts (the owner signs out and taps "Just join meetings", or Guest → Sign in → back, with no relaunch) is handled with targeted guards, not by un-hydrating: `MeetingFiltersContext` gives a guest a `saved` fellowship of "AA" (`savedFellowshipInput`), and `TimerSessionResumer` must not restore the owner's timer for a guest or on Login after a real sign-out. Why: un-hydrating risks the language reaction and other side effects, and `zoomPrefillName` already covers the Zoom name. Supersedes Task 7's premise that skipping ProfileHydrator gives the AA default (the "Why each guard exists" bullet and the ProfileHydrator comment in Step 3), and Task 7 Step 3's TimerSessionResumer guard.
- **R26.** `MeetingProvider` re-fetches live meetings on the `isGuest` edge. Why: otherwise the favorites-first sort snapshot crosses the guest switch, in either direction, until the next quarter-hour poll.
- **R26b.** The same reaction also re-snapshots the feedback on the rows it already holds. Why: so the owner's order never shows during the fetch, or while offline or in maintenance.
- **R27.** `TimerSessionResumer` gates on the owner's identity being present (`userId`), not on a live token (`isAuthenticated`). Why: the token gate stranded a forced logout deferred for a live timer. With a persisted timer and a dead refresh token at cold start, the timer never came up, so the pending logout never fired, and a later re-login was ejected on Save. A deferred logout keeps `userId`; a guest, and Login after a real sign-out, have none. Supersedes Task 7 Step 3's TimerSessionResumer guard and R25's `isAuthenticated` gate.
- **R28.** SchedulePopup skips the first-run `ExternalZoomEducationModal` for a guest. Why: its copy (a timer, attendance credit) is false for a guest, and dismissing it would spend the per-install seen flag, so the owner would never see it.
- **R29.** The guest attendance gate got an automated pin: a pure `canLogAttendance({ attendanceEnabled, isGuest })` in `app/services/attendance/attendanceGateLogic.ts`, written test-first and used by SchedulePopup's timer and InPersonPopup's "I'm Here". Why: R27 relies on a guest never persisting a timer session, `attendanceEnabled` defaults to true and carries the owner's setting into guest mode, and Jenova asked for TDD. Supersedes Task 8 Steps 1 and 2's inline `attendanceEnabled && !isGuest` checks.
- **R30.** `useZoomMeeting.joinMeeting` applies `zoomPrefillName` to whichever name wins (`config.userName ?? profileStore.displayName`), its false comments were corrected, and its log line records `hasUserName` instead of the name. Why: `ZoomJoinConfig.userName` is a required string, so the plan's `config.userName ?? zoomPrefillName(…)` never reached the guest rule; its "displayName is "" anyway" comment was false, because `displayName` carries the owner's clean-time and pronoun toggles even with no name; and CLAUDE.md forbids names in logs. Supersedes Task 8 Step 3's snippet and its comment.
- **R31.** SchedulePopup's dead `const password = …` and its stale "SDK expects the plaintext passcode" comment were deleted. Why: the bundled Zoom SDK was removed in 4.5.0, and the touched-file eslint run must pass.
- **R32.** The claim that nothing about a guest is stored was false. The device keeps the persisted `isGuest` flag and shared device settings: the Meetings filter and view picks, the location choice, and the legal acceptance. Every doc now states exactly that, and the spec's "Nothing about them is stored or tracked" was corrected the same way (guest sessions still log by device id). Why: a privacy claim in the release notes of a recovery app must be literally true, and support repeats it. Supersedes the claim in the Goal line, Task 9 Step 1b's sign-in-methods bullet and Task 9 Step 2's CHANGELOG snippet.
- **R33.** Jenova's directive: Zoom join links no longer carry the `un=` display-name prefill, for anyone ("doesn't work anyway and should be removed"). `buildExternalZoomUrl` takes no name, `ZoomJoinConfig.userName` is gone, and `zoomNameLogic.ts` and its test are deleted, because a link that never carries a name needs no guest name rule. It ran as a new Task 10. Why: Zoom never applied the name. Supersedes R9 and R30, and the name parts of Task 8 Steps 0, 1 and 3 (and the Zoom-name guard that the Architecture list and Task 9 Step 1 mention). Task 9 Step 4 item 3's Zoom-name check still holds, now for everyone.
- **R34.** Task 10 also carried three R32 follow-ups, because it edits the same files: a qualifier on the spec's "No data belonging to the device owner is visible" (device settings are shared, so per Decision 2 a guest can see the device's last bar pick), R32's entry here with pointers at the old claim, and an `isGuest` comment in `AuthenticationStore` that says what guest mode keeps. Why: the same files, and wording only.
- **R35.** A guest never has a `userId`, and the store now enforces it: `enterGuest()` refuses while one is present and Login hides "Just join meetings" then (the pure `decideGuestEntry` in `app/screens/login/guestEntryLogic.ts`), because Login also shows with a `userId` while a signed-in owner's token renews or a forced logout waits on a persisted timer, and a tap there let the owner's own Join run with no attendance timer for a whole session; this supersedes Task 5 Step 3's `enterGuest()` and, in Task 6 Step 3's Login snippet, the link's render condition and the unconditional `guest_mode_entered` event.
- **R36.** The final review's fix wave carried R35 and the review's small items (the TimerSessionResumer header, a `canLogAttendance` check inside InPersonPopup's "I'm Here" handler, the folded `buildExternalZoomUrl` comment, ProfileHydrator's merged note, jest cases for `enterGuest()` and the guest `ThemeProvider`, an EVENTS.md row for `login_code_sent`, the support README's sign-in-methods line, two support-doc sentences on the refusal (when Login hides the guest link, and the WARN line a refused entry logs), and the spec's status line) and deferred a per-method feedback-cache suppression test and a Login 48 dp assertion, which have no cheap test seam.
- **R37.** The items the final reviewer declined to judge were settled this way: the older rule that a meeting number beats a stored meetingUrl when there is no passcode is Jenova's product call; guest deep links and reminder taps stay ignored in v1, to be observed in the device pass; R23 (the `guestPromo` strings in the iOS bundle) and R11 (RevenueCat configured for guests) stand; the owner's profile hydrated onto Login after Guest → Sign in is accepted, since every field the Meetings tab shows has its own guard; the owner's AI conversation held in memory during guest mode is accepted, since the guest navigator has no Agent tab; legacy report rows with an empty uid are accepted, since current builds stamp a uid on every row and the report-polling resume pass skips rows older than seven days; the pre-existing expired-token Login flash is accepted, since R35 ends guest mode's exposure to it; signed-out sessions no longer carrying a Sentry or Umami id is the spec's intent, flagged to Jenova as an analytics change; the owner's reminder pushes still reaching a phone a guest holds are the existing push lifecycle, flagged as a follow-up; the promo copy and translations go to the content queue; and the baseline depcruise, eslint and jest noise predates the branch.

Also out of date in the plan text, though not set by a ruling:

- `app/db/index.ts` no longer re-exports `TimerSessionResumer`. `app.tsx` imports it directly, like `OwnerRelinkMigrator`, because its new `@/models` read would close a barrel cycle. Don't add the export back.
- Task 6's `GuestNavigator` cast fallback was not needed.
- Task 9 Step 4's items 2 and 5 are corrected in place: the bar's remembered pick (R25) and the dark default theme.

After the merge (2026-10-11, Jenova): "Just join meetings" became a full button, the last in `ChooseStep`'s stack and styled like the sign-in options, because guest mode is a first-class way in. This supersedes R22's underlined-link style and Task 6 Step 3's link block in `LoginScreen`. The screen passes `onJustJoin` only when `decideGuestEntry` allows a guest (R35).

After the merge (2026-10-11, Jenova): a guest's first visit opens with four onboarding cards (Welcome, Install Zoom, Your Privacy Matters, Open Source) before guest Meetings, through a `GuestOnboarding` route and `OnboardingNavigator`'s "guest" variant. Their own flag, `profileStore.guestOnboardingCompleted`, keeps a later real sign-in on the full six. The card sets live in `screens/onboarding/onboardingStepsLogic.ts`.
