/**
 * RevenueCat Service
 *
 * Centralized service for RevenueCat SDK operations including:
 * - SDK initialization
 * - Customer info retrieval
 * - Entitlement checking
 * - Purchase handling
 * - Subscription management
 */

import Purchases, {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  PurchasesError,
} from "react-native-purchases"
import RevenueCatUI, { PAYWALL_RESULT } from "react-native-purchases-ui"

import { logger } from "@/utils/logger"

import { REVENUECAT_CONFIG, ENTITLEMENTS, OFFERINGS, type EntitlementId } from "./config"

const log = logger.child({ module: "RevenueCatService" })

/**
 * RevenueCat Service Result type
 */
type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: PURCHASES_ERROR_CODE }

/**
 * Subscription info for UI display
 */
export interface SubscriptionInfo {
  /** Whether user has active premium subscription */
  isPremium: boolean
  /** Whether user has attendance report entitlement */
  hasAttendance: boolean
  /** Active entitlements */
  activeEntitlements: string[]
  /** Expiration date of current subscription (if any) */
  expirationDate: Date | null
  /** Product identifier of current subscription */
  activeProductId: string | null
  /** Whether user is in trial period */
  isInTrial: boolean
  /** URL to manage subscription (App Store/Google Play) */
  managementUrl: string | null
}

/**
 * Initialize RevenueCat SDK
 *
 * Should be called once at app startup, after the app user ID is known.
 * If appUserId is not provided, RevenueCat will generate an anonymous ID.
 */
export async function initializeRevenueCat(
  appUserId?: string,
  apiKey?: string,
): Promise<Result<void>> {
  try {
    const key = apiKey || REVENUECAT_CONFIG.getApiKey()

    if (!key) {
      log.warn("RevenueCat API key not available, skipping initialization")
      return { ok: false, error: "API key not available" }
    }

    // Enable debug logs in development
    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG)
    }

    // Configure the SDK
    await Purchases.configure({
      apiKey: key,
      appUserID: appUserId,
    })

    log.info("RevenueCat initialized", {
      isTestMode: __DEV__,
      hasAppUserId: !!appUserId,
    })

    return { ok: true, value: undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Failed to initialize RevenueCat", { error: message })
    return { ok: false, error: message }
  }
}

/**
 * Get current customer info
 */
export async function getCustomerInfo(): Promise<Result<CustomerInfo>> {
  try {
    const customerInfo = await Purchases.getCustomerInfo()
    return { ok: true, value: customerInfo }
  } catch (error) {
    const purchasesError = error as PurchasesError
    log.error("Failed to get customer info", { error: purchasesError.message })
    return {
      ok: false,
      error: purchasesError.message,
      code: purchasesError.code,
    }
  }
}

/**
 * Check if user has a specific entitlement
 */
export async function hasEntitlement(entitlementId: EntitlementId): Promise<boolean> {
  try {
    const customerInfo = await Purchases.getCustomerInfo()
    const entitlement = customerInfo.entitlements.active[entitlementId]
    return entitlement !== undefined && entitlement.isActive
  } catch (error) {
    log.error("Failed to check entitlement", { entitlementId, error: String(error) })
    return false
  }
}

/**
 * Check if user has Premium subscription
 */
export async function hasPremiumSubscription(): Promise<boolean> {
  return hasEntitlement(ENTITLEMENTS.PREMIUM)
}

/**
 * Get subscription info for UI display
 */
