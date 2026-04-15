/**
 * External Zoom Attendance
 *
 * Writes attendance records for meetings attended via the external Zoom app
 * (when "Use External Zoom" is on). The native SDK path that normally tracks
 * meeting state doesn't fire in this mode, so attendance is captured via a
 * user-controlled timer UI. Events are stubbed to make the source obvious
 * in reports and logs.
 */

import * as Crypto from "expo-crypto"

import { attendanceRepo, attendanceEvents, type AttendanceEvent } from "@/db"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ExternalAttendance" })

const MIN_CREDIT_MS = (Number(process.env.EXPO_PUBLIC_MIN_CREDIT_MINUTES) || 1) * 60 * 1000

export interface TimerAttendanceInput {
  uid: string
  mid: string
  zid: string
  meetingName: string
  startedAt: number
  endedAt: number
}

export interface TimerAttendanceResult {
  ok: boolean
  attendanceId?: string
  valid?: boolean
  creditMs?: number
}

const SOURCE = { source: "external-zoom-timer" }

/**
 * Build the synthetic event trail that stands in for SDK-emitted state events.
 * Mirrors the shape processed from real meetings so downstream reporting can
 * render a consistent timeline, while the distinct message strings make this
 * record unambiguously identifiable as timer-sourced.
 */
function buildTimerEvents(startedAt: number, endedAt: number): AttendanceEvent[] {
  return [
    {
      timestamp: startedAt,
      message: "Timer started",
      json: JSON.stringify(SOURCE),
    },
    {
      timestamp: startedAt,
      message: "External Zoom launched",
      json: JSON.stringify(SOURCE),
    },
    {
      timestamp: endedAt,
      message: "Timer saved",
      json: JSON.stringify({ ...SOURCE, durationMs: endedAt - startedAt }),
    },
  ]
}

/**
 * Create a processed, valid attendance record from a timer session.
 *
 * Save is gated in the UI on `endedAt - startedAt >= MIN_CREDIT_MS`, so in
 * practice `valid` is always true here. The check is repeated as a safety
 * net in case this helper is called elsewhere.
 */
export async function saveTimerAttendance(
  input: TimerAttendanceInput,
): Promise<TimerAttendanceResult> {
  const credit = input.endedAt - input.startedAt
  const valid = credit >= MIN_CREDIT_MS
  const attendanceId = Crypto.randomUUID()

  log.info("Saving timer attendance", {
    attendanceId,
    mid: input.mid,
    zid: input.zid,
    creditMs: credit,
    valid,
  })

  const events = buildTimerEvents(input.startedAt, input.endedAt)

  const createResult = await attendanceRepo.create({
    id: attendanceId,
    uid: input.uid,
    mid: input.mid,
    zid: input.zid,
    meetingName: input.meetingName,
    created: input.startedAt,
    events,
  })

  if (!createResult.ok) {
    log.error("Timer attendance create failed", { attendanceId, mid: input.mid })
    return { ok: false }
  }

  attendanceEvents.emit({ type: "created", id: attendanceId })

  const processResult = await attendanceRepo.markProcessed(attendanceId, {
    start: input.startedAt,
    end: input.endedAt,
    credit,
    valid,
  })

  if (!processResult.ok) {
    log.error("Timer attendance markProcessed failed", { attendanceId, mid: input.mid })
    return { ok: false, attendanceId }
  }

  log.info("Timer attendance saved", { attendanceId, mid: input.mid, valid, creditMs: credit })
  attendanceEvents.emit({ type: "processed", id: attendanceId, mid: input.mid, valid })

  return { ok: true, attendanceId, valid, creditMs: credit }
}

/**
 * Minimum credit window in milliseconds, exposed so UI can gate the Save button
 * on the same threshold used for validity.
 */
export const EXTERNAL_MIN_CREDIT_MS = MIN_CREDIT_MS
