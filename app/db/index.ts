/**
 * Database exports for the RecoverySky Hybrid app
 *
 * This module provides SQLite database access using Drizzle ORM with expo-sqlite.
 * All data is stored locally for offline-first access, with sync capabilities.
 *
 * @example
 * import { db, meetingRepo, syncQueueRepo } from "@/db"
 *
 * // Query meetings
 * const result = await meetingRepo.findAll()
 * if (result.ok) {
 *   console.log("Found", result.value.length, "meetings")
 * }
 *
 * // Queue an offline operation
 * await syncQueueRepo.enqueue({
 *   tableName: "meetings",
 *   recordId: "123",
 *   operation: "update",
 *   payload: JSON.stringify({ name: "Updated" }),
 * })
 */

export { getDb, openDb } from "./provider"
export { DatabaseProvider, useDatabase, useDatabaseReady } from "./DatabaseProvider"
export {
  meetingRepo,
  scheduleRepo,
  syncQueueRepo,
  findAllTrexes,
  findTrexById,
  findTrexesByIds,
  type TrexRow,
} from "./repositories"