export async function getSubscriptionInfo(): Promise<Result<SubscriptionInfo>> {
  try {
    const customerInfo = await Purchases.getCustomerInfo()
    const premiumEntitlement = customerInfo.entitlements.active[ENTITLEMENTS.PREMIUM]
    const attendanceEntitlement = customerInfo.entitlements.active[ENTITLEMENTS.ATTENDANCE]

    const info: SubscriptionInfo = {
      isPremium: premiumEntitlement !== undefined && premiumEntitlement.isActive,
      hasAttendance: attendanceEntitlement !== undefined && attendanceEntitlement.isActive,
      activeEntitlements: Object.keys(customerInfo.entitlements.active),
      expirationDate:
        (premiumEntitlement?.expirationDate ?? attendanceEntitlement?.expirationDate)
          ? new Date((premiumEntitlement?.expirationDate ?? attendanceEntitlement?.expirationDate)!)
          : null,
      activeProductId:
        premiumEntitlement?.productIdentifier ?? attendanceEntitlement?.productIdentifier ?? null,
      isInTrial: (premiumEntitlement?.periodType ?? attendanceEntitlement?.periodType) === "TRIAL",
      managementUrl: customerInfo.managementURL ?? null,
    }

    return { ok: true, value: info }
  } catch (error) {
    const purchasesError = error as PurchasesError
    log.error("Failed to get subscription info", { error: purchasesError.message })
    return {
      ok: false,
      error: purchasesError.message,
      code: purchasesError.code,
    }
  }
}

/**
 * Get available offerings
 *
 * Fetches the offering for the current environment:
 * - __DEV__: 'premium-standard' offering (simulator/dev testing)
 * - Production: 'default' offering
 *
 * Falls back to `offerings.current` if the named offering isn't found.
 */
export async function getOfferings(): Promise<Result<PurchasesOffering | null>> {
  try {
    const offeringId = OFFERINGS.getOfferingId()
    const offerings = await Purchases.getOfferings()
    const offering = offerings.all[offeringId] ?? offerings.current
    log.info("Resolved offering", {
      requestedId: offeringId,
      found: !!offerings.all[offeringId],
      resolvedId: offering?.identifier,
      availableOfferings: Object.keys(offerings.all).join(", "),
      packages: offering?.availablePackages.map((p) => p.identifier).join(", "),
    })
    return { ok: true, value: offering }
  } catch (error) {
    const purchasesError = error as PurchasesError
    log.error("Failed to get offerings", { error: purchasesError.message })
    return {
      ok: false,
      error: purchasesError.message,
      code: purchasesError.code,
    }
  }
}

/**
 * Purchase a package
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<Result<CustomerInfo>> {
  try {
    log.info("Starting purchase", { packageId: pkg.identifier })
    const { customerInfo } = await Purchases.purchasePackage(pkg)

    log.info("Purchase completed", {
      packageId: pkg.identifier,
      isPremium: customerInfo.entitlements.active[ENTITLEMENTS.PREMIUM] !== undefined,
    })

    return { ok: true, value: customerInfo }
  } catch (error) {
    const purchasesError = error as PurchasesError

    // User cancelled is not really an error
    if (purchasesError.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      log.info("Purchase cancelled by user")
      return { ok: false, error: "Purchase cancelled", code: purchasesError.code }
    }

    log.error("Purchase failed", {
      error: purchasesError.message,
      code: purchasesError.code,
    })

    return {
      ok: false,
      error: purchasesError.message,
      code: purchasesError.code,
    }
  }
}

/**
 * Restore purchases
 */
export async function restorePurchases(): Promise<Result<CustomerInfo>> {
  try {
    log.info("Restoring purchases")
    const customerInfo = await Purchases.restorePurchases()

    log.info("Purchases restored", {
      isPremium: customerInfo.entitlements.active[ENTITLEMENTS.PREMIUM] !== undefined,
    })

    return { ok: true, value: customerInfo }
  } catch (error) {
    const purchasesError = error as PurchasesError
    log.error("Failed to restore purchases", { error: purchasesError.message })
    return {
      ok: false,
      error: purchasesError.message,
      code: purchasesError.code,
    }
  }
}

/**
 * Present RevenueCat Paywall
 *
 * Shows the paywall UI configured in RevenueCat dashboard.
 * Uses the environment-appropriate offering (dev: 'premium-standard', prod: 'default').
 * Returns true if a purchase was made or restored.
 */
