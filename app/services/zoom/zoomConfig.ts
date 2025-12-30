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

  // Always log config status at startup for debugging
  console.log("=== ZOOM SDK CONFIG ===")
  console.log(`SDK Key: ${sdkKey ? `${sdkKey.slice(0, 8)}...` : "NOT SET"}`)
  console.log(`SDK Secret: ${sdkSecret ? "SET (hidden)" : "NOT SET"}`)
  console.log(`Configured: ${Boolean(sdkKey && sdkSecret)}`)
  console.log("=======================")

  if (!sdkKey || !sdkSecret) {
    log.warn("Zoom SDK keys not configured - SDK features will be unavailable")
    console.warn(
      "[ZoomConfig] ⚠️  EXPO_PUBLIC_ZOOM_SDK_KEY and/or EXPO_PUBLIC_ZOOM_SDK_SECRET not set!",
    )
    console.warn("[ZoomConfig] ⚠️  Add them to your .env file to enable native Zoom SDK")
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
