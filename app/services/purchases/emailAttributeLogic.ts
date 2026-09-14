/**
 * Pure decision logic for the RevenueCat `$email` subscriber attribute.
 *
 * Kept free of runtime `@/` imports so vitest can cover it (see CLAUDE.md
 * "Test Runner Split"). The I/O half lives in `revenueCatService.ts`
 * (`setUserEmail`) and the wiring in `SubscriptionContext`.
 *
 * Background (2026-09-14): RevenueCat showed no email on any customer, which
 * made support lookups by subscriber painful. The app identifies users to RC
 * with `authStore.userIdentifier` (Auth0 `sub`, or the device id for anonymous
 * users) but never forwarded the Auth0 email as an attribute.
 */

export interface EmailAttributeInput {
  /** The id RevenueCat is currently identified with (`authStore.userIdentifier`). */
  appUserId: string | undefined
  /** Stable per-install device id; anonymous users are identified by this. */
  deviceId: string | undefined
  /** `authStore.isAnonymous`. */
  isAnonymous: boolean
  /** `authStore.authEmail` — set from Auth0's `user.email`, may be empty. */
  authEmail: string
}

/**
 * Deliberately loose shape check. We are not validating for delivery — only
 * refusing obvious non-addresses (some Auth0 connections return a placeholder
 * in `email`) so RC's `$email` column stays clean enough to search.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Decide which email (if any) to attach to the current RevenueCat customer.
 *
 * Returns `null` when nothing should be sent:
 * - RC is not identified yet (no app user id).
 * - The customer is anonymous. `isAnonymous` is checked AND the id is compared
 *   to the device id, because `logout()` clears the flag while
 *   `userIdentifier` falls back to the device id — attaching a leftover email
 *   to the device-id customer would mislabel the next person on that device.
 * - The email is blank or not shaped like an address.
 */
export function resolveEmailAttribute(input: EmailAttributeInput): string | null {
  const { appUserId, deviceId, isAnonymous, authEmail } = input
  if (!appUserId) return null
  if (isAnonymous) return null
  if (deviceId !== undefined && appUserId === deviceId) return null

  const email = authEmail.trim()
  if (!EMAIL_SHAPE.test(email)) return null
  return email
}
