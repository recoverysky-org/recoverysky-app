import { applySnapshot, onSnapshot, IDisposer } from "mobx-state-tree"
import { RootStore, RootStoreModel, RootStoreSnapshot } from "../RootStore"
import * as storage from "@/utils/storage"

/**
 * The key we use to store the root state in MMKV.
 */
const ROOT_STATE_STORAGE_KEY = "root-v1"

/**
 * Setup the root state.
 * - Loads the stored snapshot from MMKV
 * - Sets up auto-persistence via onSnapshot
 */
export async function setupRootStore(rootStore: RootStore) {
  let restoredState: RootStoreSnapshot | undefined | null

  try {
    // Load stored state from MMKV
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

  // Track changes and save to MMKV
  const unsubscribe = onSnapshot(rootStore, (snapshot) => {
    storage.save(ROOT_STATE_STORAGE_KEY, snapshot)
  })

  return { rootStore, restoredState, unsubscribe }
}
