/**
 * Pure classification of Auth0 web-auth failures into the handful we show a
 * friendlier, actionable message for. Everything else returns `null` and the
 * caller keeps surfacing the SDK's own message, exactly as before 2026-09-12.
 *
 * Deliberately duck-typed and free of `react-native-auth0` / `@/` runtime
 * imports so vitest can load it (see "Test Runner Split" in CLAUDE.md). The
 * `type` strings are the SDK's `WebAuthErrorCodes` values; keep them as string
 * literals here rather than importing the enum.
 *
 * ADDED 2026-09-12 after the Play pre-launch crawler (and one real user on
 * 4.8.0) hit "The browser window was closed by a new instance of the
 * application". That is react-native-auth0's Android `onNewIntent` rejection:
 * MainActivity (singleTask) received a fresh launch intent while the Custom Tab
 * was open, which also pops the tab off the task. A plain retry works; the raw
 * sentence just reads like something broke on our side.
 */

export type AuthErrorMessageKey = "browserTerminated" | "networkError"

/** Shape-only view of a react-native-auth0 `WebAuthError` (or anything thrown). */
interface AuthErrorLike {
  type?: unknown
  message?: unknown
}

export function classifyAuthError(err: unknown): AuthErrorMessageKey | null {
  if (typeof err !== "object" || err === null) return null
  const { type, message } = err as AuthErrorLike
  const msg = typeof message === "string" ? message : ""

  if (type === "BROWSER_TERMINATED") return "browserTerminated"
  if (type === "NETWORK_ERROR") return "networkError"

  // Auth0.Android's NetworkErrorException reaches JS as "Network error" or
  // "Failed to execute the network request." — both seen in prod logs on
  // 4.7/4.8 — and the SDK does not always tag them NETWORK_ERROR.
  if (/network (error|request)/i.test(msg)) return "networkError"

  return null
}

/**
 * Whether the user walked away from the web-auth flow on purpose: closed the
 * tab (`USER_CANCELLED`) or reached the consent screen and declined
 * (`ACCESS_DENIED`). Neither is an error on our side, so callers log at INFO
 * and show nothing — the user did what they meant to do.
 *
 * ADDED 2026-09-19 (RS-022). The decline arrived in production as "An
 * unexpected error occurred. CAUSE: User did not authorize the request." and
 * was logged at ERROR twice per tap. The SDK maps Auth0's `access_denied` to
 * `ACCESS_DENIED`, but the observed text came through the Android module's
 * generic wrapper, whose type could not be confirmed from the logs, so the
 * message is matched as well — the same belt-and-braces the network case uses.
 */
export function isUserAbandonedAuth(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const { type, message } = err as AuthErrorLike
  if (type === "USER_CANCELLED" || type === "ACCESS_DENIED") return true
  const msg = typeof message === "string" ? message : ""
  return /did not authorize/i.test(msg)
}
