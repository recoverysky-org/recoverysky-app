/**
 * Pure decision logic for the RevenueCat `$email` subscriber attribute.
 *
 * Kept free of runtime `@/` imports so vitest can cover it (see CLAUDE.md
 * "Test Runner Split"). The I/O half lives in `revenueCatService.ts`
 * (`setUserEmail`) and the wiring in `SubscriptionContext`.
 *
 * Background (2026-09-14): RevenueCat showed no email on any customer, which
 * made support lookups by subscriber painful. The app identifies users to RC
 * with the Auth0 `sub` but never forwarded the Auth0 email as an attribute.
 */

export interface EmailAttributeInput {
  /** The id RevenueCat is identified with (rcIdentityFor) — an Auth0 sub or undefined. */
  appUserId: string | undefined
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
 * - The email is blank or not shaped like an address.
 *
 * CHANGED 2026-10-11: both device-id guards are gone with the old device-id
 * login — `appUserId` comes from rcIdentityFor, which can no longer be a
 * device id.
 */
export function resolveEmailAttribute(input: EmailAttributeInput): string | null {
  const { appUserId, authEmail } = input
  if (!appUserId) return null

  const email = authEmail.trim()
  if (!EMAIL_SHAPE.test(email)) return null
  return email
}
