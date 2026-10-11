/**
 * The display name to prefill in a Zoom join (`?un=`), or undefined for none.
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md): a guest sends no
 * name. On a shared phone the profile belongs to the device owner, and Zoom
 * would show them joining. One rule for every join path: SchedulePopup's two
 * buildExternalZoomUrl calls and useZoomMeeting.
 * Pure, no `@/` imports (CLAUDE.md "Test Runner Split").
 *
 * ADDED 2026-10-11: apply it to the name that actually wins, never to a
 * fallback only. A guest's `displayName` is not empty, so "the hydrator skips
 * guests" is no substitute: ProfileStore.displayName appends the owner's saved
 * clean-time / pronoun toggles (MMKV props, so they persist into guest mode)
 * even when shortName is empty, giving " (12d)", and a profile already in
 * memory (sign out, then "Just join meetings") still has the name itself.
 * useZoomMeeting once wrapped only the profile fallback, which let a
 * caller-supplied name skip the rule; it now wraps both.
 */
export function zoomPrefillName(i: {
  isGuest: boolean
  displayName: string | undefined
}): string | undefined {
  return i.isGuest ? undefined : i.displayName
}
