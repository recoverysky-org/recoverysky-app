/**
 * Pure decision logic for the announcement popup. No runtime `@/` imports and
 * no native-module imports, so vitest can exercise it directly (see the repo's
 * vitest-no-path-alias rule). The `AnnouncementGate` component supplies the
 * live state; this module holds all the branching.
 */
import type { Announcement } from "@/config/announcements"

export interface AnnouncementGateState {
  announcements: readonly Announcement[]
  seenIds: readonly string[]
  /** Display gates — ALL must hold for anything to show. */
  isAuthenticated: boolean
  onboardingCompleted: boolean
  outageMode: boolean
  timerSessionActive: boolean
}

/**
 * The first unseen announcement that may be shown right now, or null if a gate
 * blocks display or nothing is pending. Order is by array position.
 */
export function selectPendingAnnouncement(
  state: AnnouncementGateState,
): Announcement | null {
  if (!state.isAuthenticated) return null
  if (!state.onboardingCompleted) return null
  if (state.outageMode) return null
  if (state.timerSessionActive) return null
  return state.announcements.find((a) => !state.seenIds.includes(a.id)) ?? null
}

/** Whether the CTA button should render for this viewer. */
export function shouldShowCta(
  announcement: Announcement,
  hasAttendance: boolean,
): boolean {
  if (!announcement.cta) return false
  if (announcement.cta.requiresAttendance && !hasAttendance) return false
  return true
}
