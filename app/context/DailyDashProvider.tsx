/**
 * The two React bindings of the Daily Dash host. ADDED 2026-11-04 (My Day tab,
 * spec D8, D10, §4.4).
 *
 * - `DailyDashProvider` wraps the whole app, ALWAYS mounted and always the same
 *   element shape. It computes the My Day gate (`decideMyDayTabVisible`, the
 *   same inputs MainNavigator reads, so the gate holds exactly when the tab
 *   exists), feeds it to the sign-in driver, and hands the driver to the tab's
 *   UI through `useDailyDashDriver()`. A free, guest or signed-out person
 *   never has a session built or an account minted. When the gate closes the
 *   driver is told, and nothing signs the session out (spec D8): a lapsed
 *   subscription that comes back finds its data where it was.
 * - `DailyDashClient` is the client boundary for the tab: MyDayNavigator wraps
 *   its stack in it, so `ClientProvider` (and My Day's database) exists only
 *   while the tab is mounted.
 *
 * CHANGED 2026-11-04: ClientProvider used to wrap the app subtree
 * conditionally; that remounted the whole app on every gate flip (each
 * premium cold start). It now mounts inside the My Day tab.
 */
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react"
import { Platform } from "react-native"
import { ClientProvider } from "@daily-dash/client"
import { myDayFeature } from "@daily-dash/my-day"
import { observer } from "mobx-react-lite"

import { useSubscription } from "@/context/SubscriptionContext"
import { useAuthenticationStore } from "@/models"
import {
  dailyDashLoadSignIn,
  dailyDashOnRefused,
  getDailyDashClientIdentity,
  getDailyDashConnectivity,
  getDailyDashDriver,
  getDailyDashLogger,
  getDailyDashSession,
  peekDailyDashDriver,
  type Attempt,
  type DailyDashDriver,
} from "@/services/dailyDash"
import { trackEvent } from "@/services/tracking"
import { decideMyDayTabVisible } from "@/utils/myDayTabLogic"

const DailyDashDriverContext = createContext<DailyDashDriver | null>(null)

/** Module-level so the array identity is stable across renders. */
const FEATURES = [myDayFeature]
const AUTH = { products: ["recoverysky"] as const, loadSignIn: dailyDashLoadSignIn }

export const DailyDashProvider = observer(function DailyDashProvider({
  children,
}: PropsWithChildren) {
  const authStore = useAuthenticationStore()
  const { isPremium } = useSubscription()
  const gateHolds = decideMyDayTabVisible({
    isAuthenticated: authStore.isAuthenticated,
    isGuest: authStore.isGuest,
    isPremium,
    dailyDashUrlEnv: process.env.EXPO_PUBLIC_DAILY_DASH_API_URL,
    platform: Platform.OS,
  })

  // Only an open gate may build the session (and with it the driver); a
  // closed one reads what already exists, so closing never creates either.
  // Building in the render phase is tolerated: the driver is a process
  // singleton and the call is idempotent, so a re-render or a discarded
  // render builds nothing new. `dispose()` exists for tests and Fast Refresh.
  const driver = gateHolds && getDailyDashSession() ? getDailyDashDriver() : null

  useEffect(() => {
    const target = gateHolds ? getDailyDashDriver() : peekDailyDashDriver()
    target?.setGate(gateHolds)
  }, [gateHolds])

  // One element shape whatever the gate: a changing parent type would
  // remount the whole app subtree (see the header's CHANGED note).
  return (
    <DailyDashDriverContext.Provider value={driver ?? null}>
      {children}
    </DailyDashDriverContext.Provider>
  )
})

/**
 * The Daily Dash client for the My Day tab: `ClientProvider` over the ONE
 * module-scoped session (`session={session}`, read once on mount) with the
 * same `loadSignIn` / `logger` / `connectivity` / `onRefused` / `track` that
 * session was built with, so it never builds a second session racing the
 * first over the vault. Not an observer: nothing MobX is read here.
 *
 * Verified in the client source (`dist/provider/client-provider.js`,
 * `data-layer.js`): ClientProvider never disposes an external session on
 * unmount; its data layer closes My Day's database on unmount and reopens it
 * on remount. So a tab that unmounts when the subscription lapses closes the
 * database and leaves the session alive, and a tab that comes back reopens
 * it. Its mount effect calls `session.start()`, which is idempotent
 * (`starting ??= restore()`), so the driver's earlier start is the same
 * promise.
 */
export function DailyDashClient({ children }: PropsWithChildren) {
  const session = getDailyDashSession()
  const apiBaseUrl = process.env.EXPO_PUBLIC_DAILY_DASH_API_URL
  // Cannot happen under the tab, which MainNavigator registers only while
  // `decideMyDayTabVisible` holds (the same inputs as the gate, which needs a
  // valid URL). The fallback keeps the hooks below from crashing on a stale
  // render, nothing more.
  if (!session || !apiBaseUrl) return <>{children}</>

  return (
    <ClientProvider
      client={getDailyDashClientIdentity()}
      apiBaseUrl={apiBaseUrl}
      auth={AUTH}
      logger={getDailyDashLogger()}
      features={FEATURES}
      // Read after getDailyDashSession() returned non-null, so configure
      // has run and this is the real port, not the inert stand-in.
      connectivity={getDailyDashConnectivity()}
      onRefused={dailyDashOnRefused}
      track={trackEvent}
      session={session}
    >
      {children}
    </ClientProvider>
  )
}

const noopUnsubscribe = () => {}
const noopRetry = () => {}

/**
 * The driver's attempt and its retry, for the tab's "connecting / try again"
 * UI. With the gate closed (no driver) it reads "idle" with a no-op retry.
 */
export function useDailyDashDriver(): { attempt: Attempt; retry(): void } {
  const driver = useContext(DailyDashDriverContext)
  const subscribe = useCallback(
    (listener: () => void) => (driver ? driver.subscribe(listener) : noopUnsubscribe),
    [driver],
  )
  const getSnapshot = useCallback((): Attempt => (driver ? driver.getAttempt() : "idle"), [driver])
  const attempt = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { attempt, retry: driver ? driver.retry : noopRetry }
}
