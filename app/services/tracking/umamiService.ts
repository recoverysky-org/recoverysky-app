/**
 * Umami Analytics Tracking Service
 *
 * Stateless service module for Umami HTTP Tracking API.
 * Follows the same pattern as services/notifications/oneSignalService.ts.
 *
 * @see EVENTS.md for the full event reference
 */

import { Dimensions, Platform } from "react-native"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "UmamiService" })
const appVersion: string = require("../../../package.json").version

let isInitialized = false
let hostUrl = ""
let websiteId = ""
let apiKey = ""
let userId: string | undefined


/**
 * Initialize the Umami tracking service.
 * Call once after configStore.fetchConfig() resolves.
 */
export function initializeUmami(url: string, id: string, key: string): void {
  if (isInitialized) {
    log.warn("Umami already initialized, skipping")
    return
  }

  if (!url || !id) {
    log.warn("Missing Umami URL or website ID, skipping initialization")
    return
  }

  hostUrl = url.replace(/\/$/, "") // strip trailing slash
  websiteId = id
  apiKey = key
  isInitialized = true
  log.info("Umami initialized", { url: hostUrl, websiteId: websiteId.slice(0, 8) + "..." })
}

/**
 * Associate tracking events with a user identity.
 * Pass undefined to clear the identity.
 */
export function setUserId(id: string | undefined): void {
  userId = id
}

/**
 * Track a screen view (page view equivalent).
 * Called automatically from navigation state changes.
 */
export function trackScreenView(screenName: string): void {
  if (!isInitialized) return

  send({
    url: `/${screenName}`,
    title: screenName,
  })
}

/**
 * Track a custom event with optional data properties.
 *
 * @param name - Event name (max 50 chars). See EVENTS.md for the registry.
 * @param data - Optional key-value data attached to the event.
 */
export function trackEvent(name: string, data?: Record<string, string | number | boolean>): void {
  if (!isInitialized) return

  send({
    url: `/${currentScreen}`,
    name,
    data,
  })
}

// -- Internal --

/** Tracks the current screen for context on custom events */
let currentScreen = "Unknown"

/** Update current screen (called by trackScreenView) */
function updateCurrentScreen(screenName: string) {
  currentScreen = screenName
}

function getLanguage(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { i18n } = require("@/i18n")
    return i18n.language || "en"
  } catch {
    return "en"
  }
}

function getScreenDimensions(): string {
  const { width, height } = Dimensions.get("window")
  return `${Math.round(width)}x${Math.round(height)}`
}

interface UmamiPayload {
  url: string
  title?: string
  name?: string
  data?: Record<string, string | number | boolean>
}

function send(payload: UmamiPayload): void {
  // Update current screen tracker on screen views
  if (!payload.name && payload.title) {
    updateCurrentScreen(payload.title)
  }

  const body = JSON.stringify({
    type: "event",
    payload: {
      website: websiteId,
      hostname: "recoverysky.app",
      url: payload.url,
      title: payload.title,
      name: payload.name,
      data: { platform: Platform.OS, appVersion, ...payload.data },
      language: getLanguage(),
      screen: getScreenDimensions(),
      id: userId,
    },
  })

  const eventName = payload.name ?? payload.title ?? payload.url

  // Fire-and-forget — analytics should never crash the app
  fetch(`${hostUrl}/api/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey && { "X-API-Key": apiKey }),
    },
    body,
  })
    .then((r) => {
      if (r.ok) {
        log.info("Umami event sent", { event: eventName, status: r.status })
      } else {
        log.warn("Umami send failed", { event: eventName, status: r.status })
      }
    })
    .catch(() => {
      // Silently drop network failures
    })
}
