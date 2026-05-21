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
 * Delete the database file for a clean reseed or encryption migration
 */
export async function deleteDatabase(): Promise<void> {
  try {
    const dbFile = new File(Paths.document, "SQLite", DATABASE_NAME)
    if (dbFile.exists) {
      log.info("Deleting database")
      dbFile.delete()
      log.info("Database deleted")
    }
  } catch (error) {
    log.warn("Failed to delete database", { error: String(error) })
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
 * Close the database (for re-encryption or cleanup)
 */
export async function closeDb(): Promise<void> {
  if (expoDb) {
    log.info("Closing database")
    expoDb.closeSync()
    expoDb = null
    db = null
    currentEncryptionKey = null
    log.debug("Database closed")
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
