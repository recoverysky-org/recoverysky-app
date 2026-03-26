/**
 * RevenueCat Purchases Service
 *
 * Provides subscription and in-app purchase functionality via RevenueCat.
 */

// Configuration
export {
  REVENUECAT_CONFIG,
  ENTITLEMENTS,
  PRODUCTS,
  OFFERINGS,
  type EntitlementId,
  type ProductId,
  type OfferingId,
} from "./config"

// Service functions
export {
  initializeRevenueCat,
  getCustomerInfo,
  hasEntitlement,
  hasPremiumSubscription,
  getSubscriptionInfo,
  getOfferings,
  purchasePackage,
  restorePurchases,
  syncExistingPurchases,
  presentPaywall,
  presentPaywallIfNeeded,
  loginUser,
  logoutUser,
  addCustomerInfoListener,
  type SubscriptionInfo,
} from "./revenueCatService"
