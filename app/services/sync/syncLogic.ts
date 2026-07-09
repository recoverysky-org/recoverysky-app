/**
 * Pure sync logic — record mapping and merge decisions for the /sync API.
 *
 * ZERO runtime imports from `@/` — this file is vitest-tested and vitest has
 * no path-alias config (see the project testing convention). Type-only
 * imports are erased at compile time and are safe.
 */
import type {
  AttendanceCreateInput,
  AttendanceRecord,
  AttendanceReportCreateInput,
  AttendanceReportUpdateInput,
  AttendanceUpdateInput,
} from "@recoverysky-org/common/sqlite"

/** Server push batch cap — a larger batch gets 400 badRequest. */
export const SYNC_PUSH_BATCH_MAX = 200

/**
 * The wire shape of an attendance record on /sync (attendanceRecordSchema).
 * `uid` and `updated` are server-stamped; we send them only to satisfy the
 * schema — the server ignores both.
 */
export interface ServerAttendanceRecord {
  id: string
  iid: string
  uid: string
  mid: string
  zid: string
  created: number
  valid: boolean
  uzid: string
  zpid: string
  zuid: string
  meetingHost: string
  meetingName: string
  meetingTopic: string
  archived: boolean
  events: { timestamp: number; message: string; json: string }[]
  processed: number
  start: number
  end: number
  credit: number
  produced: number
  arid: string
  deleted: boolean
  updated: number
}

/** The wire shape of a report on GET /sync/reports — metadata only, no html/text. */
export interface ServerReportRecord {
  id: string
  uid: string
  name: string
  email: string
  timezone: string
  generated: number
  confirmed: number
  confirmation: string
  error: boolean
  credit: number
  fid: string
  updated: number
  deleted: boolean
}

/**
 * Map a local attendance row to the push wire shape.
 * `deleted: true` builds a tombstone (used for the hard-delete snapshot path —
 * the local row is already gone by push time, so the caller passes the
 * pre-delete snapshot as `record`).
 */
export function toServerRecord(record: AttendanceRecord, deleted = false): ServerAttendanceRecord {
  return {
    id: record.id,
    iid: record.iid,
    uid: record.uid, // ignored by server (stamped from the Auth0 sub)
    mid: record.mid,
    zid: record.zid,
    created: record.created,
    valid: record.valid,
    uzid: record.uzid,
    zpid: record.zpid,
    zuid: record.zuid,
    meetingHost: record.meetingHost ?? "",
    meetingName: record.meetingName ?? "",
    meetingTopic: record.meetingTopic ?? "",
    archived: record.archived,
    events: record.events ?? [],
    processed: record.processed,
    start: record.start,
    end: record.end,
    credit: record.credit,
    produced: record.produced,
    arid: record.arid,
    deleted,
    updated: 0, // ignored by server (server-stamped receipt time)
  }
}

export type MergeAction = "skip-dirty" | "delete" | "update" | "create"

/**
 * Decide what to do with one pulled record.
 *
 * Order matters: dirty-skip is checked FIRST, even against tombstones — a
 * record with a pending outbound entry has a local edit that will push later
 * and win last-write-wins on the server. Applying the pull now would clobber
 * the user's unpushed change.
 */
export function mergePullDecision(input: {
  deleted: boolean
  hasPendingPush: boolean
  existsLocally: boolean
}): MergeAction {
  if (input.hasPendingPush) return "skip-dirty"
  if (input.deleted) return "delete"
  return input.existsLocally ? "update" : "create"
}

/** Pulled record → local create input. New rows adopt the server uid. */
export function toLocalCreate(server: ServerAttendanceRecord): AttendanceCreateInput {
  return {
    id: server.id,
    iid: server.iid,
    uid: server.uid,
    mid: server.mid,
    zid: server.zid,
    created: server.created,
    valid: server.valid,
    events: server.events,
    uzid: server.uzid,
    zpid: server.zpid,
    zuid: server.zuid,
    meetingHost: server.meetingHost,
    meetingName: server.meetingName,
    meetingTopic: server.meetingTopic,
    archived: server.archived,
    processed: server.processed,
    start: server.start,
    end: server.end,
    credit: server.credit,
    produced: server.produced,
    arid: server.arid,
  }
}

/**
 * Pulled record → local update input. AttendanceUpdateInput has no id/uid/
 * created fields, so existing rows keep their local uid — acceptable: the
 * attendance list queries findUnproduced/findArchived (not uid-filtered).
 */
export function toLocalUpdate(server: ServerAttendanceRecord): AttendanceUpdateInput {
  return {
    iid: server.iid,
    valid: server.valid,
    events: server.events,
    uzid: server.uzid,
    zpid: server.zpid,
    zuid: server.zuid,
    meetingHost: server.meetingHost,
    meetingName: server.meetingName,
    meetingTopic: server.meetingTopic,
    archived: server.archived,
    processed: server.processed,
    start: server.start,
    end: server.end,
    credit: server.credit,
    produced: server.produced,
    arid: server.arid,
  }
}

/** Pulled report → local create. Bodies (html/text) start empty because the
 * /sync/reports pull is metadata-only; backfillReportBodies() fills them in
 * during the same sync pass via GET /reports/:id, so a synced device holds a
 * complete local copy and the detail view never hits the network.
 * CHANGED 2026-07-09: was lazy-fetch-on-open. */
export function reportToLocalCreate(server: ServerReportRecord): AttendanceReportCreateInput {
  return {
    id: server.id,
    uid: server.uid,
    fid: server.fid,
    name: server.name,
    timezone: server.timezone,
    email: server.email,
    error: server.error,
    generated: server.generated,
    confirmed: server.confirmed,
    confirmation: server.confirmation,
    credit: server.credit,
  }
}

/**
 * Pulled report → local update. DELIBERATELY omits html/text/messageId/retry:
 * the sync pull is metadata-only, and an update that included empty bodies
 * would wipe the locally-stored rendered report. Preservation-by-omission.
 */
export function reportToLocalUpdate(server: ServerReportRecord): AttendanceReportUpdateInput {
  return {
    fid: server.fid,
    name: server.name,
    timezone: server.timezone,
    email: server.email,
    error: server.error,
    confirmed: server.confirmed,
    confirmation: server.confirmation,
    credit: server.credit,
  }
}

/** Split items into batches of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
