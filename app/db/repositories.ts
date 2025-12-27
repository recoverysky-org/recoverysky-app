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
  AttendanceSqliteRepository,
  type AttendanceCreateInput,
  type AttendanceUpdateInput,
  type AttendanceRecord,
} from "@sqlite"
import { getDb } from "./provider"

/**
 * SDK event recorded during meeting attendance
 */
export interface AttendanceEvent {
  timestamp: number
  SdkEvent: string
  SdkCode: string
  SdkMessage: string
}

// Lazy repository instances - created on first access after db is opened
let _meetingRepo: MeetingSqliteRepository | null = null
let _scheduleRepo: ScheduleSqliteRepository | null = null
let _syncQueueRepo: SyncQueueRepository | null = null
let _attendanceRepo: AttendanceSqliteRepository | null = null

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
// Attendance Repository
// ============================================================================

function getAttendanceRepo(): AttendanceSqliteRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_attendanceRepo) _attendanceRepo = new AttendanceSqliteRepository(db as any)
  return _attendanceRepo
}

/**
 * Attendance repository instance (lazy)
 *
 * Tracks meeting attendance records with SDK events.
 */
export const attendanceRepo = {
  /** Create a new attendance record */
  create: async (input: AttendanceCreateInput) => {
    return getAttendanceRepo().create(input)
  },

  /** Find attendance by ID */
  findById: async (id: string) => {
    return getAttendanceRepo().findById(id)
  },

  /** Find all attendance records for a user */
  findByUserId: async (uid: string) => {
    return getAttendanceRepo().findByUserId(uid)
  },

  /** Find attendance by meeting ID */
  findByMeetingId: async (mid: string) => {
    return getAttendanceRepo().findByMeetingId(mid)
  },

  /** Find valid attendance records for a user */
  findValidByUserId: async (uid: string) => {
    return getAttendanceRepo().findValidByUserId(uid)
  },

  /** Find unprocessed attendance records */
  findUnprocessed: async () => {
    return getAttendanceRepo().findUnprocessed()
  },

  /** Add an event to an attendance record */
  addEvent: async (id: string, event: AttendanceEvent) => {
    return getAttendanceRepo().addEvent(id, event)
  },

  /** Update an attendance record */
  update: async (id: string, input: AttendanceUpdateInput) => {
    return getAttendanceRepo().update(id, input)
  },

  /** Mark attendance as processed with calculated values */
  markProcessed: async (
    id: string,
    data: { start: number; end: number; credit: number; valid: boolean },
  ) => {
    return getAttendanceRepo().markProcessed(id, data)
  },

  /** Get total credit for a user */
  getTotalCreditForUser: async (uid: string) => {
    return getAttendanceRepo().getTotalCreditForUser(uid)
  },

  /** Delete an attendance record */
  delete: async (id: string) => {
    return getAttendanceRepo().delete(id)
  },
}

// Re-export types for convenience
export type { AttendanceCreateInput, AttendanceUpdateInput, AttendanceRecord }

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
