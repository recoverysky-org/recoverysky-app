/**
 * RevenueCat Configuration
 *
 * Contains API keys, entitlement identifiers, and product configuration.
 * Use the test API key for development and platform-specific keys for production.
 */

import { Platform } from "react-native"

/**
 * RevenueCat API Keys
 *
 * Keys are provided by the server via /config endpoint and stored in ConfigStore.
 * These hardcoded values serve as fallbacks only if the server config is unavailable.
 *
 * In __DEV__: uses the test store key (RevenueCat test environment)
 * In production: uses platform-specific keys (Apple sandbox/production auto-detected)
 */
export const REVENUECAT_CONFIG = {
  // Fallback keys — server-provided keys in ConfigStore take priority
  testApiKey: "test_LDsvtXxrdEkYzSXrbqMcKOiomvI",
  iosApiKey: "appl_MnVawjDDhxwzeRUBWsWuXjPOaNo",
  androidApiKey: "",

  /**
   * Get the fallback API key based on environment and platform.
   * Prefer configStore.revenueCatApiKey over this when available.
   */
  getApiKey(): string {
    if (__DEV__) {
      return this.testApiKey
    }

    if (Platform.OS === "ios") {
      return this.iosApiKey
    } else if (Platform.OS === "android") {
      return this.androidApiKey
    }

    return this.testApiKey
  },
} as const

/**
 * Entitlement Identifiers
 *
 * These must match the entitlements configured in RevenueCat dashboard.
 */
export const ENTITLEMENTS = {
  /** RecoverySky Premium - Premium subscription access (Agent, etc.) */
  PREMIUM: "recoverysky-premium",
  /** RecoverySky Attendance - Attendance report access */
  ATTENDANCE: "recoverysky-attendance",
} as const

/**
 * Product Identifiers
 *
 * These must match the product IDs configured in App Store Connect / Google Play Console.
 */
export const PRODUCTS = {
  /** Monthly subscription */
  MONTHLY: "monthly",
  /** Yearly subscription */
  YEARLY: "yearly",
  /** Lifetime one-time purchase */
  LIFETIME: "lifetime",
} as const

/**
 * Offerings are NOT selected by id. REMOVED 2026-09-15: `OFFERINGS` picked
 * "premium-standard" in dev and "default" in prod, and neither id has existed
 * in the RevenueCat project for some time — the project's offerings are
 * default-offering / premium-subscription / premium-subscription-redesign —
 * so every environment was silently falling back to `offerings.current`
 * anyway. `current` is what the dashboard, Experiments and Targeting control,
 * and fetching by a hardcoded id bypasses all three, so `getOfferings()` in
 * revenueCatService.ts now uses it deliberately. To show a different paywall,
 * change the current offering in the dashboard; no release needed.
 */

export type EntitlementId = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS]
export type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS]
