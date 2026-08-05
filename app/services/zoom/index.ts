/**
 * Zoom Meeting Service (external-only)
 *
 * Native SDK was removed in 4.5.0 — meeting joins now open the installed
 * Zoom app via `Linking.openURL`, and attendance is recorded via the
 * timer modal flow (`externalAttendance.ts`).
 *
 * Timer session persistence and cold-start recovery MOVED 2026-08-05 to
 * @/services/attendance — they are shared with the in-person timer now.
 */

export * from "./zoomTypes"
export * from "./useZoomMeeting"
export * from "./externalAttendance"
