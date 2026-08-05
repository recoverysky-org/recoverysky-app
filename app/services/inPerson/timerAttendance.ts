/**
 * In-Person Timer Attendance
 *
 * Writes attendance records for face-to-face meetings, from a GPS-verified
 * timer session. Directly modeled on app/services/zoom/externalAttendance.ts
 * (same create → events → markProcessed-with-retry → meetingEvents sequence);
 * see that file for the timer-vs-SDK precedent this pattern originates from.
 *
 * REPLACES saveInPersonAttendance (deleted 2026-08-05), which wrote a finished
 * record from a single tap using the meeting's scheduled duration. Attendance
 * is now real elapsed time, gated at the start on the user actually being at
 * the venue.
 *
 * PRIVACY: the verified fix IS written here, into the record's event JSON, and
 * syncs to the server with the record. That is a deliberate, documented
 * amendment to the coordinates-never-persist rule — see the spec's "Privacy
 * policy amendment". Nothing in this file LOGS the fix or the distance.
 */

import * as Crypto from "expo-crypto"

import { attendanceRepo, attendanceEvents, type AttendanceEvent } from "@/db"
import { meetingEvents } from "@/db/meetingEvents"
import type { PersistedPresence } from "@/services/attendance"
import { EXTERNAL_MIN_CREDIT_MS } from "@/services/zoom"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "InPersonTimerAttendance" })

const SOURCE = { source: "in-person" }

export interface InPersonTimerAttendanceInput {
  uid: string
  mid: string
  zid: string
  meetingName: string
  startedAt: number
  endedAt: number
  presence: PersistedPresence
}

export interface InPersonTimerAttendanceResult {
  ok: boolean
  attendanceId?: string
  valid?: boolean
  creditMs?: number
}

/**
 * The event trail for a verified in-person session.
 *
 * The opening event carries the proof: where the user was, how accurate the
 * fix was, how far from the venue, and the radius in force at the time.
 * `radiusM` is recorded deliberately — a year from now you can tell whether a
 * record was verified under a 150 m rule or a retuned one without having to
 * correlate against server config history.
 */
function buildInPersonEvents(
  startedAt: number,
  endedAt: number,
  presence: PersistedPresence,
): AttendanceEvent[] {
  return [
    {
      timestamp: startedAt,
      message: "Verified present at in-person meeting",
      json: JSON.stringify({ ...SOURCE, verified: true, ...presence }),
    },
    {
      timestamp: endedAt,
      message: "Timer saved",
      json: JSON.stringify({ ...SOURCE, durationMs: endedAt - startedAt }),
    },
  ]
}

export async function saveInPersonTimerAttendance(
  input: InPersonTimerAttendanceInput,
): Promise<InPersonTimerAttendanceResult> {
  const credit = input.endedAt - input.startedAt
  const valid = credit >= EXTERNAL_MIN_CREDIT_MS
  const attendanceId = Crypto.randomUUID()

  // PRIVACY: mid/zid/credit only. Never spread `input` — it carries the fix.
  log.info("Saving in-person timer attendance", {
    attendanceId,
    mid: input.mid,
    zid: input.zid,
    creditMs: credit,
    valid,
  })

  const createResult = await attendanceRepo.create({
    id: attendanceId,
    uid: input.uid,
    mid: input.mid,
    zid: input.zid,
    meetingName: input.meetingName,
    created: input.startedAt,
    events: buildInPersonEvents(input.startedAt, input.endedAt, input.presence),
  })

  if (!createResult.ok) {
    log.error("In-person attendance create failed", { attendanceId, mid: input.mid })
    return { ok: false }
  }

  attendanceEvents.emit({ type: "created", id: attendanceId })

  // Retry markProcessed with exponential backoff. Without this, a transient DB
  // error (lock contention, brief I/O stall) between `create` and
  // `markProcessed` leaves an orphaned unprocessed record the user can neither
  // see nor recover. Retries keep the two phases paired in the common failure
  // modes; the final failure still surfaces for callers to act on.
  const MARK_PROCESSED_RETRIES = 3
  const MARK_PROCESSED_BACKOFF_MS = [500, 1500, 4500]
  const processArgs = { start: input.startedAt, end: input.endedAt, credit, valid }

  let processResult = await attendanceRepo.markProcessed(attendanceId, processArgs)

  for (let attempt = 0; !processResult.ok && attempt < MARK_PROCESSED_RETRIES; attempt++) {
    const delay = MARK_PROCESSED_BACKOFF_MS[attempt]
    log.warn("In-person attendance markProcessed failed, retrying", {
      attendanceId,
      mid: input.mid,
      attempt: attempt + 1,
      delayMs: delay,
    })
    await new Promise<void>((resolve) => setTimeout(resolve, delay))
    processResult = await attendanceRepo.markProcessed(attendanceId, processArgs)
  }

  if (!processResult.ok) {
    log.error("In-person attendance markProcessed failed after retries", {
      attendanceId,
      mid: input.mid,
      attempts: MARK_PROCESSED_RETRIES + 1,
    })
    return { ok: false, attendanceId }
  }

  log.info("In-person timer attendance saved", {
    attendanceId,
    mid: input.mid,
    valid,
    creditMs: credit,
  })
  attendanceEvents.emit({
    type: "processed",
    id: attendanceId,
    mid: input.mid,
    valid,
    source: "in-person",
  })

  // Rating-engine tally, gated on `valid` exactly as the external-Zoom path is:
  // a save below the credit floor still creates a record (marked invalid) and
  // those must not count as "a meeting" to the rating system.
  //
  // CHANGED 2026-08-05: the deleted saveInPersonAttendance fired this
  // unconditionally, because presence was user-confirmed by a tap and there
  // was no elapsed time to judge. There is now, so in-person gates like
  // everything else.
  if (valid) {
    meetingEvents.completed("in-person")
  }

  return { ok: true, attendanceId, valid, creditMs: credit }
}
