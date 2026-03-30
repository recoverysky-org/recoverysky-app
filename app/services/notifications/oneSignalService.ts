/**
 * OneSignal Push Notification Service
 *
 * Stateless service module for OneSignal SDK operations.
 * Follows the same pattern as services/purchases/revenueCatService.ts.
 */

import { Alert, Linking, Platform } from "react-native"
import { OneSignal, LogLevel } from "react-native-onesignal"
import type { NotificationClickEvent } from "react-native-onesignal"

import { translate } from "@/i18n"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "OneSignalService" })

let isInitialized = false

/**
 * Initialize OneSignal SDK.
 * Call once after configStore.fetchConfig() resolves.
 */
export function initializeOneSignal(appId: string): void {
  if (isInitialized) {
    log.warn("OneSignal already initialized, skipping")
    return
  }

  if (!appId) {
    log.warn("No OneSignal App ID provided, skipping initialization")
    return
  }

  try {
    if (__DEV__) {
      OneSignal.Debug.setLogLevel(LogLevel.Verbose)
    }

    OneSignal.initialize(appId)
    isInitialized = true
    log.info("OneSignal initialized", { appId: appId.slice(0, 8) + "..." })
  } catch (error) {
    log.debug("OneSignal initialization failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Associate the current device with a user identity.
 * Call when auth state changes (both OAuth and anonymous users).
 */
export function loginUser(externalId: string): void {
  if (!isInitialized) return
  log.info("OneSignal login", { externalId: externalId.slice(0, 8) + "..." })
  OneSignal.login(externalId)
}

/**
 * Revert to a device-scoped anonymous user.
 */
export function logoutUser(): void {
  if (!isInitialized) return
  log.info("OneSignal logout")
  OneSignal.logout()
}

/**
 * Show the native push notification permission dialog.
 * If the OS won't show the prompt (user already denied once), offers to open Settings.
 * Returns whether permission was granted.
 */
export async function requestPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false

  if (isInitialized) {
    // Already have permission — nothing to do
    const alreadyGranted = await OneSignal.Notifications.getPermissionAsync()
    if (alreadyGranted) return true

    const canRequest = await OneSignal.Notifications.canRequestPermission()
    if (canRequest) {
      log.info("Requesting notification permission")
      const granted = await OneSignal.Notifications.requestPermission(true)
      log.info("Notification permission result", { granted })
      return granted
    }
  }

  // OneSignal not initialized or OS won't show the prompt — offer to open Settings
  log.info("Prompting user to open Settings for notification permission", { isInitialized })
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
  if (!isInitialized) return false
  return OneSignal.Notifications.getPermissionAsync()
}

/** Opt user in to push notifications (without re-prompting OS dialog) */
export function optIn(): void {
  if (!isInitialized) return
  OneSignal.User.pushSubscription.optIn()
  log.info("User opted in to push notifications")
}

/** Opt user out of push notifications */
export function optOut(): void {
  if (!isInitialized) return
  OneSignal.User.pushSubscription.optOut()
  log.info("User opted out of push notifications")
}

/** Check if user is opted in to push notifications */
export async function getOptedIn(): Promise<boolean> {
  if (!isInitialized) return false
  return OneSignal.User.pushSubscription.getOptedInAsync()
}

/** Set user language for notification localization */
export function setLanguage(languageCode: string): void {
  if (!isInitialized) return
  OneSignal.User.setLanguage(languageCode)
}

/**
 * Add a notification click handler.
 * Returns a cleanup function to remove the listener.
 */
export function addClickHandler(handler: (event: NotificationClickEvent) => void): () => void {
  OneSignal.Notifications.addEventListener("click", handler)
  return () => {
    OneSignal.Notifications.removeEventListener("click", handler)
  }
}
