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

import { useEffect, useRef, useState } from "react"
import { Alert, AppState, AppStateStatus, BackHandler, Platform } from "react-native"
import { useFonts } from "expo-font"
import * as Linking from "expo-linking"
import * as SplashScreen from "expo-splash-screen"
import * as Updates from "expo-updates"
import { reaction } from "mobx"
import { Auth0Provider } from "react-native-auth0"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

// Prevent splash screen from auto-hiding before we're ready
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore errors - splash screen might already be hidden
})

import { ToastProvider } from "./components/Toast"
import { MeetingProvider } from "./context/MeetingContext"
import { SubscriptionProvider } from "./context/SubscriptionContext"
import {
  DatabaseProvider,
  DatabaseLoadingOverlay,
  ProfileHydrator,
  ChatHydrator,
  ReportPollingResumer,
} from "./db"
import { initI18n, translate } from "./i18n"
import { RootStoreModel, RootStoreProvider, setupRootStore, RootStore } from "./models"
import { AppNavigator } from "./navigators/AppNavigator"
import { useNavigationPersistence } from "./navigators/navigationUtilities"
import { api } from "./services/api"
import {
  attestDevice,
  isAttestationSupported,
  isSimulator,
  preparePlayIntegrity,
} from "./services/attestation"
import { AUTH0_CONFIG } from "./services/auth/auth0"
import {
  initializeNotifications,
  loginNotificationUser,
  logoutNotificationUser,
  hasNotificationPermission,
  optInNotifications,
  optOutNotifications,
  addNotificationClickHandler,
  getLastNotificationResponse,
  setNotificationLanguage,
} from "./services/notifications"
import { initReviewService } from "./services/review"
import { initializeUmami, setTrackingUserId, trackEvent } from "./services/tracking"
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

log.info("App module loaded")

// =============================================================================
// Device Attestation State (memory-only)
// =============================================================================

/** Tracks device JWT expiry time for re-attestation on foreground */
let jwtExpiresAt: number | null = null

/** Whether we're using X-API-Key fallback (simulators) instead of device JWT */
let usingApiKeyFallback = false

/** Google Cloud project number for Play Integrity (Android only) */
const GOOGLE_CLOUD_PROJECT_NUMBER = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER || ""

/**
 * Check if JWT is expired or near expiry (within 5 minutes)
 */
function isJwtExpiredOrNearExpiry(): boolean {
  if (!jwtExpiresAt) return true
  const FIVE_MINUTES_MS = 5 * 60 * 1000
  return Date.now() > jwtExpiresAt - FIVE_MINUTES_MS
}

/**
 * Perform device attestation and update API headers
 * Returns true if attestation succeeded, false otherwise
 */
async function performAttestation(deviceId: string): Promise<boolean> {
  if (!isAttestationSupported()) {
    log.info("Attestation not supported on this platform/device")
    return false
  }

  log.info("Performing device attestation")
  const result = await attestDevice(deviceId)

  if (result.ok) {
    api.setDeviceJwt(result.data.deviceJwt)
    jwtExpiresAt = result.data.expiresAt
    log.info("Device attestation complete", {
      expiresIn: Math.round((result.data.expiresAt - Date.now()) / 1000 / 60) + " min",
    })
    return true
  } else {
    log.error("Device attestation failed", {
      code: result.error.code,
      message: result.error.message,
    })
    return false
  }
}

/**
 * Initialize device authorization (called once on cold start)
 * - Physical devices: Perform attestation to get device JWT
 * - Simulators: Use X-API-Key fallback
 */
