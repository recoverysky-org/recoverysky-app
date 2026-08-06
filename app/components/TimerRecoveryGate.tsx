/**
 * TimerRecoveryGate
 *
 * App-root surface that remounts ExternalZoomTimerModal or InPersonTimerModal
 * — whichever the persisted session's source dictates — pre-seeded with the
 * session after a cold start. Driven by the recovery channel in
 * `services/attendance/timerRecovery` (populated by TimerSessionResumer
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
 * CHANGED 2026-08-05: this now has to cover a second owner too —
 * InPersonPopup mounts its own InPersonTimerModal (Task 10) the same way
 * SchedulePopup mounts ExternalZoomTimerModal. It still can't double-mount,
 * but not because the channel's producer only ever fires once: TimerSession-
 * Resumer's `hasRun` ref is one-shot per MOUNT, not per process, so a
 * resumer remount could in principle push a second, different session into
 * the channel while this gate still held session A. What actually prevents
 * it is that TimerSessionResumer and this gate are both unconditional
 * descendants of the same DatabaseProvider in app.tsx, gate strictly
 * deeper — the only asymmetric remount is this gate remounting alone (safe:
 * it just re-reads the singleton), because any ancestor remount that would
 * reset the resumer is also an ancestor of this gate, tearing down whatever
 * modal instance it held in the same pass. (Updates.reloadAsync(), used on
 * the outage-recovery path, resets the whole tree together — a fresh mount,
 * not an A-to-B handoff.) The one real gap is Fast Refresh in dev: editing
 * TimerSessionResumer.tsx alone can reset its ref while this gate's mounted
 * child survives untouched — dev-only, and the worst case is one
 * misattributed log line, never wrong data. Move either component out from
 * under DatabaseProvider, or make one conditionally mounted, and this
 * guarantee needs re-deriving.
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
