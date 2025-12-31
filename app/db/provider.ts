/**
 * Database provider initialization
 *
 * Provides lazy database initialization - nothing happens until openDb() is called.
 * Uses dynamic import to avoid loading native module until needed.
 * Supports SQLCipher encryption with a key from SecureStore.
 */

import { Paths, File } from "expo-file-system"
import type { SQLiteDatabase } from "expo-sqlite"
import * as schema from "@sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"

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
      console.log("[provider] Deleting database...")
      dbFile.delete()
      console.log("[provider] Database deleted")
    }
  } catch (error) {
    console.warn("[provider] Failed to delete database:", error)
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

    console.log("[provider] Loading expo-sqlite...")
    const { openDatabaseSync } = await import("expo-sqlite")
    const { drizzle } = await import("drizzle-orm/expo-sqlite")

    expoDb = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true })

    // Set encryption key immediately after opening (required for SQLCipher)
    if (encryptionKey) {
      console.log("[provider] Setting SQLCipher encryption key...")
      expoDb.execSync(`PRAGMA key = '${encryptionKey}'`)
      currentEncryptionKey = encryptionKey
      console.log("[provider] Encrypted database opened")
    } else {
      console.log("[provider] Unencrypted database opened")
    }

    db = drizzle(expoDb, { schema })
    console.log("[provider] Database ready")
  }
  return { expoDb: expoDb!, db: db! }
}

/**
 * Close the database (for re-encryption or cleanup)
 */
export async function closeDb(): Promise<void> {
  if (expoDb) {
    console.log("[provider] Closing database...")
    expoDb.closeSync()
    expoDb = null
    db = null
    currentEncryptionKey = null
    console.log("[provider] Database closed")
  }
}

/**
 * Get the current encryption key (if database is encrypted)
 */
export function getCurrentEncryptionKey(): string | null {
  return currentEncryptionKey
}

/**
 * Get current database instances (null if not opened)
 */
export function getDb() {
  return { expoDb, db }
}
