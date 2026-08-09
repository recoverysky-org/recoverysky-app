/**
 * useLocationGate — the I/O half of the In-Person location gate.
 *
 * Every decision lives in the pure, vitest-covered
 * app/utils/locationGateLogic.ts. This file only reads the OS permission
 * state, runs that decision, and performs whichever of prompt / confirm /
 * deep-link it returns. Do not re-derive the branching here.
 *
 * Never throws: OS call rejections are caught and logged, then resolved as
 * `false`. Task 7 calls this from a UI context where an unhandled rejection
 * would crash or create a stuck loading state. Discriminating rejection
 * outcomes as false gives the caller a clean path for either entry point
 * (gate passes or fails to locate permissions, both resolve to a boolean).
 *
 * Spec: docs/superpowers/specs/2026-08-08-settings-permissions-section-design.md
 */

import { useCallback } from "react"
import { Alert, Linking } from "react-native"
import * as Location from "expo-location"

import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import { decideLocationGate, toOsStatus } from "@/utils/locationGateLogic"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useLocationGate" })

export interface UseLocationGateResult {
  /**
   * Run the gate once. Resolves true if location is enabled by the time it
   * settles, false otherwise. Safe to call repeatedly — it re-reads the OS
   * state every time, which is what makes a user returning from device
   * settings pick up their new grant without a restart.
   */
  runGate: () => Promise<boolean>
}

export function useLocationGate(): UseLocationGateResult {
  const profileStore = useProfileStore()

  const runGate = useCallback(async (): Promise<boolean> => {
    try {
      // getForegroundPermissionsAsync does NOT prompt — it only reads. The
      // prompting call is requestForegroundPermissionsAsync below, reached only
      // on the "prompt-os" branch. Getting these two backwards would show the
      // system dialog on every segment visit.
      const current = await Location.getForegroundPermissionsAsync()
      const action = decideLocationGate({
        locationEnabled: profileStore.locationEnabled,
        osStatus: toOsStatus(current),
      })

      switch (action) {
        case "proceed":
          return true

        case "prompt-os": {
          const granted = await Location.requestForegroundPermissionsAsync()
          profileStore.setLocationEnabled(granted.granted)
          return granted.granted
        }

        case "confirm-in-app":
          // The OS has already said yes; only our own toggle is off. An Alert is
          // the only thing that can change anything here — a deep-link would
          // land the user on a settings screen with location already enabled.
          return new Promise<boolean>((resolve) => {
            Alert.alert(
              translate("location:gateConfirmTitle"),
              translate("location:gateConfirmMessage"),
              [
                {
                  text: translate("common:cancel"),
                  style: "cancel",
                  onPress: () => resolve(false),
                },
                {
                  text: translate("location:gateConfirmAccept"),
                  onPress: () => {
                    profileStore.setLocationEnabled(true)
                    resolve(true)
                  },
                },
              ],
              // Dismissing by tapping outside (Android) must still settle the
              // promise, or the caller's await never returns.
              { onDismiss: () => resolve(false) },
            )
          })

        case "open-settings":
          Alert.alert(
            translate("location:gateDeniedTitle"),
            translate("location:gateDeniedMessage"),
            [
              { text: translate("common:cancel"), style: "cancel" },
              {
                text: translate("location:openSettings"),
                onPress: () => {
                  Linking.openSettings().catch(() => {})
                },
              },
            ],
          )
          return false
      }
    } catch (err) {
      // OS call rejections are caught here and logged, then resolved as false.
      // Task 7 calls this from a UI context where an unhandled rejection would
      // crash or create a stuck loading state. Discriminating the error outcome
      // as false gives the caller a clean promise-based path regardless of
      // whether the gate succeeds, fails, or encounters an OS error.
      log.warn("Location gate failed", { error: String(err) })
      return false
    }
  }, [profileStore])

  return { runGate }
}
