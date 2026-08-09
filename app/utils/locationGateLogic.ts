/**
 * locationGateLogic — pure decisions for the In-Person location gate.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it (vitest
 * has no path-alias resolution in this repo — see CLAUDE.md "Test Runner
 * Split"). The I/O half — reading OS status, showing the dialogs, opening
 * device settings — lives in `@/hooks/useLocationGate`.
 *
 * See docs/superpowers/specs/2026-08-08-settings-permissions-section-design.md.
 */

/**
 * The OS permission state, reduced to the three cases that lead to different
 * actions. Deliberately NOT expo-location's `PermissionStatus` enum: importing
 * it would make this module unimportable by vitest, and the shape below is
 * what the rest of the app already reasons about.
 */
export type LocationOsStatus = "granted" | "denied" | "undetermined"

/**
 * What the caller should do next.
 *
 * - `proceed` — location is available and wanted; use it.
 * - `prompt-os` — the system dialog can still be shown; show it.
 * - `confirm-in-app` — the OS already said yes and only our own toggle is off,
 *   so there is nothing for the OS to ask. Our dialog is the only one that can
 *   change anything here.
 * - `open-settings` — the OS said no and will not ask again. Only device
 *   settings can undo it.
 */
export type LocationGateAction = "proceed" | "prompt-os" | "confirm-in-app" | "open-settings"

/**
 * Reduce an expo-location permission response to `LocationOsStatus`.
 *
 * Derived from `granted` + `canAskAgain` rather than read off `status`,
 * because those two fields are what `useNearbySchedules` and
 * `usePresenceCheck` already branch on — one shared notion of "denied" beats
 * two that can drift.
 */
export function toOsStatus(perm: { granted: boolean; canAskAgain: boolean }): LocationOsStatus {
  if (perm.granted) return "granted"
  return perm.canAskAgain ? "undetermined" : "denied"
}

/**
 * Decide what opening the In-Person segment should do.
 *
 * The `locationEnabled: false, osStatus: "granted"` case is the load-bearing
 * one: it covers BOTH the user who turned the toggle off in Settings and the
 * user returning from device settings having just enabled it, without needing
 * to know which they are. Sending either to device settings would land them on
 * a screen where location is already on and nothing needs changing.
 */
export function decideLocationGate(input: {
  locationEnabled: boolean
  osStatus: LocationOsStatus
}): LocationGateAction {
  if (input.osStatus === "denied") return "open-settings"
  if (input.osStatus === "undetermined") return "prompt-os"
  // osStatus === "granted" from here.
  return input.locationEnabled ? "proceed" : "confirm-in-app"
}
