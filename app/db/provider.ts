/**
 * Database provider initialization
 *
 * Provides lazy database initialization - nothing happens until openDb() is called.
 * Uses dynamic import to avoid loading native module until needed.
 * Supports SQLCipher encryption with a key from SecureStore.
 */

import { Paths, File } from "expo-file-system"
import type { SQLiteDatabase } from "expo-sqlite"
import * as schema from "@recoverysky-org/common/sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "DatabaseProvider" })

const DATABASE_NAME = "recoverysky.db"

// Not initialized until openDb() is called
let expoDb: SQLiteDatabase | null = null
let db: ExpoSQLiteDatabase<typeof schema> | null = null
let currentEncryptionKey: string | null = null

/**
 * Listeners told when the singleton connection goes away.
 *
 * ADDED 2026-09-19 (Sentry RECOVERYSKY-APP-1X). DatabaseProvider promises its
 * children that the database is open, but the singleton can be closed
 * underneath it: reloadApp() closes it BEFORE `Updates.reloadAsync()`, and the
 * JS runtime stays alive for up to a second after that. Anything that mounts
 * or queries in that second throws "Database not opened". The provider
 * subscribes here so it can drop its children the moment the handle is gone.
 */
type DbClosedListener = () => void
const closedListeners = new Set<DbClosedListener>()

export function onDbClosed(listener: DbClosedListener): () => void {
  closedListeners.add(listener)
  return () => {
    closedListeners.delete(listener)
  }
}

/**
 * The main database file plus the sidecar files SQLite may leave beside it.
 * Deleting only the main file and leaving a `-wal` / `-journal` behind would
 * let SQLite "recover" pages encrypted under the old key into the new
 * database on the next open and fail exactly the way we are trying to reset.
 */
function databaseFiles(): File[] {
  return ["", "-wal", "-shm", "-journal"].map(
    (suffix) => new File(Paths.document, "SQLite", `${DATABASE_NAME}${suffix}`),
  )
}

/**
 * Delete the database file for a clean reseed or encryption migration.
 *
 * CHANGED 2026-09-14 (RS-024): also removes the WAL / SHM / rollback-journal
 * sidecars (see `databaseFiles`), and requires the singleton connection to be
 * closed first — expo-sqlite keeps the native handle alive in its own cache
 * while a JS reference exists, so deleting underneath it would leave the
 * process reading an unlinked inode until the next launch.
 */
export async function deleteDatabase(): Promise<void> {
  if (expoDb) {
    throw new Error("deleteDatabase: close the database before deleting it")
  }
  for (const file of databaseFiles()) {
    try {
      if (file.exists) {
        log.info("Deleting database file", { name: file.name })
        file.delete()
      }
    } catch (error) {
      log.warn("Failed to delete database file", { name: file.name, error: String(error) })
    }
  }
}

/**
 * Size of the on-disk database file in bytes; 0 when absent or unreadable.
 *
 * Used by the key-acquisition step to tell "first launch" apart from "the
 * keychain lost our key but the encrypted data is still here" (RS-024). A
 * zero-byte file counts as absent — SQLCipher treats an empty file as a new
 * database, so any key opens it.
 */
export function encryptedDatabaseBytes(): number {
  try {
    const dbFile = new File(Paths.document, "SQLite", DATABASE_NAME)
    return dbFile.exists ? dbFile.size : 0
  } catch {
    return 0
  }
}

/**
 * Check if the database file exists
 */
export function databaseExists(): boolean {
  try {
    const dbFile = new File(Paths.document, "SQLite", DATABASE_NAME)
    return dbFile.exists
  } catch {
    return false
  }
}

/**
 * Open the database with optional encryption.
 * Dynamically imports expo-sqlite to avoid loading native module at startup.
 *
 * @param encryptionKey - 64-character hex string (32 bytes) for SQLCipher encryption
 */
export async function openDb(encryptionKey?: string): Promise<{
  expoDb: SQLiteDatabase
  db: ExpoSQLiteDatabase<typeof schema>
}> {
  if (!expoDb) {
    // Delete database if reseed is requested
    if (process.env.EXPO_PUBLIC_RESEED_DB === "true") {
      await deleteDatabase()
    }

    log.debug("Loading expo-sqlite")
    const { openDatabaseSync } = await import("expo-sqlite")
    const { drizzle } = await import("drizzle-orm/expo-sqlite")

    // No `enableChangeListener` — nothing in the app or common-lib consumes
    // onDatabaseChange / addDatabaseChangeListener, and the flag registers a
    // JSI callback SharedObject (a WeakObject bound to the runtime) for no
    // benefit. That object is exactly the kind whose ~WeakObject crashed in
    // SharedObjectRegistry.clear during OTA reload teardown on 4.5.0
    // (EXC_BAD_ACCESS in .cxx_destruct). Re-add only alongside a real consumer.
    expoDb = openDatabaseSync(DATABASE_NAME)

    // Set encryption key immediately after opening (required for SQLCipher)
    if (encryptionKey) {
      log.debug("Setting SQLCipher encryption key")
      expoDb.execSync(`PRAGMA key = '${encryptionKey}'`)
      currentEncryptionKey = encryptionKey
      log.info("Database opened", { encrypted: true })
    } else {
      log.info("Database opened", { encrypted: false })
    }

    db = drizzle(expoDb, { schema })
    log.debug("Drizzle ORM initialized")
  }
  return { expoDb: expoDb!, db: db! }
}

/**
 * Close the database (for re-encryption or cleanup).
 *
 * CHANGED 2026-09-14 (RS-024): always drops the module singleton, even when
 * the native close throws. DatabaseProvider now calls this after a failed
 * open so the next attempt gets a fresh connection: SQLCipher latches a codec
 * error on the connection that hit it, and expo-sqlite hands the same cached
 * native handle back for the same path, so retrying on the old handle could
 * never succeed no matter what fixed the underlying cause.
 */
export async function closeDb(): Promise<void> {
  if (expoDb) {
    log.info("Closing database")
    try {
      expoDb.closeSync()
    } finally {
      expoDb = null
      db = null
      currentEncryptionKey = null
    }
    log.debug("Database closed")
    // After the nulls, so a listener that reads getDb() sees it closed.
    // Each listener is isolated: a throw in one must not stop the others or
    // surface from a best-effort close.
    for (const listener of closedListeners) {
      try {
        listener()
      } catch (error) {
        log.warn("onDbClosed listener threw", { error: String(error) })
      }
    }
  }
}

/**
 * Get the current encryption key (if database is encrypted)
 */
export function getCurrentEncryptionKey(): string | null {
  return currentEncryptionKey
}

/**
 * Re-encrypt the database with a new key using PRAGMA rekey.
 * Preserves all data - no need to delete/recreate.
 *
 * @param newKey - The new encryption key (64-character hex string)
 */
export async function rekeyDatabase(newKey: string): Promise<void> {
  if (!expoDb) {
    throw new Error("Database not open, cannot rekey")
  }

  if (!currentEncryptionKey) {
    throw new Error("Database not encrypted, cannot rekey")
  }

  log.info("Re-encrypting database with new key")
  expoDb.execSync(`PRAGMA rekey = '${newKey}'`)
  currentEncryptionKey = newKey
  log.info("Database re-encrypted successfully")
}

/**
 * Get current database instances (null if not opened)
 */
export function getDb() {
  return { expoDb, db }
}
