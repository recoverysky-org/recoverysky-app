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
  AttendanceReportSqliteRepository,
  FeedbackSqliteRepository,
  ChatMessageSqliteRepository,
  ZoomAuthSqliteRepository,
  type AttendanceCreateInput,
  type AttendanceUpdateInput,
  type AttendanceRecord,
  type AttendanceReportRecord,
  type AttendanceReportCreateInput,
  type AttendanceReportUpdateInput,
  type FeedbackRecord,
  type FeedbackInput,
  type ChatMessageRecord,
  type ChatMessageInput,
  type ZoomAuthRecord,
  type ZoomAuthCreateInput,
  type ZoomAuthUpdateInput,
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
let _chatMessageRepo: ChatMessageSqliteRepository | null = null
let _zoomAuthRepo: ZoomAuthSqliteRepository | null = null

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

  /** Find archived attendance records */
  findArchived: async () => {
    return getAttendanceRepo().findArchived()
  },

  /** Mark an attendance record as archived */
  markArchived: async (id: string) => {
    return getAttendanceRepo().markArchived(id)
  },

  /** Mark attendance as produced (link to a report, also archives) */
  markProduced: async (id: string, arid: string) => {
    return getAttendanceRepo().markProduced(id, arid)
  },

  /** Find attendance records linked to a specific report */
  findByReportId: async (arid: string) => {
    return getAttendanceRepo().findByReportId(arid)
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
// Attendance Report Repository
// ============================================================================

let _attendanceReportRepo: AttendanceReportSqliteRepository | null = null

function getAttendanceReportRepo(): AttendanceReportSqliteRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_attendanceReportRepo)
    _attendanceReportRepo = new AttendanceReportSqliteRepository(db as any)
  return _attendanceReportRepo
}

/**
 * Attendance report repository instance (lazy)
 *
 * Stores generated attendance reports with email delivery tracking.
 */
export const attendanceReportRepo = {
  /** Create a new attendance report */
  create: async (input: AttendanceReportCreateInput) => {
    return getAttendanceReportRepo().create(input)
  },

  /** Find report by ID */
  findById: async (id: string) => {
    return getAttendanceReportRepo().findById(id)
  },

  /** Find all reports for a user */
  findByUserId: async (uid: string) => {
    return getAttendanceReportRepo().findByUserId(uid)
  },

  /** Find all reports */
  findAll: async () => {
    return getAttendanceReportRepo().findAll()
  },

  /** Update a report */
  update: async (id: string, input: AttendanceReportUpdateInput) => {
    return getAttendanceReportRepo().update(id, input)
  },

  /** Mark report email as sent with confirmation ID */
  markEmailSent: async (id: string, confirmation: string) => {
    return getAttendanceReportRepo().markEmailSent(id, confirmation)
  },

  /** Delete a report */
  delete: async (id: string) => {
    return getAttendanceReportRepo().delete(id)
  },
}

// Re-export report types for convenience
export type { AttendanceReportRecord, AttendanceReportCreateInput, AttendanceReportUpdateInput }

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
// Chat Message Repository
// ============================================================================

function getChatMessageRepo(): ChatMessageSqliteRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_chatMessageRepo) _chatMessageRepo = new ChatMessageSqliteRepository(db as any)
  return _chatMessageRepo
}

/**
 * Chat message repository instance (lazy)
 *
 * Stores AI agent conversation messages for persistence across app restarts.
 * Messages include tool invocations serialized as JSON for conversation continuity.
 */
export const chatMessageRepo = {
  /** Find all messages ordered by createdAt */
  findAll: async () => {
    return getChatMessageRepo().findAll()
  },

  /** Find message by ID */
  findById: async (id: string) => {
    return getChatMessageRepo().findById(id)
  },

  /** Create a new message */
  create: async (input: ChatMessageInput) => {
    return getChatMessageRepo().create(input)
  },

  /** Create multiple messages (bulk insert) */
  createMany: async (inputs: ChatMessageInput[]) => {
    return getChatMessageRepo().createMany(inputs)
  },

  /** Clear all messages (delete conversation history) */
  clear: async () => {
    return getChatMessageRepo().clear()
  },

  /** Delete messages older than timestamp */
  deleteOlderThan: async (timestamp: number) => {
    return getChatMessageRepo().deleteOlderThan(timestamp)
  },

  /** Delete a specific message */
  delete: async (id: string) => {
    return getChatMessageRepo().delete(id)
  },

  /** Get message count */
  count: async () => {
    return getChatMessageRepo().count()
  },
}

// Re-export chat message types
export type { ChatMessageRecord, ChatMessageInput }

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
   * Uses upsert - creates if not exists, updates only provided fields if exists
   */
  save: async (data: SecureProfileData): Promise<void> => {
    try {
      log.debug("Saving profile to SQLite", { fields: Object.keys(data).join(",") })
      await getProfileRepo().upsert({
        shortName: data.shortName,
        pronouns: data.pronouns,
        recoveryDate: data.recoveryDate,
        fellowship: data.fellowship,
        language: data.language,
      })
      log.debug("Profile saved successfully")
    } catch (error) {
      log.error("profileRepository save error", { error: String(error) })
    }
  },
}

// ============================================================================
// Zoom Auth Repository (Secure - encrypted SQLite)
// ============================================================================

function getZoomAuthRepo(): ZoomAuthSqliteRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_zoomAuthRepo) _zoomAuthRepo = new ZoomAuthSqliteRepository(db as any)
  return _zoomAuthRepo
}

/**
 * Zoom auth repository for secure storage of OAuth tokens.
 *
 * Stores: accessToken, refreshToken, zoomUserId, zoomEmail, zoomDisplayName
 * Tokens are encrypted at the database level via SQLCipher.
 */
export const zoomAuthRepo = {
  /** Find zoom auth by device ID */
  findById: async (id: string) => {
    return getZoomAuthRepo().findById(id)
  },

  /** Create new zoom auth record */
  create: async (input: ZoomAuthCreateInput) => {
    return getZoomAuthRepo().create(input)
  },

  /** Update existing zoom auth record */
  update: async (id: string, input: ZoomAuthUpdateInput) => {
    return getZoomAuthRepo().update(id, input)
  },

  /** Create or update zoom auth record (upsert) */
  upsert: async (input: ZoomAuthCreateInput) => {
    return getZoomAuthRepo().upsert(input)
  },

  /** Delete zoom auth record (disconnect) */
  delete: async (id: string) => {
    return getZoomAuthRepo().delete(id)
  },

  /** Check if access token is expired */
  isExpired: (record: ZoomAuthRecord): boolean => {
    const bufferMs = 5 * 60 * 1000 // 5 minutes
    return Date.now() >= record.expiresAt - bufferMs
  },
}

// Re-export zoom auth types
export type { ZoomAuthRecord, ZoomAuthCreateInput, ZoomAuthUpdateInput }
