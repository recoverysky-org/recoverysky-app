/**
 * Database Seeding
 *
 * Loads initial data from bundled JSON files into SQLite.
 * Only runs on first launch (tracked via MMKV flag).
 */

import { SQLiteDatabase } from "expo-sqlite"
import { loadString, saveString } from "@/utils/storage"

const SEED_FLAG_KEY = "db_seeded_v1"

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

/**
 * Seed the database with data from JSON files
 * Uses batch inserts with transactions for performance
 */
export async function seedDatabase(db: SQLiteDatabase): Promise<void> {
  if (isDatabaseSeeded()) {
    console.log("[seedDatabase] Already seeded, skipping...")
    return
  }

  console.log("[seedDatabase] Starting database seeding...")
  const startTime = Date.now()

  try {
    // Load JSON files
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const meetingsData = require("../data/meetings.json") as MeetingRow[]
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const schedulesData = require("../data/schedules.json") as ScheduleRow[]
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const trexesData = require("../data/trexes.json") as TrexRow[]
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const scheduleMeetingsData = require("../data/schedule_meetings.json") as ScheduleMeetingRow[]

    console.log(`[seedDatabase] Loaded: ${meetingsData.length} meetings, ${schedulesData.length} schedules, ${trexesData.length} trexes`)

    // Insert in order (respect foreign keys)
    await insertSchedules(db, schedulesData)
    await insertMeetings(db, meetingsData)
    await insertTrexes(db, trexesData)
    await insertScheduleMeetings(db, scheduleMeetingsData)

    markDatabaseSeeded()

    const elapsed = Date.now() - startTime
    console.log(`[seedDatabase] Seeding complete in ${elapsed}ms`)
  } catch (error) {
    console.error("[seedDatabase] Seeding failed:", error)
    throw error
  }
}

// Type definitions for JSON data
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
  zids: string
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
  rrule_json: string
  hour: number | null
  minute: number | null
  dow: number | null
  dom: number | null
  month: number | null
}

interface ScheduleMeetingRow {
  schedule_id: string
  meeting_id: string
}

const BATCH_SIZE = 500

async function insertSchedules(db: SQLiteDatabase, data: ScheduleRow[]): Promise<void> {
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
      values
    )
  }
}

async function insertMeetings(db: SQLiteDatabase, data: MeetingRow[]): Promise<void> {
  console.log(`[seedDatabase] Inserting ${data.length} meetings...`)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")
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
      values
    )
  }
}

async function insertTrexes(db: SQLiteDatabase, data: TrexRow[]): Promise<void> {
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
      values
    )
  }
}

async function insertScheduleMeetings(db: SQLiteDatabase, data: ScheduleMeetingRow[]): Promise<void> {
  console.log(`[seedDatabase] Inserting ${data.length} schedule_meetings...`)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const placeholders = batch.map(() => "(?, ?)").join(", ")
    const values = batch.flatMap((sm) => [sm.schedule_id, sm.meeting_id])

    db.runSync(
      `INSERT OR REPLACE INTO schedule_meetings (schedule_id, meeting_id) VALUES ${placeholders}`,
      values
    )
  }
}
