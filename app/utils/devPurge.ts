/**
 * DEV-ONLY: wipe every piece of local state so the next launch behaves like a
 * fresh install. Wired to the __DEV__ "Purge" button on LoginScreen.
 *
 * ADDED 2026-09-28 for testing passwordless login and wrong-account recovery,
 * where the device-owner record, the Auth0 SDK's stored session and the
 * SecureStore credentials all survive a normal sign-out on purpose — and the
 * iOS Keychain survives even an uninstall, so "delete the app" is not a clean
 * start either.
 *
 * What it clears, in this order (the order matters — see each step):
 *  1. The Auth0 SDK's own credential store (react-native-auth0
 *     CredentialsManager). Passed in, because only a component can reach the
 *     useAuth0() hook. Does NOT clear the browser's Auth0/Google/Apple cookie:
 *     that needs clearSession(), which opens a browser and, on iOS, a system
 *     dialog. A later Google/Apple tap may therefore still pick the last
 *     account silently.
 *  2. SecureStore: auth_credentials_v1, terms_accepted_v2 (clearAllSecureData)
 *     and the device-trust pair device_jwt_v1 / app_attest_key_id_v1, which
 *     clearAllSecureData deliberately keeps for normal sign-outs. The next
 *     launch re-attests from scratch (a new Apple key on iOS).
 *  3. The encrypted database, its SQLCipher key and the device-owner record —
 *     via resetLocalDatabase(), which keeps the key and the file one unit
 *     (RS-024) and clears the owner last.
 *  4. MMKV, all of it: the MST root snapshot, device id, meeting filters,
 *     sync bookkeeping, RevenueCat per-identity flags. LAST, because every
 *     MST action before it (clearOwner in step 3) writes the snapshot back
 *     synchronously via onSnapshot; clearing earlier would be undone.
 *  5. Reload, through reloadApp() so the database handle is closed before
 *     the runtime tears down.
 *
 * Every step is best-effort and logged: a purge that stops halfway leaves a
 * worse test state than one that skips a step it could not do.
 */

import { resetLocalDatabase } from "@/db/resetLocalDatabase"
import {
  clearAllSecureData,
  clearAppAttestKeyId,
  clearDeviceJwt,
} from "@/services/auth/secureStorage"
import { logger } from "@/utils/logger"
import { reloadApp } from "@/utils/reloadApp"
import { clear as clearMmkv } from "@/utils/storage"

const log = logger.child({ module: "devPurge" })

export interface DevPurgeOptions {
  /** react-native-auth0's clearCredentials() from useAuth0(). */
  clearSdkCredentials: () => Promise<void>
  /** AuthenticationStore.clearOwner — see resetLocalDatabase. */
  clearOwner: () => void
}

async function step(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn()
    log.info("Dev purge step done", { step: name })
  } catch (e) {
    log.warn("Dev purge step failed — continuing", { step: name, error: String(e) })
  }
}

export async function devPurgeAllLocalData(options: DevPurgeOptions): Promise<void> {
  if (!__DEV__) return
  log.warn("Dev purge: wiping all local data")
  await step("auth0-sdk-credentials", options.clearSdkCredentials)
  await step("secure-store", async () => {
    await Promise.all([clearAllSecureData(), clearDeviceJwt(), clearAppAttestKeyId()])
  })
  await step("database-key-owner", () => resetLocalDatabase({ clearOwner: options.clearOwner }))
  await step("mmkv", clearMmkv)
  await reloadApp()
}
