/**
 * What went wrong with POST /auth0/email/start or /verify, as the verify-email
 * screen needs to know it. `getGeneralApiProblem` folds every 4xx into
 * "rejected" and drops the body, and this screen has to tell "wrong code" from
 * "address in use" — so these two calls read the API's `code` field instead.
 *
 * PURE and inside services/api/ on purpose: vitest loads it, and services/api
 * must not import from services/auth (depcruise cycle).
 */
export type EmailVerifyProblem =
  | "email_in_use"
  | "invalid_code"
  | "code_expired"
  | "too_many_attempts"
  | "rate_limited"
  | "inactive_recipient"
  | "not_password_account"
  /** Server trouble, no connection, or an answer we don't recognise: "try again". */
  | "unavailable"

const PASSED_THROUGH: readonly EmailVerifyProblem[] = [
  "email_in_use",
  "invalid_code",
  "code_expired",
  "too_many_attempts",
  "inactive_recipient",
  "not_password_account",
]

export function emailVerifyProblemFrom(
  status: number | undefined,
  bodyCode: unknown,
): EmailVerifyProblem {
  if (status === 429) return "rate_limited"
  // The app only sends addresses that pass isPlausibleEmail; one the API's
  // stricter check still refuses is, to the user, an address we can't mail.
  if (bodyCode === "invalid_email") return "inactive_recipient"
  const known = PASSED_THROUGH.find((code) => code === bodyCode)
  return known ?? "unavailable"
}
