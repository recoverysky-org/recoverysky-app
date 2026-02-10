import { applySnapshot, onSnapshot } from "mobx-state-tree"

import { profileRepository } from "@/db/repositories"
import { logger } from "@/utils/logger"
import * as storage from "@/utils/storage"

import { RootStore, RootStoreSnapshot } from "../RootStore"

const log = logger.child({ module: "RootStore" })

/**
 * The key we use to store the root state in MMKV.
 */
const ROOT_STATE_STORAGE_KEY = "root-v1"

/**
 * Strip OAuth tokens from the auth store snapshot before persisting to MMKV.
 * Tokens are managed by the Auth0 SDK (iOS Keychain / Android Keystore) and
 * re-synced to MST on app launch — no need to duplicate them in unencrypted storage.
 */
function stripAuthTokens<T extends Record<string, unknown>>(snapshot: T): T {
  const authStore = snapshot.authenticationStore as Record<string, unknown> | undefined
  if (!authStore) return snapshot

  const { accessToken: _, refreshToken: _r, idToken: _i, expiresAt: _e, ...safeAuth } = authStore
  return { ...snapshot, authenticationStore: safeAuth }
}

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

  // Track changes and save to MMKV
  // Exclude configStore (uses env vars) and auth tokens (managed by Auth0 SDK securely)
  const unsubscribe = onSnapshot(rootStore, (snapshot) => {
    const { configStore: _configStore, ...snapshotWithoutConfig } = snapshot
    storage.save(ROOT_STATE_STORAGE_KEY, stripAuthTokens(snapshotWithoutConfig))
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
