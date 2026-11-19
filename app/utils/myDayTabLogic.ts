/**
 * Pure decision for whether the My Day tab is shown. Kept free of runtime `@/`
 * and React Native imports so vitest can import it (see CLAUDE.md "Test Runner
 * Split"); MainNavigator supplies the inputs. Mirrors `agentTabLogic.ts`.
 *
 * Keyed on the build's `EXPO_PUBLIC_DAILY_DASH_API_URL` env var, not on a store:
 * a store would fall back to a default URL and never be empty, so it could not
 * serve as an on/off switch. Removing the var from a build's environment (and
 * from EAS, for OTAs) is what turns the tab off, the same way the Agent tab
 * works.
 *
 * Deliberately NO `__DEV__` escape, unlike the Agent tab: a dev build without
 * premium has no Daily Dash account to show, so the tab would only render an
 * error. CHANGED 2026-11-07 (Jenova): the gate is RevenueCat's `myday`
 * entitlement, no longer `recoverysky-premium`, and the Agent tab lost its
 * `__DEV__` escape too, so both tabs follow the same rule. Guests and signed-out users never see it either: My Day belongs to
 * the device owner's account.
 */
import { isValidAgentUrl } from "./agentTabLogic"

/**
 * Re-exported `isValidAgentUrl`: the same shape applies, an absolute http(s)
 * base with no query or fragment, because the Daily Dash client appends
 * `/v1/...` to it and a `?` or `#` would swallow that suffix.
 */
export const isValidDailyDashUrl: (raw: string | undefined | null) => boolean = isValidAgentUrl

export interface MyDayTabInputs {
  isAuthenticated: boolean
  isGuest: boolean
  /** RevenueCat `myday` entitlement. CHANGED 2026-11-07: was `isPremium`. */
  hasMyDay: boolean
  /** The build's `EXPO_PUBLIC_DAILY_DASH_API_URL`, as inlined at bundle time. */
  dailyDashUrlEnv: string | undefined
  /** `Platform.OS`; the tab is phone-only (spec D12), so "web" hides it. */
  platform: string
}

/**
 * Whether the My Day tab's icon is in the tab bar. ADDED 2026-11-19 (Jenova): it shows without
 * the `myday` entitlement, as an upsell. A tap without it opens the "Premium Feature" alert and
 * the paywall instead of the tab (`useMyDayPaywallPrompt`), and the tab's screen renders
 * `MyDayLocked`, never the package, so no Daily Dash client mounts for an account without it.
 */
export function decideMyDayTabShown(i: Omit<MyDayTabInputs, "hasMyDay">): boolean {
  return (
    i.isAuthenticated &&
    !i.isGuest &&
    isValidDailyDashUrl(i.dailyDashUrlEnv) &&
    i.platform !== "web"
  )
}

/**
 * Whether My Day itself is open to this account: the tab shows and the `myday` entitlement holds.
 * CHANGED 2026-11-19: no longer what puts the icon in the tab bar (`decideMyDayTabShown` does). It
 * is still the gate `DailyDashProvider` feeds the sign-in driver, and what mounts
 * `MyDayNavigator`, so the session and the client exist exactly while it holds.
 */
export function decideMyDayTabVisible(i: MyDayTabInputs): boolean {
  return decideMyDayTabShown(i) && i.hasMyDay
}
