/**
 * SQLite Encryption Key Service
 *
 * Manages the encryption key for SQLite database:
 * - Anonymous users: Generate and store a local key in SecureStore
 * - Authenticated users: Use key from JWT custom claims
 *
 * The key is stored in SecureStore which uses:
 * - iOS: Keychain (hardware-backed)
 * - Android: Keystore (hardware-backed)
 */

import * as Crypto from "expo-crypto"
import * as SecureStore from "expo-secure-store"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "sqliteKey" })

const SQLITE_KEY = "sqlite_encryption_key_v1"

/**
 * Load the stored SQLite encryption key, or null when the keychain has none.
 *
 * Throws when SecureStore itself fails — most importantly
 * errSecInteractionNotAllowed (-25308), which iOS returns for our
 * `WHEN_UNLOCKED` item when the app is launched in the background while the
 * phone is locked. Callers must treat a throw as "try again later", never as
 * "no key" (see RS-024: the two are worlds apart — one heals on unlock, the
 * other is a bricked install).
 */
export async function loadSqliteEncryptionKey(): Promise<string | null> {
  log.info("loadSqliteEncryptionKey()")
  try {
    const key = await SecureStore.getItemAsync(SQLITE_KEY)
    if (key) {
      log.info("Loaded existing SQLite encryption key from SecureStore")
      return key
    }
    log.info("No SQLite encryption key in SecureStore")
    return null
  } catch (error) {
    log.error("loadSqliteEncryptionKey failed", { error: String(error) })
    throw error
  }
}

/**
 * Generate a random 32-byte key (256-bit AES), store it in SecureStore, and
 * return it as a 64-character hex string.
 *
 * CHANGED 2026-09-14 (RS-024): this used to be the fallback branch inside a
 * single get-or-generate function, which minted a fresh key whenever the
 * keychain came back empty — including on devices that still had an encrypted
 * database on disk. The new key could never open that file, and storing it
 * overwrote the only slot the old key could have returned to. The decision of
 * WHETHER to generate now lives in `app/db/acquireKey.ts` (pure logic in
 * `dbOpenLogic.ts`), which checks the database file first.
 */
export async function generateAndStoreSqliteEncryptionKey(): Promise<string> {
  try {
    log.info("Generating new SQLite encryption key (first launch)")
    const randomBytes = await Crypto.getRandomBytesAsync(32)

    // Convert to hex string (64 characters)
    const key = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    // Store in SecureStore
    await SecureStore.setItemAsync(SQLITE_KEY, key)
    log.info("SQLite encryption key generated and stored in SecureStore")

    return key
  } catch (error) {
    log.error("generateAndStoreSqliteEncryptionKey failed", { error: String(error) })
    throw error
  }
}

/**
 * Update the SQLite encryption key.
 *
 * Used when an authenticated user has a server-side key from JWT claims.
 * This replaces the locally generated key with the user's key.
 *
 * Note: Caller is responsible for re-encrypting the database after this.
 */
export async function setSqliteEncryptionKey(key: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SQLITE_KEY, key)
    log.info("SQLite encryption key updated")
  } catch (error) {
    log.error("Failed to set SQLite encryption key", { error: String(error) })
    throw error
  }
}

/**
 * Check if we have a stored encryption key.
 */
export async function hasSqliteEncryptionKey(): Promise<boolean> {
  try {
    const key = await SecureStore.getItemAsync(SQLITE_KEY)
    return !!key
  } catch (error) {
    log.error("Failed to check SQLite encryption key", { error: String(error) })
    return false
  }
}

/**
 * Get the current stored encryption key without generating a new one.
 * Returns null if no key is stored.
 */
export async function getCurrentSqliteKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SQLITE_KEY)
  } catch (error) {
    log.error("Failed to get current SQLite encryption key", { error: String(error) })
    return null
  }
}

/**
 * Clear the stored encryption key.
 *
 * WARNING: This will make the encrypted database inaccessible!
 * Only use for debugging or when intentionally resetting the app.
 */
export async function clearSqliteEncryptionKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SQLITE_KEY)
    log.warn("SQLite encryption key cleared")
  } catch (error) {
    log.error("Failed to clear SQLite encryption key", { error: String(error) })
    throw error
  }
}
