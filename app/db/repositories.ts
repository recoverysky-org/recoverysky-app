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
  FeedbackSqliteRepository,
  type AttendanceCreateInput,
  type AttendanceUpdateInput,
  type AttendanceRecord,
  type FeedbackRecord,
  type FeedbackInput,
} from "@recoverysky-org/common/sqlite"

import type { SecureProfileData } from "@/models/ProfileStore"
import { logger } from "@/utils/logger"

import { getDb } from "./provider"
import { UserProfileSqliteRepository } from "./UserProfileSqliteRepository"

const log = logger.child({ module: "Repositories" })

/**
 * Event recorded during meeting attendance
 * Each event captures a moment in the attendance lifecycle with full context.
 */
export interface AttendanceEvent {
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Human-readable event description */
  message: string
  /** Full event data as JSON string for audit trail */
  json: string
}

// Lazy repository instances - created on first access after db is opened
let _meetingRepo: MeetingSqliteRepository | null = null
let _scheduleRepo: ScheduleSqliteRepository | null = null
let _syncQueueRepo: SyncQueueRepository | null = null
let _attendanceRepo: AttendanceSqliteRepository | null = null
let _feedbackRepo: FeedbackSqliteRepository | null = null

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

  /** Find unproduced attendance records (not yet included in a report) */
  findUnproduced: async () => {
    return getAttendanceRepo().findUnproduced()
  },

  /** Find all attendance records */
  findAll: async () => {
    return getAttendanceRepo().findAll()
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
// Feedback Repository
// ============================================================================

function getFeedbackRepo(): FeedbackSqliteRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_feedbackRepo) _feedbackRepo = new FeedbackSqliteRepository(db as any)
  return _feedbackRepo
}

/**
 * Feedback repository instance (lazy)
 *
 * Tracks user preferences (loves, ratings) and engagement (joins) per meeting.
 */
export const feedbackRepo = {
  /** Find all feedback records */
  findAll: async () => {
    return getFeedbackRepo().findAll()
  },

  /** Find feedback by meeting ID */
  findByMid: async (mid: string) => {
    return getFeedbackRepo().findByMid(mid)
  },

  /** Find feedback for multiple meeting IDs */
  findByMids: async (mids: string[]) => {
    return getFeedbackRepo().findByMids(mids)
  },

  /** Toggle love status for a meeting, returns new state */
  toggleLove: async (mid: string) => {
    return getFeedbackRepo().toggleLove(mid)
  },

  /** Set rating for a meeting (0-5) */
  setRating: async (mid: string, rating: number) => {
    return getFeedbackRepo().setRating(mid, rating)
  },

  /** Record a join event (increment joins, update lastJoin) */
  recordJoin: async (mid: string) => {
    return getFeedbackRepo().recordJoin(mid)
  },

  /** Find all loved meetings */
  findLoved: async () => {
    return getFeedbackRepo().findLoved()
  },

  /** Find most recently joined meetings */
  findRecentlyJoined: async (limit = 10) => {
    return getFeedbackRepo().findRecentlyJoined(limit)
  },
}

// Re-export feedback types
export type { FeedbackRecord, FeedbackInput }

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

// ============================================================================
// Profile Repository (Secure - encrypted SQLite)
// ============================================================================

let _profileRepo: UserProfileSqliteRepository | null = null

function getProfileRepo(): UserProfileSqliteRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_profileRepo) _profileRepo = new UserProfileSqliteRepository(db as any)
  return _profileRepo
}

/**
 * Profile repository for secure storage of sensitive user data.
 *
 * Stores: shortName, pronouns, recoveryDate, fellowship, language
 */
export const profileRepository = {
  /**
   * Load profile data from SQLite
   * Returns null if no profile exists yet
   */
  load: async (): Promise<SecureProfileData | null> => {
    try {
      const record = await getProfileRepo().findDefault()
      if (!record) return null

      return {
        shortName: record.shortName || undefined,
        pronouns: (record.pronouns as SecureProfileData["pronouns"]) || undefined,
        recoveryDate: record.recoveryDate || undefined,
        fellowship: record.fellowship || undefined,
        language: record.language || undefined,
      }
    } catch (error) {
      log.error("profileRepository load error", { error: String(error) })
      return null
    }
  },

  /**
   * Save profile data to SQLite
   * Uses upsert - creates if not exists, updates if exists
   */
  save: async (data: SecureProfileData): Promise<void> => {
    try {
      await getProfileRepo().upsert({
        shortName: data.shortName,
        pronouns: data.pronouns,
        recoveryDate: data.recoveryDate,
        fellowship: data.fellowship,
        language: data.language,
      })
    } catch (error) {
      log.error("profileRepository save error", { error: String(error) })
    }
  },
}
