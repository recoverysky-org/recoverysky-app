/**
 * Database provider initialization
 *
 * Creates the expo-sqlite database and wraps it with Drizzle ORM.
 * Uses sync mode for simpler API (no async/await for reads).
 */

import { openDatabaseSync } from "expo-sqlite"
import { drizzle } from "drizzle-orm/expo-sqlite"
import * as schema from "@common/sqlite"

/**
 * Database name for the app
 */
const DATABASE_NAME = "recoverysky.db"

/**
 * Raw expo-sqlite database instance
 * Use this for advanced operations or migrations
 */
export const expoDb = openDatabaseSync(DATABASE_NAME, {
  enableChangeListener: true,
})

/**
 * Drizzle ORM database instance
 * Provides type-safe queries with the SQLite schema
 */
export const db = drizzle(expoDb, { schema })
