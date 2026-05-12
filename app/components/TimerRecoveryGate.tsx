/**
 * TimerRecoveryGate
 *
 * App-root surface that remounts ExternalZoomTimerModal pre-seeded with a
 * persisted timer session after a cold start. Driven by the recovery channel
 * in `services/zoom/timerRecovery` (populated by TimerSessionResumer when
 * the DB is ready and a fresh persisted session exists).
 *
 * Why mounted here and not inside SchedulePopup:
 *  - SchedulePopup is meeting-scoped and only mounts when the user opens a
 *    specific meeting. On cold start the user lands on Home — no popup is
 *    open — so we need a route-independent place for the modal to live.
 *  - The modal's existing resume path (ExternalZoomTimerModal:115–160)
 *    adopts the persisted startedAt and DOES NOT re-launch Zoom on resume,
 *    so the timer just picks up where it left off.
 *
 * Why we don't have to worry about double-mounting with the SchedulePopup
 * version: only set once at cold start, cleared on Save/Cancel. Any
 * subsequent Join flow uses the SchedulePopup-owned modal.
 */

import { useCallback, useMemo } from "react"

import { setRecoverySession, useRecoverySession } from "@/services/zoom"

import { ExternalZoomTimerModal } from "./ExternalZoomTimerModal"

export function TimerRecoveryGate() {
  const session = useRecoverySession()

  const handleClose = useCallback(() => {
    setRecoverySession(null)
  }, [])

  const meeting = useMemo(() => {
    if (!session) return null
    return {
      id: session.meetingId,
      name: session.meetingName,
      url: session.meetingUrl,
    }
  }, [session])

  if (!session || !meeting) return null

  return (
    <ExternalZoomTimerModal
      visible
      meeting={meeting}
      onClose={handleClose}
      onSaved={handleClose}
    />
  )
}
