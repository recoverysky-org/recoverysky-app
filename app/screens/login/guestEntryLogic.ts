/**
 * guestEntryLogic: whether LoginScreen offers guest mode ("Just join meetings").
 *
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md). Pure, with no
 * imports at all, so vitest can load it (CLAUDE.md "Test Runner Split").
 */

/**
 * True only on Android, on the choose step, with no `userId` present.
 *
 * - Android only: iOS requires an authenticated account.
 * - Choose step only, so the link never sits under the email or code field.
 * - No `userId`: Login also shows while one is present, for a signed-in owner
 *   whose token is renewing at cold start, and while a forced logout is
 *   deferred for a persisted attendance timer. Guest mode over the owner's own
 *   session would turn on every guest guard for that session, and Join would
 *   open Zoom with no attendance timer. `AuthenticationStore.enterGuest()`
 *   refuses in that state too; this keeps the link from being offered at all.
 */
export function decideGuestEntry(i: {
  /** Platform.OS */
  platform: string
  /** LoginScreen's step: "choose" | "email" | "code" */
  step: string
  /** Whether `authStore.userId` is set */
  hasUserId: boolean
}): boolean {
  return i.platform === "android" && i.step === "choose" && !i.hasUserId
}
