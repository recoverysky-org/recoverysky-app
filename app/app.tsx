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
import * as Location from "expo-location"
import * as SplashScreen from "expo-splash-screen"
import { reaction } from "mobx"
import { Auth0Provider } from "react-native-auth0"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

// Prevent splash screen from auto-hiding before we're ready
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore errors - splash screen might already be hidden
})

import { AnnouncementGate } from "./components/AnnouncementGate"
import { MaintenanceBanner } from "./components/MaintenanceBanner"
import { TimerRecoveryGate } from "./components/TimerRecoveryGate"
import { ToastProvider } from "./components/Toast"
import { MeetingProvider } from "./context/MeetingContext"
import { SubscriptionProvider } from "./context/SubscriptionContext"
import {
  attendanceEvents,
  configCacheRepository,
  DatabaseProvider,
  DatabaseLoadingOverlay,
  openDbEarly,
  ProfileHydrator,
  ChatHydrator,
  ReportPollingResumer,
  TimerSessionResumer,
  SyncResumer,
  BackupPassRunner,
} from "./db"
// Not via the ./db barrel — see the note beside the barrel's resumer exports.
import { FavoritesMigrator } from "./db/FavoritesMigrator"
import { initI18n, translate } from "./i18n"
import { RootStoreModel, RootStoreProvider, setupRootStore, RootStore } from "./models"
import { AppNavigator } from "./navigators/AppNavigator"
import { useNavigationPersistence } from "./navigators/navigationUtilities"
import { api, type ServerConfig } from "./services/api"
import { isTimerSessionActive } from "./services/attendance"
import { isSimulator, preparePlayIntegrity } from "./services/attestation"
import {
  GOOGLE_CLOUD_PROJECT_NUMBER,
  establishDeviceToken,
  hydratePersistedDeviceJwt,
  isJwtExpiredOrNearExpiry,
  setApiKeyFallback,
  isUsingApiKeyFallback,
} from "./services/attestation/deviceToken"
import {
  type EstablishOutcome,
  pickAttestationAlert,
} from "./services/attestation/deviceTokenLogic"
import {
  clearStoredCredentials,
  createDeviceTokenRefresher,
  createUserTokenRefresher,
} from "./services/auth"
import { AUTH0_CONFIG } from "./services/auth/auth0"
import { clearAuthCredentials } from "./services/auth/secureStorage"
import { registerUnusableTokenHandler } from "./services/auth/unusableTokenHandler"
import { setSentryUser } from "./services/crashReporting/sentry"
import { initNetworkMonitoring } from "./services/network"
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
import { initRatingEngine } from "./services/rating"
import { initAttendanceSync } from "./services/sync"
import { initializeUmami, setTrackingUserId, trackEvent } from "./services/tracking"
import { ThemeProvider } from "./theme/context"
import { customFontsToLoad } from "./theme/typography"
import { checkForUpdates } from "./utils/checkForUpdates"
import { decideStartupConfigPath } from "./utils/configCacheLogic"
import { shouldSkipConfigPoll } from "./utils/connectivityLogic"
import { parseDeepLinkSegment, pendingTargetForSegment } from "./utils/deepLinkLogic"
import { getDeviceId, generateSessionId } from "./utils/deviceId"
import { loadDateFnsLocale } from "./utils/formatDate"
import { shouldRevokeLocationFlag } from "./utils/locationGateLogic"
import { hashUserId, logger } from "./utils/logger"
import { reloadApp } from "./utils/reloadApp"
import * as storage from "./utils/storage"

const log = logger.child({ module: "App" })

// Generate session ID once at module load (persists for app lifecycle)
const sessionId = generateSessionId()
// Log the full release identity including the OTA counter, e.g. "4.5.0-1"
// (native runtimeVersion + the `update` field, reset to "0" on each native
// bump). Matches the v{version}-{update} string in Settings and Sentry's
// release+dist pair, so a log line points at the exact JS bundle — not just
// the native shell. Two users on 4.5.0 native can be on different OTAs.
const pkg = require("../package.json")

const appVersion = `${pkg.version}-${pkg.update ?? "0"}`

// Set initial logger context with session and version (deviceId added after async load)
logger.setContext({ sessionId, appVersion })

log.info("App module loaded")

/**
 * Initialize device authorization (called once on cold start)
 * - Physical devices: stored JWT → assertion → full attestation
 * - Simulators / web / dev builds: X-API-Key fallback
 *
 * CHANGED 2026-09-09: returns "degraded" instead of blocking on temporary
 * failures. The app then renders on local data with the "Connecting…"
 * banner while the device refresher keeps trying. Only `unsupported` and a
 * server refusal still block — and the copy no longer tells anyone to
 * reinstall (attendance is local; a reinstall destroys it).
 */
