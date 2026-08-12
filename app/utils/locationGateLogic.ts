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
 * Should the in-app Location toggle be forced off to match the OS?
 *
 * ADDED 2026-08-12: `profileStore.locationEnabled` could outlive the grant it
 * was written from. Six sites write it `true` (both `useLocationGate` confirm
 * branches, both `SettingsScreen` toggle branches, and `InPersonPopup`'s
 * tap-is-consent self-heal) against one that wrote it `false` — app.tsx's
 * resume sync, which only fires on `background → active`. An "Allow Once" /
 * "Only this time" grant usually dies with the *process*, which produces no
 * such transition, so Settings showed Location ON for a permission we no
 * longer held. Callers now share this predicate rather than each re-deriving
 * the comparison: the bug being fixed IS a reconciliation that existed on one
 * path and not another, and two hand-written copies invite it straight back.
 *
 * ONE-DIRECTIONAL BY DESIGN. True only when we claim a grant the OS does not
 * give us. The false→true direction is deliberately not expressible here: an
 * OS grant is only half the consent, and answering the other half on the
 * user's behalf is exactly what `decideLocationGate`'s "confirm-in-app" branch
 * exists to avoid. Do not add a `shouldGrant` twin.
 */
export function shouldRevokeLocationFlag(input: {
  osGranted: boolean
  locationEnabled: boolean
}): boolean {
  return !input.osGranted && input.locationEnabled
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
