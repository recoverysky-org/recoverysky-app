/**
 * Repository instances for the app
 *
 * Pre-instantiated repositories using the app's database connection.
 * Import these directly for data access throughout the app.
 *
 * @example
 * import { meetingRepo, syncQueueRepo, findAllTrexes } from "@/db"
 *
 * // Find all meetings
 * const meetings = await meetingRepo.findAll()
 *
 * // Get all trexes
 * const trexes = findAllTrexes()
 *
 * // Queue an offline operation
 * await syncQueueRepo.enqueue({
 *   tableName: "meetings",
 *   recordId: "123",
 *   operation: "create",
 *   payload: JSON.stringify(meetingData),
 * })
 */

import {
  MeetingSqliteRepository,
  ScheduleSqliteRepository,
  SyncQueueRepository,
} from "@common/sqlite"
import { db, expoDb } from "./provider"

/**
 * Meeting repository instance
 * Handles CRUD operations for meetings with junction tables
 */
export const meetingRepo = new MeetingSqliteRepository(db as any)

/**
 * Schedule repository instance
 * Handles CRUD operations for schedules with meeting relationships
 */
export const scheduleRepo = new ScheduleSqliteRepository(db as any)

/**
 * Sync queue repository instance
 * Manages offline operation queue for server synchronization
 */
export const syncQueueRepo = new SyncQueueRepository(db as any)

// ============================================================================
// TREX Queries (simple functions, no full repository needed for MVP)
// ============================================================================

/** Type for a trex row from SQLite */
export interface TrexRow {
  id: string
  coordinate: number
  coordinate_end: number
  timezone: string
  periodicity: number
  duration_ms: number
  dtstart: string
  dtend: string | null
  rrule_str: string
  rrule_json: string
  hour: number | null
  minute: number | null
  dow: number | null
  dom: number | null
  month: number | null
}

/**
 * Find all trexes using raw SQL
 */
export function findAllTrexes(): TrexRow[] {
  return expoDb.getAllSync<TrexRow>("SELECT * FROM trexes")
}

/**
 * Find a trex by ID using raw SQL
 */
export function findTrexById(id: string): TrexRow | undefined {
  const result = expoDb.getFirstSync<TrexRow>("SELECT * FROM trexes WHERE id = ?", [id])
  return result ?? undefined
}

/**
 * Find trexes by multiple IDs
 */
export function findTrexesByIds(ids: string[]): TrexRow[] {
  // For efficiency, we'll query all and filter in memory for MVP
  // A proper implementation would use IN clause
  const all = findAllTrexes()
  const idSet = new Set(ids)
  return all.filter((t) => idSet.has(t.id))
}
