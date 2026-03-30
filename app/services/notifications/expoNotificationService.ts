/**
 * Expo Push Notification Service
 *
 * Stateless service module for expo-notifications SDK operations.
 * Registers Expo Push Tokens with the RecoverySky backend via POST /push-tokens/ (upsert).
 */

import { Alert, Linking, Platform } from "react-native"
import Constants from "expo-constants"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"

import { translate } from "@/i18n"
import { api } from "@/services/api"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ExpoNotificationService" })

let isInitialized = false

/** Cached push token, userId, and deviceId for the current session */
let cachedToken: string | null = null
let cachedUserId: string | null = null
let cachedDeviceId: string | null = null

/**
 * Get the Expo project ID from app config.
 */
function getProjectId(): string {
  return Constants.expoConfig?.extra?.eas?.projectId ?? ""
}

/**
 * Ensure we have a push token cached. Fetches one from APNs/FCM if not.
 * Returns false if the token could not be obtained.
 */
async function ensureToken(): Promise<boolean> {
  if (cachedToken) {
    log.debug("ensureToken: using cached token", { token: cachedToken.slice(0, 20) + "..." })
    return true
  }

  if (Platform.OS === "web") {
    log.debug("ensureToken: skipped on web")
    return false
  }

  if (!Device.isDevice) {
    log.debug("ensureToken: skipped on simulator")
    return false
  }

  const projectId = getProjectId()
  if (!projectId) {
    log.debug("ensureToken: no project ID available")
    return false
  }

  try {
    log.debug("ensureToken: requesting push token from APNs/FCM", { projectId: projectId.slice(0, 8) + "..." })
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    cachedToken = token
    log.info("ensureToken: push token obtained", { token: token.slice(0, 20) + "..." })
    return true
  } catch (error) {
    log.debug("ensureToken: failed to obtain push token", {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * Upsert the push token to the backend with current state.
 * All mutations (register, opt-in/out, language change) go through this single POST.
 * Fetches the token from APNs/FCM if not yet cached (e.g. permission was granted after init).
 */
async function upsertToken(overrides?: { enabled?: boolean; language?: string }): Promise<void> {
  if (!cachedUserId || !cachedDeviceId) {
    log.debug("upsertToken: skipped, missing cached identity", {
      hasUserId: !!cachedUserId,
      hasDeviceId: !!cachedDeviceId,
    })
    return
  }

  if (!(await ensureToken())) {
    log.debug("upsertToken: skipped, could not obtain token")
    return
  }

  const payload = {
    userId: cachedUserId,
    deviceId: cachedDeviceId,
    token: cachedToken!,
    platform: Platform.OS as "ios" | "android",
    ...overrides,
  }

  log.debug("upsertToken: POST /push-tokens/", {
    userId: payload.userId.slice(0, 8) + "...",
    deviceId: payload.deviceId.slice(0, 8) + "...",
    token: payload.token.slice(0, 20) + "...",
    platform: payload.platform,
    ...overrides,
  })

  const result = await api.registerPushToken(payload)

  if (result.kind === "ok") {
    log.debug("upsertToken: success")
  } else {
    log.warn("upsertToken: failed", { kind: result.kind })
  }
}

/**
 * Initialize expo-notifications.
 * Sets the notification handler for foreground display behavior.
 * Call once during app startup.
 */
export function initializeNotifications(): void {
  if (isInitialized) {
    log.warn("initializeNotifications: already initialized, skipping")
    return
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })

  isInitialized = true
  log.info("initializeNotifications: ready")
}

/**
 * Get the Expo Push Token and register it with the backend.
 * Call when user authenticates or re-authenticates.
 */
export async function registerPushToken(userId: string, deviceId: string): Promise<void> {
  log.debug("registerPushToken: called", {
    userId: userId.slice(0, 8) + "...",
    deviceId: deviceId.slice(0, 8) + "...",
  })
  cachedUserId = userId
  cachedDeviceId = deviceId

  try {
    await upsertToken()
  } catch (error) {
    log.error("registerPushToken: failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Clear cached token state on logout.
 * The backend token goes stale naturally and gets overwritten on next login.
 */
export function unregisterPushToken(): void {
  log.debug("unregisterPushToken: clearing cached state")
  cachedToken = null
  cachedUserId = null
  cachedDeviceId = null
}

/**
 * Show the native push notification permission dialog.
 * If the OS won't show the prompt (user already denied once), offers to open Settings.
 * Returns whether permission was granted.
 */
export async function requestPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  log.debug("requestPermission: current status", { status: existingStatus })

  if (existingStatus === "granted") return true

  log.debug("requestPermission: prompting user")
  const { status } = await Notifications.requestPermissionsAsync()
  log.debug("requestPermission: result", { status })

  if (status === "granted") return true

  // OS won't show the prompt again -- offer to open Settings
  log.debug("requestPermission: denied, offering Settings redirect")
  return new Promise((resolve) => {
    Alert.alert(
      translate("settingsScreen:notificationsDisabledTitle"),
      translate("settingsScreen:notificationsDisabledMessage"),
      [
        { text: translate("common:cancel"), style: "cancel", onPress: () => resolve(false) },
        {
          text: translate("settingsScreen:openSettings"),
          onPress: () => {
            Linking.openSettings()
            resolve(false)
          },
        },
      ],
    )
  })
}

/** Check current notification permission status */
export async function hasPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false
  const { status } = await Notifications.getPermissionsAsync()
  log.debug("hasPermission:", { status })
  return status === "granted"
}

/** Opt user in to push notifications — upserts token with enabled: true */
export async function optIn(): Promise<void> {
  log.debug("optIn: called")
  try {
    await upsertToken({ enabled: true })
    log.debug("optIn: complete")
  } catch (error) {
    log.error("optIn: failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Opt user out of push notifications — upserts token with enabled: false */
export async function optOut(): Promise<void> {
  log.debug("optOut: called")
  try {
    await upsertToken({ enabled: false })
    log.debug("optOut: complete")
  } catch (error) {
    log.error("optOut: failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Check if user is opted in to push notifications */
export async function getOptedIn(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync()
  log.debug("getOptedIn:", { status })
  return status === "granted"
}

/** Set user language for notification localization — upserts token with language */
export async function setLanguage(languageCode: string): Promise<void> {
  log.debug("setLanguage: called", { languageCode })
  try {
    await upsertToken({ language: languageCode })
    log.debug("setLanguage: complete")
  } catch (error) {
    log.error("setLanguage: failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Add a notification click (response) handler.
 * Normalizes the expo-notifications response shape to match the existing
 * { screen, section, segment, meetingId } data contract.
 * Returns a cleanup function to remove the listener.
 */
export function addClickHandler(
  handler: (data: {
    screen?: string
    section?: string
    segment?: string
    meetingId?: string
  }) => void,
): () => void {
  log.debug("addClickHandler: registered")
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | { screen?: string; section?: string; segment?: string; meetingId?: string }
      | undefined
    log.debug("addClickHandler: notification tapped", {
      screen: data?.screen,
      section: data?.section,
      meetingId: data?.meetingId,
    })
    if (data) {
      handler(data)
    }
  })
  return () => subscription.remove()
}
