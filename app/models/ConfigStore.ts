import { Platform } from "react-native"
import { flow, Instance, SnapshotOut, types } from "mobx-state-tree"

import { api } from "@/services/api"
import { logger } from "@/utils/logger"

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
    /** Zoom SDK key */
    zoomSdkKey: types.optional(types.string, process.env.EXPO_PUBLIC_ZOOM_SDK_KEY || ""),
    /** Zoom SDK secret */
    zoomSdkSecret: types.optional(types.string, process.env.EXPO_PUBLIC_ZOOM_SDK_SECRET || ""),
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
    /** ZAK service API key */
    zakApiKey: types.optional(types.string, process.env.EXPO_PUBLIC_ZAK_API_KEY || ""),
    /** OneSignal app ID */
    oneSignalAppId: types.optional(
      types.string,
      process.env.EXPO_PUBLIC_ONE_SIGNAL_APP_ID || "",
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
              if (config.ZOOM_SDK_KEY) store.zoomSdkKey = config.ZOOM_SDK_KEY
              if (config.ZOOM_SDK_SECRET) store.zoomSdkSecret = config.ZOOM_SDK_SECRET
              if (config.REVENUE_CAT_API_TEST_KEY)
                store.revenueCatTestKey = config.REVENUE_CAT_API_TEST_KEY
              if (config.REVENUE_CAT_API_APPLE_KEY)
                store.revenueCatAppleKey = config.REVENUE_CAT_API_APPLE_KEY
              if (config.REVENUE_CAT_API_GOOGLE_KEY)
                store.revenueCatGoogleKey = config.REVENUE_CAT_API_GOOGLE_KEY
              if (config.ZAK_API_KEY) store.zakApiKey = config.ZAK_API_KEY
              if (config.ONE_SIGNAL_APP_ID) store.oneSignalAppId = config.ONE_SIGNAL_APP_ID
              if (config.OTLP_API_KEY) store.otlpApiKey = config.OTLP_API_KEY
              if (config.UMAMI_URL) store.umamiUrl = config.UMAMI_URL
              if (config.UMAMI_WEBSITE_ID) store.umamiWebsiteId = config.UMAMI_WEBSITE_ID
              if (config.UMAMI_X_API_KEY) store.umamiApiKey = config.UMAMI_X_API_KEY
              store.isLoaded = true

              const zoomKeyPreview = store.zoomSdkKey
                ? store.zoomSdkKey.slice(0, 8) + "..."
                : "EMPTY"
              log.info("Config loaded from server", {
                attempt,
                hasZoomKey: !!store.zoomSdkKey,
                hasZoomSecret: !!store.zoomSdkSecret,
                zoomKeyPreview,
              })
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
        throw new Error("Failed to load configuration after " + MAX_RETRIES + " attempts")
      } finally {
        store.isLoading = false
      }
    }),

    /**
     * Reset config to defaults (env vars)
     */
    reset() {
      store.apiUrl = process.env.EXPO_PUBLIC_API_URL || "https://api.recoverysky.app"
      store.agentUrl = process.env.EXPO_PUBLIC_AGENT_URL || "https://agent.recoverysky.app"
      store.zoomSdkKey = process.env.EXPO_PUBLIC_ZOOM_SDK_KEY || ""
      store.zoomSdkSecret = process.env.EXPO_PUBLIC_ZOOM_SDK_SECRET || ""
      store.authKey = process.env.EXPO_PUBLIC_AUTH_KEY || ""
      store.revenueCatTestKey = process.env.EXPO_PUBLIC_REVENUE_CAT_API_TEST_KEY || ""
      store.revenueCatAppleKey = process.env.EXPO_PUBLIC_REVENUE_CAT_API_APPLE_KEY || ""
      store.revenueCatGoogleKey = process.env.EXPO_PUBLIC_REVENUE_CAT_API_GOOGLE_KEY || ""
      store.zakApiKey = process.env.EXPO_PUBLIC_ZAK_API_KEY || ""
      store.oneSignalAppId = process.env.EXPO_PUBLIC_ONE_SIGNAL_APP_ID || ""
      store.otlpApiKey = process.env.EXPO_PUBLIC_OTLP_API_KEY || ""
      store.umamiUrl = process.env.EXPO_PUBLIC_UMAMI_URL || ""
      store.umamiWebsiteId = process.env.EXPO_PUBLIC_UMAMI_WEBSITE_ID || ""
      store.umamiApiKey = process.env.EXPO_PUBLIC_UMAMI_X_API_KEY || ""
      store.isLoaded = false
    },
  }))

export interface ConfigStore extends Instance<typeof ConfigStoreModel> {}
export interface ConfigStoreSnapshot extends SnapshotOut<typeof ConfigStoreModel> {}
