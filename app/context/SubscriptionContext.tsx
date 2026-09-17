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
import { Alert, Platform } from "react-native"
import { reaction } from "mobx"
import { CustomerInfo } from "react-native-purchases"

import { translate, type TxKeyPath } from "@/i18n"
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
  BILLING_UNRESPONSIVE_ERROR,
  billingUnresponsiveCopy,
  nextBillingUnresponsive,
  decideRcIdentityTransition,
  rcIdentityFor,
  shouldSyncForIdentity,
  syncFlagKey,
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
  /**
   * The store (Google Play Billing / StoreKit) stopped answering a RevenueCat
   * call. ADDED 2026-09-15 — see billingHealthLogic.ts. Settings shows the
   * "restart your device" status instead of "..." while this is true; it
   * clears on the next store call that succeeds.
   */
  billingUnresponsive: boolean
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
  billingUnresponsive: false,
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
}

/**
 * SubscriptionProvider Component
 *
 * Wraps the app to provide subscription state.
 * Initializes RevenueCat and listens for subscription changes.
 *
 * CHANGED 2026-09-17: RevenueCat's identity is no longer an `appUserId` prop
 * — it is a MobX reaction on the auth store (see the identity section below).
 * The prop was read at render time in `App`, which is not an observer, so
 * after sign-in the SDK stayed identified as the DEVICE ID until `App`
 * happened to re-render, and purchases made in that window posted to the
 * device-id customer (81 active subscriptions were stranded that way as of
 * the 2026-09-17 export). Spec:
 * docs/superpowers/specs/2026-09-17-revenuecat-identity-reactive-design.md.
 */