async function initializeDeviceAuthorization(deviceId: string): Promise<void> {
  // Web platform - no attestation
  if (Platform.OS === "web") {
    log.info("Web platform, skipping attestation")
    api.setApiKeyAuth()
    usingApiKeyFallback = true
    return
  }

  // Simulator/emulator - use X-API-Key fallback
  if (isSimulator()) {
    log.info("Simulator detected, using X-API-Key fallback")
    api.setApiKeyAuth()
    usingApiKeyFallback = true
    return
  }

  // Physical device - prepare Play Integrity for Android, then attest
  if (Platform.OS === "android" && GOOGLE_CLOUD_PROJECT_NUMBER) {
    await preparePlayIntegrity(GOOGLE_CLOUD_PROJECT_NUMBER)
  }

  // Perform initial attestation
  const success = await performAttestation(deviceId)
  if (!success) {
    // Fallback to X-API-Key if attestation fails
    log.warn("Attestation failed, falling back to X-API-Key")
    api.setApiKeyAuth()
    usingApiKeyFallback = true
  }
}

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
        Meetings: {
          path: "meetings/:meetingId?",
          parse: { meetingId: (id: string) => id || undefined },
        },
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

  // Track deviceId for foreground re-attestation
  const deviceIdRef = useRef<string | null>(null)

  // Initialize MST RootStore with persistence
  useEffect(() => {
    ;(async () => {
      const _rootStore = RootStoreModel.create({})

      try {
        // setupRootStore logs its own params/results
        await setupRootStore(_rootStore)

        // Auth0 SDK handles token persistence internally
        // We just need to set up deviceId for anonymous users

        // getDeviceId logs its own params/results
        const deviceId = await getDeviceId()
        deviceIdRef.current = deviceId
        _rootStore.authenticationStore.setDeviceId(deviceId)
        logger.setContext({ deviceId })

        // Initialize device authorization (attestation or API key fallback)
        // This blocks until we have valid device credentials
        await initializeDeviceAuthorization(deviceId)

        // Fetch server config (keys, secrets, URLs from /config endpoint)
        // If all retries fail, enter maintenance mode — config is required to operate
        await _rootStore.configStore.fetchConfig()
        if (!_rootStore.configStore.isLoaded) {
          log.warn("Config fetch exhausted all retries — entering maintenance mode")
          _rootStore.configStore.setOutageMode()
        }

        // Update logger with server-provided OTLP key
        if (_rootStore.configStore.otlpApiKey) {
          logger.updateConfig({ apiKey: _rootStore.configStore.otlpApiKey })
        }

        // Set initial OAuth auth (user authentication)
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

        // Initialize push notifications (non-fatal)
        if (Platform.OS !== "web") {
          initializeNotifications()

          // Register push token with backend
          if (authStore.userIdentifier && authStore.deviceId) {
            loginNotificationUser(authStore.userIdentifier, authStore.deviceId).catch(() => {})
          }

          // React to auth state changes for push token registration
          reaction(
            () => authStore.userIdentifier,
            (id) => {
              if (id && authStore.deviceId) {
                loginNotificationUser(id, authStore.deviceId).catch(() => {})
              } else {
                logoutNotificationUser()
              }
            },
          )

          // Sync language preference to backend
          reaction(
            () => _rootStore.profileStore.language,
            (language) => {
              if (language) setNotificationLanguage(language)
            },
          )

          // Handle notification click → navigate to screen and open SchedulePopup
          // if meetingId is present. setPendingMeetingId stores the meetingId in a
          // module-level variable that LiveContent subscribes to — this is the
          // reliable path for opening the popup (route params race with clearing).
          // See navigationUtilities.ts for the full explanation.
          const handleNotificationData = (data: {
            screen?: string
            section?: string
            segment?: string
            meetingId?: string
          }) => {
            if (data?.screen) {
              log.info("Notification clicked, navigating", { screen: data.screen, ...data })
              const { navigate: navTo, setPendingMeetingId } =
                require("./navigators/navigationUtilities")
              const params: Record<string, string> = {}
              if (data.section) params.section = data.section
              if (data.segment) params.segment = data.segment
              if (data.meetingId) {
                params.meetingId = data.meetingId
                setPendingMeetingId(data.meetingId)
                trackEvent("notification_meeting_opened", { screen: data.screen })
              }
              navTo(data.screen as never, Object.keys(params).length > 0 ? params : undefined)
            }
          }

          // Warm-start: listener fires when user taps notification while app is running
          addNotificationClickHandler(handleNotificationData)

          // Cold-start: check if app was launched by tapping a notification
          // (addNotificationResponseReceivedListener doesn't fire for the launch notification)
          getLastNotificationResponse().then((data) => {
            if (data) handleNotificationData(data)
          })
        }

        // Initialize Umami analytics (non-fatal)
        if (_rootStore.configStore.umamiUrl && _rootStore.configStore.umamiWebsiteId) {
          initializeUmami(
            _rootStore.configStore.umamiUrl,
            _rootStore.configStore.umamiWebsiteId,
            _rootStore.configStore.umamiApiKey,
          )

          // Set initial user identity
          if (authStore.userIdentifier) setTrackingUserId(authStore.userIdentifier)

          // React to auth identity changes
          reaction(
            () => authStore.userIdentifier,
            (id) => setTrackingUserId(id || undefined),
          )
        }

        initReviewService(_rootStore.configStore)

        setRootStore(_rootStore)
        trackEvent("app_initialized", { sessionId })
        log.info("App initialization complete")
      } catch (error) {
        log.error("RootStore initialization failed", { error: String(error) })
        setRootStore(_rootStore)
      }
    })()
  }, [])

  // Poll server config — 60s during maintenance, 15min otherwise
  useEffect(() => {
    if (!rootStore) return

    const NORMAL_INTERVAL = 15 * 60 * 1000 // 15 minutes
    const MAINTENANCE_INTERVAL = 60 * 1000 // 60 seconds

    let interval: ReturnType<typeof setInterval>

    const startPolling = (ms: number) => {
      clearInterval(interval)
      interval = setInterval(() => {
        log.debug("Config poll triggered", { maintenanceMode: rootStore.configStore.maintenanceMode })
        rootStore.configStore.fetchConfig()
      }, ms)
    }

    // Start with appropriate interval
    startPolling(rootStore.configStore.maintenanceMode ? MAINTENANCE_INTERVAL : NORMAL_INTERVAL)

    // React to maintenance mode changes and adjust interval
    const dispose = reaction(
      () => rootStore.configStore.maintenanceMode,
      (inMaintenance) => {
        log.info("Config poll interval changed", { inMaintenance })
        startPolling(inMaintenance ? MAINTENANCE_INTERVAL : NORMAL_INTERVAL)
      },
    )

    return () => {
      clearInterval(interval)
      dispose()
    }
  }, [rootStore])

  // Check for OTA updates after app is initialized (non-blocking, silent hot-swap)
  useEffect(() => {
    if (__DEV__ || !rootStore) return

    const timeout = setTimeout(async () => {
      try {
        const update = await Updates.checkForUpdateAsync()
        if (update.isAvailable) {
          log.info("OTA update available, fetching")
          await Updates.fetchUpdateAsync()
          log.info("OTA update fetched, showing reload notice")
          Alert.alert(
            translate("common:updateTitle"),
            translate("common:updateMessage"),
            [{ text: translate("common:ok"), onPress: () => Updates.reloadAsync() }],
            { cancelable: false },
          )
        }
      } catch (e) {
        log.debug("Update check skipped or failed", { error: String(e) })
      }
    }, 3000)

    return () => clearTimeout(timeout)
  }, [rootStore])

  // Foreground re-attestation: re-attest when app comes to foreground with expired JWT
  useEffect(() => {
    // Skip if using API key fallback (simulator) or on web
    if (usingApiKeyFallback || Platform.OS === "web") {
      return
    }

    let appState = AppState.currentState

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      // App coming to foreground from background/inactive
      if (appState.match(/inactive|background/) && nextState === "active") {
        if (isJwtExpiredOrNearExpiry() && deviceIdRef.current) {
          log.info("JWT expired/near-expiry, re-attesting in background")
          const attestPromise = performAttestation(deviceIdRef.current).then(() => {})
          api.setAttestationInProgress(attestPromise)
        }
      }
      appState = nextState
    })

    return () => {
      subscription.remove()
    }
  }, [])

  // Sync OS notification permission with profileStore on foreground resume
  useEffect(() => {
    if (!rootStore || Platform.OS === "web") return

    let appState = AppState.currentState

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appState.match(/inactive|background/) && nextState === "active") {
        hasNotificationPermission().then((permitted) => {
          const { notificationsEnabled } = rootStore.profileStore
          if (!permitted && notificationsEnabled) {
            // OS permission revoked → disable app toggle
            rootStore.profileStore.setNotificationsEnabled(false)
            optOutNotifications()
          } else if (permitted && !notificationsEnabled) {
            // OS permission granted (user enabled in Settings) → enable app toggle
            rootStore.profileStore.setNotificationsEnabled(true)
            optInNotifications()
          }
        })
      }
      appState = nextState
    })

    return () => {
      subscription.remove()
    }
  }, [rootStore])

  // Check if app is ready
  const isAppReady =
    isNavigationStateRestored && isI18nInitialized && rootStore && (areFontsLoaded || fontLoadError)

  // Note: Splash screen is hidden by DatabaseLoadingOverlay when DB is seeded
  if (!isAppReady) {
    return null
  }

  const linking = {
    prefixes: [prefix],
    config,
  }

  // Get userId for RevenueCat
  const revenueCatUserId = rootStore.authenticationStore.userIdentifier

  // otherwise, we're ready to render the app
  return (
    <Auth0Provider domain={AUTH0_CONFIG.domain} clientId={AUTH0_CONFIG.clientId}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <KeyboardProvider>
          <RootStoreProvider value={rootStore}>
            <SubscriptionProvider appUserId={revenueCatUserId}>
              <DatabaseProvider>
                <ProfileHydrator />
                <ChatHydrator />
                <ReportPollingResumer />
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
    </Auth0Provider>
  )
}
