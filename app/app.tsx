/* eslint-disable import/first */
/**
 * Welcome to the main entry point of the app. In this file, we'll
 * be kicking off our app.
 *
 * Most of this file is boilerplate and you shouldn't need to modify
 * it very often. But take some time to look through and understand
 * what is going on here.
 *
 * The app navigation resides in ./app/navigators, so head over there
 * if you're interested in adding screens and navigators.
 */

// Polyfills for Vercel AI SDK streaming (must be first!)
import "./utils/polyfills"

if (__DEV__) {
  // Load Reactotron in development only.
  // Note that you must be using metro's `inlineRequires` for this to work.
  // If you turn it off in metro.config.js, you'll have to manually import it.
  require("./devtools/ReactotronConfig.ts")
}
import "./utils/gestureHandler"

import { useEffect, useState } from "react"
import { useFonts } from "expo-font"
import * as Linking from "expo-linking"
import * as SplashScreen from "expo-splash-screen"
import { reaction } from "mobx"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

// Prevent splash screen from auto-hiding before we're ready
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore errors - splash screen might already be hidden
})

import { ToastProvider } from "./components/Toast"
import { MeetingProvider } from "./context/MeetingContext"
import { SubscriptionProvider } from "./context/SubscriptionContext"
import { DatabaseProvider, DatabaseLoadingOverlay, ProfileHydrator } from "./db"
import { initI18n } from "./i18n"
import { RootStoreModel, RootStoreProvider, setupRootStore, RootStore } from "./models"
import { AppNavigator } from "./navigators/AppNavigator"
import { useNavigationPersistence } from "./navigators/navigationUtilities"
import { api } from "./services/api"
import { loadStoredAuth } from "./services/auth/useZitadelAuth"
import { ZoomMeetingProvider } from "./services/zoom"
import { ThemeProvider } from "./theme/context"
import { customFontsToLoad } from "./theme/typography"
import { getDeviceId, generateSessionId } from "./utils/deviceId"
import { loadDateFnsLocale } from "./utils/formatDate"
import { logger } from "./utils/logger"
import * as storage from "./utils/storage"

const log = logger.child({ module: "App" })

// Generate session ID once at module load (persists for app lifecycle)
const sessionId = generateSessionId()
const appVersion = require("../package.json").version

// Set initial logger context with session and version (deviceId added after async load)
logger.setContext({ sessionId, appVersion })

log.info("App module loaded", { sessionId: sessionId.slice(0, 8) + "...", appVersion })

export const NAVIGATION_PERSISTENCE_KEY = "NAVIGATION_STATE"

// Web linking configuration - matches AppStackParamList with nested Main navigator
const prefix = Linking.createURL("/")
const config = {
  screens: {
    Welcome: "welcome",
    Login: "login",
    Main: {
      screens: {
        Home: "",
        Live: "live",
        Meetings: "meetings",
        Schedule: "schedule",
        Agent: "agent",
        Settings: "settings",
      },
    },
  },
}

/**
 * This is the root component of our app.
 * @param {AppProps} props - The props for the `App` component.
 * @returns {JSX.Element} The rendered `App` component.
 */
export function App() {
  log.info("App component mounting")

  const {
    initialNavigationState,
    onNavigationStateChange,
    isRestored: isNavigationStateRestored,
  } = useNavigationPersistence(storage, NAVIGATION_PERSISTENCE_KEY)

  const [areFontsLoaded, fontLoadError] = useFonts(customFontsToLoad)
  const [isI18nInitialized, setIsI18nInitialized] = useState(false)
  const [rootStore, setRootStore] = useState<RootStore | undefined>(undefined)

  // Initialize i18n and date-fns locale
  useEffect(() => {
    ;(async () => {
      try {
        // initI18n logs its own params/results
        await initI18n()
        setIsI18nInitialized(true)

        // loadDateFnsLocale logs its own params/results
        await loadDateFnsLocale()
      } catch (error) {
        log.error("i18n/locale initialization failed", { error: String(error) })
      }
    })()
  }, [])

  // Initialize MST RootStore with persistence
  useEffect(() => {
    ;(async () => {
      const _rootStore = RootStoreModel.create({})

      try {
        // setupRootStore logs its own params/results
        await setupRootStore(_rootStore)

        // loadStoredAuth logs its own params/results
        await loadStoredAuth(_rootStore.authenticationStore, _rootStore.configStore)

        // getDeviceId logs its own params/results
        const deviceId = await getDeviceId()
        _rootStore.authenticationStore.setDeviceId(deviceId)

        // Set initial API auth
        const authStore = _rootStore.authenticationStore
        api.updateAuth(authStore.isAnonymous, authStore.accessToken)
        log.debug("API auth configured", {
          isAnonymous: authStore.isAnonymous,
          hasToken: !!authStore.accessToken,
        })

        // React to auth state changes
        reaction(
          () => ({
            isAnonymous: authStore.isAnonymous,
            accessToken: authStore.accessToken,
          }),
          ({ isAnonymous, accessToken }) => {
            log.info("Auth state changed", { isAnonymous, hasToken: !!accessToken })
            api.updateAuth(isAnonymous, accessToken)
          },
        )

        setRootStore(_rootStore)
        log.info("App initialization complete")
      } catch (error) {
        log.error("RootStore initialization failed", { error: String(error) })
        setRootStore(_rootStore)
      }
    })()
  }, [])

  // Check if app is ready
  const isAppReady =
    isNavigationStateRestored && isI18nInitialized && rootStore && (areFontsLoaded || fontLoadError)

  // Note: Splash screen is hidden by DatabaseLoadingOverlay when DB is seeded
  if (!isAppReady) {
    // Only log on first render to avoid spam
    return null
  }

  const linking = {
    prefixes: [prefix],
    config,
  }

  // Get userId for RevenueCat (use deviceId for anonymous users, userId for authenticated)
  const revenueCatUserId =
    rootStore.authenticationStore.userId ?? rootStore.authenticationStore.deviceId

  // otherwise, we're ready to render the app
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider>
        <RootStoreProvider value={rootStore}>
          <SubscriptionProvider appUserId={revenueCatUserId}>
            <DatabaseProvider>
              <ProfileHydrator />
              <MeetingProvider>
                <ThemeProvider>
                  <ToastProvider>
                    <ZoomMeetingProvider>
                      <DatabaseLoadingOverlay />
                      <AppNavigator
                        linking={linking}
                        initialState={initialNavigationState}
                        onStateChange={onNavigationStateChange}
                      />
                    </ZoomMeetingProvider>
                  </ToastProvider>
                </ThemeProvider>
              </MeetingProvider>
            </DatabaseProvider>
          </SubscriptionProvider>
        </RootStoreProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  )
}
