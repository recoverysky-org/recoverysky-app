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
import { getDeviceId } from "./utils/deviceId"
import { loadDateFnsLocale } from "./utils/formatDate"
import { logger } from "./utils/logger"
import * as storage from "./utils/storage"

const log = logger.child({ module: "App" })

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
        Guide: "guide",
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
  log.debug("App component initializing")

  const {
    initialNavigationState,
    onNavigationStateChange,
    isRestored: isNavigationStateRestored,
  } = useNavigationPersistence(storage, NAVIGATION_PERSISTENCE_KEY)

  const [areFontsLoaded, fontLoadError] = useFonts(customFontsToLoad)
  const [isI18nInitialized, setIsI18nInitialized] = useState(false)
  const [rootStore, setRootStore] = useState<RootStore | undefined>(undefined)

  // Log state changes
  useEffect(() => {
    log.debug("Navigation state restored", { isNavigationStateRestored })
  }, [isNavigationStateRestored])

  useEffect(() => {
    log.debug("Fonts state", { areFontsLoaded, fontLoadError: !!fontLoadError })
  }, [areFontsLoaded, fontLoadError])

  useEffect(() => {
    log.debug("i18n state", { isI18nInitialized })
  }, [isI18nInitialized])

  useEffect(() => {
    log.info("Starting i18n initialization")
    initI18n()
      .then(() => {
        log.info("i18n initialized successfully")
        setIsI18nInitialized(true)
      })
      .then(() => {
        log.info("Loading date-fns locale")
        return loadDateFnsLocale()
      })
      .then(() => {
        log.info("date-fns locale loaded")
      })
      .catch((error) => {
        log.error("i18n/locale initialization failed", { error: String(error) })
      })
  }, [])

  // Initialize MST RootStore with persistence
  useEffect(() => {
    log.info("Initializing MST RootStore")
    const _rootStore = RootStoreModel.create({})
    setupRootStore(_rootStore)
      .then(async () => {
        log.info("RootStore initialized and hydrated from storage")

        // Restore OAuth tokens from SecureStore (if any)
        const authRestored = await loadStoredAuth(_rootStore.authenticationStore)
        if (authRestored) {
          log.info("OAuth tokens restored from SecureStore")
        }

        // Initialize device ID for user identification
        const deviceId = await getDeviceId()
        _rootStore.authenticationStore.setDeviceId(deviceId)
        log.info("Device ID initialized", { deviceId: deviceId.slice(0, 8) + "..." })

        // Set initial API auth based on current state
        const authStore = _rootStore.authenticationStore
        api.updateAuth(authStore.isAnonymous, authStore.accessToken)

        // React to auth state changes and update API headers
        reaction(
          () => ({
            isAnonymous: authStore.isAnonymous,
            accessToken: authStore.accessToken,
          }),
          ({ isAnonymous, accessToken }) => {
            log.debug("Auth state changed, updating API headers", {
              isAnonymous,
              hasToken: !!accessToken,
            })
            api.updateAuth(isAnonymous, accessToken)
          },
        )

        // Note: Language is now hydrated from SQLite via ProfileHydrator
        // after the database is ready, not from MMKV snapshot

        setRootStore(_rootStore)
      })
      .catch((error) => {
        log.error("RootStore initialization failed", { error: String(error) })
        // Still set the store even if hydration fails
        setRootStore(_rootStore)
      })
  }, [])

  // Check if app is ready
  const isAppReady =
    isNavigationStateRestored && isI18nInitialized && rootStore && (areFontsLoaded || fontLoadError)

  // Note: Splash screen is hidden by DatabaseLoadingOverlay when DB is seeded

  // Before we show the app, we have to wait for our state to be ready.
  // In the meantime, don't render anything. This will be the background
  // color set in native by rootView's background color.
  // In iOS: application:didFinishLaunchingWithOptions:
  // In Android: https://stackoverflow.com/a/45838109/204044
  // You can replace with your own loading component if you wish.
  if (!isAppReady) {
    log.debug("App waiting for initialization", {
      isNavigationStateRestored,
      isI18nInitialized,
      hasRootStore: !!rootStore,
      areFontsLoaded,
      hasFontError: !!fontLoadError,
    })
    return null
  }

  log.info("App initialization complete, rendering providers")

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
