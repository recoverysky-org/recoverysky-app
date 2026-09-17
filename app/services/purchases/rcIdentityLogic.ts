/**
 * rcIdentityLogic — which identity RevenueCat should be signed in as, and
 * what to do when it changes.
 *
 * ADDED 2026-09-17. Spec: docs/superpowers/specs/2026-09-17-revenuecat-identity-reactive-design.md.
 *
 * Until this, RevenueCat's app user id was `authenticationStore.userIdentifier`
 * read at render time in `App` (not an observer), so after sign-in the SDK
 * stayed identified as the DEVICE ID until `App` happened to re-render — and
 * a purchase made in that window posted to the device-id customer. The
 * 2026-09-17 export showed 9,881 device-id customers (one per install), 286
 * of them purchasers, 81 with active subscriptions the signed-in user could
 * not see. The rules here make the identity a reaction to the auth store and
 * keep the device id out of RevenueCat entirely.
 *
 * Pure, no `@/` imports, so vitest can reach it (CLAUDE.md, "Test Runner
 * Split"). The I/O half is the reaction in SubscriptionContext.
 */

/**
 * The RevenueCat app user id for the current auth state: the Auth0 sub when
 * a real user is signed in, otherwise null — in which case the SDK runs on
 * its own `$RCAnonymousID`, which `logIn()` later aliases into the user's
 * customer. The device id is never an answer: `loginAnonymously()` stores it
 * in `userId`, hence the `isAnonymous` check.
 */
export function rcIdentityFor(i: {
  userId: string | undefined
  isAnonymous: boolean
}): string | null {
  if (i.isAnonymous || !i.userId) return null
  return i.userId
}

export type RcIdentityTransition = "login" | "logout" | "none"

/** What one change of `rcIdentityFor` means for the SDK. A changed sub is a login, not a logout+login. */
export function decideRcIdentityTransition(
  prev: string | null,
  next: string | null,
): RcIdentityTransition {
  if (prev === next) return "none"
  if (next !== null) return "login"
  return "logout"
}

/** MMKV key: receipts synced for this identity on this install. */
export function syncFlagKey(appUserId: string): string {
  return `rc_purchases_synced.${appUserId}`
}

/**
 * Whether to run `syncPurchases()` now that RevenueCat is identified as
 * `appUserId`. Once per identity per install — NOT once per install, which is
 * what the old `rc_purchases_synced` flag did: it was written on first launch
 * under the device id, so the Auth0 customer never got a sync and a receipt
 * that had landed on the device-id customer stayed there. With Restore
 * Behavior = Transfer, the first sync under the Auth0 sub moves it over.
 */
export function shouldSyncForIdentity(
  appUserId: string,
  loadFlag: (key: string) => string | null | undefined,
): boolean {
  return !loadFlag(syncFlagKey(appUserId))
}
