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
 *
 * CHANGED 2026-09-18 (spec 2 §1.4): also clears the device-owner record
 * (AuthenticationStore.ownerSub/ownerEmail) as part of the same teardown — a
 * record pointing at data that no longer exists would show the wrong-account
 * screen over an empty database. Runs last, after the file and key are gone,
 * so a failure earlier in teardown leaves the owner record intact rather than
 * clearing ownership over a database that's still on disk.
 */

import { clearSqliteEncryptionKey } from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { closeDb, deleteDatabase } from "./provider"

const log = logger.child({ module: "DatabaseProvider" })

export interface ResetLocalDatabaseOptions {
  /**
   * Clears AuthenticationStore.ownerSub/ownerEmail. ADDED 2026-09-17 (spec 2
   * §1.4): a record pointing at data that no longer exists would show the
   * wrong-account screen over an empty database. Passed in rather than
   * imported so db/ does not grow a runtime dependency on models/.
   */
  clearOwner: () => void
}

export async function resetLocalDatabase(options: ResetLocalDatabaseOptions): Promise<void> {
  log.warn("Resetting local database and encryption key")
  await closeDb()
  await deleteDatabase()
  await clearSqliteEncryptionKey()
  options.clearOwner()
  log.warn("Local database reset complete")
}
