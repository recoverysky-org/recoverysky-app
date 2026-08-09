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

import { useCallback, useRef } from "react"
import { Alert, Linking, Platform } from "react-native"
import * as Location from "expo-location"

import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import { decideLocationGate, toOsStatus } from "@/utils/locationGateLogic"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useLocationGate" })

/**
 * Show the location-denied alert when the OS has explicitly denied permission.
 * Used by both the gate (when the user needs to enable location) and the
 * Settings toggle (when the user tried to enable location). Both call sites
 * need the same "permission denied, tap to open settings" dialog.
 */
export function showLocationDeniedAlert(): void {
  // ADDED 2026-08-09 (whole-branch review, I1): react-native-web's `Alert` is
  // a no-op (`node_modules/react-native-web/dist/exports/Alert/index.js` is
  // literally `class Alert { static alert() {} }`), so on web this rendered
  // nothing at all — no dialog, no route out, an empty tab with a control
  // that silently did nothing. Web also has no device-settings screen to
  // deep-link to (there is no `Linking.openSettings()` equivalent), so unlike
  // the confirm branch below there's no substitute *interaction* to offer —
  // the honest thing left to do is at least tell the user what's wrong via
  // `window.alert`, matching the copy the native dialog would have shown.
  // Native behavior below is unchanged.
  if (Platform.OS === "web") {
    window.alert(
      `${translate("location:gateDeniedTitle")}\n\n${translate("location:gateDeniedMessage")}`,
    )
    return
  }

  Alert.alert(translate("location:gateDeniedTitle"), translate("location:gateDeniedMessage"), [
    { text: translate("common:cancel"), style: "cancel" },
    {
      text: translate("location:openSettings"),
      onPress: () => {
        Linking.openSettings().catch(() => {})
      },
    },
  ])
}

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

  /**
   * The in-flight gate run, or null. ADDED 2026-08-08 (TODO M6, promoted from
   * deferred by the AppState resume work): a single foreground resume could
   * trigger this hook from two directions at once inside InPersonScreen — the
   * resume listener calling it directly, and app.tsx's revoke sync writing
   * `locationEnabled = false`, which re-fired the segment's `visible` effect
   * through its dependency array. Both land on the same hook instance, and
   * each `Alert.alert` is an independent native dialog, so without this the
   * user got two stacked prompts for one trip to device Settings.
   *
   * CHANGED 2026-08-09: that second path is gone — the `visible` effect no
   * longer re-fires on `locationEnabled` (it was popping a dialog at users who
   * switched the toggle off in Settings). The guard stays: InPersonScreen still
   * has two callers on one hook instance, `handleBannerPress` is a third, and
   * a user double-tapping the banner is enough to stack dialogs. Do not remove
   * it on the assumption there is only one caller.
   *
   * Sharing the promise rather than dropping the second call is deliberate:
   * every caller still gets a truthful answer about whether location ended up
   * enabled, which `void`-ing the extra call would not provide if a caller
   * later starts awaiting it.
   */
  const inFlightRef = useRef<Promise<boolean> | null>(null)

  const executeGate = useCallback(async (): Promise<boolean> => {
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
          //
          // The `await` is load-bearing: without it, if Alert.alert throws, the
          // rejection bypasses the outer try/catch and propagates to the caller,
          // re-introducing the defect round 1 fixed. Only `return await p` routes
          // p's rejection to the local catch block.
          //
          // ADDED 2026-08-09 (whole-branch review, I1): react-native-web's
          // `Alert` is a no-op (see `showLocationDeniedAlert` above), so the
          // Promise below never settled on web — the try/catch couldn't help,
          // because a no-op isn't a throw, it's just silence forever.
          // `window.confirm` is web's synchronous equivalent of a two-button
          // Alert: it blocks the calling code until the user answers, so
          // there's no Promise left dangling. Native behavior below this
          // branch is unchanged.
          if (Platform.OS === "web") {
            const confirmed = window.confirm(
              `${translate("location:gateConfirmTitle")}\n\n${translate("location:gateConfirmMessage")}`,
            )
            if (confirmed) profileStore.setLocationEnabled(true)
            return confirmed
          }

          return await new Promise<boolean>((resolve) => {
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
          showLocationDeniedAlert()
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

  const runGate = useCallback((): Promise<boolean> => {
    // `executeGate` never rejects (it catches everything), so `.finally` here
    // is only clearing the slot — there is no rejection to re-surface. Clearing
    // it in `finally` rather than `then` still matters: if that invariant is
    // ever broken, a rejected run must not wedge the gate closed forever.
    if (inFlightRef.current) return inFlightRef.current
    const run = executeGate().finally(() => {
      inFlightRef.current = null
    })
    inFlightRef.current = run
    return run
  }, [executeGate])

  return { runGate }
}
