/**
 * Database provider initialization
 *
 * Provides lazy database initialization - nothing happens until openDb() is called.
 * Uses dynamic import to avoid loading native module until needed.
 */

import type { SQLiteDatabase } from "expo-sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"
import * as schema from "@sqlite"

const DATABASE_NAME = "recoverysky.db"

// Not initialized until user clicks "Open Db"
let expoDb: SQLiteDatabase | null = null
let db: ExpoSQLiteDatabase<typeof schema> | null = null

/**
 * Open the database. Called when user clicks "Open Db".
 * Dynamically imports expo-sqlite to avoid loading native module at startup.
 */
export async function openDb(): Promise<{ expoDb: SQLiteDatabase; db: ExpoSQLiteDatabase<typeof schema> }> {
  if (!expoDb) {
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
