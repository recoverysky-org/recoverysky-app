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
  ReminderSqliteRepository,
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
  type ReminderRecord,
  type ReminderCreateInput,
  type ReminderUpdateInput,
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
 * Sync queue repository instance (lazy) — the durable outbox for cloud sync.
 *
 * Queue rows for create/update carry only recordId (current row data is read
 * at push time so N edits collapse to one push); delete rows carry a JSON
 * snapshot payload for tombstone construction.
 */
function getSyncQueueRepo(): SyncQueueRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_syncQueueRepo) _syncQueueRepo = new SyncQueueRepository(db as any)
  return _syncQueueRepo
}

export const syncQueueRepo = {
  enqueue: async (input: {
    tableName: string
    recordId: string
    operation: "create" | "update" | "delete"
    payload?: string
  }) => {
    return getSyncQueueRepo().enqueue(input)
  },

  /** Pending + retryable-failed items, FIFO */
  getPending: async (maxRetries?: number) => {
    return getSyncQueueRepo().getPending(maxRetries)
  },

  markSynced: async (id: string) => {
    return getSyncQueueRepo().markSynced(id)
  },

  markFailed: async (id: string, errorMessage: string) => {
    return getSyncQueueRepo().markFailed(id, errorMessage)
  },

  deleteItem: async (id: string) => {
    return getSyncQueueRepo().delete(id)
  },

  /**
   * Delete every pending/retryable item. Called on logout — user A's queued
   * records must never be pushed under user B's token (the server would
   * stamp them with B's uid).
   *
   * CRITICAL: Must surface any delete failures. A failed delete leaves user A's
   * records in the outbox; the logout flow would report "queue empty" to the
   * auth store, but those rows persist and get pushed to the server under user
   * B's token with B's uid — a cross-account data leak. This function returns
   * failure if any individual delete fails so callers can abort the logout flow
   * and alert the user, not silently leak queued data.
   */
  clearPending: async () => {
    const pending = await getSyncQueueRepo().getPending()
    if (!pending.ok) return pending

    const failedIds: string[] = []
    for (const item of pending.value) {
      const deleteResult = await getSyncQueueRepo().delete(item.id)
      if (!deleteResult.ok) {
        failedIds.push(item.id)
      }
    }

    if (failedIds.length > 0) {
      const error = new Error(
        `clearPending: ${failedIds.length} of ${pending.value.length} deletes failed: ${failedIds.join(", ")}`,
      )
      log.error("clearPending partial failure", {
        failedIdCount: failedIds.length,
        totalPending: pending.value.length,
        failedIdList: failedIds.join(", "),
      })
      return { ok: false as const, error }
    }

    return { ok: true as const, value: pending.value.length }
  },
}

// ============================================================================
// Attendance mutation hook (cloud sync outbox)
// ============================================================================

export type AttendanceMutationOp = "create" | "update" | "delete"

export interface AttendanceMutation {
  recordId: string
  operation: AttendanceMutationOp
  /** Pre-delete row snapshot — only present on "delete". The sync push builds
   * a deleted:true tombstone from this because the row is gone by push time. */
  snapshot?: AttendanceRecord
}

// Single choke point for the sync outbox: every app-side attendance mutation
// flows through the attendanceRepo wrappers below, so one hook here covers
// externalAttendance, useReportSender, AttendanceScreen edits, and
// NinetyInNinetyCard — and any future mutation site — with zero call-site
// changes. The sync service registers itself at init
// (app/services/sync/index.ts). Pull-merge writes go through
// attendanceSyncWriter instead, which deliberately does NOT notify — pulled
// records must never re-enqueue themselves.
let attendanceMutationHook: ((m: AttendanceMutation) => void) | null = null

export function setAttendanceMutationHook(fn: ((m: AttendanceMutation) => void) | null): void {
  attendanceMutationHook = fn
}

function notifyAttendanceMutation(m: AttendanceMutation): void {
  // Isolated: a throwing hook must never break the mutation that already succeeded.
  try {
    attendanceMutationHook?.(m)
  } catch (err) {
    log.error("attendanceMutationHook threw (isolated)", { error: String(err) })
  }
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
    const result = await getAttendanceRepo().create(input)
    // create() resolves to the new row id; prefer it over input.id (which is optional)
    if (result.ok) notifyAttendanceMutation({ recordId: result.value, operation: "create" })
    return result
  },

  /** Find attendance by ID */
  findById: async (id: string) => {
    return getAttendanceRepo().findById(id)
  },

  /** Find multiple attendance records by id (sync push reads current rows) */
  findByIds: async (ids: string[]) => {
    return getAttendanceRepo().findByIds(ids)
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
    const result = await getAttendanceRepo().markArchived(id)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
  },

  /** Mark attendance as produced (link to a report, also archives) */
  markProduced: async (id: string, arid: string) => {
    const result = await getAttendanceRepo().markProduced(id, arid)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
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
    const result = await getAttendanceRepo().addEvent(id, event)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
  },

  /** Update an attendance record */
  update: async (id: string, input: AttendanceUpdateInput) => {
    const result = await getAttendanceRepo().update(id, input)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
  },

  /** Mark attendance as processed with calculated values */
  markProcessed: async (
    id: string,
    data: { start: number; end: number; credit: number; valid: boolean },
  ) => {
    const result = await getAttendanceRepo().markProcessed(id, data)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
  },

  /** Get total credit for a user */
  getTotalCreditForUser: async (uid: string) => {
    return getAttendanceRepo().getTotalCreditForUser(uid)
  },

  /** Delete an attendance record (hard delete — NinetyInNinetyCard cleanup).
   * Snapshot the row FIRST: the sync tombstone push needs the full record
   * after the row is gone. */
  delete: async (id: string) => {
    const existing = await getAttendanceRepo().findById(id)
    // Note: snapshot === undefined collapses two distinct cases: (1) row
    // genuinely not found, or (2) the read itself failed. Either way, the
    // tombstone has no payload to serialize. This is by design.
    const snapshot = existing.ok && existing.value ? existing.value : undefined
    const result = await getAttendanceRepo().delete(id)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "delete", snapshot })
    return result
  },
}

