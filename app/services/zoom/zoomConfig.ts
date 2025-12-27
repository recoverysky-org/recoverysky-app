/**
 * Zoom SDK Configuration
 *
 * SDK keys should be configured via environment variables:
 * - EXPO_PUBLIC_ZOOM_SDK_KEY
 * - EXPO_PUBLIC_ZOOM_SDK_SECRET
 */

import { logger } from "@/utils/logger"

const log = logger.child({ module: "ZoomConfig" })

/**
 * Zoom SDK configuration interface
 */
export interface ZoomSDKConfig {
  /** Zoom Meeting SDK key */
  sdkKey: string
  /** Zoom Meeting SDK secret */
  sdkSecret: string
  /** Zoom domain (default: zoom.us) */
  domain: string
  /** Enable SDK logging */
  enableLog: boolean
  /** Log file size in MB */
  logSize: number
}

/**
 * Get Zoom SDK configuration from environment variables
 */
export function getZoomConfig(): ZoomSDKConfig {
  const sdkKey = process.env.EXPO_PUBLIC_ZOOM_SDK_KEY || ""
  const sdkSecret = process.env.EXPO_PUBLIC_ZOOM_SDK_SECRET || ""

  if (!sdkKey || !sdkSecret) {
    log.warn("Zoom SDK keys not configured - SDK features will be unavailable")
  }

  return {
    sdkKey,
    sdkSecret,
    domain: "zoom.us",
    enableLog: __DEV__,
    logSize: 5,
  }
}

/**
 * Check if Zoom SDK is configured with valid credentials
 */
export function isZoomConfigured(): boolean {
  const config = getZoomConfig()
  return Boolean(config.sdkKey && config.sdkSecret)
}
