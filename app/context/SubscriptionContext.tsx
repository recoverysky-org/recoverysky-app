/**
 * SubscriptionContext
 *
 * React Context for subscription state management.
 * Provides access to subscription status, paywall presentation, and purchase functions.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
  type FC,
} from "react"
import { CustomerInfo } from "react-native-purchases"

import { useAuthenticationStore, useConfigStore, useProfileStore } from "@/models"
import {
  initializeRevenueCat,
  getSubscriptionInfo,
  hasPremiumSubscription,
  presentPaywall,
  presentPaywallIfNeeded,
  restorePurchases,
  syncExistingPurchases,
  addCustomerInfoListener,
  loginUser,
  logoutUser,
  setUserEmail,
  resolveEmailAttribute,
  type SubscriptionInfo,
} from "@/services/purchases"
import { trackEvent } from "@/services/tracking"
import { logger } from "@/utils/logger"
import { loadString, saveString } from "@/utils/storage"

const log = logger.child({ module: "SubscriptionContext" })

/**
 * Subscription context value
 */
interface SubscriptionContextValue {
  /** Whether RevenueCat is initialized */
  isInitialized: boolean
  /** Whether subscription info is loading */
  isLoading: boolean
  /** Whether user has Premium subscription */
  isPremium: boolean
  /** Whether user has attendance report entitlement */
  hasAttendance: boolean
  /** Detailed subscription info */
  subscriptionInfo: SubscriptionInfo | null
  /** Error message if any */
  error: string | null
  /** Present the paywall UI */
  showPaywall: () => Promise<boolean>
  /** Present paywall only if user doesn't have Pro */
  showPaywallIfNeeded: () => Promise<boolean>
  /** Restore purchases from App Store/Google Play */
  restore: () => Promise<boolean>
  /** Refresh subscription status */
  refresh: () => Promise<void>
  /** Login user to RevenueCat (for identified users) */
  login: (appUserId: string) => Promise<void>
  /** Logout user from RevenueCat */
  logout: () => Promise<void>
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  isInitialized: false,
  isLoading: true,
  isPremium: false,
  hasAttendance: false,
  subscriptionInfo: null,
  error: null,
  showPaywall: async () => false,
  showPaywallIfNeeded: async () => false,
  restore: async () => false,
  refresh: async () => {},
  login: async () => {},
  logout: async () => {},
})

/**
 * Hook to access subscription context
 */
export function useSubscription(): SubscriptionContextValue {
  return useContext(SubscriptionContext)
}

/**
 * Hook to check if user has Premium subscription
 */
export function useIsPremium(): boolean {
  const { isPremium } = useSubscription()
  return isPremium
}

interface SubscriptionProviderProps {
  children: ReactNode
  /** Optional app user ID for identified users */
  appUserId?: string
}

/**
 * SubscriptionProvider Component
 *
 * Wraps the app to provide subscription state.
 * Initializes RevenueCat and listens for subscription changes.
 */
