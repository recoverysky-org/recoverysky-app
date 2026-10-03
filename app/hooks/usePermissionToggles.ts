import { useCallback } from "react"
import * as Location from "expo-location"

import { showLocationDeniedAlert } from "@/hooks/useLocationGate"
import { useAuthenticationStore, useProfileStore } from "@/models"
import {
  loginNotificationUser,
  optInNotifications,
  optOutNotifications,
  requestNotificationPermission,
} from "@/services/notifications"
import { trackEvent } from "@/services/tracking"
import { decideLocationGate, toOsStatus } from "@/utils/locationGateLogic"
import { logger } from "@/utils/logger"

/**
 * The Push Notifications and Location switch handlers.
 *
 * MOVED 2026-10-03 out of SettingsScreen, unchanged, so the onboarding
 * "Customize Your App" step can offer the same two switches. Both handlers
 * carry request-then-revert rules that were each learned the hard way (see
 * the comments below); a second copy in onboarding would have drifted.
 *
 * The premium gate on push is NOT here. It is the caller's: Settings and
 * onboarding each decide what a non-premium tap does.
 */
export function usePermissionToggles() {
  const profileStore = useProfileStore()
  const authStore = useAuthenticationStore()

  const handleNotificationsToggle = useCallback(
    async (value: boolean) => {
      profileStore.setNotificationsEnabled(value)
      trackEvent("notification_toggle", { enabled: value })
      if (value) {
        const granted = await requestNotificationPermission()
        if (!granted) {
          profileStore.setNotificationsEnabled(false)
          return
        }
        // Ensure push token is registered with backend (fetches token if needed)
        if (authStore.userIdentifier && authStore.deviceId) {
          loginNotificationUser(authStore.userIdentifier, authStore.deviceId).catch(() => {})
        }
        optInNotifications()
      } else {
        optOutNotifications()
      }
    },
    [profileStore, authStore],
  )

  /**
   * Escalate only as far as the OS actually requires. Turning the toggle on
   * when permission is already granted must NOT re-prompt or deep-link —
   * there is nothing to ask, and sending the user to device settings would
   * land them on a screen with nothing to change.
   *
   * Same request-then-revert shape as handleNotificationsToggle above: if the
   * OS refuses, the switch goes back to off rather than lying.
   */
  const handleLocationToggle = useCallback(
    async (value: boolean) => {
      trackEvent("location_toggle", { enabled: value })

      if (!value) {
        profileStore.setLocationEnabled(false)
        return
      }

      // ADDED 2026-08-09 (whole-branch review, I2): both `Location.*` calls
      // below are unguarded, and this handler is passed to
      // `PermissionsSection` as `(value: boolean) => void` — nothing in that
      // chain attaches a `.catch`, so a rejection here used to become an
      // unhandled promise rejection and a bogus Sentry/Loki error. Same
      // invariant `useLocationGate.runGate` already holds (see its own
      // try/catch) and `InPersonScreen.handleBannerPress` guards for its
      // `Linking.openSettings()` call — the Settings copy of this toggle had
      // just diverged. On failure, leave the switch truthful: never call
      // `setLocationEnabled(true)` off the back of an OS call that didn't
      // actually resolve granted.
      try {
        const current = await Location.getForegroundPermissionsAsync()
        const action = decideLocationGate({
          locationEnabled: false,
          osStatus: toOsStatus(current),
        })

        if (action === "confirm-in-app") {
          // OS already granted — the boolean is the only thing standing in the
          // way, and the user just asked for it by flipping the switch.
          profileStore.setLocationEnabled(true)
          return
        }

        if (action === "open-settings") {
          showLocationDeniedAlert()
          return
        }

        // action === "prompt-os"
        const granted = await Location.requestForegroundPermissionsAsync()
        profileStore.setLocationEnabled(granted.granted)
      } catch (err) {
        logger.warn("Location toggle failed", { error: String(err) })
      }
    },
    [profileStore],
  )

  return { handleNotificationsToggle, handleLocationToggle }
}
