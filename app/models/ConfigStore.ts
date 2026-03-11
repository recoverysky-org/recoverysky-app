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
    /** RevenueCat test API key (from server /config) */
    revenueCatTestKey: types.optional(types.string, ""),
    /** RevenueCat Apple API key (from server /config) */
    revenueCatAppleKey: types.optional(types.string, ""),
    /** RevenueCat Google API key (from server /config) */
    revenueCatGoogleKey: types.optional(types.string, ""),
    /** ZAK service API key (from server /config) */
    zakApiKey: types.optional(types.string, ""),
    /** OTLP collector API key (from server /config) */
    otlpApiKey: types.optional(types.string, ""),
    /** OneSignal App ID (from server /config) */
    oneSignalAppId: types.optional(types.string, ""),
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
          if (config.OTLP_API_KEY) store.otlpApiKey = config.OTLP_API_KEY
          if (config.ONE_SIGNAL_APP_ID) store.oneSignalAppId = config.ONE_SIGNAL_APP_ID
          store.isLoaded = true

          log.info("Config loaded from server", {
            hasZoomKey: !!store.zoomSdkKey,
            hasZoomSecret: !!store.zoomSdkSecret,
            zoomKeyPreview: store.zoomSdkKey ? store.zoomSdkKey.slice(0, 8) + "..." : "EMPTY",
          })
        } else {
          log.warn("Failed to fetch config, using defaults", { kind: result.kind })
        }
      } catch (error) {
        log.error("Config fetch error", {
          error: error instanceof Error ? error.message : String(error),
        })
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
      store.revenueCatTestKey = ""
      store.revenueCatAppleKey = ""
      store.revenueCatGoogleKey = ""
      store.zakApiKey = ""
      store.otlpApiKey = ""
      store.oneSignalAppId = ""
      store.isLoaded = false
    },
  }))

export interface ConfigStore extends Instance<typeof ConfigStoreModel> {}
export interface ConfigStoreSnapshot extends SnapshotOut<typeof ConfigStoreModel> {}
