/**
 * Persistence for the External Zoom attendance timer.
 *
 * The timer UI lives in React state and is destroyed whenever the process is
 * killed (iOS memory pressure, swipe-to-kill, OS restart). Without persistence
 * the user loses an entire meeting's attendance. We mirror the active session
 * to MMKV so TimerSessionResumer can finalize or discard it on the next cold
 * start.
 *
 * Persisted fields are the minimum needed to reconstruct the call into
 * saveTimerAttendance: uid is captured at start (to preserve the attendee's
 * identity even if they sign out and back in), and zid is re-derived from
 * meetingUrl via extractZoomMeetingNumber at restore time.
 */

import { load, remove, save } from "@/utils/storage"

const STORAGE_KEY = "external-zoom-timer-session-v1"

export interface PersistedTimerSession {
  startedAt: number
  uid: string
  meetingId: string
  meetingName: string
  meetingUrl: string
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
