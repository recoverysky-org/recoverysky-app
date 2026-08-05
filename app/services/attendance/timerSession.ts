/**
 * Persistence for attendance timer sessions.
 *
 * The timer UI lives in React state and is destroyed whenever the process is
 * killed (iOS memory pressure, swipe-to-kill, OS restart). Without persistence
 * the user loses an entire meeting's attendance. We mirror the active session
 * to MMKV so TimerSessionResumer can restore it on the next cold start.
 *
 * Persisted fields are the minimum needed to reconstruct the save call: uid is
 * captured at start (to preserve the attendee's identity even if they sign out
 * and back in), and for external Zoom, zid is re-derived from meetingUrl via
 * extractZoomMeetingNumber at restore time.
 *
 * MOVED 2026-08-05 from app/services/zoom/timerSession.ts. Two features now
 * share this — external Zoom and GPS-verified in-person — and a module under
 * services/zoom/ owning in-person sessions is a trap for whoever reads it next.
 */

import { load, remove, save } from "@/utils/storage"

/**
 * MMKV key. DO NOT RENAME.
 *
 * The name is now a misnomer — it holds in-person sessions too. It is kept
 * because renaming it would silently orphan the live session of any user who
 * is mid-Zoom-meeting when this OTA lands: the new key reads empty, the old
 * key is never read again, and their attendance is lost. That is precisely the
 * harm TimerSessionResumer's 2026-05-11 rewrite exists to prevent.
 */
const STORAGE_KEY = "external-zoom-timer-session-v1"

export type TimerSource = "external-zoom" | "in-person"

/**
 * The verified GPS fix for an in-person session.
 *
 * PRIVACY: this is a deliberate, documented amendment to the rule in
 * useNearbySchedules.ts's header (coordinates never touch MMKV or SQLite). A
 * verified attendance record is the product and the proof has to survive a
 * process kill — a recovered session that could only write an *unverified*
 * record would defeat the feature. Cleared with the rest of the session on
 * Save or Cancel. See the spec's "Privacy policy amendment" section.
 */
export interface PersistedPresence {
  lat: number
  lon: number
  accuracyM?: number
  distanceM: number
  radiusM: number
}

export interface PersistedTimerSession {
  startedAt: number
  uid: string
  meetingId: string
  meetingName: string
  /** External Zoom only — an in-person session has no URL. */
  meetingUrl?: string
  /**
   * Absent on sessions written before 2026-08-05. Read it through
   * `sessionSource()`, never directly.
   */
  source?: TimerSource
  /** In-person only. */
  presence?: PersistedPresence
  /**
   * In-person only. The Zoom path re-derives zid from meetingUrl via
   * extractZoomMeetingNumber at restore time; an in-person session has no URL,
   * so the value has to be carried. Optional because sessions written before
   * 2026-08-05 don't have it — and don't need it, being external-zoom.
   */
  zid?: string
}

/**
 * The source of a persisted session, defaulting a missing `source` to external
 * Zoom.
 *
 * This default is load-bearing, not defensive. A user who was mid-Zoom-meeting
 * when this OTA landed has a session with no `source` field. Treating it as
 * anything other than external-zoom — or as unknown and discarding it — loses
 * their attendance. This is the ONLY place the defaulting happens; do not
 * inline `session.source ?? "external-zoom"` at call sites.
 */
export function sessionSource(session: PersistedTimerSession): TimerSource {
  return session.source ?? "external-zoom"
}

export function saveTimerSession(session: PersistedTimerSession): void {
  save(STORAGE_KEY, session)
}

export function loadTimerSession(): PersistedTimerSession | null {
  return load<PersistedTimerSession>(STORAGE_KEY)
}

export function clearTimerSession(): void {
  remove(STORAGE_KEY)
}
