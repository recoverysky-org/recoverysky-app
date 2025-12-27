/**
 * Device ID Utility
 *
 * Cross-platform unique device identifier using expo-application.
 * Used to identify users across both anonymous and authenticated states.
 */

import * as Application from "expo-application"
import { Platform } from "react-native"

import { loadString, saveString } from "./storage"
import { logger } from "./logger"

const log = logger.child({ module: "deviceId" })

const DEVICE_ID_KEY = "device_id_v1"

/**
 * Get or generate a unique device identifier.
 *
 * - iOS: Uses idForVendor (unique per vendor + device)
 * - Android: Uses Android ID (unique per device)
 * - Web: Generates and persists a UUID
 *
 * The ID is cached in MMKV storage for consistency.
 */
export async function getDeviceId(): Promise<string> {
  // Check cache first
  const cached = loadString(DEVICE_ID_KEY)
  if (cached) {
    log.debug("Device ID loaded from cache", { deviceId: cached.slice(0, 8) + "..." })
    return cached
  }

  let deviceId: string

  if (Platform.OS === "ios") {
    const iosId = await Application.getIosIdForVendorAsync()
    deviceId = iosId || generateUUID()
    log.info("iOS device ID obtained", { source: iosId ? "idForVendor" : "generated" })
  } else if (Platform.OS === "android") {
    const androidId = Application.getAndroidId()
    deviceId = androidId || generateUUID()
    log.info("Android device ID obtained", { source: androidId ? "androidId" : "generated" })
  } else {
    // Web: generate and persist UUID
    deviceId = generateUUID()
    log.info("Web device ID generated")
  }

  // Cache for future use
  saveString(DEVICE_ID_KEY, deviceId)
  log.debug("Device ID cached", { deviceId: deviceId.slice(0, 8) + "..." })

  return deviceId
}

/**
 * Generate a UUID v4 string.
 * Uses crypto.randomUUID when available, otherwise falls back to manual generation.
 */
function generateUUID(): string {
  // Modern environments have crypto.randomUUID
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // Fallback for older environments
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
