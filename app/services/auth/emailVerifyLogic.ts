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

// Type-only and relative: erased at runtime, so vitest can still load this module.
import type { EmailVerifyProblem } from "../api/emailVerifyProblem"

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
 *
 * CHANGED 2026-10-04 (RS-054): `undefined` now means "not read yet" and WAITS;
 * only an explicit `false` asks. A cold start hydrates tokens from SecureStore
 * (setupRootStore) before useAuth0Wrapper's [user] sync has read the ID token,
 * so `isAuthenticated` was true while the claim was still undefined. On the
 * first launch of the build that added the claim, 18 of 21 showings fired
 * 0.05–0.7 s before the claim arrived, and 11 of those went to accounts Auth0
 * already had as verified. The rule above still holds where it matters: the
 * sync writes `claim === true`, so a token WITHOUT the claim stores `false`
 * and is asked. Only a session with no ID token at all is never asked.
 *
 * CHANGED 2026-10-01 (final review): only a session with NO recorded
 * `loginMethod` is asked — a password sign-in, or a session restored from a
 * build that never recorded one. A Google or Apple session into a linked
 * `auth0|` account carries the password identity's unverified flag too, but
 * linking required the provider's verified email to equal the account's, so
 * the mailbox is already proven (spec §3: "Google and Apple never see it").
 */
export function needsEmailVerification(input: {
  sub: string | undefined
  emailVerifiedClaim: boolean | undefined
  loginMethod: "email" | "apple" | "google" | undefined
  locallyVerified: boolean
}): boolean {
  if (!input.sub?.startsWith("auth0|")) return false
  if (input.locallyVerified) return false
  if (input.loginMethod !== undefined) return false
  return input.emailVerifiedClaim === false
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
 *
 * CHANGED 2026-10-01 (final review): a degraded device lane blocks too. While
 * `configStore.deviceAuthDegraded` is set, every API send is refused locally
 * and answers "unavailable", so a mandatory screen would have no way to pass —
 * the same lock-out as offline.
 */
export function verifyGateBlocked(input: {
  isAuthenticated: boolean
  isAnonymous: boolean
  onboardingCompleted: boolean
  offline: boolean
  maintenanceMode: boolean
  outageMode: boolean
  timerSessionActive: boolean
  deviceAuthDegraded: boolean
}): boolean {
  return (
    !input.isAuthenticated ||
    input.isAnonymous ||
    !input.onboardingCompleted ||
    input.offline ||
    input.maintenanceMode ||
    input.outageMode ||
    input.timerSessionActive ||
    input.deviceAuthDegraded
  )
}

/**
 * Where the verify screen goes after the API refused a code (ADDED 2026-10-01).
 * `null` means stay on the current step and show the problem there.
 * - A dead code (expired, or killed by too many wrong tries) goes back to
 *   review, where a new one can be sent.
 * - An address already in use goes to the change step, to pick another.
 */
export function stepAfterVerifyProblem(problem: EmailVerifyProblem): "review" | "change" | null {
  if (problem === "code_expired" || problem === "too_many_attempts") return "review"
  if (problem === "email_in_use") return "change"
  return null
}

/**
 * Whether the address that got verified differs from the one the account
 * carried (ADDED 2026-10-01). Case and surrounding whitespace don't count; an
 * empty or missing account email always counts as changed.
 */
export function emailChanged(verifiedEmail: string, accountEmail: string | undefined): boolean {
  return verifiedEmail.trim().toLowerCase() !== (accountEmail ?? "").trim().toLowerCase()
}

/**
 * Whether a screen that is already up must close (ADDED 2026-10-01).
 * - Account gone (signed out or switched): close, in either mode.
 * - MANDATORY and blocked (offline, maintenance, outage, a timer, a degraded
 *   device lane): close,
 *   because the user could neither send a code nor leave. It re-shows by
 *   itself once unblocked, since a mandatory showing latches.
 * - SKIPPABLE stays up when blocked: "Not now" is always there, and closing
 *   would burn the day's already-counted showing on a network blip.
 * - ADDED 2026-10-04 (RS-054): the claim now reads verified: close, in either
 *   mode. The store's value is persisted, so a cold start can show the screen
 *   on yesterday's `false` moments before the sync reads a token that says
 *   `true` (the address was verified on another device). Nothing is left to ask.
 */
export function mustCloseShownGate(input: {
  mode: "skippable" | "mandatory"
  hasAccount: boolean
  blocked: boolean
  claimVerified: boolean
}): boolean {
  if (!input.hasAccount || input.claimVerified) return true
  return input.mode === "mandatory" && input.blocked
}
