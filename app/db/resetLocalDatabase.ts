/**
 * Destroy the local encrypted database and the key that protects it, as one
 * unit. Used by DatabaseProvider's "Reset local data" recovery action and by
 * Settings → Delete User Data.
 *
 * Why one unit (RS-024, 2026-09-14): Delete User Data used to clear the
 * SQLCipher key but leave the database file. The next cold start found no
 * key, minted a fresh one, and could never open the old file — the install
 * was bricked until the user deleted the app. The key and the file are only
 * meaningful together; whoever removes one must remove the other.
 *
 * Order matters: close first (expo-sqlite caches the native handle and would
 * keep the unlinked inode alive), delete the file and its sidecars, then clear
 * the key so the next open takes the genuine first-launch path.
 */

import { clearSqliteEncryptionKey } from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { closeDb, deleteDatabase } from "./provider"

const log = logger.child({ module: "DatabaseProvider" })

export async function resetLocalDatabase(): Promise<void> {
  log.warn("Resetting local database and encryption key")
  await closeDb()
  await deleteDatabase()
  await clearSqliteEncryptionKey()
  log.warn("Local database reset complete")
}
