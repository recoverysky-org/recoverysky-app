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

import { observable, runInAction } from "mobx"

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

/**
 * How stale a persisted session can be and still count as "live" for
 * `isTimerSessionActive()`. Mirrors TimerSessionResumer's MAX_RECOVERY_AGE_MS
 * deliberately: a session that resumer would refuse to restore must not be
 * allowed to hold the navigation lock either, or a user who force-quit mid
 * meeting a week ago comes back to permanently disabled tabs. Kept as its own
 * constant rather than imported to avoid app/services -> app/db coupling; if
 * you change one, change both.
 */
const MAX_ACTIVE_SESSION_AGE_MS = 6 * 60 * 60 * 1000

/**
 * Observable mirror of "a timer session is live right now".
 *
 * ADDED 2026-08-06 to fix a real loss-of-attendance path: navigating to
 * another tab unmounted InPersonPopup (its RN Modal returns null when hidden),
 * which unmounted InPersonTimerModal, which ran useAttendanceTimer's cleanup
 * and destroyed the clock. TimerSessionResumer only fires once per mount, so
 * nothing re-surfaced the timer until a cold start — and if none happened
 * within MAX_RECOVERY_AGE_MS the attendance was simply gone.
 *
 * The signal has to live HERE, on the persisted session, not in the modal's
 * React state. The modal's own mount lifecycle cannot drive a lock whose
 * entire job is to prevent that modal from being unmounted — clearing on
 * unmount would release the lock at exactly the moment it was needed.
 *
 * MobX (not a new event channel) for the reason CLAUDE.md gives for
 * maintenanceMode: MainNavigator is already an observer() and reacts for free,
 * and a parallel pub/sub would be a second source of truth.
 *
 * Seeded from MMKV at module load so a cold-start recovery (resumer restores
 * -> TimerRecoveryGate shows the modal) is locked too, since that path resumes
 * rather than re-saving and so never calls saveTimerSession().
 */
const timerSessionActive = observable.box(false)

function seedActiveFromStorage(): void {
  const existing = load<PersistedTimerSession>(STORAGE_KEY)
  const live =
    existing !== null &&
    existing.startedAt > 0 &&
    Date.now() - existing.startedAt <= MAX_ACTIVE_SESSION_AGE_MS
  runInAction(() => timerSessionActive.set(live))
}
seedActiveFromStorage()

/**
 * True while an attendance timer is running (either venue).
 *
 * Read from an observer() component and it re-renders when this flips. Callers
 * use it to refuse navigation that would unmount the timer — see
 * MainNavigator's tab lock and app.tsx's notification handler.
 */
export function isTimerSessionActive(): boolean {
  return timerSessionActive.get()
}

export function saveTimerSession(session: PersistedTimerSession): void {
  save(STORAGE_KEY, session)
  runInAction(() => timerSessionActive.set(true))
}

export function loadTimerSession(): PersistedTimerSession | null {
  return load<PersistedTimerSession>(STORAGE_KEY)
}

/**
 * Clears the session AND releases the navigation lock. Save and Cancel are the
 * only two paths that reach here, which is what makes the lock safe: every
 * legitimate way out of a running timer goes through this function.
 */
export function clearTimerSession(): void {
  remove(STORAGE_KEY)
  runInAction(() => timerSessionActive.set(false))
}
