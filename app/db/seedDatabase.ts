/**
 * Database Seeding
 *
 * Loads initial data from bundled JSON files into SQLite.
 * Transforms denormalized JSON into normalized SQLite tables.
 * Only runs on first launch (tracked via MMKV flag).
 */

import { SQLiteDatabase } from "expo-sqlite"

import { loadString, saveString, remove } from "@/utils/storage"

const SEED_FLAG_KEY = "db_seeded_v2"

// ============================================================================
// Progress Reporting
// ============================================================================

export interface SeedProgress {
  /** Current step number (1-based) */
  step: number
  /** Total number of steps */
  totalSteps: number
  /** Human-readable step name */
  stepName: string
  /** i18n key for the step */
  stepKey: string
  /** Records inserted in current step */
  current: number
  /** Total records to insert in current step */
  total: number
}

export type SeedProgressCallback = (progress: SeedProgress) => void

/**
 * Force re-seed if EXPO_PUBLIC_RESEED_DB=true
 * Set this in .env or run: EXPO_PUBLIC_RESEED_DB=true npm start
 */
if (process.env.EXPO_PUBLIC_RESEED_DB === "true") {
  console.log("[seedDatabase] EXPO_PUBLIC_RESEED_DB=true, clearing seed flag...")
  remove(SEED_FLAG_KEY)
}

/**
 * Check if database has been seeded
 */
export function isDatabaseSeeded(): boolean {
  const flag = loadString(SEED_FLAG_KEY)
  return flag === "true"
}

/**
 * Mark database as seeded
 */
function markDatabaseSeeded(): void {
  saveString(SEED_FLAG_KEY, "true")
}

// ============================================================================
// Raw JSON Types (denormalized source data)
// ============================================================================

interface RawMeeting {
  id: string
  iid: string
  uid: string
  zid: string
  sid: string
  status: string
  verified: string
  locked: boolean
  created: string
  updated: string
  version: number
  url: string
  password: string
  passwordEnc: string
  fellowship: string
  language: string
  closed: boolean
  requiresLogin: boolean
  restricted: boolean
  restrictedDescription: string
  description: string
  email: string
  name: string
  phone: string
  website: string
  conferencePhone: string
  location: string
  sha256: string
  meetingTypes: string[]
  tags: string[]
}

interface RawSchedule {
  id: string
  status: string
  name: string
  fellowship: string
  created: string
  updated: string
  version: number
  sha256: string
  mids: string[]
  zids: string[]
}

interface RawTrex {
  id: string
  coordinate: number
  coordinate_end: number
  timezone: string
  periodicity: number
  duration_ms: number
  dtstart: string
  dtend: string | null
  rrule_str: string
  rrule_json: Record<string, unknown>
  hour: number | null
  minute: number | null
  dow: number | null
  dom: number | null
  month: number | null
}

// ============================================================================
// Normalized SQLite Row Types
// ============================================================================

interface MeetingRow {
  id: string
  iid: string
  uid: string
  zid: string
  sid: string
  status: string
  verified: string
  locked: number
  created: string
  updated: string
  version: number
  url: string
  password: string
  passwordEnc: string
  fellowship: string
  language: string
  closed: number
  requiresLogin: number
  restricted: number
  restrictedDescription: string
  description: string
  email: string
  name: string
  phone: string
  website: string
  conferencePhone: string
  location: string
  sha256: string
}

interface ScheduleRow {
  id: string
  status: string
  zids: string // JSON stringified
  name: string
  fellowship: string
  created: string
  updated: string
  version: number
  sha256: string
}

interface TrexRow {
  id: string
  coordinate: number
  coordinate_end: number
  timezone: string
  periodicity: number
  duration_ms: number
  dtstart: string
  dtend: string | null
  rrule_str: string
  rrule_json: string // JSON stringified
  hour: number | null
  minute: number | null
  dow: number | null
  dom: number | null
  month: number | null
}

interface MeetingTypeRow {
  meeting_id: string
  type: string
}

interface MeetingTagRow {
  meeting_id: string
  tag: string
}

interface ScheduleMeetingRow {
  schedule_id: string
  meeting_id: string
}

// ============================================================================
// Transform Functions
// ============================================================================