async function initializeDeviceAuthorization(deviceId: string): Promise<"ok" | "degraded"> {
  if (Platform.OS === "web") {
    log.info("Web platform, skipping attestation")
    setApiKeyFallback()
    return "ok"
  }
  if (isSimulator()) {
    log.info("Simulator detected, using X-API-Key fallback")
    setApiKeyFallback()
    return "ok"
  }
  // Dev builds on physical devices — skip attestation entirely.
  // Play Integrity can't validate the debug signing key (not registered with
  // Play Console), so every attempt fails, burns retries, and delays startup.
  if (__DEV__) {
    log.info("Dev build on device, skipping attestation and using X-API-Key")
    setApiKeyFallback()
    return "ok"
  }

  // Prepared on EVERY Android cold start, before the persisted-JWT fast path
  // below — `playIntegrityPrepared` is per-process state in
  // services/attestation/index.ts, and a later re-attestation in this same
  // session (the device refresher at JWT skew, or a foreground warm-up)
  // depends on it having already run. A warm start that took the fast path
  // and skipped this would degrade on its first mid-session re-attestation
  // with no way back to "ok" for the rest of the process. This matches what
  // the pre-2026-09-09 flow did.
  if (Platform.OS === "android" && GOOGLE_CLOUD_PROJECT_NUMBER) {
    await preparePlayIntegrity(GOOGLE_CLOUD_PROJECT_NUMBER)
  }

  // Fast path: a persisted JWT with more than the skew left needs no network.
  if (await hydratePersistedDeviceJwt()) return "ok"

  const outcome = await establishDeviceToken(deviceId)
  if (outcome.status === "ok") return "ok"
  if (outcome.status === "degraded") {
    log.warn("Device attestation degraded — running without a device token", {
      detail: outcome.detail,
    })
    return "degraded"
  }

  log.fatal("Initial attestation blocked", { reason: outcome.reason })
  const { titleKey, messageKey } = pickAttestationAlert(outcome.reason)
  return new Promise<"ok" | "degraded">(() => {
    Alert.alert(
      translate(titleKey),
      translate(messageKey),
      [
        {
          text: translate("common:retry"),
          onPress: () => {
            // Full app reload to retry from scratch.
            // CHANGED 2026-05-21: via reloadApp() to close the expo-sqlite
            // SharedObject before teardown — avoids the SharedObjectRegistry
            // .clear / ~WeakObject EXC_BAD_ACCESS crash seen on OTA reloads.
            reloadApp(() => BackHandler.exitApp())
          },
        },
        {
          text: translate("common:close"),
          style: "destructive",
          onPress: () => BackHandler.exitApp(),
        },
      ],
      { cancelable: false },
    )
  })
}

/**
 * One-shot recovery for a cold start that opened on env-var defaults because
 * the config cache was cold AND the device lane was degraded (see the branch
 * in the init effect below).
 *
 * ADDED 2026-09-09 (final review): that start is deliberately NOT outage mode,
 * so nothing polls /status/ready and nothing reloads on its own — but several
 * subsystems are one-shot on mount and read ConfigStore at that moment
 * (RevenueCat in SubscriptionContext, Umami, the OTLP api key). They never
 * re-run in-session, so a device that recovers mid-session would sit on
 * placeholder keys until the user killed the app. A reload re-runs the whole
 * bootstrap, which is the same reason the outage-recovery effect reloads
 * rather than re-initialising in place: init registers MobX reactions that
 * would duplicate.
 *
 * Fires at most once, and never while an attendance timer is live — the
 * reload would take the timer's tree with it. Reacting over both values (the
 * pendingLogout idiom above) makes the release of the timer the trigger.
 */
