/**
 * SQLite Encryption Key Service
 *
 * Manages the encryption key for SQLite database:
 * - Anonymous users: Generate and store a local key in SecureStore
 * - Authenticated users: Use key from Zitadel JWT metadata
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
 * Get or generate SQLite encryption key.
 *
 * On first call (no stored key), generates a random 32-byte key (256-bit AES)
 * and stores it in SecureStore. Subsequent calls return the stored key.
 */
export async function getSqliteEncryptionKey(): Promise<string> {
  log.info("getSqliteEncryptionKey()")

  try {
    // Try to load existing key
    let key = await SecureStore.getItemAsync(SQLITE_KEY)

    if (key) {
      log.info("Loaded existing SQLite encryption key from SecureStore")
      return key
    }

    // Generate new 32-byte key (256-bit for AES)
    log.info("Generating new SQLite encryption key (first launch)")
    const randomBytes = await Crypto.getRandomBytesAsync(32)

    // Convert to hex string (64 characters)
    key = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    // Store in SecureStore
    await SecureStore.setItemAsync(SQLITE_KEY, key)
    log.info("SQLite encryption key generated and stored in SecureStore")

    return key
  } catch (error) {
    log.error("getSqliteEncryptionKey failed", { error: String(error) })
    throw error
  }
}

/**
 * Update the SQLite encryption key.
 *
 * Used when an authenticated user has a server-side key from Zitadel.
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
