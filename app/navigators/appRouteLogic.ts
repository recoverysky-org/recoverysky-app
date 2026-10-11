/**
 * Which top-level route AppNavigator shows. ADDED 2026-10-11 for guest mode
 * (spec 2026-09-27-guest-mode-design.md).
 *
 * Order: outage → authenticated (Onboarding | Main) → WrongAccount → Guest →
 * Login. AppNavigator uses this for BOTH the registered screen and
 * initialRouteName — only the matching <Stack.Screen> is registered per
 * render, so the two must never diverge (see the 2026-09-18 note there).
 *
 * WrongAccount outranks Guest so a refused session is never hidden behind
 * guest browsing. Guest is Android-only: iOS requires an authenticated
 * account, so a stray persisted flag there (restored backup) falls to Login.
 *
 * Pure, no `@/` imports (CLAUDE.md "Test Runner Split").
 */
export type AppRoute = "Maintenance" | "Onboarding" | "Main" | "WrongAccount" | "Guest" | "Login"

export function decideAppRoute(i: {
  outage: boolean
  isAuthenticated: boolean
  needsOnboarding: boolean
  hasForeignSession: boolean
  isGuest: boolean
  /** Platform.OS */
  platform: string
}): AppRoute {
  if (i.outage) return "Maintenance"
  if (i.isAuthenticated) return i.needsOnboarding ? "Onboarding" : "Main"
  if (i.hasForeignSession) return "WrongAccount"
  if (i.isGuest && i.platform === "android") return "Guest"
  return "Login"
}