/**
 * Hook-bypassing writes for the sync pull-merge path.
 *
 * INVARIANT: nothing in here calls notifyAttendanceMutation. Records applied
 * from a server pull must not re-enter the sync outbox — that would echo
 * every pulled record straight back to the server forever.
 */
export const attendanceSyncWriter = {
  exists: async (id: string): Promise<boolean> => {
    const result = await getAttendanceRepo().findById(id)
    return result.ok && result.value !== null
  },

  createFromServer: async (input: AttendanceCreateInput) => {
    return getAttendanceRepo().create(input)
  },

  updateFromServer: async (id: string, input: AttendanceUpdateInput) => {
    return getAttendanceRepo().update(id, input)
  },

  /** Apply a pulled tombstone: hard-delete the local row. */
  remove: async (id: string) => {
    return getAttendanceRepo().delete(id)
  },

  reportExists: async (id: string): Promise<boolean> => {
    const result = await getAttendanceReportRepo().findById(id)
    return result.ok && result.value !== null
  },

  reportCreateFromServer: async (input: AttendanceReportCreateInput) => {
    return getAttendanceReportRepo().create(input)
  },

  reportUpdateFromServer: async (id: string, input: AttendanceReportUpdateInput) => {
    return getAttendanceReportRepo().update(id, input)
  },

  reportRemove: async (id: string) => {
    return getAttendanceReportRepo().delete(id)
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

  /** Find all unconfirmed, non-error reports (pending delivery) */
  findUnconfirmed: async () => {
    const result = await getAttendanceReportRepo().findAll()
    if (!result.ok) return result
    return { ok: true as const, value: result.value.filter((r) => r.confirmed === 0 && !r.error) }
  },

  /** Update a report */
  update: async (id: string, input: AttendanceReportUpdateInput) => {
    return getAttendanceReportRepo().update(id, input)
  },

  /** Mark report as confirmed sent with confirmation ID */
  markConfirmed: async (id: string, confirmation: string) => {
    return getAttendanceReportRepo().markConfirmed(id, confirmation)
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
// Reminder Repository
// ============================================================================

let _reminderRepo: ReminderSqliteRepository | null = null

function getReminderRepo(): ReminderSqliteRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_reminderRepo) _reminderRepo = new ReminderSqliteRepository(db as any)
  return _reminderRepo
}

/**
 * Reminder repository instance (lazy)
 *
 * Stores user reminders for upcoming meetings with timezone-aware scheduling.
 */
export const reminderRepo = {
  /** Create a new reminder */
  create: async (input: ReminderCreateInput) => {
    return getReminderRepo().create(input)
  },

  /** Find reminder by ID */
  findById: async (id: string) => {
    return getReminderRepo().findById(id)
  },

  /** Find all reminders for a user */
  findByUserId: async (uid: string) => {
    return getReminderRepo().findByUserId(uid)
  },

  /** Find all reminders for a meeting */
  findByMeetingId: async (mid: string) => {
    return getReminderRepo().findByMeetingId(mid)
  },

  /** Find a user's reminder for a specific meeting */
  findByUserAndMeeting: async (uid: string, mid: string) => {
    return getReminderRepo().findByUserAndMeeting(uid, mid)
  },

  /** Find all enabled reminders for a user */
  findEnabledByUserId: async (uid: string) => {
    return getReminderRepo().findEnabledByUserId(uid)
  },

  /** Update a reminder */
  update: async (id: string, input: ReminderUpdateInput) => {
    return getReminderRepo().update(id, input)
  },

  /** Toggle enabled status */
  toggleEnabled: async (id: string) => {
    return getReminderRepo().toggleEnabled(id)
  },

  /** Delete a reminder */
  delete: async (id: string) => {
    return getReminderRepo().delete(id)
  },

  /** Delete all reminders for a user */
  deleteByUserId: async (uid: string) => {
    return getReminderRepo().deleteByUserId(uid)
  },
}

// Re-export reminder types
export type { ReminderRecord, ReminderCreateInput, ReminderUpdateInput }

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
        userIdNum: record.userIdNum ?? undefined,
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
        userIdNum: data.userIdNum,
      })
      log.debug("Profile saved successfully")
    } catch (error) {
      log.error("profileRepository save error", { error: String(error) })
    }
  },
}
