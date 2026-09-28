/**
 * creditLogic — the bound on an attendance record's `credit` (attended
 * duration, in milliseconds).
 *
 * Pure: no runtime `@/` imports, so vitest can load it and so both timer save
 * paths (`services/zoom/externalAttendance.ts`, `services/inperson/
 * timerAttendance.ts`) and the sync push payload (`services/sync/syncLogic.ts`)
 * can share one number without a dependency between them.
 *
 * ADDED 2026-09-19 (RS-034). A timer session that outlives the meeting — a
 * process left running across a device sleep, a crash, or days in the
 * background, which `TimerSessionResumer` deliberately restores whatever its
 * age (see its header, CHANGED 2026-09-12) — produces a `credit` no meeting
 * can have. One such row, a 37-day session from June, sat in a user's sync
 * outbox: the api's `attendances.credit` column is a 32-bit integer, so the
 * insert failed with Postgres 22003 on every push and that user's sync
 * stopped for good (the poison-batch half of the fix is in
 * `attendanceSyncService.ts`). Bounding the value at the source means a
 * stale timer can never poison a batch again, on any build, before the schema
 * is widened.
 */

/**
 * The longest attended duration a record may carry: 24 hours.
 *
 * No meeting lasts a day, and it sits comfortably under the api column's
 * ceiling (2,147,483,647 ms ≈ 24.8 days), which is the number that actually
 * broke. A record clamped here still saves — the user trims the duration in
 * the Attendance tab exactly as the timer modals already tell them to.
 */
export const MAX_CREDIT_MS = 24 * 60 * 60 * 1000

export interface ClampedCredit {
  /** The value to store or send. */
  credit: number
  /** True when the input was altered — log it so the tracker can count stale timers. */
  clamped: boolean
}

/**
 * Bound a computed credit to `[0, MAX_CREDIT_MS]`.
 *
 * A negative or non-finite input (a clock that moved backwards between start
 * and end, or a corrupt row) becomes 0 rather than propagating: 0 is "no
 * credit", which is the honest reading of an interval we cannot trust.
 */
export function clampCredit(creditMs: number): ClampedCredit {
  if (!Number.isFinite(creditMs) || creditMs < 0) {
    return { credit: 0, clamped: creditMs !== 0 }
  }
  if (creditMs > MAX_CREDIT_MS) return { credit: MAX_CREDIT_MS, clamped: true }
  return { credit: creditMs, clamped: false }
}
