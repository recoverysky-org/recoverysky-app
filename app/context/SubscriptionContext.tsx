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
  useState,
  useCallback,
  useMemo,
  type ReactNode,
  type FC,
} from "react"
import { CustomerInfo } from "react-native-purchases"

import { useConfigStore, useProfileStore } from "@/models"
import {
  initializeRevenueCat,
  getSubscriptionInfo,
  hasPremiumSubscription,
  presentPaywall,
  presentPaywallIfNeeded,
  restorePurchases,
  addCustomerInfoListener,
  loginUser,
  logoutUser,
  type SubscriptionInfo,
} from "@/services/purchases"
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
        await loadSubscriptionInfo()
      } else {
        setError(result.error)
      }

      setIsLoading(false)
    }

    void initialize()
  }, [appUserId, loadSubscriptionInfo])

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
    const result = await presentPaywall()
    if (result.ok && result.value) {
      await loadSubscriptionInfo()
      return true
    }
    return false
  }, [loadSubscriptionInfo])

  /**
   * Present paywall if needed
   */
  const showPaywallIfNeeded = useCallback(async (): Promise<boolean> => {
    const result = await presentPaywallIfNeeded()
    if (result.ok && result.value) {
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
