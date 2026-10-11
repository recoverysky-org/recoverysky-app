/**
 * attendanceGateLogic — whether the current user may start an attendance timer.
 *
 * Pure, with no imports at all, so vitest can load it (CLAUDE.md "Test Runner
 * Split") and both timer entry points can share the one rule.
 */

/**
 * True only when attendance is on AND the user is not a guest.
 *
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md). Guests never log
 * attendance, and this rule is load-bearing for the timer-recovery design:
 * - `profileStore.attendanceEnabled` is an MMKV prop, so the device OWNER's
 *   setting persists into guest mode. A guest on the owner's phone reads
 *   `true` there whenever the owner had attendance on. It also defaults to
 *   `true` (and `reset()` sets it back), so a guest on a fresh install reads
 *   `true` too. The setting alone cannot be the gate.
 * - `TimerSessionResumer` restores a persisted timer session as soon as a
 *   `userId` is present, and relies on a guest never having persisted one. If
 *   a guest could start a timer and the app were killed mid-meeting, the
 *   owner's next sign-in would restore that session and save it under the
 *   owner's identity.
 *
 * Every place that can START a timer must gate on this, not on
 * `attendanceEnabled` alone. There are two:
 * - `SchedulePopup` `proceedExternalJoin`: opens `ExternalZoomTimerModal`
 *   instead of opening Zoom directly.
 * - `InPersonPopup`'s "I'm Here" button: runs the GPS presence check and opens
 *   `InPersonTimerModal`.
 */
export function canLogAttendance(i: { attendanceEnabled: boolean; isGuest: boolean }): boolean {
  return i.attendanceEnabled && !i.isGuest
}
