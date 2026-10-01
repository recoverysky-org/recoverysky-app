/**
 * Decisions for the legacy email verification gate (spec:
 * docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md §3–4).
 *
 * PURE MODULE — no `@/` runtime imports so vitest can load it. The I/O half is
 * emailVerifyState.ts (MMKV) and components/VerifyEmailGate.tsx.
 *
 * Why this exists: passwordless sign-in finds an account by its email. A
 * legacy password account whose address is a typo or a dead mailbox cannot be
 * found, so its owner must fix the address while still signed in.
 */

/**
 * Six skippable showings; the seventh is mandatory (decided 2026-10-01). One
 * showing a day, so a user gets a full week of use before it is required.
 */
export const MAX_SKIPS = 6
/** Our code email can be slower than Auth0's; Login keeps its own 30 s. */
export const VERIFY_RESEND_COOLDOWN_MS = 60_000
export const WHY_VERIFY_URL =
  "https://www.recoverysky.org/post/8/recoverysky-required-email-verification"
export const SUPPORT_EMAIL = "support@recoverysky.app"

/** Per install, per account. `count` = showings so far. */
export interface VerifyState {
  count: number
  /** Local calendar day (YYYY-MM-DD) of the last showing. */
  lastDay: string | null
  /** Set once the API confirmed a code. Wins over the ID token's claim. */
  verified: boolean
}

export const EMPTY_VERIFY_STATE: VerifyState = { count: 0, lastDay: null, verified: false }

/**
 * Only an unverified PASSWORD account is asked.
 *
 * - `locallyVerified` wins over the claim: a cold start can restore a cached
 *   ID token that still says unverified after the API already fixed it.
 * - A session started by an email code is never asked: entering the code
 *   proved the mailbox. The token for a linked password account still carries
 *   the password identity's unverified flag, so the claim alone would ask
 *   someone who verified seconds ago.
 * - A missing claim counts as unverified: asking once too often is cheap, and
 *   never asking a locked-out-to-be user is not.
 */
export function needsEmailVerification(input: {
  sub: string | undefined
  emailVerifiedClaim: boolean | undefined
  loginMethod: "email" | "apple" | "google" | undefined
  locallyVerified: boolean
}): boolean {
  if (!input.sub?.startsWith("auth0|")) return false
  if (input.locallyVerified) return false
  if (input.loginMethod === "email") return false
  return input.emailVerifiedClaim !== true
}

export type VerifyPrompt =
  | { mode: "hidden" }
  | { mode: "skippable"; skipsLeft: number }
  | { mode: "mandatory" }

/**
 * One showing per local day. Showings 1–MAX_SKIPS are skippable; after that it
 * is mandatory and latches (shown on every check, whatever the day).
 * `lastDay !== today` rather than `<`: a clock set backwards must not hide the
 * screen until the old date comes round again.
 */
export function decideVerifyPrompt(state: VerifyState, today: string): VerifyPrompt {
  if (state.count > MAX_SKIPS) return { mode: "mandatory" }
  if (state.lastDay === today) return { mode: "hidden" }
  if (state.count === MAX_SKIPS) return { mode: "mandatory" }
  return { mode: "skippable", skipsLeft: MAX_SKIPS - state.count }
}

/**
 * Call when the screen is displayed, not when "Not now" is tapped — killing
 * the app must not dodge the count. Capped one past MAX_SKIPS (the latch).
 */
export function recordShowing(state: VerifyState, today: string): VerifyState {
  return { ...state, count: Math.min(state.count + 1, MAX_SKIPS + 1), lastDay: today }
}

/**
 * Times the screen must not appear at all (and so must not count a day):
 * the API can't send a code offline or in maintenance, and a mandatory screen
 * with no way to pass would lock a user out of meetings. A running attendance
 * timer and onboarding are work in progress we never interrupt.
 */
export function verifyGateBlocked(input: {
  isAuthenticated: boolean
  isAnonymous: boolean
  onboardingCompleted: boolean
  offline: boolean
  maintenanceMode: boolean
  outageMode: boolean
  timerSessionActive: boolean
}): boolean {
  return (
    !input.isAuthenticated ||
    input.isAnonymous ||
    !input.onboardingCompleted ||
    input.offline ||
    input.maintenanceMode ||
    input.outageMode ||
    input.timerSessionActive
  )
}
