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
 * IMPORTANT: Never ship with test API key to production!
 * Use environment variables or build configurations in production.
 */
export const REVENUECAT_CONFIG = {
  // Test Store API key - use for development only
  testApiKey: "test_LDsvtXxrdEkYzSXrbqMcKOiomvI",

  // Platform-specific API keys for production
  // TODO: Replace with actual production keys from RevenueCat dashboard
  iosApiKey: "appl_XXXXXXXXXXXXXXXXXXXXXXXXXX",
  androidApiKey: "goog_XXXXXXXXXXXXXXXXXXXXXXXXXX",

  /**
   * Get the appropriate API key based on environment and platform
   */
  getApiKey(): string {
    // Use test key for development
    if (__DEV__) {
      return this.testApiKey
    }

    // Use platform-specific keys for production
    if (Platform.OS === "ios") {
      return this.iosApiKey
    } else if (Platform.OS === "android") {
      return this.androidApiKey
    }

    // Fallback to test key (should not happen in production)
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
 */
export const OFFERINGS = {
  /** Default offering shown to all users */
  DEFAULT: "default",
} as const

export type EntitlementId = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS]
export type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS]
export type OfferingId = (typeof OFFERINGS)[keyof typeof OFFERINGS]
