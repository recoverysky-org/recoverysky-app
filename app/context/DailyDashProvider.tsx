/**
 * Mounts the Daily Dash client (`ClientProvider`) only while the My Day gate
 * holds, and feeds that gate to the sign-in driver. ADDED 2026-11-04 (My Day
 * tab, spec D8, D10, §4.4).
 *
 * The gate is the tab's own decision (`decideMyDayTabVisible`) over the same
 * inputs MainNavigator reads, so the client exists exactly when the tab
 * does: a free, guest or signed-out person never has a Daily Dash database
 * opened or an account minted. When the gate closes, `ClientProvider`
 * unmounts and the driver is told, and nothing signs the session out (spec
 * D8): a lapsed subscription that comes back finds its data where it was.
 *
 * `ClientProvider` gets the ONE module-scoped session (`session={session}`,
 * read once on mount) plus the same `loadSignIn` / `logger` / `connectivity`
 * / `onRefused` / `track` that session was built with, so the provider never
 * builds a second session racing the first over the vault.
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
  const apiBaseUrl = process.env.EXPO_PUBLIC_DAILY_DASH_API_URL
  const gateHolds = decideMyDayTabVisible({
    isAuthenticated: authStore.isAuthenticated,
    isGuest: authStore.isGuest,
    isPremium,
    dailyDashUrlEnv: apiBaseUrl,
    platform: Platform.OS,
  })

  // Only an open gate may build the session (and with it the driver); a
  // closed one reads what already exists, so closing never creates either.
  const session = gateHolds ? getDailyDashSession() : null
  const driver = session ? getDailyDashDriver() : null

  useEffect(() => {
    const target = gateHolds ? getDailyDashDriver() : peekDailyDashDriver()
    target?.setGate(gateHolds)
  }, [gateHolds])

  // `apiBaseUrl` is non-null here: the gate holds only for a valid URL, and
  // getDailyDashSession() returns null without one.
  if (!session || !driver || !apiBaseUrl) return <>{children}</>

  return (
    <DailyDashDriverContext.Provider value={driver}>
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
    </DailyDashDriverContext.Provider>
  )
})

const noopUnsubscribe = () => {}
const noopRetry = () => {}

/**
 * The driver's attempt and its retry, for the tab's "connecting / try again"
 * UI. Outside the provider (gate closed) it reads "idle" with a no-op retry.
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
