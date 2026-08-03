/**
 * In-Person Attendance
 *
 * Writes attendance records for face-to-face meetings marked present via the
 * "I'm Here" in-person flow (Task 9's popup). Unlike the external-Zoom timer
 * path, presence here is user-confirmed at the point of tapping "I'm Here" —
 * there's no elapsed-time credit gate, so `valid` is always true. Modeled
 * directly on app/services/zoom/externalAttendance.ts (same create → events
 * → markProcessed-with-retry → meetingEvents sequence); see that file for the
 * SDK-vs-external-timer precedent this pattern originates from.
 */

import * as Crypto from "expo-crypto"

import { attendanceRepo, attendanceEvents, type AttendanceEvent } from "@/db"
import { meetingEvents } from "@/db/meetingEvents"
import { logger } from "@/utils/logger"
import { isSameLocalDay } from "@/utils/nearbyLogic"

const log = logger.child({ module: "InPersonAttendance" })

const SOURCE = { source: "in-person" }

export interface InPersonAttendanceInput {
  uid: string
  mid: string
  zid: string
  meetingName: string
  durationMs: number
}

export interface InPersonAttendanceResult {
  ok: boolean
  attendanceId?: string
  /** True when a record for this meeting already exists today — no write done */
  alreadyLogged?: boolean
}

/**
 * True when an attendance record for this meeting was already created
 * today (device-local day). Backs the "I'm Here" double-log guard and the
 * popup's logged-✓ state. Fails open (false) on repo errors — a second
 * record is more recoverable than a blocked first one.
 */
export async function hasLoggedToday(mid: string): Promise<boolean> {
  const result = await attendanceRepo.findByMeetingId(mid)
  if (!result.ok) return false
  const now = Date.now()
  return result.value.some((r) => isSameLocalDay(r.created, now))
}

/**
 * Create a processed, valid attendance record for an in-person "I'm Here"
 * confirmation.
 *
 * `valid` is always true — there's no MIN_CREDIT_MS gate like the external
 * Zoom timer, because presence was already user-confirmed by tapping the
 * button rather than inferred from elapsed time.
 */
export async function saveInPersonAttendance(
  input: InPersonAttendanceInput,
): Promise<InPersonAttendanceResult> {
  // Same-local-day guard: re-tapping "I'm Here" (or a retry after a UI glitch)
  // must not create a second record for the same meeting on the same day.
  if (await hasLoggedToday(input.mid)) {
    return { ok: true, alreadyLogged: true }
  }

  const now = Date.now()
  const attendanceId = Crypto.randomUUID()

  log.info("Saving in-person attendance", {
    attendanceId,
    mid: input.mid,
    zid: input.zid,
    durationMs: input.durationMs,
  })

  const events: AttendanceEvent[] = [
    {
      timestamp: now,
      message: "Marked present at in-person meeting",
      json: JSON.stringify(SOURCE),
    },
  ]

  const createResult = await attendanceRepo.create({
    id: attendanceId,
    uid: input.uid,
    mid: input.mid,
    zid: input.zid,
    meetingName: input.meetingName,
    created: now,
    events,
  })

  if (!createResult.ok) {
    log.error("In-person attendance create failed", { attendanceId, mid: input.mid })
    return { ok: false }
  }

  attendanceEvents.emit({ type: "created", id: attendanceId })

  // Retry markProcessed with exponential backoff. Without this, a transient
  // DB error (lock contention, brief I/O stall) between `create` and
  // `markProcessed` leaves an orphaned unprocessed record that the user can't
  // see or recover. Retries keep the two phases paired in the common failure
  // modes; the final failure still surfaces for callers to act on.
  const MARK_PROCESSED_RETRIES = 3
  const MARK_PROCESSED_BACKOFF_MS = [500, 1500, 4500]

  let processResult = await attendanceRepo.markProcessed(attendanceId, {
    start: now,
    end: now + input.durationMs,
    credit: input.durationMs,
    valid: true,
  })

  for (let attempt = 0; !processResult.ok && attempt < MARK_PROCESSED_RETRIES; attempt++) {
    const delay = MARK_PROCESSED_BACKOFF_MS[attempt]
    log.warn("In-person attendance markProcessed failed, retrying", {
      attendanceId,
      mid: input.mid,
      attempt: attempt + 1,
      delayMs: delay,
    })
    await new Promise<void>((resolve) => setTimeout(resolve, delay))
    processResult = await attendanceRepo.markProcessed(attendanceId, {
      start: now,
      end: now + input.durationMs,
      credit: input.durationMs,
      valid: true,
    })
  }

  if (!processResult.ok) {
    log.error("In-person attendance markProcessed failed after retries", {
      attendanceId,
      mid: input.mid,
      attempts: MARK_PROCESSED_RETRIES + 1,
    })
    return { ok: false, attendanceId }
  }

  log.info("In-person attendance saved", {
    attendanceId,
    mid: input.mid,
    durationMs: input.durationMs,
  })
  attendanceEvents.emit({
    type: "processed",
    id: attendanceId,
    mid: input.mid,
    valid: true,
    source: "in-person",
  })

  // Rating-engine tally. Unlike the external-Zoom timer path there is no
  // invalid case to gate on — presence was already user-confirmed, so this
  // always fires once processing succeeds.
  meetingEvents.completed("in-person")

  return { ok: true, attendanceId }
}
