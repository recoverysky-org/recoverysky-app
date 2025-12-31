import { applySnapshot, onSnapshot } from "mobx-state-tree"

import { profileRepository } from "@/db/repositories"
import * as storage from "@/utils/storage"

import { RootStore, RootStoreSnapshot } from "../RootStore"

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
  let restoredState: RootStoreSnapshot | undefined | null

  try {
    // Load stored state from MMKV (non-sensitive data only)
    restoredState = storage.load(ROOT_STATE_STORAGE_KEY) as RootStoreSnapshot | null
    if (restoredState) {
      applySnapshot(rootStore, restoredState)
    }
  } catch (e) {
    // If there's any problems loading, start fresh
    if (__DEV__) {
      console.error("Error loading root store:", e)
    }
  }

  // Track changes and save to MMKV (sensitive data excluded via volatile)
  const unsubscribe = onSnapshot(rootStore, (snapshot) => {
    storage.save(ROOT_STATE_STORAGE_KEY, snapshot)
  })

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
  try {
    const secureProfile = await profileRepository.load()
    if (secureProfile) {
      rootStore.profileStore.hydrateFromSQLite(secureProfile)
      return true
    }
  } catch (e) {
    if (__DEV__) {
      console.error("Error loading secure profile from SQLite:", e)
    }
  }
  return false
}