export const SubscriptionProvider: FC<SubscriptionProviderProps> = ({ children }) => {
  const configStore = useConfigStore()
  const profileStore = useProfileStore()
  const authStore = useAuthenticationStore()
  const [isInitialized, setIsInitialized] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isPremium, setIsPremium] = useState(false)
  const [hasAttendance, setHasAttendance] = useState(false)
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [billingUnresponsive, setBillingUnresponsive] = useState(false)

  /**
   * Fold a store call's Result into the billingUnresponsive flag (pure
   * decision in `nextBillingUnresponsive`). Every RevenueCat call that
   * reaches the store passes through here so a success anywhere clears the
   * flag and a timeout anywhere sets it.
   */
  const noteStoreResult = useCallback((result: { ok: boolean; error?: string }) => {
    setBillingUnresponsive((prev) => nextBillingUnresponsive(prev, result))
  }, [])

  /**
   * Tell the user the store is not answering and what to do about it.
   * ADDED 2026-09-15. Only for a user-initiated tap (Subscribe, Restore):
   * subscribing is the most important thing a user does in this app, and a
   * silent failure there reads as our bug. The copy names the store and asks
   * for a device restart — the one thing that cleared the 2026-09-15 wedge —
   * then to come back and confirm the subscription, because a purchase that
   * hung may or may not have gone through on the store's side.
   */
  const alertBillingUnresponsive = useCallback(() => {
    const copy = billingUnresponsiveCopy(Platform.OS)
    log.warn("Store unresponsive during a user action — asking for a device restart", {
      platform: Platform.OS,
    })
    Alert.alert(translate(copy.title as TxKeyPath), translate(copy.message as TxKeyPath))
  }, [])

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
   * not look a subscriber up by address. Reads the auth store at call time —
   * the email must be the value in the store at the moment RC becomes
   * identified, and `authEmail` is written in the same synchronous action as
   * `userId` on login. (It used to say "rather than via props because `App`
   * is not an observer"; CHANGED 2026-09-17, that prop is gone — identity is
   * a reaction on the same store now.) Existing users are backfilled
   * organically the first time they launch after this ships; the pure
   * `resolveEmailAttribute()` decides whether there is anything to send
   * (never for anonymous / device-id customers).
   */
  const syncEmailAttribute = useCallback(async () => {
    const email = resolveEmailAttribute({
      appUserId:
        rcIdentityFor({ userId: authStore.userId, isAnonymous: authStore.isAnonymous }) ?? "",
      deviceId: authStore.deviceId,
      isAnonymous: authStore.isAnonymous,
      authEmail: authStore.authEmail,
    })
    if (!email) return
    await setUserEmail(email)
  }, [authStore])

  /**
   * What RevenueCat is currently identified as: an Auth0 sub, or null for the
   * SDK's own anonymous id. Owned by this provider, never read from a prop.
   */
  const rcIdentity = useRef<string | null>(null)
  /** Serialises identity transitions so a fast sign-out/sign-in cannot interleave. */
  const identityQueue = useRef<Promise<void>>(Promise.resolve())

  /**
   * Sync store receipts the FIRST time RevenueCat is identified as this user
   * on this install. CHANGED 2026-09-17: the old install-wide
   * `rc_purchases_synced` flag was written on first launch — under the device
   * id — so the Auth0 customer never got a sync and a receipt that had landed
   * on the device-id customer stayed there. Per-identity (`shouldSyncForIdentity`)
   * means a stranded subscriber's next signed-in cold start syncs the device's
   * receipt under their sub, and Restore Behavior = Transfer moves the
   * subscription over with no Restore tap. Also still the iaptic → RevenueCat
   * migration for existing subscribers, on both stores.
   */
  const syncReceiptsForIdentity = useCallback(
    async (appUserId: string) => {
      if (!shouldSyncForIdentity(appUserId, loadString)) {
        log.debug("Receipt sync already done for this identity on this install")
        return
      }
      log.info("First time identified as this user on this install — syncing store receipts")
      const result = await syncExistingPurchases()
      noteStoreResult(result)
      // Only mark complete on success so a failure (or a store timeout) retries next launch.
      if (result.ok) saveString(syncFlagKey(appUserId), "1")
      else log.warn("Receipt sync failed — will retry on next launch", { error: result.error })
    },
    [noteStoreResult],
  )

  /**
   * Initialize RevenueCat on mount — once. The identity it starts with is
   * whatever the auth store holds right now (hydrated before this mounts);
   * every later change goes through the reaction below.
   *
   * CHANGED 2026-09-17: when nobody is signed in, configure() gets NO
   * appUserID. The SDK then runs on a `$RCAnonymousID` that a later logIn()
   * aliases into the user's customer — RevenueCat's designed flow, which it
   * never performs for our custom device ids. That is what stops one phantom
   * customer per install (9,881 in the 2026-09-17 export).
   */
  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true)

      const initialIdentity = rcIdentityFor({
        userId: authStore.userId,
        isAnonymous: authStore.isAnonymous,
      })
      const result = await initializeRevenueCat(
        initialIdentity ?? undefined,
        configStore.revenueCatApiKey || undefined,
      )
      // The store round trips below are bounded by the store ceiling
      // (billingHealthLogic.ts, 2026-09-15), so this effect can no longer leave
      // isLoading = true forever. A timeout sets billingUnresponsive, which
      // Settings renders as the "restart your device" status.
      if (result.ok) {
        rcIdentity.current = initialIdentity
        setIsInitialized(true)
        if (initialIdentity) {
          // Attribute sync runs after configure() so it lands on the identified
          // customer. Failure is non-fatal — the next launch retries.
          await syncEmailAttribute()
          await syncReceiptsForIdentity(initialIdentity)
        }
        await loadSubscriptionInfo()
      } else {
        setError(result.error)
      }

      setIsLoading(false)
    }

    void initialize()
    // Mount-only by design: identity changes are the reaction's job, and
    // re-running configure() is not something the SDK supports.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
   * Apply one identity transition to the SDK (pure decision in
   * `decideRcIdentityTransition`). Login: logIn(sub) → email attribute →
   * per-identity receipt sync → reload. Logout: logOut() → reload (the SDK
   * moves to a fresh anonymous id). Never logs the raw sub.
   */
  const applyIdentity = useCallback(
    async (next: string | null) => {
      const transition = decideRcIdentityTransition(rcIdentity.current, next)
      if (transition === "none") return
      rcIdentity.current = next
      setIsLoading(true)
      try {
        if (transition === "login") {
          const result = await loginUser(next!)
          if (!result.ok) {
            setError(result.error)
            return
          }
          log.info("RevenueCat identified as the signed-in user")
          await syncEmailAttribute()
          await syncReceiptsForIdentity(next!)
        } else {
          const result = await logoutUser()
          if (!result.ok) setError(result.error)
          else log.info("RevenueCat identity cleared on sign-out")
        }
        await loadSubscriptionInfo()
      } finally {
        setIsLoading(false)
      }
    },
    [loadSubscriptionInfo, syncEmailAttribute, syncReceiptsForIdentity],
  )

  /** Queue a transition; see `applyIdentity`. Returned promise settles when it has applied. */
  const enqueueIdentity = useCallback(
    (next: string | null): Promise<void> => {
      identityQueue.current = identityQueue.current
        .then(() => applyIdentity(next))
        .catch((err) => log.error("RevenueCat identity transition failed", { error: String(err) }))
      return identityQueue.current
    },
    [applyIdentity],
  )

  /**
   * Identity reaction. Fires synchronously with the store write that sets
   * `userId`, so there is no window between "signed in" and "RevenueCat
   * knows" — the window a purchase used to fall into. `fireImmediately`
   * catches a sign-in that completed while configure() was still running.
   * Queued so transitions apply in order.
   */
  useEffect(() => {
    if (!isInitialized) return
    return reaction(
      () => rcIdentityFor({ userId: authStore.userId, isAnonymous: authStore.isAnonymous }),
      (next) => void enqueueIdentity(next),
      { fireImmediately: true },
    )
  }, [isInitialized, authStore, enqueueIdentity])

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
    noteStoreResult(result)
    if (!result.ok && result.error === BILLING_UNRESPONSIVE_ERROR) {
      alertBillingUnresponsive()
      return false
    }
    if (result.ok && result.value) {
      trackEvent("purchase_completed", { entitlement: "premium" })
      await loadSubscriptionInfo()
      return true
    }
    return false
  }, [loadSubscriptionInfo, noteStoreResult, alertBillingUnresponsive])

  /**
   * Present paywall if needed
   */
  const showPaywallIfNeeded = useCallback(async (): Promise<boolean> => {
    trackEvent("paywall_shown", { source: "gated" })
    const result = await presentPaywallIfNeeded()
    noteStoreResult(result)
    if (!result.ok && result.error === BILLING_UNRESPONSIVE_ERROR) {
      alertBillingUnresponsive()
      return false
    }
    if (result.ok && result.value) {
      trackEvent("purchase_completed", { entitlement: "premium" })
      await loadSubscriptionInfo()
      return true
    }
    return false
  }, [loadSubscriptionInfo, noteStoreResult, alertBillingUnresponsive])

  /**
   * Restore purchases
   */
  const restore = useCallback(async (): Promise<boolean> => {
    setIsLoading(true)
    const result = await restorePurchases()
    setIsLoading(false)
    noteStoreResult(result)

    if (result.ok) {
      await loadSubscriptionInfo()
      const premium = await hasPremiumSubscription()
      if (premium) trackEvent("purchase_restored")
      return premium
    }

    // ADDED 2026-09-15: a store that never answered is not "no purchases
    // found" — tell the user what actually happened and what to do.
    if (result.error === BILLING_UNRESPONSIVE_ERROR) alertBillingUnresponsive()
    setError(result.error)
    return false
  }, [loadSubscriptionInfo, noteStoreResult, alertBillingUnresponsive])

  /**
   * Refresh subscription status
   */
  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    await loadSubscriptionInfo()
    setIsLoading(false)
  }, [loadSubscriptionInfo])

  /**
   * Login / logout, exposed for callers that want to force the transition
   * (Settings → Delete User Data calls `logout()` before clearing the auth
   * store). CHANGED 2026-09-17: both route through the same queued
   * `applyIdentity` as the reaction, so an explicit call followed by the
   * store change it causes applies ONCE — `decideRcIdentityTransition`
   * returns "none" for the second — instead of a double `Purchases.logOut()`
   * whose second call rejects ("current user is anonymous").
   */
  const login = useCallback((userId: string) => enqueueIdentity(userId), [enqueueIdentity])
  const logout = useCallback(() => enqueueIdentity(null), [enqueueIdentity])

  const contextValue = useMemo<SubscriptionContextValue>(
    () => ({
      isInitialized,
      isLoading,
      isPremium,
      hasAttendance,
      subscriptionInfo,
      error,
      billingUnresponsive,
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
      billingUnresponsive,
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
