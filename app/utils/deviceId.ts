/**
 * Device ID Utility
 *
 * Cross-platform unique device identifier using expo-application.
 * Used to identify users across both anonymous and authenticated states.
 */

import { Platform } from "react-native"
import * as Application from "expo-application"

import { logger } from "./logger"
import { loadString, saveString } from "./storage"

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
  log.info("getDeviceId()", { platform: Platform.OS })

  // Check cache first
  const cached = loadString(DEVICE_ID_KEY)
  if (cached) {
    log.info("Device ID loaded from cache", { deviceId: cached.slice(0, 8) + "..." })
    return cached
  }

  let deviceId: string
  let source: string

  if (Platform.OS === "ios") {
    const iosId = await Application.getIosIdForVendorAsync()
    deviceId = iosId || generateUUID()
    source = iosId ? "idForVendor" : "generated"
  } else if (Platform.OS === "android") {
    const androidId = Application.getAndroidId()
    deviceId = androidId || generateUUID()
    source = androidId ? "androidId" : "generated"
  } else {
    deviceId = generateUUID()
    source = "generated"
  }

  // Cache for future use
  saveString(DEVICE_ID_KEY, deviceId)
  log.info("Device ID created", {
    source,
    deviceId: deviceId.slice(0, 8) + "...",
  })

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

/**
 * Generate a new session ID.
 * Call this once at app launch to track logs within a single session.
 */
export function generateSessionId(): string {
  const sessionId = generateUUID()
  log.debug("Session ID generated", { sessionId: sessionId.slice(0, 8) + "..." })
  return sessionId
}
