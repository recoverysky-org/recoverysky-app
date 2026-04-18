import { applySnapshot, onSnapshot } from "mobx-state-tree"

import { profileRepository } from "@/db/repositories"
import { loadAuthCredentials } from "@/services/auth/secureStorage"
import { logger } from "@/utils/logger"
import * as storage from "@/utils/storage"

import { RootStore, RootStoreSnapshot } from "../RootStore"

const log = logger.child({ module: "RootStore" })

/**
 * The key we use to store the root state in MMKV.
 */
const ROOT_STATE_STORAGE_KEY = "root-v1"

/**
 * Setup the root state.
 * - Loads the stored snapshot from MMKV (non-sensitive data)
 * - Sets up auto-persistence via onSnapshot
 *
 * Note: Sensitive profile data is NOT included in snapshots.
 * Call hydrateProfileFromSQLite() separately after database is ready.
 */
export async function setupRootStore(rootStore: RootStore) {
  log.info("setupRootStore()", { storageKey: ROOT_STATE_STORAGE_KEY })

  let restoredState: RootStoreSnapshot | undefined | null

  try {
    // Load stored state from MMKV (non-sensitive data only)
    restoredState = storage.load(ROOT_STATE_STORAGE_KEY) as RootStoreSnapshot | null
    if (restoredState) {
      // Exclude configStore - it should always use env vars (not cached values)
      const { configStore: _configStore, ...stateWithoutConfig } = restoredState
      applySnapshot(rootStore, stateWithoutConfig)
      log.info("Restored RootStore from MMKV", {
        hasAuthStore: !!restoredState.authenticationStore,
        hasProfileStore: !!restoredState.profileStore,
      })
    } else {
      log.info("No stored RootStore snapshot, starting fresh")
    }
  } catch (e) {
    log.error("Failed to load RootStore from MMKV", { error: String(e) })
  }

  // Reset anonymous flag on cold start so returning anonymous users see the Login screen.
  if (rootStore.authenticationStore.isAnonymous) {
    rootStore.authenticationStore.setProp("isAnonymous", false)
  }

  // External Zoom is hard-coded on for all users — override any persisted false.
  if (!rootStore.profileStore.useExternalZoom) {
    rootStore.profileStore.setUseExternalZoom(true)
  }

  // Load auth credentials from SecureStore.
  // If we have a valid (non-expired) access token, hydrate auth immediately —
  // no need to wait for Auth0 SDK. This eliminates the Login screen flash.
  try {
    const creds = await loadAuthCredentials()
    if (creds && creds.expiresAt > Date.now()) {
      rootStore.authenticationStore.setTokens(
        creds.accessToken,
        creds.refreshToken,
        creds.idToken,
        creds.expiresAt,
      )
      log.info("Auth credentials restored from SecureStore", {
        expiresIn: Math.round((creds.expiresAt - Date.now()) / 1000 / 60) + " min",
      })
    } else if (creds) {
      log.info("Stored auth credentials expired, user will need to re-authenticate")
    }
  } catch (e) {
    log.error("Failed to load auth credentials from SecureStore", { error: String(e) })
  }

  // Auth is always ready after loading from SecureStore — either we have valid tokens
  // or we don't, but either way we know what screen to show immediately.
  rootStore.authenticationStore.setAuthReady()

  // Track changes and save to MMKV
  // Exclude configStore (uses env vars); auth tokens are all volatile and won't appear in snapshots
  const unsubscribe = onSnapshot(rootStore, (snapshot) => {
    const { configStore: _configStore, ...snapshotWithoutConfig } = snapshot
    storage.save(ROOT_STATE_STORAGE_KEY, snapshotWithoutConfig)
  })
  log.debug("RootStore snapshot listener registered")

  return { rootStore, restoredState, unsubscribe }
}

/**
 * Hydrate sensitive profile data from encrypted SQLite.
 * Call this after the database is ready.
 *
 * @param rootStore - The initialized root store
 * @returns true if profile was loaded, false if using defaults
 */
export async function hydrateProfileFromSQLite(rootStore: RootStore): Promise<boolean> {
  log.info("hydrateProfileFromSQLite()")

  try {
    const secureProfile = await profileRepository.load()
    if (secureProfile) {
      rootStore.profileStore.hydrateFromSQLite(secureProfile)
      log.info("Profile hydrated from SQLite", {
        hasRecoveryDate: !!secureProfile.recoveryDate,
        language: secureProfile.language,
      })
      return true
    }
    log.info("No profile in SQLite, using defaults")
  } catch (e) {
    log.error("Failed to load profile from SQLite", { error: String(e) })
  }
  return false
}
