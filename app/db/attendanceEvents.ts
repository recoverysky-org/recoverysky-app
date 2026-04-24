/**
 * Attendance Events
 *
 * Simple pub/sub for attendance record changes.
 * Components subscribe to receive real-time updates when attendance is created or processed.
 */

import type { AttendanceRecord } from "./repositories"

export type AttendanceChangeType =
  | "created"
  | "processed"
  | "acknowledged"
  | "produced"
  | "archived"
  | "delivery_resolved"

export type AttendanceSource = "sdk" | "external-timer"

export interface AttendanceChange {
  type: AttendanceChangeType
  id: string
  /** The full record (available on 'processed' events) */
  record?: AttendanceRecord
  /** Our internal meeting ID (available on 'processed' events) */
  mid?: string
  /** Whether attendance met minimum duration (available on 'processed' events) */
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
  listeners.forEach((listener) => listener(event))
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