export async function presentPaywall(): Promise<Result<boolean>> {
  try {
    // Fetch the correct offering for the environment
    const offeringsResult = await getOfferings()
    const offering = offeringsResult.ok ? (offeringsResult.value ?? undefined) : undefined

    log.info("Presenting paywall", { offering: offering?.identifier })
    const result = await RevenueCatUI.presentPaywall({ offering })

    switch (result) {
      case PAYWALL_RESULT.PURCHASED:
        log.info("Paywall: Purchase completed")
        return { ok: true, value: true }
      case PAYWALL_RESULT.RESTORED:
        log.info("Paywall: Purchases restored")
        return { ok: true, value: true }
      case PAYWALL_RESULT.CANCELLED:
        log.info("Paywall: Cancelled by user")
        return { ok: true, value: false }
      case PAYWALL_RESULT.NOT_PRESENTED:
        log.warn("Paywall: Not presented")
        return { ok: true, value: false }
      case PAYWALL_RESULT.ERROR:
        log.error("Paywall: Error occurred")
        return { ok: false, error: "Paywall error" }
      default:
        return { ok: true, value: false }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error("Failed to present paywall", { error: message })
    return { ok: false, error: message }
  }
}

/**
 * Present Paywall if user doesn't have Pro entitlement
 *
 * Automatically checks entitlement and only shows paywall if needed.
 * Returns true if user now has the entitlement (already had it, purchased, or restored).
 */
export async function presentPaywallIfNeeded(): Promise<Result<boolean>> {
  try {
    // Fetch the correct offering for the environment
    const offeringsResult = await getOfferings()
    const offering = offeringsResult.ok ? (offeringsResult.value ?? undefined) : undefined

    log.info("Presenting paywall if needed", { offering: offering?.identifier })
    const result = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: ENTITLEMENTS.PREMIUM,
      offering,
    })

    switch (result) {
      case PAYWALL_RESULT.PURCHASED:
        log.info("Paywall: Purchase completed")
        return { ok: true, value: true }
      case PAYWALL_RESULT.RESTORED:
        log.info("Paywall: Purchases restored")
        return { ok: true, value: true }
      case PAYWALL_RESULT.NOT_PRESENTED:
        // User already has the entitlement
        log.info("Paywall: Not presented (user already has entitlement)")
        return { ok: true, value: true }
      case PAYWALL_RESULT.CANCELLED:
        log.info("Paywall: Cancelled by user")
        return { ok: true, value: false }
      case PAYWALL_RESULT.ERROR:
        log.error("Paywall: Error occurred")
        return { ok: false, error: "Paywall error" }
      default:
        return { ok: true, value: false }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error("Failed to present paywall if needed", { error: message })
    return { ok: false, error: message }
  }
}

/**
 * Login/identify user with RevenueCat
 *
 * Call this when user logs in to associate purchases with their account.
 */
export async function loginUser(appUserId: string): Promise<Result<CustomerInfo>> {
  try {
    log.info("Logging in user to RevenueCat", { appUserId })
    const { customerInfo } = await Purchases.logIn(appUserId)
    return { ok: true, value: customerInfo }
  } catch (error) {
    const purchasesError = error as PurchasesError
    log.error("Failed to login user", { error: purchasesError.message })
    return {
      ok: false,
      error: purchasesError.message,
      code: purchasesError.code,
    }
  }
}

/**
 * Logout user from RevenueCat
 *
 * Call this when user logs out. Creates a new anonymous user.
 */
export async function logoutUser(): Promise<Result<CustomerInfo>> {
  try {
    log.info("Logging out user from RevenueCat")
    const customerInfo = await Purchases.logOut()
    return { ok: true, value: customerInfo }
  } catch (error) {
    const purchasesError = error as PurchasesError
    log.error("Failed to logout user", { error: purchasesError.message })
    return {
      ok: false,
      error: purchasesError.message,
      code: purchasesError.code,
    }
  }
}

/**
 * Add customer info update listener
 *
 * Use this to react to subscription changes in real-time.
 */
export function addCustomerInfoListener(listener: (info: CustomerInfo) => void): () => void {
  // The listener returns an EmitterSubscription with a remove method
  // TypeScript types are incorrect, so we cast through unknown
  // May return undefined if RevenueCat isn't configured yet
  const subscription = Purchases.addCustomerInfoUpdateListener(listener) as unknown as
    | { remove: () => void }
    | undefined
  return () => subscription?.remove()
}
