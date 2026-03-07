/**
 * Zoom SDK Configuration
 *
 * SDK keys are provided by ConfigStore (fetched from server).
 * Falls back to empty strings if not configured.
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
 * Get Zoom SDK configuration
 *
 * @param sdkKey - SDK key from ConfigStore
 * @param sdkSecret - SDK secret from ConfigStore
 */
export function getZoomConfig(sdkKey: string = "", sdkSecret: string = ""): ZoomSDKConfig {
  log.info("Zoom config", {
    sdkKey: sdkKey ? `${sdkKey.slice(0, 8)}...` : "NOT SET",
    sdkSecret: sdkSecret ? "SET" : "NOT SET",
  })

  if (!sdkKey || !sdkSecret) {
    log.warn("Zoom SDK keys not configured - SDK features will be unavailable")
  }

  return {
    sdkKey,
    sdkSecret,
    domain: "zoom.us",
    enableLog: true,
    logSize: 5,
  }
}

/**
 * Check if Zoom SDK is configured with valid credentials
 */
export function isZoomConfigured(sdkKey: string = "", sdkSecret: string = ""): boolean {
  return Boolean(sdkKey && sdkSecret)
}
