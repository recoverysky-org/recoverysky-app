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
 * Offering Identifiers
 *
 * These must match the offerings configured in RevenueCat dashboard.
 * In __DEV__ (simulator), we use a specific test offering.
 */
export const OFFERINGS = {
  /** Default offering shown to all users */
  DEFAULT: "default",
  /** Premium standard offering for simulator/dev testing */
  PREMIUM_STANDARD: "premium-standard",

  /**
   * Get the offering identifier for the current environment.
   * Simulator/dev uses 'premium-standard', production uses 'default'.
   */
  getOfferingId(): string {
    if (__DEV__) {
      return this.PREMIUM_STANDARD
    }
    return this.DEFAULT
  },
} as const

export type EntitlementId = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS]
export type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS]
export type OfferingId = (typeof OFFERINGS)[keyof typeof OFFERINGS]
