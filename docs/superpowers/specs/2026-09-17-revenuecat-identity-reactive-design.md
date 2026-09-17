# RevenueCat identity: reactive, per-identity synced, no device ids — design

**Date:** 2026-09-17
**Status:** Approved, implementing. JS-only → OTA.
**Prerequisite (done 2026-09-17):** RevenueCat → Project settings → *Handling multiple
app user IDs* = **Transfer to new App User ID** (verified by Jenova; it is also the default).

## Problem

RevenueCat's app user id is `authenticationStore.userIdentifier` read at render time in
`App` (`app.tsx:1192`) and passed to `SubscriptionProvider` as a prop. `App` is not an
observer, so after sign-in the SDK stays identified as the **device id** until `App`
happens to re-render — `SubscriptionContext` already carries a comment saying exactly
this about the email attribute ("the `appUserId` prop only refreshes on incidental
re-renders").

Evidence:

- Dev log, 2026-09-14 21:00 CDT: `Auth0 login flow completed`, then one minute later the
  purchase posts as `POST /v1/receipts` for `/v1/subscribers/3c8d8f26d5fb07b3` — the
  Pixel's Android ID, not the Auth0 sub.
- RevenueCat customer export, 2026-09-17: 13,686 customers; 9,881 are device-id
  customers (one per install: `Purchases.configure({ appUserID: deviceId })` runs before
  anyone signs in and RevenueCat mints a customer on first contact); **286 purchasers are
  on device-id customers** (228 iOS, where anonymous auth never existed), **81 with an
  active subscription**, last seen on versions up to 4.10.1.

Consequence for those 81: their next cold start identifies as the Auth0 sub (persisted
`userId`), which owns nothing → paywall → a paying user is locked out until they think to
tap Restore Purchases.

## Design

Three parts, all in `SubscriptionContext.tsx` / `app.tsx` / `revenueCatService.ts`.

### 1. Identity is a MobX reaction, not a prop

`SubscriptionProvider` drops the `appUserId` prop and subscribes to the auth store:

```ts
const signedInId = () => rcIdentityFor({ userId: authStore.userId, isAnonymous: authStore.isAnonymous })
reaction(signedInId, (next, prev) => apply(decideRcIdentityTransition(prev, next)))
```

- `rcIdentityFor` → the Auth0 `userId` when signed in and not anonymous, else `null`.
  (Same rule as `pushRegistrationUserId`; the device id is never a RevenueCat identity.)
- `decideRcIdentityTransition(prev, next)` → `"login"` (null→sub, or sub→different sub),
  `"logout"` (sub→null), `"none"`. Pure, vitest-covered, in
  `app/services/purchases/rcIdentityLogic.ts`.
- `login` → `Purchases.logIn(sub)`, then the email attribute sync, then the per-identity
  receipt sync (§2), then `loadSubscriptionInfo()`. `logout` → `Purchases.logOut()`.
- The reaction fires synchronously with the store write that sets `userId`, so there is no
  window between "signed in" and "RevenueCat knows". `fireImmediately: true` covers the
  cold start where the store hydrates before RevenueCat finishes configuring — handled by
  applying the transition once `isInitialized` flips, using the current value.

The existing `prevAppUserId` effect is deleted; it was the prop-driven version of this.

### 2. Sync receipts once per identity, not once per install

The migration sync (`syncExistingPurchases()` → `Purchases.syncPurchases()`) is gated by
the MMKV flag `rc_purchases_synced`, written on **first launch — under the device id**.
The Auth0 customer therefore never gets a sync unless identity changes mid-session.

Replace the flag with **`rc_purchases_synced.<appUserId>`**: the first time RevenueCat is
identified as a given id on this install, sync once. Bounded by the 20 s store ceiling
(`billingHealthLogic.ts`, 2026-09-15); a timeout leaves the flag unset so it retries next
launch. The old install-wide flag is ignored (orphaned, harmless).

This is also the **remediation for the 81 stranded subscribers**, with no user action:
their next cold start identifies as the Auth0 sub, finds no per-identity flag, syncs the
device's store receipt, and — because Restore Behavior is Transfer — RevenueCat moves the
subscription from the device-id customer to the Auth0 customer. `Customer info updated`
then grants the entitlement.

Decision: `shouldSyncForIdentity(appUserId, flags)` is pure (same module as §1).

### 3. Stop minting device-id customers

`initializeRevenueCat` is called with **no `appUserID`** when nobody is signed in. The
SDK generates a `$RCAnonymousID:…`, and a later `logIn(sub)` **aliases** that anonymous
customer into the Auth0 customer — RevenueCat's designed flow, which it never performs
for our custom device ids. Existing installs are unaffected: the SDK keeps its cached
current app user id until the next `logIn`/`logOut`, and the reaction in §1 issues that.

Downstream already understands anonymous ids: `resolveEmailAttribute` sends nothing for
them, and the backfill's `classifyAppUserId` skips them.

Jenova's direction (2026-09-17): the device id should not be used as a *user identity*
anywhere. This spec removes it from RevenueCat; the wider removal of the anonymous-login
path (`loginAnonymously`, `isAnonymous`, `userIdentifier`'s device-id fallback — 15 files)
is a separate TODO item, not part of this change.

## Files

- `app/services/purchases/rcIdentityLogic.ts` (+ test): `rcIdentityFor`,
  `decideRcIdentityTransition`, `shouldSyncForIdentity`, `syncFlagKey`.
- `app/context/SubscriptionContext.tsx`: reaction replaces the prop + `prevAppUserId`
  effect; per-identity sync; configure without an id when signed out.
- `app/app.tsx`: delete `revenueCatUserId` and the prop.
- `app/services/purchases/revenueCatService.ts`: `initializeRevenueCat(apiKey, appUserId?)`
  passes `appUserID` only when given; comment.
- `CLAUDE.md` Subscription System section; `CHANGELOG.md` Fixed.

## Verification

- Vitest: the three pure decisions (edges, same-sub no-op, sub→other-sub is a login).
- Manual (dev build, test store): fresh install → RevenueCat debug log shows
  `Initial App User ID - $RCAnonymousID:…`; sign in → `Identifying App User ID: <sub>`
  **before** any Subscribe tap; purchase → `POST /v1/receipts` under the sub; sign out →
  `logOut`. Stranded case: on the Pixel, the 2026-09-14 test-store purchase sits on
  `3c8d8f26d5fb07b3`; a signed-in cold start after this ships should show Premium with no
  Restore tap, and the dashboard should show the subscription transferred.
- Fleet: the RevenueCat export's device-id **active** count (81 on 2026-09-17) should fall
  as those users launch.

## Out of scope

- Deleting the ~9,900 historical device-id customers in RevenueCat (inert records).
- The 286 device-id purchasers who never launch again (nothing client-side can reach them).
- Removing the anonymous-login path app-wide (separate TODO).
