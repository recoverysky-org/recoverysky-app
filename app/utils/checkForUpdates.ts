/**
 * Two-step update checker:
 * 1. Native version check — if behind, prompt user to visit the store
 * 2. OTA update check — if native is current, check for expo-updates patches
 */

import { Alert, Linking } from "react-native"
import * as Updates from "expo-updates"

import { translate } from "@/i18n"
import { logger } from "@/utils/logger"
import { reloadApp } from "@/utils/reloadApp"

const log = logger.child({ module: "checkForUpdates" })

const STORE_URL = "https://recoverysky.app/app#download"

/** Local X.Y.Z from package.json — the OTA counter (`update`) is never compared. */
const LOCAL_VERSION: string = require("../../package.json").version

/**
 * Module-level lock that prevents stacked update prompts. Any caller (cold
 * start, foreground re-check, manual Settings tap) that arrives while a
 * prompt Alert is still on screen short-circuits and returns false. The
 * flag flips off when the user dismisses the Alert (or in `finally` if the
 * pre-prompt async work threw).
 * CHANGED 2026-11-04: the Daily Dash client's 426 `update_required` refusal
 * (My Day tab) is a caller too, through `promptStoreUpdate()` below, so a
 * refusal and the cold-start check never stack two store prompts.
 */
let promptInFlight = false

/**
 * Strip any `-Y` OTA-counter suffix so only the native `X.Y.Z` portion is
 * compared. The store prompt is about native upgrades only; OTA delivery is
 * handled separately by `Updates.checkForUpdateAsync()` below. Defensive on
 * both sides even though today the server sends bare `X.Y.Z` — if either
 * source ever drifts, NaN comparisons would silently skip the prompt.
 */
function stripOtaSuffix(v: string): string {
  const dash = v.indexOf("-")
  return dash === -1 ? v : v.slice(0, dash)
}

/** Returns true if current < latest (X.Y.Z only, OTA counter ignored). */
function isVersionBehind(current: string, latest: string): boolean {
  const c = stripOtaSuffix(current).split(".").map(Number)
  const l = stripOtaSuffix(latest).split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    if ((c[i] ?? 0) < (l[i] ?? 0)) return true
    if ((c[i] ?? 0) > (l[i] ?? 0)) return false
  }
  return false
}

/**
 * Shows the "update from the store" prompt. Returns false, showing nothing,
 * when another update prompt is already on screen; true when this call showed
 * it. `onPress` runs after the store page is opened.
 *
 * CHANGED 2026-11-04: extracted from `checkForUpdates()` as a named export so
 * the Daily Dash client's 426 `update_required` refusal (My Day tab,
 * `services/dailyDash/dailyDashSession.ts`) reuses the same prompt and the same
 * `promptInFlight` lock instead of growing a second one.
 */
export function promptStoreUpdate(onPress?: () => void): boolean {
  if (promptInFlight) {
    log.debug("Store prompt skipped — prompt already in flight")
    return false
  }

  // CHANGED 2026-09-19 (RS-035): the Cancel button is gone. A build that is
  // behind the store is also cut off from every OTA (runtimeVersion tracks
  // the native version), so "later" meant "never": 4.8.0-x alone showed this
  // prompt in ~300 sessions a week and dismissed it every time, while its
  // users kept hitting defects fixed months earlier. The one remaining button
  // opens the store page and the app then CONTINUES RUNNING — nothing here
  // blocks, quits, or loops. The user can come back without updating and use
  // the app; the prompt simply returns on the next cold start or long
  // foreground, exactly as before. Installing from the store is what restarts
  // the app, not us. `cancelable: false` closes the Android back-button and
  // tap-outside dismissals so the button is the only way through.
  promptInFlight = true
  Alert.alert(
    translate("common:storeUpdateTitle"),
    translate("common:storeUpdateMessage"),
    [
      {
        text: translate("common:storeUpdateButton"),
        onPress: () => {
          promptInFlight = false
          Linking.openURL(STORE_URL)
          onPress?.()
        },
      },
    ],
    { cancelable: false },
  )
  return true
}

/**
 * Check for updates in two steps:
 * 1. If native version < latestVersion → prompt to open store
 * 2. Otherwise → check for OTA update via expo-updates
 *
 * @param latestVersion - The latest native version from server config
 * @returns true if an update was found (either type)
 */
export async function checkForUpdates(latestVersion: string): Promise<boolean> {
  if (promptInFlight) {
    log.debug("Update check skipped — prompt already in flight")
    return false
  }

  const local = LOCAL_VERSION

  // Step 1: Native version check — the prompt itself (and why it has a single
  // button) lives in `promptStoreUpdate()` above.
  if (latestVersion && isVersionBehind(local, latestVersion)) {
    log.info("Local version behind", { local, latest: latestVersion })
    return new Promise((resolve) => {
      // The early return above means the lock is free, so this always shows.
      // Resolving false if it ever didn't keeps the promise from hanging.
      if (!promptStoreUpdate(() => resolve(true))) resolve(false)
    })
  }

  // Step 2: OTA update check
  log.debug("Checking for OTA update", { local, latestVersion })
  let update: Updates.UpdateCheckResult
  try {
    update = await Updates.checkForUpdateAsync()
  } catch (e) {
    // Defensive: don't leave the lock set if the native module throws before
    // we even open an Alert. (We hadn't set it yet here, but symmetry helps
    // future maintainers reason about the flag.)
    promptInFlight = false
    throw e
  }

  if (update.isAvailable) {
    log.info("OTA update available, fetching")
    try {
      await Updates.fetchUpdateAsync()
    } catch (e) {
      promptInFlight = false
      throw e
    }
    log.info("OTA update fetched, prompting reload")
    promptInFlight = true
    return new Promise((resolve) => {
      Alert.alert(
        translate("common:updateTitle"),
        translate("common:updateMessage"),
        [
          {
            text: translate("common:ok"),
            onPress: () => {
              // reloadAsync restarts the JS context so the flag reset is
              // largely theoretical, but flip it before kicking off the
              // reload in case the call is delayed or fails.
              promptInFlight = false
              // CHANGED 2026-05-21: route through reloadApp() so the
              // expo-sqlite SharedObject is closed before teardown — fixes
              // the EXC_BAD_ACCESS / SharedObjectRegistry.clear crash that
              // fired during this exact OTA-accept reload on 4.5.0.
              reloadApp()
              resolve(true)
            },
          },
        ],
        { cancelable: false },
      )
    })
  }

  return false
}