function armDegradedStartConfigRecovery(_rootStore: RootStore) {
  let fired = false
  const dispose = reaction(
    () => ({ loaded: _rootStore.configStore.isLoaded, live: isTimerSessionActive() }),
    ({ loaded, live }) => {
      if (fired || !loaded || live) return
      fired = true
      dispose()
      log.info("Config loaded after a degraded cold start — reloading to complete init")
      // Via reloadApp() for the expo-sqlite SharedObject teardown reason
      // documented on the other two call sites.
      reloadApp((e) => {
        log.warn("reloadAsync failed during degraded-start recovery", { error: String(e) })
      })
    },
  )
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

  // Set during store init so the foreground warm-up can reach the refresher.
  const deviceRefresherRef = useRef<{ getToken: () => Promise<string | null> } | null>(null)

  // Initialize MST RootStore with persistence
  useEffect(() => {
    ;(async () => {
      const _rootStore = RootStoreModel.create({})

      try {
        const authStore = _rootStore.authenticationStore

        // CHANGED 2026-08-06: the initial api.updateAuth() call and the
        // auth-state reaction that mirrored it into the API layer are gone.
        // Both existed only to keep a *sticky* Authorization header in sync
        // with the store; the auth gate now reads the store through the user
        // refresher on every single request, so there is nothing left to push.

        // ---- Forced logout on a dead refresh token ----------------------
        //
        // Two beats, deliberately. Beat one is inside the user refresher: it
        // returns null forever after a permanent failure, so no stale Bearer
        // can go out regardless of what happens below. Beat two is the actual
        // eject, which we hold while an attendance timer is live.
        const performForcedLogout = () => {
          log.warn("Performing forced logout after permanent refresh failure")
          authStore.logout()
          // Both credential stores must go. Clearing only ours leaves the SDK's
          // keychain entry intact and the next useAuth0Wrapper sync would
          // cheerfully re-hydrate the dead session.
          clearAuthCredentials().catch((err) =>
            log.error("Failed to clear auth credentials", { error: String(err) }),
          )
          clearStoredCredentials().catch((err) =>
            log.error("Failed to clear SDK credentials", { error: String(err) }),
          )
          userRefresher.reset()
        }

        const userRefresher = createUserTokenRefresher({
          authStore,
          onPermanentFailure: () => {
            if (isTimerSessionActive()) {
              log.warn("Refresh dead but timer is live — deferring logout")
              authStore.setPendingLogout(true)
            } else {
              performForcedLogout()
            }
          },
        })

        // ADDED 2026-09-10: the Auth0 SDK sync effect (useAuth0Wrapper) can
        // hand us a token that is not a JWT for our audience. It reports
        // here; markRejected() latches the refresher so no bearer goes out
        // and ejects through the same timer-aware onPermanentFailure above.
        // The hook has several mount sites and each may report the same
        // token — the latch and performForcedLogout() both tolerate repeats.
        // (The latch is reset by performForcedLogout() itself, so "tolerate"
        // means idempotent, not deduplicated.)
        registerUnusableTokenHandler(() => userRefresher.markRejected())

        // Wire both refreshers into the API's per-request auth gate. This is
        // the injection point that keeps app/services/api free of any import
        // edge into services/auth or services/attestation — depcruise would
        // see a cycle otherwise (the existing direction is attestation → api).
        const deviceRefresher = createDeviceTokenRefresher({
          getDeviceId: () => deviceIdRef.current,
          // Background attempts clear or set the "Connecting…" banner. Safe
          // to reference _rootStore here: the closure runs long after the
          // node exists, and setupRootStore() applies a snapshot to this
          // same node rather than replacing it (see the ORDERING note below).
          onOutcome: (outcome: EstablishOutcome) =>
            _rootStore.configStore.setDeviceAuthDegraded(outcome.status !== "ok"),
        })
        deviceRefresherRef.current = deviceRefresher

        // ⚠️ ORDERING: registration MUST stay ahead of every await below — do
        // not "tidy" this down next to setupRootStore or the device wiring.
        //
        // CHANGED 2026-08-07: this block used to sit after fetchConfig(). The
        // gate goes live in the Api constructor, so between there and this call
        // `refreshers.device()` is the no-op default returning null. /config is
        // a device-auth-gated secrets endpoint, and EXPO_PUBLIC_AUTH_KEY only
        // exists in .env (gitignored AND easignored, absent from eas.json), so
        // on a production build the X-API-Key fallback is empty too — /config
        // went out with NO device credential at all, failed every retry, and
        // dropped every production cold start onto the MaintenanceScreen. The
        // old sticky-header code accidentally avoided this because
        // performAttestation() pushed the JWT into the API layer itself.
        //
        // CHANGED 2026-08-07 (again): moved further up, ahead of
        // setupRootStore() and getDeviceId(). "Before fetchConfig" was too weak
        // a requirement — the real rule is that registration must precede ANY
        // code that can throw. getDeviceId() touches SecureStore and can throw
        // on a device with keychain trouble; a throw there landed in the outer
        // catch, which mounts the store and lets the app run normally, with the
        // refreshers stuck on their no-op defaults forever. That is the
        // production no-credential failure above, except outageMode is false,
        // so the user gets a normal-looking app with permanently empty lists
        // instead of the MaintenanceScreen.
        //
        // Both refreshers tolerate running this early. createUserTokenRefresher
        // needs only `_rootStore.authenticationStore`, which exists the moment
        // RootStoreModel.create() returns and is read lazily per getToken()
        // call — setupRootStore() applies a snapshot to that same node rather
        // than replacing it. createDeviceTokenRefresher reads deviceIdRef
        // through a closure and returns the current (null) token when it is
        // unset, so it is safe before getDeviceId() resolves.
        //
        // Registering this early is safe in the other direction too: nothing
        // between here and attestation hits the gate. The only request in that
        // window is getPublicStatus(), which carries SKIP_AUTH_GATE_HEADER, and
        // the device refresher's own /attest call carries it too — so a live
        // refresher cannot recurse. The device lane additionally refuses to
        // attest at all until initializeDeviceAuthorization() has chosen a lane
        // (isDeviceAuthInitialized() in services/attestation/deviceToken).
        api.registerTokenRefreshers({
          device: deviceRefresher.getToken,
          user: userRefresher.getToken,
          // ADDED 2026-09-10: a 401 with token_malformed / token_claims /
          // token_signature latches the user lane and ejects (timer-aware,
          // via onPermanentFailure above). token_expired, token_invalid, a
          // code-less 401 and the 503 auth_unavailable never reach this.
          onBearerRejected: userRefresher.markRejected,
        })

        // Fire the deferred eject the moment the timer releases. Reads the
        // observable box in services/attendance/timerSession, so Save and
        // Cancel both trip it for free. MobX rather than a new event channel,
        // for the reason CLAUDE.md gives for maintenanceMode.
        //
        // Safe to register before setupRootStore() (CHANGED 2026-08-07, moved
        // up with the registration block): `pendingLogout` is a VOLATILE field,
        // so the applySnapshot() inside setupRootStore cannot flip it and trip
        // this reaction into logging someone out on cold start. Keep it
        // volatile — persisting it would make that a live hazard.
        reaction(
          () => ({ pending: authStore.pendingLogout, live: isTimerSessionActive() }),
          ({ pending, live }) => {
            if (pending && !live) performForcedLogout()
          },
        )

        // setupRootStore logs its own params/results
        await setupRootStore(_rootStore)

        // Auth0 SDK handles token persistence internally
        // We just need to set up deviceId for anonymous users

        // getDeviceId logs its own params/results
        const deviceId = await getDeviceId()
        deviceIdRef.current = deviceId
        _rootStore.authenticationStore.setDeviceId(deviceId)
        logger.setContext({ deviceId })

        // Live device network state → NetworkStore. Registered BEFORE the
        // /status/ready precheck below so the outage screen's Device Offline vs
        // System Maintenance variant has a real value from its first frame
        // (NetInfo fires the listener immediately with the current state).
        // Also finally activates NetworkStore's existing consumers — the
        // sync gate, the In-Person map toggle, Settings' offline row.
        // ADDED 2026-09-06: network-aware maintenance spec.
        initNetworkMonitoring(_rootStore)

        // Startup config cache — read BEFORE the /status/ready precheck so a warm
        // cache is in hand when we decide the config path below. Opening the
        // DB here is safe/idempotent (see openDbEarly). Any failure lands on
        // cachedConfig = null, which is byte-for-byte the pre-cache startup.
        // Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
        let cachedConfig: ServerConfig | null = null
        if (await openDbEarly()) {
          const row = await configCacheRepository.load()
          const decision = decideStartupConfigPath(row)
          if (decision.mode === "warm") {
            cachedConfig = decision.config
            log.info("Config cache warm", { fetchedAt: row?.fetchedAt })
          } else {
            log.info("Config cache cold (first launch or unreadable cache)")
          }
        }

        // Persist every successful /config payload to the encrypted SQLite
        // cache. A reaction (not a ConfigStore side effect) so models/ stays
        // free of db/ imports — same direction as ProfileHydrator. Registered
        // BEFORE the fetch below so the very first launch's payload is
        // captured too (a save before the DB opens just logs and no-ops;
        // the 60s config poll self-heals). Never disposed: config polling
        // runs for the app's lifetime.
        reaction(
          () => _rootStore.configStore.lastConfigPayload,
          (payload) => {
            if (!payload) return
            void configCacheRepository.save(
              JSON.stringify(payload),
              _rootStore.configStore.lastConfigFetchedAt,
            )
          },
        )

        // /status/ready precheck — runs BEFORE attestation. If the API is
        // unreachable, /attest will fail with a misleading "Device
        // Verification Failed" alert. /status/ready is unauthenticated and
        // doesn't require any of the JWTs we're about to set up, so it's
        // the right way to detect "API is down at startup" cleanly.
        // CHANGED 2026-09-14: was GET /status; the readiness route is the
        // same DB + TREX gate with a tiny body — see getPublicStatus.
        //
        // Fail fast so users on a real outage see the MaintenanceScreen
        // quickly instead of staring at the splash — but give slow networks
        // an honest chance first. Per-request timeouts ESCALATE across
        // attempts (2.5s → 4s → 6s) rather than staying flat: a network
        // that needs 3-5s to answer used to fail every flat-2.5s attempt
        // identically and land a healthy user on the outage screen. The
        // client default is 10s, which previously stretched this gate to
        // 25-47s on flaky networks and contributed to Background ANRs
        // (heavy native init colliding with the user backgrounding the app
        // mid-precheck); a fast cannot-connect (status 0) still returns
        // well under the first ceiling. See getPublicStatus in services/api.
        // CHANGED 2026-08-14: was 4 attempts × flat 2.5s + (1+2+4)s delays
        // (≈17s worst case). Now 3 attempts on the 2.5/4/6s ladder +
        // (1+2)s delays ≈ 15.5s worst case — slightly tighter budget, far
        // fewer false positives on slow-but-alive networks (the
        // false-outage reports investigated 2026-08-14).
        const STATUS_TIMEOUT_LADDER_MS = [2500, 4000, 6000]
        const STATUS_RETRY_DELAYS = [1000, 2000]
        let statusOk = false
        for (let attempt = 1; attempt <= STATUS_TIMEOUT_LADDER_MS.length; attempt++) {
          const result = await api.getPublicStatus(STATUS_TIMEOUT_LADDER_MS[attempt - 1])
          if (result.kind === "ok") {
            statusOk = true
            if (attempt > 1) log.info("/status/ready precheck recovered", { attempt })
            break
          }
          log.warn("/status/ready precheck failed", { attempt, kind: result.kind })
          if (attempt <= STATUS_RETRY_DELAYS.length) {
            await new Promise((r) => setTimeout(r, STATUS_RETRY_DELAYS[attempt - 1]))
          }
        }

        if (!statusOk) {
          log.warn("/status/ready precheck exhausted retries — entering outage mode")
          _rootStore.configStore.setOutageMode()
          // Mount the root store so the app shell renders (AppNavigator
          // routes to MaintenanceScreen on outageMode). Skip attestation
          // and fetchConfig — both would fail anyway, and downstream
          // setup (Umami, push notifications, RevenueCat) all depend on
          // configStore being loaded. The outage-recovery effect below
          // will detect when /status/ready comes back and reload the app.
          setRootStore(_rootStore)
          trackEvent("app_initialized", { sessionId, outage: true })
          log.info("App initialization complete (outage mode)")
          return
        }

        // Initialize device authorization (attestation or API key fallback)
        // This blocks until we have valid device credentials
        // CHANGED 2026-09-09: no longer strictly true — a temporary
        // attestation failure now resolves "degraded" instead of blocking
        // forever, so the app can proceed on local data with the banner.
        // Only `unsupported` / server-rejected still block via the fatal alert.
        const deviceAuth = await initializeDeviceAuthorization(deviceId)
        _rootStore.configStore.setDeviceAuthDegraded(deviceAuth === "degraded")
        if (deviceAuth === "degraded") {
          // ADDED 2026-09-09 (final review): the cold-start ladder just failed,
          // but it ran outside the refresher, whose backoff therefore has
          // recorded nothing — the very first API request below would re-run
          // the full ladder immediately (and on iOS generate a second Apple key
          // seconds after the first). Seed the ladder with that failure.
          deviceRefresher.noteColdStartFailure()
        }

        // Fetch server config (keys, secrets, URLs from /config endpoint).
        // Cold-start outage gate fires for two cases — both route to the
        // full-screen MaintenanceScreen instead of the runtime banner:
        //   1. Fetch failed after all retries: nothing cached to render.
        //   2. Fetch succeeded but server reported MAINTENANCE_MODE=true:
        //      we don't want a fresh-launched user staring at an empty
        //      meeting list with a banner; the full screen is the more
        //      honest UX. The gate clears on the next poll where
        //      maintenance is off (see ConfigStore.fetchConfig).
        // CHANGED 2026-08-14: both gates now apply ONLY when the config
        // cache is cold (first launch / unreadable cache). A warm cache
        // seeds the store and the fetch runs un-awaited in the background;
        // maintenance then arrives as the banner (spec decision: banner-only
        // on warm starts). outageMode is never set on the warm path.
        // Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
        if (cachedConfig) {
          _rootStore.configStore.applyServerConfig(cachedConfig, { fromCache: true })
          // Deliberately un-awaited: refreshes store + cache when it lands.
          void _rootStore.configStore.fetchConfig()
        } else {
          await _rootStore.configStore.fetchConfig()
          if (!_rootStore.configStore.isLoaded) {
            // CHANGED 2026-09-09 (final review): a degraded device lane is the
            // one cold-cache failure that must NOT enter outage mode. With no
            // device token the API answers /config with a 401, so the fetch
            // fails — but the PUBLIC /status/ready the MaintenanceScreen recovery
            // effect polls is healthy in an attest-only outage. It would call
            // reloadApp() at once, the whole init would run again (87 s ladder,
            // degrade, 401, outage), and on iOS every cycle burns one Secure
            // Enclave key generation: an unbounded loop against the exact Apple
            // rate limit this branch exists to protect. Render on the env-var
            // ConfigStore defaults with the "Connecting…" banner instead, and
            // arm the one-shot reload for when config finally lands.
            if (deviceAuth === "degraded") {
              log.warn(
                "Config fetch failed on a degraded device lane — opening on env defaults, no outage mode",
              )
              armDegradedStartConfigRecovery(_rootStore)
            } else {
              log.warn("Config fetch exhausted all retries — entering outage mode")
              _rootStore.configStore.setOutageMode()
            }
          } else if (_rootStore.configStore.maintenanceMode) {
            log.info("Cold start with maintenance active — entering outage mode")
            _rootStore.configStore.setOutageMode()
          }
        }

        // Update logger with server-provided OTLP key
        if (_rootStore.configStore.otlpApiKey) {
          logger.updateConfig({ apiKey: _rootStore.configStore.otlpApiKey })
        }

        // Cloud backup / multi-device sync — wires the outbox mutation hook,
        // resume + gate-clear reactions, and fires a cold-start catch-up.
        // Gated internally on profileStore.syncEnabled + the attendance
        // entitlement, so this is a no-op for users who haven't opted in.
        initAttendanceSync(_rootStore)

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

          // Handle notification click → navigate to screen and open the meeting
          // popup if meetingId is present. setPendingMeetingId stores the
          // meetingId in a module-level variable that the popup's host
          // subscribes to — this is the reliable path for opening the popup
          // (route params race with clearing). See navigationUtilities.ts for
          // the full explanation.
          //
          // CHANGED 2026-08-07: the popup is no longer always SchedulePopup.
          // Reminder pushes now carry `segment` (the sender derives it from
          // `meetings."venueType"`), and an in-person reminder must open
          // InPersonPopup — the only surface with the Directions button — via
          // the "inperson" pending target. Both the segment route param and
          // the pending target are narrowed through parseDeepLinkSegment
          // rather than passed through: see that module for why an
          // unrecognised value is a blank Meetings tab, not a cosmetic miss.
          const handleNotificationData = (data: {
            screen?: string
            section?: string
            segment?: string
            meetingId?: string
          }) => {
            if (data?.screen) {
              // Refuse to navigate while an attendance timer is running.
              // navTo() bypasses the tab bar entirely, so MainNavigator's
              // tabPress lock does not see it — and this is the LIKELIER of
              // the two paths, because meeting reminders fire around meeting
              // times, which is exactly when a timer is up. Navigating away
              // unmounts the popup hosting the timer modal and destroys the
              // clock; the user is sitting in the meeting they just lost
              // credit for. Deliberately dropped rather than queued: by the
              // time they save or cancel, a reminder for a meeting that has
              // already started is not worth yanking them anywhere.
              if (isTimerSessionActive()) {
                log.info("Notification tap ignored — attendance timer running", {
                  screen: data.screen,
                })
                return
              }
              log.info("Notification clicked, navigating", { screen: data.screen, ...data })
              const {
                navigate: navTo,
                setPendingMeetingId,
              } = require("./navigators/navigationUtilities")
              const params: Record<string, string> = {}
              if (data.section) params.section = data.section
              // Narrow once, use for both: the route param that picks the
              // visible segment and the target that picks the popup. They must
              // agree, or the user watches a popup open on a segment they
              // aren't looking at.
              const segment = parseDeepLinkSegment(data.segment)
              if (segment) params.segment = segment
              if (data.meetingId) {
                params.meetingId = data.meetingId
                setPendingMeetingId(data.meetingId, pendingTargetForSegment(segment))
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

        // Sentry user identity. Always wired (not gated on umami config)
        // since crash reporting must work even when analytics doesn't.
        // Opaque userIdentifier only — never email/name. PII is also
        // double-checked in sentry.beforeSend just in case.
        if (authStore.userIdentifier) setSentryUser(authStore.userIdentifier)
        reaction(
          () => authStore.userIdentifier,
          (id) => setSentryUser(id || null),
        )

        // Logger user identity. Keyed on `userId` (Auth0 sub), NOT
        // `userIdentifier` — anonymous users already ride on `deviceId`,
        // which every record carries. The value is HASHED before it touches
        // the logger (see hashUserId.ts): the raw sub embeds the identity
        // provider and its account id, and this attribute lands on every
        // Loki line next to meeting/attendance context. `undefined` on
        // sign-out clears the attribute (setContext merges, so we must write
        // the key explicitly rather than omit it).
        logger.setContext({ userId: hashUserId(authStore.userId) })
        reaction(
          () => authStore.userId,
          (id) => logger.setContext({ userId: hashUserId(id) }),
        )

        initRatingEngine(_rootStore.configStore)

        // Sync shortName → Auth0 profile, debounced.
        // Mounted once here so it covers every edit site (onboarding, settings,
        // import, etc.) without per-screen wiring. Skips the first emission
        // after hydration so we don't re-POST the existing value on cold start.
        {
          const profileStore = _rootStore.profileStore
          let debounceTimer: ReturnType<typeof setTimeout> | undefined
          let lastSynced: string | undefined

          reaction(
            () => ({
              name: profileStore.shortName,
              hydrated: profileStore.isHydrated,
              isAnonymous: authStore.isAnonymous,
            }),
            ({ name, hydrated, isAnonymous }) => {
              if (!hydrated) return
              if (isAnonymous) return
              if (lastSynced === undefined) {
                // First emission after hydration — prime the cache, don't POST.
                lastSynced = name
                return
              }
              if (name === lastSynced) return

              if (debounceTimer) clearTimeout(debounceTimer)
              debounceTimer = setTimeout(async () => {
                // Backend constraint: trimmed, 1–300 chars.
                const value = name.trim().slice(0, 300)
                if (!value) return
                const result = await api.updateAuth0Profile({ name: value })
                if (result.kind === "ok") {
                  lastSynced = name
                  log.debug("Auth0 profile synced", { name: value })
                } else {
                  // Don't update lastSynced on failure — next edit retries.
                  log.warn("Auth0 profile sync failed", { kind: result.kind })
                }
              }, 800)
            },
          )
        }

        setRootStore(_rootStore)
        trackEvent("app_initialized", { sessionId })
        log.info("App initialization complete")
      } catch (error) {
        log.error("RootStore initialization failed", { error: String(error) })
        setRootStore(_rootStore)
      }
    })()
  }, [])

  // Poll server config — faster during maintenance to detect when it ends
  useEffect(() => {
    if (!rootStore) return

    const NORMAL_INTERVAL = (Number(process.env.EXPO_PUBLIC_CONFIG_POLL_SECONDS) || 60) * 1000
    const MAINTENANCE_INTERVAL =
      (Number(process.env.EXPO_PUBLIC_CONFIG_POLL_MAINTENANCE_SECONDS) || 15) * 1000

    let interval: ReturnType<typeof setInterval>

    const startPolling = (ms: number) => {
      clearInterval(interval)
      interval = setInterval(() => {
        // CHANGED 2026-09-06: offline ticks are skipped entirely — a poll
        // that cannot succeed must not run, or its failure gets counted as
        // maintenance evidence (the false-banner complaint). The reconnect
        // reaction below resyncs the moment the device is back.
        if (shouldSkipConfigPoll({ isOffline: rootStore.networkStore.isOffline })) {
          log.debug("Config poll skipped — device offline")
          return
        }
        log.debug("Config poll triggered", {
          maintenanceMode: rootStore.configStore.maintenanceMode,
        })
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

    // ADDED 2026-09-06: immediate refetch on the offline→online edge, so a
    // reconnecting user doesn't wait out the poll interval — and if server
    // maintenance ended while we were offline, the banner clears promptly.
    const disposeReconnect = reaction(
      () => rootStore.networkStore.isOffline,
      (isOffline, prevOffline) => {
        if (prevOffline === true && isOffline === false) {
          log.info("Network reconnected — immediate config refetch")
          rootStore.configStore.fetchConfig()
        }
      },
    )

    return () => {
      clearInterval(interval)
      dispose()
      disposeReconnect()
    }
  }, [rootStore])

  // Outage recovery loop — polls /status/ready while we're stuck in cold-start
  // outage mode. When the API comes back, reload the app so the full init
  // sequence (attestation, fetchConfig, Umami, push, etc.) re-runs from
  // scratch. Reload is the safe option here: the bootstrap registers MobX
  // reactions that would duplicate if we re-ran init in place. The user
  // sees a brief splash flash but no manual intervention is needed.
  // CHANGED 2026-09-06: interval ticks early-return while the device is
  // offline (they cannot succeed and just burn radio), and a reconnect
  // reaction fires one immediate check so a returning connection doesn't
  // wait out the 15s interval.
  useEffect(() => {
    if (!rootStore) return

    let interval: ReturnType<typeof setInterval> | undefined
    // In-flight guard: the 15s interval tick and the reconnect reaction below
    // both call checkStatusAndReload, and a reconnect landing right on a tick
    // would otherwise run two concurrent /status/ready checks that could both
    // resolve "ok" and both call reloadApp(). One reload is enough.
    let checking = false

    const checkStatusAndReload = async () => {
      if (checking) return
      checking = true
      try {
        const result = await api.getPublicStatus()
        if (result.kind === "ok") {
          log.info("/status/ready recovered — reloading app to resume init")
          if (interval) {
            clearInterval(interval)
            interval = undefined
          }
          // CHANGED 2026-05-21: via reloadApp() to close the expo-sqlite
          // SharedObject before teardown — avoids the SharedObjectRegistry
          // .clear / ~WeakObject EXC_BAD_ACCESS crash seen on OTA reloads.
          reloadApp((e) => {
            log.warn("reloadAsync failed during outage recovery", { error: String(e) })
          })
        }
      } finally {
        checking = false
      }
    }

    const dispose = reaction(
      () => rootStore.configStore.outageMode,
      (inOutage) => {
        if (interval) {
          clearInterval(interval)
          interval = undefined
        }
        if (!inOutage) return

        log.info("Outage detected — starting /status/ready recovery polling")
        interval = setInterval(() => {
          if (rootStore.networkStore.isOffline) return // wait for the reconnect reaction
          void checkStatusAndReload()
        }, 15_000)
      },
      { fireImmediately: true },
    )

    // ADDED 2026-09-06: one immediate check on the offline→online edge while
    // in outage — the common case is "user launched in airplane mode, then
    // turned it off"; they should recover in seconds, not at the next tick.
    const disposeReconnect = reaction(
      () => rootStore.networkStore.isOffline,
      (isOffline, prevOffline) => {
        if (rootStore.configStore.outageMode && prevOffline === true && isOffline === false) {
          void checkStatusAndReload()
        }
      },
    )

    return () => {
      if (interval) clearInterval(interval)
      dispose()
      disposeReconnect()
    }
  }, [rootStore])

  // Check for store + OTA updates after app is initialized (non-blocking)
  useEffect(() => {
    if (__DEV__ || !rootStore) return

    const timeout = setTimeout(async () => {
      try {
        await checkForUpdates(rootStore.configStore.latestVersion)
      } catch (e) {
        log.debug("Update check skipped or failed", { error: String(e) })
      }
    }, 3000)

    return () => clearTimeout(timeout)
  }, [rootStore])

  // Foreground OTA recheck: the cold-start check above only runs once, so a
  // user who keeps the app backgrounded for days never sees a newly published
  // OTA until they force-quit. On resume after a sufficiently long background
  // window, re-run checkForUpdates. Short-foregrounds (tab switches, glances)
  // are ignored by the threshold so we don't spam the native module.
  useEffect(() => {
    if (__DEV__ || !rootStore || Platform.OS === "web") return

    const FOREGROUND_RECHECK_MS = 5 * 60 * 1000 // 5 minutes
    let appState = AppState.currentState
    let backgroundedAt: number | null = null

    log.info("Foreground OTA recheck listener installed", {
      thresholdMs: FOREGROUND_RECHECK_MS,
      initialAppState: appState,
    })

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      log.debug("AppState transition", { from: appState, to: nextState })

      if (appState === "active" && nextState.match(/inactive|background/)) {
        backgroundedAt = Date.now()
        log.debug("App backgrounded, stamped backgroundedAt", { backgroundedAt })
      } else if (appState.match(/inactive|background/) && nextState === "active") {
        const elapsed = backgroundedAt !== null ? Date.now() - backgroundedAt : 0
        backgroundedAt = null
        trackEvent("app_foregrounded", { backgrounded_ms: elapsed })
        if (elapsed >= FOREGROUND_RECHECK_MS) {
          log.info("Foreground resume past threshold, rechecking for updates", {
            backgroundedMs: elapsed,
            thresholdMs: FOREGROUND_RECHECK_MS,
          })
          checkForUpdates(rootStore.configStore.latestVersion).catch((e) =>
            log.debug("Foreground update check failed", { error: String(e) }),
          )
        } else {
          log.debug("Foreground resume below threshold, skipping recheck", {
            backgroundedMs: elapsed,
            thresholdMs: FOREGROUND_RECHECK_MS,
          })
        }
      }
      appState = nextState
    })

    return () => {
      log.debug("Foreground OTA recheck listener removed")
      subscription.remove()
    }
  }, [rootStore])

  // Foreground re-attestation: re-attest when app comes to foreground with expired JWT
  useEffect(() => {
    // Skip if using API key fallback (simulator) or on web
    if (isUsingApiKeyFallback() || Platform.OS === "web") {
      return
    }

    let appState = AppState.currentState

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      // App coming to foreground from background/inactive
      if (appState.match(/inactive|background/) && nextState === "active") {
        if (isJwtExpiredOrNearExpiry() && deviceIdRef.current) {
          log.info("JWT expired/near-expiry, warming re-attestation")
          // Fire and forget. Queueing is no longer this listener's job:
          // single-flight inside the device refresher gives every caller the
          // same in-flight promise, which is exactly why
          // setAttestationInProgress could be deleted.
          //
          // CHANGED 2026-08-06: this warm-up is now redundant for
          // *correctness* — the request gate refreshes on demand — but it is
          // kept for latency. Attestation is a multi-second Apple/Play round
          // trip; without it the first fetch after a long background sleep
          // pays that cost inline and visibly.
          void deviceRefresherRef.current?.getToken()
        }
      }
      appState = nextState
    })

    return () => {
      subscription.remove()
    }
  }, [])

  // Fire Umami `attendance_validated` whenever an attendance record finishes
  // processing with `valid === true`. We track the *validation* event rather
  // than raw creation because records can be created optimistically (e.g. the
  // SDK marks a meeting as joined) and then invalidated when the user cancels
  // below the credit threshold — those should not count as attendance in
  // analytics. One subscriber covers both the native SDK path and the
  // external-Zoom timer path via their shared `processed` emit.
  useEffect(() => {
    const unsubscribe = attendanceEvents.subscribe((event) => {
      if (event.type === "processed" && event.valid === true) {
        trackEvent("attendance_validated", { source: event.source ?? "unknown" })
      }
    })
    return unsubscribe
  }, [])

  // Sync OS notification permission with profileStore on foreground resume.
  // CHANGED 2026-08-08 (TODO I3): also syncs the location permission, so
  // Settings can no longer show Location ON for a grant the user revoked in
  // device Settings. Web is excluded by the early return below for both:
  // there is no device-settings round trip to come back from.
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

        // Location is deliberately ONE-directional — revoke only, no
        // auto-enable. Notifications above sync both ways because the OS grant
        // is the whole of that consent. Location has a second, independent
        // consent: our own `locationEnabled` toggle, which the In-Person gate
        // asks for separately (`decideLocationGate`'s "confirm-in-app" branch
        // exists precisely for OS-granted-but-toggle-off). Auto-enabling here
        // would answer that question on the user's behalf and quietly start
        // reading their position because they once allowed it for something
        // else. getForegroundPermissionsAsync only READS — it never prompts.
        // CHANGED 2026-08-12: the comparison moved into the shared
        // `shouldRevokeLocationFlag` predicate. This resume listener used to be
        // the ONLY place the flag was ever cleared, and it only fires on
        // `background → active` — so a one-time grant that died with the
        // process left the flag stranded on. Three more sites reconcile now
        // (useNearbySchedules, usePresenceCheck, SettingsScreen focus); they
        // all share the predicate so the rule cannot drift between them.
        Location.getForegroundPermissionsAsync()
          .then(({ granted }) => {
            if (
              shouldRevokeLocationFlag({
                osGranted: granted,
                locationEnabled: rootStore.profileStore.locationEnabled,
              })
            ) {
              rootStore.profileStore.setLocationEnabled(false)
            }
          })
          .catch((err) => {
            // Never fatal: a failed read just leaves the toggle as-is until the
            // next resume, and the gate re-reads the OS state on every run.
            log.warn("Location permission resume sync failed", { error: String(err) })
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
        {/* preload={false}: KeyboardProvider's default preload=true calls
            KeyboardController.preload() on mount, which on iOS spins up a
            hidden UITextField and calls becomeFirstResponder() at cold start
            (see react-native-keyboard-controller UIResponder.swift
            preloadKeyboardIfNeeded). On iOS 18 with Apple Intelligence that
            synchronously loads the GenerativeModels / WritingToolsUI framework
            on the main thread while servicing the keyboard's RTI trait update
            (_supportsWritingTools), blocking ≥2s and tripping Sentry's
            "App Hanging" watchdog during launch. We trade the marginal
            first-focus keyboard warm-up for a hang-free startup. */}
        <KeyboardProvider preload={false}>
          <RootStoreProvider value={rootStore}>
            <SubscriptionProvider appUserId={revenueCatUserId}>
              <DatabaseProvider>
                <ProfileHydrator />
                <ChatHydrator />
                <ReportPollingResumer />
                <TimerSessionResumer />
                <SyncResumer />
                <BackupPassRunner />
                <FavoritesMigrator />
                <MeetingProvider>
                  <ThemeProvider>
                    <ToastProvider>
                      <DatabaseLoadingOverlay />
                      <AppNavigator
                        linking={linking}
                        initialState={initialNavigationState}
                        onStateChange={onNavigationStateChange}
                      />
                      {/* Sticky maintenance banner — drawn above all
                          screens including modals via absolute positioning
                          + high zIndex. Sibling to AppNavigator so a
                          navigator state swap (or a navigator-level
                          modal) doesn't unmount it. */}
                      <MaintenanceBanner />
                      {/* External Zoom timer recovery — remounts the
                          running timer modal on cold start when the OS
                          killed our process mid-meeting. Sibling to
                          AppNavigator so it survives navigator state
                          swaps and renders above every screen. Driven
                          by TimerSessionResumer via the recovery
                          channel in services/attendance/timerRecovery. */}
                      <TimerRecoveryGate />
                      <AnnouncementGate />
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
