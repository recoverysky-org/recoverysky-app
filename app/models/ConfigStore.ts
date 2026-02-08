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
  }))
  .actions((store) => ({
    /**
     * Fetch config from server
     */
    fetchConfig: flow(function* fetchConfig() {
      if (store.isLoading) return

      store.isLoading = true
      log.debug("Fetching config from server")

      try {
        const result = yield api.getConfig()

        if (result.kind === "ok") {
          const { config } = result
          // Only override values the server provides (API_URL, AUTH_KEY, ZOOM_SDK_KEY removed from server)
          if (config.AGENT_URL) store.agentUrl = config.AGENT_URL
          if (config.ZOOM_SDK_SECRET) store.zoomSdkSecret = config.ZOOM_SDK_SECRET
          store.isLoaded = true

          log.info("Config loaded from server")
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
      store.isLoaded = false
    },
  }))

export interface ConfigStore extends Instance<typeof ConfigStoreModel> {}
export interface ConfigStoreSnapshot extends SnapshotOut<typeof ConfigStoreModel> {}
