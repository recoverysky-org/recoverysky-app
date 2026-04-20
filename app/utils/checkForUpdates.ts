/**
 * Two-step update checker:
 * 1. Native version check — if behind, prompt user to visit the store
 * 2. OTA update check — if native is current, check for expo-updates patches
 */

import { Alert, Linking } from "react-native"
import * as Updates from "expo-updates"

import { translate } from "@/i18n"
import { logger } from "@/utils/logger"

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

  // Step 1: Native version check
  if (latestVersion && isVersionBehind(local, latestVersion)) {
    log.info("Local version behind", { local, latest: latestVersion })
    promptInFlight = true
    return new Promise((resolve) => {
      Alert.alert(
        translate("common:storeUpdateTitle"),
        translate("common:storeUpdateMessage"),
        [
          {
            text: translate("common:cancel"),
            style: "cancel",
            onPress: () => {
              promptInFlight = false
              resolve(true)
            },
          },
          {
            text: translate("common:storeUpdateButton"),
            onPress: () => {
              promptInFlight = false
              Linking.openURL(STORE_URL)
              resolve(true)
            },
          },
        ],
      )
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
              Updates.reloadAsync()
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
