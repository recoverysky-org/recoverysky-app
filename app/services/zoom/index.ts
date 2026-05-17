/**
 * Zoom Meeting Service (external-only)
 *
 * Native SDK was removed in 4.5.0 — meeting joins now open the installed
 * Zoom app via `Linking.openURL`, and attendance is recorded via the
 * timer modal flow (`externalAttendance.ts`).
 */

export * from "./zoomTypes"
export * from "./useZoomMeeting"
export * from "./externalAttendance"
export * from "./timerSession"
export * from "./timerRecovery"
