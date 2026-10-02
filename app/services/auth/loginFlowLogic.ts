/**
 * Pure decisions for the three-state login screen (spec:
 * docs/superpowers/specs/2026-09-12-passwordless-login-design.md §1, §4.1).
 *
 * PURE MODULE — no `@/` runtime imports, no React, no native modules, so
 * vitest can load it (CLAUDE.md "Test Runner Split"). The screen owns the
 * I/O and calls these.
 */

export type LoginStep = "choose" | "email" | "code"

export type LoginEvent =
  | "chooseEmail"
  | "chooseOwnerEmail"
  | "codeSent"
  | "back"
  | "wrongEmail"
  | "tooManyAttempts"
  | "sendRateLimited"

/**
 * Our own resend hold-off. Auth0's per-address send limit is stricter over an
 * hour; this just stops a double-tap from burning two codes.
 */
export const RESEND_COOLDOWN_MS = 30_000

/**
 * `j***@proton.me`. Shown wherever the address might be glanced at on a shared
 * screen — the login screen's owner button, the code step header, and the
 * wrong-account screen. Always the same three asterisks so the mask never
 * leaks the local part's length.
 */
export function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  const at = normalized.indexOf("@")
  if (at <= 0) return email
  return `${normalized[0]}***${normalized.slice(at)}`
}

/**
 * Deliberately permissive: `x@y.z`. Real validation is Auth0's job — a code
 * that never arrives is the feedback. This only gates the Send button so an
 * obviously unfinished address doesn't fire a request.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/**
 * Seconds left before Resend is allowed again; 0 means allowed now.
 * CHANGED 2026-10-01: the cooldown is a parameter (default unchanged) so the
 * verify-email screen can use 60 s without a second copy of this function.
 */
export function resendWaitSeconds(
  lastSentAt: number | null,
  now: number,
  cooldownMs: number = RESEND_COOLDOWN_MS,
): number {
  if (lastSentAt === null) return 0
  const remainingMs = lastSentAt + cooldownMs - now
  if (remainingMs <= 0) return 0
  return Math.ceil(remainingMs / 1000)
}

/**
 * Step transitions. `tooManyAttempts` / `sendRateLimited` return to `email`
 * on purpose: the only remedy is waiting, and leaving the user on `code`
 * invites more failed attempts and a longer lockout.
 *
 * CHANGED 2026-09-18: `sendRateLimited` no longer ejects a user who is ALREADY
 * on the code step. That event fires when a RESEND is refused, which says
 * nothing about the code Auth0 already delivered — it is still sitting in the
 * inbox and still valid. Sending them back to `email` discarded the field they
 * were typing into and left Send, itself rate-limited, as the only control on
 * screen: a dead end built out of a recoverable state. `tooManyAttempts` is
 * different and still ejects, because there the CODE is what got locked out.
 */
export function nextStep(step: LoginStep, event: LoginEvent): LoginStep {
  switch (event) {
    case "chooseEmail":
      return "email"
    case "chooseOwnerEmail":
      return "code"
    case "codeSent":
      return "code"
    case "back":
      if (step === "code") return "email"
      return "choose"
    case "wrongEmail":
      return "email"
    case "tooManyAttempts":
      return "email"
    case "sendRateLimited":
      if (step === "code") return "code"
      return "email"
  }
}