export const SubscriptionProvider: FC<SubscriptionProviderProps> = ({ children, appUserId }) => {
  const configStore = useConfigStore()
  const profileStore = useProfileStore()
  const authStore = useAuthenticationStore()
  const [isInitialized, setIsInitialized] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isPremium, setIsPremium] = useState(false)
  const [hasAttendance, setHasAttendance] = useState(false)
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Load subscription info from RevenueCat
   */
  const loadSubscriptionInfo = useCallback(async () => {
    const result = await getSubscriptionInfo()
    if (result.ok) {
      setSubscriptionInfo(result.value)
      setIsPremium(result.value.isPremium)
      setHasAttendance(result.value.hasAttendance)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [])

  /**
   * Forward the signed-in user's email to RevenueCat as the `$email`
   * subscriber attribute.
   *
   * ADDED 2026-09-14: RC showed no email on any customer, so support could
   * not look a subscriber up by address. Reads the auth store at call time
   * rather than via props because `App` is not an observer — the `appUserId`
   * prop only refreshes on incidental re-renders, and the email must be the
   * value in the store at the moment RC becomes identified. `authEmail` is
   * written in the same synchronous action as `userId` on login, so it is
   * already present whenever `appUserId` is. Existing users are backfilled
   * organically the first time they launch after this ships; the pure
   * `resolveEmailAttribute()` decides whether there is anything to send
   * (never for anonymous / device-id customers).
   */
  const syncEmailAttribute = useCallback(async () => {
    const email = resolveEmailAttribute({
      appUserId: authStore.userIdentifier,
      deviceId: authStore.deviceId,
      isAnonymous: authStore.isAnonymous,
      authEmail: authStore.authEmail,
    })
    if (!email) return
    await setUserEmail(email)
  }, [authStore])

  /**
   * Initialize RevenueCat on mount
   */
  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true)

      const result = await initializeRevenueCat(
        appUserId,
        configStore.revenueCatApiKey || undefined,
      )
      if (result.ok) {
        setIsInitialized(true)

        // One-time sync for users migrating from the old app (iaptic → RevenueCat).
        // Silently sends the on-device App Store receipt to RC without Apple ID prompt.
        if (!loadString("rc_purchases_synced")) {
          log.info("First launch with RevenueCat — running migration sync for existing receipts")
          const syncResult = await syncExistingPurchases()
          if (syncResult.ok) {
            log.info("Migration sync succeeded — marking as complete")
          } else {
            log.warn("Migration sync failed — will retry on next launch", {
              error: syncResult.error,
            })
          }
          // Only mark complete on success so it retries on failure
          if (syncResult.ok) saveString("rc_purchases_synced", "1")
        } else {
          log.debug("Migration sync already completed — skipping")
        }

        // Attribute sync runs after configure() so it lands on the identified
        // customer. Failure is non-fatal — the next launch retries.
        await syncEmailAttribute()

        await loadSubscriptionInfo()
      } else {
        setError(result.error)
      }

      setIsLoading(false)
    }

    void initialize()
  }, [appUserId, loadSubscriptionInfo, syncEmailAttribute])

  /**
   * Listen for customer info updates
   */
  useEffect(() => {
    if (!isInitialized) return

    const unsubscribe = addCustomerInfoListener((customerInfo: CustomerInfo) => {
      log.info("Customer info updated", {
        activeEntitlements: Object.keys(customerInfo.entitlements.active).join(", "),
      })
      void loadSubscriptionInfo()
    })

    return unsubscribe
  }, [isInitialized, loadSubscriptionInfo])

  /**
   * Sync RevenueCat identity when appUserId changes after initialization.
   * Calls Purchases.logIn() to associate purchases with the identified account,
   * then re-syncs on-device receipts under the new identity.
   */
  const prevAppUserId = useRef(appUserId)
  useEffect(() => {
    if (!isInitialized) return
    if (appUserId === prevAppUserId.current) return
    prevAppUserId.current = appUserId

    const syncIdentity = async () => {
      if (appUserId) {
        const result = await loginUser(appUserId)
        if (result.ok) {
          log.info("RevenueCat identity updated after auth change", { appUserId })
          // Now that RC is identified as the signed-in user, attach their email.
          await syncEmailAttribute()
          // Re-sync receipts under new identity (bypass one-time flag)
          await syncExistingPurchases()
          await loadSubscriptionInfo()
        }
      }
    }
    void syncIdentity()
  }, [appUserId, isInitialized, loadSubscriptionInfo, syncEmailAttribute])

  /**
   * Auto-enable attendance tracking on first subscription detection only.
   * Uses MMKV flag so it never re-enables if the user later disables it.
   */
  useEffect(() => {
    if (hasAttendance && !loadString("attendance_auto_enabled")) {
      profileStore.setAttendanceEnabled(true)
      saveString("attendance_auto_enabled", "1")
    }
  }, [hasAttendance, profileStore])

  /**
   * Present paywall
   */
  const showPaywall = useCallback(async (): Promise<boolean> => {
    trackEvent("paywall_shown", { source: "manual" })
    const result = await presentPaywall()
    if (result.ok && result.value) {
      trackEvent("purchase_completed", { entitlement: "premium" })
      await loadSubscriptionInfo()
      return true
    }
    return false
  }, [loadSubscriptionInfo])

  /**
   * Present paywall if needed
   */
  const showPaywallIfNeeded = useCallback(async (): Promise<boolean> => {
    trackEvent("paywall_shown", { source: "gated" })
    const result = await presentPaywallIfNeeded()
    if (result.ok && result.value) {
      trackEvent("purchase_completed", { entitlement: "premium" })
      await loadSubscriptionInfo()
      return true
    }
    return false
  }, [loadSubscriptionInfo])

  /**
   * Restore purchases
   */
  const restore = useCallback(async (): Promise<boolean> => {
    setIsLoading(true)
    const result = await restorePurchases()
    setIsLoading(false)

    if (result.ok) {
      await loadSubscriptionInfo()
      const premium = await hasPremiumSubscription()
      if (premium) trackEvent("purchase_restored")
      return premium
    }

    setError(result.error)
    return false
  }, [loadSubscriptionInfo])

  /**
   * Refresh subscription status
   */
  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    await loadSubscriptionInfo()
    setIsLoading(false)
  }, [loadSubscriptionInfo])

  /**
   * Login user
   */
  const login = useCallback(
    async (userId: string): Promise<void> => {
      setIsLoading(true)
      const result = await loginUser(userId)
      if (result.ok) {
        await loadSubscriptionInfo()
      } else {
        setError(result.error)
      }
      setIsLoading(false)
    },
    [loadSubscriptionInfo],
  )

  /**
   * Logout user
   */
  const logout = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    const result = await logoutUser()
    if (result.ok) {
      await loadSubscriptionInfo()
    } else {
      setError(result.error)
    }
    setIsLoading(false)
  }, [loadSubscriptionInfo])

  const contextValue = useMemo<SubscriptionContextValue>(
    () => ({
      isInitialized,
      isLoading,
      isPremium,
      hasAttendance,
      subscriptionInfo,
      error,
      showPaywall,
      showPaywallIfNeeded,
      restore,
      refresh,
      login,
      logout,
    }),
    [
      isInitialized,
      isLoading,
      isPremium,
      hasAttendance,
      subscriptionInfo,
      error,
      showPaywall,
      showPaywallIfNeeded,
      restore,
      refresh,
      login,
      logout,
    ],
  )

  return (
    <SubscriptionContext.Provider value={contextValue}>{children}</SubscriptionContext.Provider>
  )
}
