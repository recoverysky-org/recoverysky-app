import { Platform } from "react-native"
import { flow, Instance, SnapshotOut, types } from "mobx-state-tree"

import { api } from "@/services/api"
import { logger } from "@/utils/logger"
import { DEFAULT_PRESENCE_RADIUS_M, DEV_PRESENCE_RADIUS_M } from "@/utils/presenceLogic"

const log = logger.child({ module: "ConfigStore" })

/**
 * ConfigStore - Server-provided configuration
 *
 * Fetches config from /config endpoint after authentication.
 * Falls back to env vars / defaults if fetch fails.
 */
export const ConfigStoreModel = types
  .model("ConfigStore")
  .props({
    /** Main API URL */
    apiUrl: types.optional(
      types.string,
      process.env.EXPO_PUBLIC_API_URL || "https://api.recoverysky.app",
    ),
    /** Agent API URL */
    agentUrl: types.optional(
      types.string,
      process.env.EXPO_PUBLIC_AGENT_URL || "https://agent.recoverysky.app",
    ),
    /** Social (Replyke-hosted community site) URL */
    socialUrl: types.optional(
      types.string,
      process.env.EXPO_PUBLIC_SOCIAL_URL || "https://social.recoverysky.app",
    ),
    /** Anonymous auth API key */
    authKey: types.optional(types.string, process.env.EXPO_PUBLIC_AUTH_KEY || ""),
    /** RevenueCat test API key */
    revenueCatTestKey: types.optional(
      types.string,
      process.env.EXPO_PUBLIC_REVENUE_CAT_API_TEST_KEY || "",
    ),
    /** RevenueCat Apple API key */
    revenueCatAppleKey: types.optional(
      types.string,
      process.env.EXPO_PUBLIC_REVENUE_CAT_API_APPLE_KEY || "",
    ),
    /** RevenueCat Google API key */
    revenueCatGoogleKey: types.optional(
      types.string,
      process.env.EXPO_PUBLIC_REVENUE_CAT_API_GOOGLE_KEY || "",
    ),
    /** OTLP collector API key */
    otlpApiKey: types.optional(types.string, process.env.EXPO_PUBLIC_OTLP_API_KEY || ""),
    /** Umami analytics URL */
    umamiUrl: types.optional(types.string, process.env.EXPO_PUBLIC_UMAMI_URL || ""),
    /** Umami website ID */
    umamiWebsiteId: types.optional(
      types.string,
      process.env.EXPO_PUBLIC_UMAMI_WEBSITE_ID || "",
    ),
    /** Umami X-API-Key */
    umamiApiKey: types.optional(types.string, process.env.EXPO_PUBLIC_UMAMI_X_API_KEY || ""),
    /** Whether app review prompts are enabled */
    reviewEnabled: types.optional(
      types.boolean,
      process.env.EXPO_PUBLIC_REVIEW_ENABLED === "true",
    ),
    /** Server-controlled maintenance mode */
    maintenanceMode: types.optional(types.boolean, false),
    /** Custom maintenance message from server */
    maintenanceMessage: types.optional(types.string, ""),
    /** ISO timestamp for estimated maintenance end */
    maintenanceUntil: types.optional(types.string, ""),
    /**
     * Cold-start outage: the very first /config fetch failed and we have no
     * cached data to render. The AppNavigator routes to MaintenanceScreen
     * only when this is true. Runtime maintenance (server flag flips, or
     * polling failure after retries) flips `maintenanceMode` instead, which
     * shows the non-blocking banner.
     */
    outageMode: types.optional(types.boolean, false),
    /** Latest native app version available in the App Store / Play Store */
    latestVersion: types.optional(types.string, ""),
    /**
     * MapTiler style URLs for the In-Person map view, light + dark. Full URLs
     * with the API key embedded — served by /config so the key is never baked
     * into the binary and can be rotated (or the provider swapped) without a
     * release. EMPTY IS THE KILL SWITCH: shouldShowMapToggle() hides the map
     * toggle unless both are non-empty, so an old server or a deliberate
     * server-side clear degrades to the list-only segment. No env fallback on
     * purpose — there is no safe client-side default for a keyed URL.
     * Spec: docs/superpowers/specs/2026-08-07-in-person-map-view-design.md
     */
    mapStyleUrlLight: types.optional(types.string, ""),
    mapStyleUrlDark: types.optional(types.string, ""),
    /**
     * Radius in meters within which a user counts as present at an in-person
     * meeting. Server-tunable so the threshold can be corrected without
     * shipping a build — see docs/superpowers/specs/2026-08-05-gps-in-person-
     * attendance-design.md for why 150 m.
     *
     * Not persisted to MMKV (no ConfigStore field is). The hardcoded default
     * therefore applies until /config resolves, which is harmless: it IS the
     * intended value, so a user who taps "I'm Here" during a cold start is
     * checked against exactly the right radius.
     */
    presenceRadiusM: types.optional(types.number, DEFAULT_PRESENCE_RADIUS_M),
    /**
     * Presence radius used by `__DEV__` builds only, from the server's
     * `DEV_PRESENCE_RADIUS_M`. Read through the `effectivePresenceRadiusM`
     * view — never directly, or a production build will use it.
     *
     * A simulator reports a fixed location (Apple HQ unless Xcode is told
     * otherwise) that is never within the real radius of a real venue, so
     * without this every "I'm Here" tap fails out-of-range and nothing past
     * the GPS gate is reachable locally. Kept as its own field rather than
     * overwriting `presenceRadiusM` so the store stays an honest record of
     * what the server actually sent for production.
     */
    devPresenceRadiusM: types.optional(types.number, DEV_PRESENCE_RADIUS_M),
    /** Whether config has been fetched from server */
    isLoaded: types.optional(types.boolean, false),
    /** Whether config fetch is in progress */
    isLoading: types.optional(types.boolean, false),
  })
  .views((store) => ({
    /** Whether we have valid config (either from server or defaults) */
    get hasConfig() {
      return !!store.apiUrl && !!store.agentUrl
    },
    /** RevenueCat API key — test key in __DEV__, platform key in production */
    get revenueCatApiKey(): string {
      if (__DEV__) return store.revenueCatTestKey
      if (Platform.OS === "ios") return store.revenueCatAppleKey
      if (Platform.OS === "android") return store.revenueCatGoogleKey
      return store.revenueCatTestKey
    },
    /**
     * The presence radius actually enforced — the wide dev value in `__DEV__`
     * builds, the real server/default value everywhere else. `__DEV__` is
     * false in TestFlight and store builds, so no shipped binary can widen the
     * gate. This is the ONLY thing `usePresenceCheck` should read.
     */
    get effectivePresenceRadiusM(): number {
      return __DEV__ ? store.devPresenceRadiusM : store.presenceRadiusM
    },
  }))
  .actions((store) => ({
    /**
     * Fetch config from server
     */
    fetchConfig: flow(function* fetchConfig() {
      if (store.isLoading) return

      store.isLoading = true
      log.info("Fetching config from server")

      const MAX_RETRIES = 3
      const RETRY_DELAYS = [2000, 4000, 8000]

      try {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const result = yield api.getConfig()

            if (result.kind === "ok") {
              const { config } = result
              if (config.AGENT_URL) store.agentUrl = config.AGENT_URL
              if (config.SOCIAL_URL) store.socialUrl = config.SOCIAL_URL
              if (config.REVENUE_CAT_API_TEST_KEY)
                store.revenueCatTestKey = config.REVENUE_CAT_API_TEST_KEY
              if (config.REVENUE_CAT_API_APPLE_KEY)
                store.revenueCatAppleKey = config.REVENUE_CAT_API_APPLE_KEY
              if (config.REVENUE_CAT_API_GOOGLE_KEY)
                store.revenueCatGoogleKey = config.REVENUE_CAT_API_GOOGLE_KEY
              if (config.OTLP_API_KEY) store.otlpApiKey = config.OTLP_API_KEY
              if (config.UMAMI_URL) store.umamiUrl = config.UMAMI_URL
              if (config.UMAMI_WEBSITE_ID) store.umamiWebsiteId = config.UMAMI_WEBSITE_ID
              if (config.UMAMI_X_API_KEY) store.umamiApiKey = config.UMAMI_X_API_KEY
              if (config.REVIEW_ENABLED !== undefined)
                store.reviewEnabled = config.REVIEW_ENABLED
              store.maintenanceMode = config.MAINTENANCE_MODE ?? false
              store.maintenanceMessage = config.MAINTENANCE_MESSAGE ?? ""
              store.maintenanceUntil = config.MAINTENANCE_UNTIL ?? ""
              if (config.LATEST_VERSION) store.latestVersion = config.LATEST_VERSION
              if (config.MAP_STYLE_URL_LIGHT) store.mapStyleUrlLight = config.MAP_STYLE_URL_LIGHT
              if (config.MAP_STYLE_URL_DARK) store.mapStyleUrlDark = config.MAP_STYLE_URL_DARK
              // Guarded on > 0: a server sending 0 (or a malformed value that
              // coerces to it) would make every check fail with "you are 3 m
              // away, you must be within 0 m" — an unfixable-from-the-client
              // outage of the whole feature. Falling back to the default is
              // the safe failure.
              if (config.PRESENCE_RADIUS_M && config.PRESENCE_RADIUS_M > 0)
                store.presenceRadiusM = config.PRESENCE_RADIUS_M
              // Same > 0 guard, same reason. Stored unconditionally rather
              // than behind `__DEV__` — the field is inert in production
              // because `effectivePresenceRadiusM` is what gates its use.
              if (config.DEV_PRESENCE_RADIUS_M && config.DEV_PRESENCE_RADIUS_M > 0)
                store.devPresenceRadiusM = config.DEV_PRESENCE_RADIUS_M
              // Clear any cold-start outage gate ONLY when the service
              // reports itself as healthy. While maintenance is active we
              // keep the gate up so the user-facing state (full-screen vs
              // banner) is decided at app startup and doesn't flip mid-poll.
              if (!store.maintenanceMode) {
                store.outageMode = false
              }
              store.isLoaded = true

              log.info("Config loaded from server", { attempt })
              return // success
            }

            log.warn("Config fetch failed", { attempt, kind: result.kind })
          } catch (error) {
            log.error("Config fetch error", {
              attempt,
              error: error instanceof Error ? error.message : String(error),
            })
          }

          // Wait before retrying (unless this was the last attempt)
          if (attempt < MAX_RETRIES) {
            log.info("Retrying config fetch", {
              nextAttempt: attempt + 1,
              delay: RETRY_DELAYS[attempt - 1],
            })
            yield new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]))
          }
        }

        // All retries exhausted
        if (store.isLoaded) {
          // Config was previously loaded (polling failure) — enter maintenance mode
          // so the user sees the maintenance screen instead of stale data.
          log.warn("Config poll failed after " + MAX_RETRIES + " attempts — entering maintenance mode")
          store.maintenanceMode = true
          store.maintenanceMessage = ""
          store.maintenanceUntil = ""
        } else {
          // Initial startup failure — caller (app.tsx) handles via setOutageMode()
          log.warn("Config fetch failed after " + MAX_RETRIES + " attempts, using env var defaults")
        }
      } finally {
        store.isLoading = false
      }
    }),

    /**
     * Enter cold-start outage mode. Called when all fetchConfig retries are
     * exhausted at startup with nothing cached. AppNavigator uses this — and
     * only this — to route to the full-screen MaintenanceScreen. Runtime
     * maintenance flips `maintenanceMode` instead and shows a banner.
     */
    setOutageMode() {
      store.outageMode = true
    },

    /**
     * Reset config to defaults (env vars)
     */
    reset() {
      store.apiUrl = process.env.EXPO_PUBLIC_API_URL || "https://api.recoverysky.app"
      store.agentUrl = process.env.EXPO_PUBLIC_AGENT_URL || "https://agent.recoverysky.app"
      store.socialUrl = process.env.EXPO_PUBLIC_SOCIAL_URL || "https://social.recoverysky.app"
      store.authKey = process.env.EXPO_PUBLIC_AUTH_KEY || ""
      store.revenueCatTestKey = process.env.EXPO_PUBLIC_REVENUE_CAT_API_TEST_KEY || ""
      store.revenueCatAppleKey = process.env.EXPO_PUBLIC_REVENUE_CAT_API_APPLE_KEY || ""
      store.revenueCatGoogleKey = process.env.EXPO_PUBLIC_REVENUE_CAT_API_GOOGLE_KEY || ""
      store.otlpApiKey = process.env.EXPO_PUBLIC_OTLP_API_KEY || ""
      store.umamiUrl = process.env.EXPO_PUBLIC_UMAMI_URL || ""
      store.umamiWebsiteId = process.env.EXPO_PUBLIC_UMAMI_WEBSITE_ID || ""
      store.umamiApiKey = process.env.EXPO_PUBLIC_UMAMI_X_API_KEY || ""
      store.reviewEnabled = process.env.EXPO_PUBLIC_REVIEW_ENABLED === "true"
      store.maintenanceMode = false
      store.maintenanceMessage = ""
      store.maintenanceUntil = ""
      store.mapStyleUrlLight = ""
      store.mapStyleUrlDark = ""
      store.outageMode = false
      store.isLoaded = false
    },
  }))

export interface ConfigStore extends Instance<typeof ConfigStoreModel> {}
export interface ConfigStoreSnapshot extends SnapshotOut<typeof ConfigStoreModel> {}
