import { applySnapshot, onSnapshot } from "mobx-state-tree"

import { profileRepository } from "@/db/repositories"
import { AUTH0_CONFIG } from "@/services/auth/auth0"
import { isUsableAccessToken } from "@/services/auth/jwtUtils"
import { clearAuthCredentials, loadAuthCredentials } from "@/services/auth/secureStorage"
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

  // ADDED 2026-09-17 (spec 2 §1.3): first launch after the ownership OTA on an
  // install that was signed in. Adopt the persisted account as the device
  // owner NOW, before any reaction sees the session, so the upgrade itself
  // never shows the wrong-account screen. Must run before the isAnonymous
  // reset below: an anonymous snapshot carries userId === deviceId, and a
  // device id must never become the owner.
  //
  // CHANGED 2026-09-18: running before the reset is NOT sufficient on its own,
  // hence the explicit deviceId check. The reset below persists through
  // onSnapshot, so an install that used the old anonymous login (live on
  // Android 2025-12-26 → 2026-05-14) reaches its SECOND cold start with
  // `isAnonymous: false` already written and `userId` still the device id —
  // the `!auth.isAnonymous` guard passes and the device id becomes the owner.
  // That state is unrecoverable from inside the app: ownerProofMethod() on a
  // device id is "unknown" and ownerEmail is undefined, so WrongAccountView
  // offers Cancel and nothing else, and every real sign-in loops back to it.
  {
    const auth = rootStore.authenticationStore
    if (!auth.ownerSub && auth.userId && !auth.isAnonymous && auth.userId !== auth.deviceId) {
      auth.setOwner(auth.userId, auth.authEmail || undefined)
      log.info("Owner stamped from hydration")
    }
  }

  // Reset anonymous flag on cold start so returning anonymous users see the Login screen.
  if (rootStore.authenticationStore.isAnonymous) {
    rootStore.authenticationStore.setProp("isAnonymous", false)
  }

  // Load auth credentials from SecureStore.
  // If we have a valid (non-expired) access token, hydrate auth immediately —
  // no need to wait for Auth0 SDK. This eliminates the Login screen flash.
  //
  // CHANGED 2026-08-07: hydrate even when the access token is EXPIRED.
  // Skipping hydration dropped the refresh token along with the access token,
  // and the request gate's user refresher bails when the store holds neither
  // (its never-signed-in guard) — so the gate never attempted a renewal for a
  // returning user whose refresh token was perfectly good, and recovery waited
  // on the Auth0Provider [user] effect after the provider tree mounted: the
  // exact dependency the gate exists to remove. isAuthenticated still returns
  // false for an expired token, so navigation is unchanged — the first gated
  // request refreshes it and flips auth on its own.
  try {
    const creds = await loadAuthCredentials()
    if (creds) {
      // ADDED 2026-09-10: refuse to hydrate a token that can never be accepted
      // by the API (an opaque Auth0 token from an audience-less session — see
      // isUsableAccessToken). Discard it and let the Auth0Provider's [user]
      // effect produce a good one or eject; a corrupt blob must not punish a
      // user whose SDK session is fine. An EXPIRED JWT still hydrates — the
      // gate-driven refresh below needs the refresh token beside it.
      const check = isUsableAccessToken(creds.accessToken, { audience: AUTH0_CONFIG.audience })
      if (!check.ok) {
        log.warn("Stored access token unusable — discarding", {
          source: "hydration",
          reason: check.reason,
          tokenLength: creds.accessToken.length,
          tokenSegments: creds.accessToken.split(".").length,
        })
        clearAuthCredentials().catch((e) =>
          log.error("Failed to clear unusable auth credentials", { error: String(e) }),
        )
      } else {
        // No ID token on cold start — it is not persisted (see
        // StoredAuthCredentials) and nothing after login needs it.
        // CHANGED 2026-09-30: Settings → Account now reads authStore.idToken
        // for its linked-method rows (accountMethodsLogic.ts). Leaving it
        // undefined here is still right: the SDK restores its own session on
        // cold start and useAuth0Wrapper's [user] sync writes the fresh ID
        // token via setTokens, as does every refresh. Until then the screen
        // shows only the active row. Don't drop idToken from those setTokens calls.
        rootStore.authenticationStore.setTokens(
          creds.accessToken,
          creds.refreshToken,
          undefined,
          creds.expiresAt,
        )
        if (creds.expiresAt > Date.now()) {
          log.info("Auth credentials restored from SecureStore", {
            expiresIn: Math.round((creds.expiresAt - Date.now()) / 1000 / 60) + " min",
          })
        } else {
          log.info("Stored access token expired — hydrated for gate-driven refresh", {
            hasRefreshToken: !!creds.refreshToken,
          })
        }
      }
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
