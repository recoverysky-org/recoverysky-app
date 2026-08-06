/**
 * Attendance Events
 *
 * Simple pub/sub for attendance record changes.
 * Components subscribe to receive real-time updates when attendance is created or processed.
 */

import { logger } from "@/utils/logger"

import type { AttendanceRecord } from "./repositories"

const log = logger.child({ module: "attendanceEvents" })

export type AttendanceChangeType =
  | "created"
  | "processed"
  | "acknowledged"
  | "produced"
  | "archived"
  | "delivery_resolved"
  // Emitted by the cloud-sync service after a pull merge changed local rows —
  // screens reload lists the same way they do for local mutations. The `id`
  // on these events is the constant "sync" (no single record changed).
  | "synced"

// "in-person" is emitted by saveInPersonTimerAttendance (app/services/inPerson/timerAttendance.ts)
// for records written from the "I'm Here" in-person meeting flow.
export type AttendanceSource = "sdk" | "external-timer" | "in-person"

export interface AttendanceChange {
  type: AttendanceChangeType
  id: string
  /** The full record (available on 'processed' events) */
  record?: AttendanceRecord
  /** Our internal meeting ID (available on 'processed' events) */
  mid?: string
  /**
   * Whether attendance met minimum duration (available on 'processed' events).
   * CHANGED 2026-08-05: `useTopicPanel` (extracted from `SchedulePopup` in
   * Task 4, now shared by the in-person timer too) also sets this on the
   * `acknowledged` events it emits after a valid `processed` event, so
   * downstream listeners that only look at `acknowledged` still see it.
   */
  valid?: boolean
  /** How the attendance was captured (available on 'processed' events) */
  source?: AttendanceSource
  /** Attendance report ID (available on 'produced' events) */
  reportId?: string
  /** Whether delivery resolved with an error (only on 'delivery_resolved' events) */
  deliveryError?: boolean
}

type AttendanceChangeListener = (event: AttendanceChange) => void

const listeners = new Set<AttendanceChangeListener>()

/**
 * Emit an attendance change to all subscribers
 */
function emit(event: AttendanceChange): void {
  // Isolate each subscriber: a throwing listener must never break the emitter or
  // the code that fired the event. `processed` is emitted synchronously from
  // inside saveTimerAttendance's critical path (right before meetingEvents
  // .completed), so an unhandled listener throw would abort the save and strand
  // the timer modal open. See meetingEvents.emit for the same guard + rationale.
  listeners.forEach((listener) => {
    try {
      listener(event)
    } catch (err) {
      log.error("attendanceEvents listener threw (isolated)", { error: String(err) })
    }
  })
}

/**
 * Subscribe to attendance changes
 * @returns Unsubscribe function
 */
function subscribe(listener: AttendanceChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const attendanceEvents = {
  emit,
  subscribe,
}