function transformMeeting(raw: RawMeeting): {
  meeting: MeetingRow
  types: MeetingTypeRow[]
  tags: MeetingTagRow[]
} {
  return {
    meeting: {
      id: raw.id,
      iid: raw.iid,
      uid: raw.uid,
      zid: raw.zid,
      sid: raw.sid,
      status: raw.status,
      verified: raw.verified,
      locked: raw.locked ? 1 : 0,
      created: raw.created,
      updated: raw.updated,
      version: raw.version,
      url: raw.url,
      password: raw.password,
      passwordEnc: raw.passwordEnc,
      fellowship: raw.fellowship,
      language: raw.language,
      closed: raw.closed ? 1 : 0,
      requiresLogin: raw.requiresLogin ? 1 : 0,
      restricted: raw.restricted ? 1 : 0,
      restrictedDescription: raw.restrictedDescription,
      description: raw.description,
      email: raw.email,
      name: raw.name,
      phone: raw.phone,
      website: raw.website,
      conferencePhone: raw.conferencePhone,
      location: raw.location,
      sha256: raw.sha256,
    },
    types: raw.meetingTypes.map((type) => ({
      meeting_id: raw.id,
      type,
    })),
    tags: raw.tags.map((tag) => ({
      meeting_id: raw.id,
      tag,
    })),
  }
}

function transformSchedule(raw: RawSchedule): {
  schedule: ScheduleRow
  scheduleMeetings: ScheduleMeetingRow[]
} {
  return {
    schedule: {
      id: raw.id,
      status: raw.status,
      zids: JSON.stringify(raw.zids),
      name: raw.name,
      fellowship: raw.fellowship,
      created: raw.created,
      updated: raw.updated,
      version: raw.version,
      sha256: raw.sha256,
    },
    scheduleMeetings: raw.mids.map((mid) => ({
      schedule_id: raw.id,
      meeting_id: mid,
    })),
  }
}

function transformTrex(raw: RawTrex): TrexRow {
  return {
    id: raw.id,
    coordinate: raw.coordinate,
    coordinate_end: raw.coordinate_end,
    timezone: raw.timezone,
    periodicity: raw.periodicity,
    duration_ms: raw.duration_ms,
    dtstart: raw.dtstart,
    dtend: raw.dtend,
    rrule_str: raw.rrule_str,
    rrule_json: JSON.stringify(raw.rrule_json),
    hour: raw.hour,
    minute: raw.minute,
    dow: raw.dow,
    dom: raw.dom,
    month: raw.month,
  }
}

// ============================================================================
// Batch Insert Functions
// ============================================================================

const BATCH_SIZE = 500

async function insertSchedules(
  db: SQLiteDatabase,
  data: ScheduleRow[],
  onBatch?: (inserted: number) => void,
): Promise<void> {
  console.log(`[seedDatabase] Inserting ${data.length} schedules...`)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")
    const values = batch.flatMap((s) => [
      s.id,
      s.status,
      s.zids,
      s.name,
      s.fellowship,
      s.created,
      s.updated,
      s.version,
      s.sha256,
    ])

    db.runSync(
      `INSERT OR REPLACE INTO schedules (id, status, zids, name, fellowship, created, updated, version, sha256) VALUES ${placeholders}`,
      values,
    )
    onBatch?.(Math.min(i + BATCH_SIZE, data.length))
  }
}

async function insertMeetings(
  db: SQLiteDatabase,
  data: MeetingRow[],
  onBatch?: (inserted: number) => void,
): Promise<void> {
  console.log(`[seedDatabase] Inserting ${data.length} meetings...`)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const placeholders = batch
      .map(
        () =>
          "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .join(", ")
    const values = batch.flatMap((m) => [
      m.id,
      m.iid,
      m.uid,
      m.zid,
      m.sid,
      m.status,
      m.verified,
      m.locked,
      m.created,
      m.updated,
      m.version,
      m.url,
      m.password,
      m.passwordEnc,
      m.fellowship,
      m.language,
      m.closed,
      m.requiresLogin,
      m.restricted,
      m.restrictedDescription,
      m.description,
      m.email,
      m.name,
      m.phone,
      m.website,
      m.conferencePhone,
      m.location,
      m.sha256,
    ])

    db.runSync(
      `INSERT OR REPLACE INTO meetings (id, iid, uid, zid, sid, status, verified, locked, created, updated, version, url, password, passwordEnc, fellowship, language, closed, requiresLogin, restricted, restrictedDescription, description, email, name, phone, website, conferencePhone, location, sha256) VALUES ${placeholders}`,
      values,
    )
    onBatch?.(Math.min(i + BATCH_SIZE, data.length))
  }
}

