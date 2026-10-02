/**
 * Device ownership decisions (spec:
 * docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md §1.2).
 *
 * PURE MODULE — no `@/` runtime imports so vitest can load it. The I/O half
 * (reading/writing the store, routing) is in useAuth0Wrapper.ts and
 * AppNavigator.tsx.
 */

export type OwnershipDecision = "adopt" | "match" | "relinked" | "mismatch"

/**
 * One device, one owner. Anonymous sessions never own a device and are never
 * blocked by one — the first real sign-in adopts.
 *
 * CHANGED 2026-09-18: `isAnonymous` means "the session being decided is itself
 * anonymous", which is never true for an Auth0 session. It is NOT the auth
 * store's persisted flag: that describes the previous session, and passing it
 * here would wave a stranger's account through on a device whose flag had not
 * been reset yet. The gate in useAuth0Wrapper.ts passes a literal false.
 */
export function decideOwnership(input: {
  ownerSub: string | undefined
  sessionSub: string
  /** True only when the session being decided is itself anonymous (never for an Auth0 session). */
  isAnonymous: boolean
  /**
   * Every identity's standalone sub from the ID token's identities claim
   * (linkedSubsFromIdToken). Empty for an unlinked account or a tenant
   * without the Action.
   */
  linkedSubs?: readonly string[]
}): OwnershipDecision {
  if (input.isAnonymous) return "match"
  if (!input.ownerSub) return "adopt"
  if (input.ownerSub === input.sessionSub) return "match"
  // ADDED 2026-09-30 (spec 2 §7): the owner's identity was linked into another
  // account — from ANOTHER device, so this one's ownerSub still names the
  // identity as it was when standalone — and Auth0 now answers every sign-in
  // on it with the primary's sub. Same person, new sub. Without this the
  // wrong-account screen asked for the owner's address, which produced the
  // same sub again: a loop only Delete User Data could break. The claim is in
  // the signed ID token, the same source as sessionSub itself.
  if (input.linkedSubs?.includes(input.ownerSub)) return "relinked"
  return "mismatch"
}

export type ProofMethod = "code" | "google" | "apple" | "unknown"

/**
 * How the owner proves it's them, derived from the Auth0 sub prefix rather
 * than stored — storing it would let the two drift.
 *
 * `auth0|` (legacy password account) maps to `code` on purpose: spec 1's
 * post-login Action links an `email|` login into the password account when
 * the addresses match, so a code sent to ownerEmail returns the owner's sub.
 */
export function ownerProofMethod(sub: string | undefined): ProofMethod {
  if (!sub) return "unknown"
  if (sub.startsWith("email|") || sub.startsWith("auth0|")) return "code"
  if (sub.startsWith("google-oauth2|")) return "google"
  if (sub.startsWith("apple|")) return "apple"
  return "unknown"
}

/**
 * The address the Login screen offers as "Send code to …" after a sign-in.
 *
 * ADDED 2026-09-30. It used to be the ID token's `email`, stamped only at
 * adoption. For a linked account that is the PRIMARY identity's address, not
 * the one the user typed: a code sent to jenova-marie@proton.me signs into an
 * account whose primary is a gmail identity, so the button came back as
 * "Send code to m***@gmail.com". Either address reaches the same account, but
 * offering one the user never typed reads as the wrong account.
 * CHANGED 2026-09-30: "either address reaches the same account" holds only
 * while the typed address is that account's own email or was linked by the
 * Link passwordless identity Action. A different address linked from
 * WrongAccountScreen never signs in again (see decideForeignLink), so that
 * link is no longer made.
 *
 * - A code sign-in (by the owner, or the one that adopts the device) → the
 *   address the user typed, which is proven by the code they just entered.
 * - Adoption by any other method → the token's email, as before.
 * - The owner signing in by Apple/Google → keep what is stored.
 */
export function ownerEmailAfterLogin(input: {
  decision: "adopt" | "match" | "relinked"
  loginMethod: "email" | "apple" | "google" | undefined
  typedEmail: string | undefined
  tokenEmail: string | undefined
  currentOwnerEmail: string | undefined
}): string | undefined {
  if (input.loginMethod === "email" && input.typedEmail) return input.typedEmail
  if (input.decision === "adopt") return input.tokenEmail
  return input.currentOwnerEmail
}

export type ForeignLinkDecision = "same-session" | "link" | "skip-email-mismatch"

/**
 * After the owner proves themselves on WrongAccountScreen, whether to link the
 * foreign session's identity into the owner's account (spec 2 §2.5).
 *
 * ADDED 2026-09-30. The wrong-account screen exists for "I forgot which login
 * is mine": send the user back to the original sign-in. Linking is a side
 * benefit, and only safe when the foreign identity's address IS the owner
 * account's email. Auth0 finds email-code users by the ROOT account's email
 * only (verified on the dev tenant 2026-09-30: users-by-email and user search
 * never see a linked identity's address). So a linked email identity on a
 * DIFFERENT address can never sign in again — the next code login for it
 * creates a fresh, unlinked `email|` user, and the device lands back on this
 * screen while Settings shows the dead identity as "Linked". Matching
 * addresses are fine: Auth0 finds the account by its own email.
 *
 * Compared case-insensitively; a missing address on either side never links.
 * The user is told nothing either way — the caller only logs the outcome.
 */
export function decideForeignLink(input: {
  foreignSub: string
  foreignEmail: string | undefined
  acceptedSub: string
  acceptedEmail: string | undefined
}): ForeignLinkDecision {
  if (input.foreignSub === input.acceptedSub) return "same-session"
  const a = input.foreignEmail?.trim().toLowerCase()
  const b = input.acceptedEmail?.trim().toLowerCase()
  return a && b && a === b ? "link" : "skip-email-mismatch"
}

/**
 * ADDED 2026-10-01 (legacy email verification spec §7). True for a legacy
 * password account. Such an owner may be unable to receive a code (a typo'd
 * or dead address on the account), so the wrong-account screen also offers
 * the password form. An `email|` owner has no password to offer.
 */
export function ownerHasPassword(sub: string | undefined): boolean {
  return !!sub?.startsWith("auth0|")
}
