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
  /**
   * ADDED 2026-10-06 (Android icon-change notice): targeting inputs.
   * `platform` is `Platform.OS`. `nativeVersion` is the installed store
   * build's version (`Application.nativeApplicationVersion`), or null when
   * unknown (web). `shownThisSession` holds the ids of repeating
   * announcements already shown since this JS session started.
   */
  platform: string
  nativeVersion: string | null
  shownThisSession: readonly string[]
}

/**
 * Compare two dotted numeric versions ("4.10.1" vs "4.11.0"). Missing parts
 * count as 0 and non-numeric parts as 0, so a malformed string never throws.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0)
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/** Whether this announcement targets the current device at all. */
export function isAnnouncementEligible(
  a: Announcement,
  platform: string,
  nativeVersion: string | null,
): boolean {
  if (a.platform && a.platform !== platform) return false
  if (a.repeatUntilNativeVersion) {
    // Unknown version → don't show. A nag that can't tell whether the user
    // already has the new build must not risk showing to someone who does.
    if (!nativeVersion) return false
    if (compareVersions(nativeVersion, a.repeatUntilNativeVersion) >= 0) return false
  }
  return true
}

/**
 * The first pending announcement that may be shown right now, or null if a gate
 * blocks display or nothing is pending. Order is by array position.
 *
 * CHANGED 2026-10-06: an entry with `repeatUntilNativeVersion` is never
 * "seen": it is pending once per JS session (i.e. once per cold start or OTA
 * reload) until the installed build reaches that version. Ordinary entries
 * still show exactly once. Entries not eligible for this device are skipped
 * (not stopped at), so an Android-only notice never blocks an iOS user's queue.
 */
export function selectPendingAnnouncement(state: AnnouncementGateState): Announcement | null {
  if (!state.isAuthenticated) return null
  if (!state.onboardingCompleted) return null
  if (state.outageMode) return null
  if (state.timerSessionActive) return null
  return (
    state.announcements.find((a) => {
      if (!isAnnouncementEligible(a, state.platform, state.nativeVersion)) return false
      if (a.repeatUntilNativeVersion) return !state.shownThisSession.includes(a.id)
      return !state.seenIds.includes(a.id)
    }) ?? null
  )
}

/** Whether the CTA button should render for this viewer. */
export function shouldShowCta(announcement: Announcement, hasAttendance: boolean): boolean {
  if (!announcement.cta) return false
  if (announcement.cta.requiresAttendance && !hasAttendance) return false
  return true
}
