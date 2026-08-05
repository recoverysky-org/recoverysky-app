/**
 * TimerRecoveryGate
 *
 * App-root surface that remounts ExternalZoomTimerModal pre-seeded with a
 * persisted timer session after a cold start. Driven by the recovery channel
 * in `services/attendance/timerRecovery` (populated by TimerSessionResumer
 * when the DB is ready and a fresh persisted session exists).
 *
 * Why mounted here and not inside SchedulePopup:
 *  - SchedulePopup is meeting-scoped and only mounts when the user opens a
 *    specific meeting. On cold start the user lands on Home — no popup is
 *    open — so we need a route-independent place for the modal to live.
 *  - The modal's existing resume path — now the resume branch of
 *    useAttendanceTimer's launch effect (app/hooks/useAttendanceTimer.ts;
 *    referenced by symbol name, not line number, since it moved out of
 *    ExternalZoomTimerModal on 2026-08-05) — adopts the persisted startedAt
 *    and DOES NOT re-launch Zoom on resume, so the timer just picks up where
 *    it left off.
 *
 * Why we don't have to worry about double-mounting with the SchedulePopup
 * version: only set once at cold start, cleared on Save/Cancel. Any
 * subsequent Join flow uses the SchedulePopup-owned modal.
 *
 * CHANGED 2026-08-05: routes on sessionSource(). An in-person session has no
 * meetingUrl, so handing it to ExternalZoomTimerModal would hit that modal's
 * !meetingUrl guard and drop a live timer on the floor — the precise harm this
 * whole recovery surface exists to prevent.
 *
 * Topic capture is deliberately skipped on this path for BOTH sources: the
 * gate mounts at app root with no popup behind it, so there is no useTopicPanel
 * host and onSaved simply closes. Unchanged from the Zoom-only behavior.
 */

import { useCallback, useMemo } from "react"

import { setRecoverySession, sessionSource, useRecoverySession } from "@/services/attendance"

import { ExternalZoomTimerModal } from "./ExternalZoomTimerModal"
import { InPersonTimerModal } from "./InPersonTimerModal"

export function TimerRecoveryGate() {
  const session = useRecoverySession()

  const handleClose = useCallback(() => {
    setRecoverySession(null)
  }, [])

  const source = session ? sessionSource(session) : null

  const zoomMeeting = useMemo(() => {
    if (!session || source !== "external-zoom") return null
    return {
      id: session.meetingId,
      name: session.meetingName,
      url: session.meetingUrl ?? "",
    }
  }, [session, source])

  const inPersonMeeting = useMemo(() => {
    if (!session || source !== "in-person") return null
    return {
      id: session.meetingId,
      name: session.meetingName,
      zid: session.zid ?? "",
    }
  }, [session, source])

  if (!session) return null

  if (inPersonMeeting) {
    return (
      <InPersonTimerModal
        visible
        meeting={inPersonMeeting}
        // The verification taken at the venue, carried through the process
        // kill. InPersonTimerModal re-reads the persisted block at save time
        // and prefers it over this prop; passing it here keeps the modal's
        // `active` guard (which requires a presence) satisfied on mount.
        presence={session.presence ?? null}
        onClose={handleClose}
        onSaved={handleClose}
      />
    )
  }

  if (!zoomMeeting) return null

  return (
    <ExternalZoomTimerModal
      visible
      meeting={zoomMeeting}
      onClose={handleClose}
      onSaved={handleClose}
    />
  )
}