async function insertTrexes(
  db: SQLiteDatabase,
  data: TrexRow[],
  onBatch?: (inserted: number) => void,
): Promise<void> {
  console.log(`[seedDatabase] Inserting ${data.length} trexes...`)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")
    const values = batch.flatMap((t) => [
      t.id,
      t.coordinate,
      t.coordinate_end,
      t.timezone,
      t.periodicity,
      t.duration_ms,
      t.dtstart,
      t.dtend,
      t.rrule_str,
      t.rrule_json,
      t.hour,
      t.minute,
      t.dow,
      t.dom,
      t.month,
    ])

    db.runSync(
      `INSERT OR REPLACE INTO trexes (id, coordinate, coordinate_end, timezone, periodicity, duration_ms, dtstart, dtend, rrule_str, rrule_json, hour, minute, dow, dom, month) VALUES ${placeholders}`,
      values,
    )
    onBatch?.(Math.min(i + BATCH_SIZE, data.length))
  }
}

async function insertMeetingTypes(
  db: SQLiteDatabase,
  data: MeetingTypeRow[],
  onBatch?: (inserted: number) => void,
): Promise<void> {
  console.log(`[seedDatabase] Inserting ${data.length} meeting_types...`)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const placeholders = batch.map(() => "(?, ?)").join(", ")
    const values = batch.flatMap((mt) => [mt.meeting_id, mt.type])

    db.runSync(
      `INSERT OR REPLACE INTO meeting_types (meeting_id, type) VALUES ${placeholders}`,
      values,
    )
    onBatch?.(Math.min(i + BATCH_SIZE, data.length))
  }
}

async function insertMeetingTags(
  db: SQLiteDatabase,
  data: MeetingTagRow[],
  onBatch?: (inserted: number) => void,
): Promise<void> {
  if (data.length === 0) {
    console.log(`[seedDatabase] No meeting_tags to insert`)
    onBatch?.(0)
    return
  }

  console.log(`[seedDatabase] Inserting ${data.length} meeting_tags...`)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const placeholders = batch.map(() => "(?, ?)").join(", ")
    const values = batch.flatMap((mt) => [mt.meeting_id, mt.tag])

    db.runSync(
      `INSERT OR REPLACE INTO meeting_tags (meeting_id, tag) VALUES ${placeholders}`,
      values,
    )
    onBatch?.(Math.min(i + BATCH_SIZE, data.length))
  }
}

async function insertScheduleMeetings(
  db: SQLiteDatabase,
  data: ScheduleMeetingRow[],
  onBatch?: (inserted: number) => void,
): Promise<void> {
  console.log(`[seedDatabase] Inserting ${data.length} schedule_meetings...`)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const placeholders = batch.map(() => "(?, ?)").join(", ")
    const values = batch.flatMap((sm) => [sm.schedule_id, sm.meeting_id])

    db.runSync(
      `INSERT OR REPLACE INTO schedule_meetings (schedule_id, meeting_id) VALUES ${placeholders}`,
      values,
    )
    onBatch?.(Math.min(i + BATCH_SIZE, data.length))
  }
}

// ============================================================================
// Main Seed Function
// ============================================================================

/** Seed steps with i18n keys */
const SEED_STEPS = [
  { name: "Loading data", key: "database:seedingLoading" },
  { name: "Schedules", key: "database:seedingSchedules" },
  { name: "Meetings", key: "database:seedingMeetings" },
  { name: "Recurrence data", key: "database:seedingTrexes" },
  { name: "Meeting types", key: "database:seedingTypes" },
  { name: "Finalizing", key: "database:seedingFinalizing" },
] as const

/**
 * Seed the database with initial data.
 *
 * NOTE: Currently no data needs seeding - meetings/schedules/trexes come from API.
 * This function is kept for future use if local seed data is needed.
 *
 * @param db - SQLite database instance
 * @param onProgress - Optional callback for progress updates
 */
export async function seedDatabase(
  _db: SQLiteDatabase,
  _onProgress?: SeedProgressCallback,
): Promise<void> {
  if (isDatabaseSeeded()) {
    console.log("[seedDatabase] Already seeded, skipping...")
    return
  }

  // No data to seed currently - meetings/schedules/trexes come from API
  // Just mark as seeded immediately
  console.log("[seedDatabase] No seed data required, marking as seeded...")
  markDatabaseSeeded()
}
