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
import { KeyboardProvider } from "react-native-keyboard-controller"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

import { MeetingProvider } from "./context/MeetingContext"
import { DatabaseProvider, DatabaseLoadingOverlay } from "./db"
import { initI18n } from "./i18n"
import { RootStoreModel, RootStoreProvider, setupRootStore, RootStore } from "./models"
import { AppNavigator } from "./navigators/AppNavigator"
import { useNavigationPersistence } from "./navigators/navigationUtilities"
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

        // Initialize device ID for user identification
        const deviceId = await getDeviceId()
        _rootStore.authenticationStore.setDeviceId(deviceId)
        log.info("Device ID initialized", { deviceId: deviceId.slice(0, 8) + "..." })

        setRootStore(_rootStore)
      })
      .catch((error) => {
        log.error("RootStore initialization failed", { error: String(error) })
        // Still set the store even if hydration fails
        setRootStore(_rootStore)
      })
  }, [])

  // Before we show the app, we have to wait for our state to be ready.
  // In the meantime, don't render anything. This will be the background
  // color set in native by rootView's background color.
  // In iOS: application:didFinishLaunchingWithOptions:
  // In Android: https://stackoverflow.com/a/45838109/204044
  // You can replace with your own loading component if you wish.
  if (!isNavigationStateRestored || !isI18nInitialized || !rootStore || (!areFontsLoaded && !fontLoadError)) {
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

  // otherwise, we're ready to render the app
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider>
        <RootStoreProvider value={rootStore}>
          <DatabaseProvider>
            <MeetingProvider>
              <ThemeProvider>
                <DatabaseLoadingOverlay />
                <AppNavigator
                  linking={linking}
                  initialState={initialNavigationState}
                  onStateChange={onNavigationStateChange}
                />
              </ThemeProvider>
            </MeetingProvider>
          </DatabaseProvider>
        </RootStoreProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  )
}
