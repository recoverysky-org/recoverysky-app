/**
 * The display name to prefill in a Zoom join (`?un=`), or undefined for none.
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md): a guest sends no
 * name. On a shared phone the profile belongs to the device owner, and Zoom
 * would show them joining. One rule for every join path: SchedulePopup's two
 * buildExternalZoomUrl calls and useZoomMeeting.
 * Pure, no `@/` imports (CLAUDE.md "Test Runner Split").
 */
export function zoomPrefillName(i: {
  isGuest: boolean
  displayName: string | undefined
}): string | undefined {
  return i.isGuest ? undefined : i.displayName
}
