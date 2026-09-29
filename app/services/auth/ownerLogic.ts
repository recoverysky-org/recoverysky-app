/**
 * Device ownership decisions (spec:
 * docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md §1.2).
 *
 * PURE MODULE — no `@/` runtime imports so vitest can load it. The I/O half
 * (reading/writing the store, routing) is in useAuth0Wrapper.ts and
 * AppNavigator.tsx.
 */

export type OwnershipDecision = "adopt" | "match" | "mismatch"

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
}): OwnershipDecision {
  if (input.isAnonymous) return "match"
  if (!input.ownerSub) return "adopt"
  return input.ownerSub === input.sessionSub ? "match" : "mismatch"
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
