/**
 * Database provider initialization
 *
 * Provides lazy database initialization - nothing happens until openDb() is called.
 * Uses dynamic import to avoid loading native module until needed.
 */

import { Paths, File } from "expo-file-system"
import type { SQLiteDatabase } from "expo-sqlite"
import * as schema from "@sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"

const DATABASE_NAME = "recoverysky.db"

// Not initialized until user clicks "Open Db"
let expoDb: SQLiteDatabase | null = null
let db: ExpoSQLiteDatabase<typeof schema> | null = null

/**
 * Delete the database file for a clean reseed
 */
async function deleteDatabase(): Promise<void> {
  try {
    const dbFile = new File(Paths.document, "SQLite", DATABASE_NAME)
    if (dbFile.exists) {
      console.log("[provider] Deleting database for reseed...")
      dbFile.delete()
      console.log("[provider] Database deleted")
    }
  } catch (error) {
    console.warn("[provider] Failed to delete database:", error)
  }
}

/**
 * Open the database. Called when user clicks "Open Db".
 * Dynamically imports expo-sqlite to avoid loading native module at startup.
 */
export async function openDb(): Promise<{
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
    db = drizzle(expoDb, { schema })
    console.log("[provider] Database opened")
  }
  return { expoDb: expoDb!, db: db! }
}

/**
 * Get current database instances (null if not opened)
 */
export function getDb() {
  return { expoDb, db }
}
