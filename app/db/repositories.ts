/**
 * Repository instances for the app
 *
 * Lazily-initialized repositories - only work after openDb() is called.
 *
 * @example
 * import { meetingRepo, findAllTrexes } from "@/db"
 *
 * // Find all meetings (after db is opened)
 * const meetings = await meetingRepo.findAll()
 *
 * // Get all trexes
 * const trexes = findAllTrexes()
 */

import {
  MeetingSqliteRepository,
  ScheduleSqliteRepository,
  SyncQueueRepository,
} from "@sqlite"
import { getDb } from "./provider"

// Lazy repository instances - created on first access after db is opened
let _meetingRepo: MeetingSqliteRepository | null = null
let _scheduleRepo: ScheduleSqliteRepository | null = null
let _syncQueueRepo: SyncQueueRepository | null = null

/**
 * Meeting repository instance (lazy)
 */
export const meetingRepo = {
  findAll: async () => {
    const { db } = getDb()
    if (!db) throw new Error("Database not opened")
    if (!_meetingRepo) _meetingRepo = new MeetingSqliteRepository(db as any)
    return _meetingRepo.findAll()
  },

  findByIds: async (ids: string[]) => {
    const { db } = getDb()
    if (!db) throw new Error("Database not opened")
    if (!_meetingRepo) _meetingRepo = new MeetingSqliteRepository(db as any)
    return _meetingRepo.findByIds(ids)
  },
}

/**
 * Schedule repository instance (lazy)
 */
export const scheduleRepo = {
  findAll: async () => {
    const { db } = getDb()
    if (!db) throw new Error("Database not opened")
    if (!_scheduleRepo) _scheduleRepo = new ScheduleSqliteRepository(db as any)
    return _scheduleRepo.findAll()
  },
}

/**
 * Sync queue repository instance (lazy)
 */
export const syncQueueRepo = {
  enqueue: async (data: any) => {
    const { db } = getDb()
    if (!db) throw new Error("Database not opened")
    if (!_syncQueueRepo) _syncQueueRepo = new SyncQueueRepository(db as any)
    return _syncQueueRepo.enqueue(data)
  },
}

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
  const { expoDb } = getDb()
  if (!expoDb) return []
  return expoDb.getAllSync<TrexRow>("SELECT * FROM trexes")
}

/**
 * Find a trex by ID using raw SQL
 */
export function findTrexById(id: string): TrexRow | undefined {
  const { expoDb } = getDb()
  if (!expoDb) return undefined
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
