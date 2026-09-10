/**
 * Lets the Auth0 SDK sync effect (useAuth0Wrapper, mounted inside the
 * navigator tree) reach the user refresher's eject latch, which is created
 * in app.tsx's init closure before the tree exists.
 *
 * ADDED 2026-09-10. Module-level registration rather than a prop or a
 * context: the hook has four mount sites (AppNavigator, LoginScreen,
 * SettingsScreen, DevScreen) and none of them is app.tsx. Same idiom as
 * api.registerTokenRefreshers(). Spec:
 * docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md
 */

import type { UnusableTokenReason } from "./jwtUtils"

type UnusableTokenHandler = (reason: UnusableTokenReason) => void

let handler: UnusableTokenHandler | null = null

/** Called once from app.tsx after the user refresher exists. */
export function registerUnusableTokenHandler(fn: UnusableTokenHandler): void {
  handler = fn
}

/**
 * Report a token the SDK handed us that can never be accepted by the API.
 * Returns false when no handler is registered yet (nothing ejected); the
 * caller logs either way.
 */
export function reportUnusableToken(reason: UnusableTokenReason): boolean {
  if (!handler) return false
  handler(reason)
  return true
}
