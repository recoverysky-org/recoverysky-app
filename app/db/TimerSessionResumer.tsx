/**
 * TimerSessionResumer Component
 *
 * Headless. On app startup (once the database is ready), check MMKV for an
 * External Zoom attendance timer that was running when the process was last
 * killed. If one is found and is recent enough, surface it to the recovery
 * channel so TimerRecoveryGate can remount the running modal pre-seeded with
 * the persisted session.
 *
 * CHANGED 2026-05-11: previously this fired a destructive Alert.alert with
 * only Save / Discard options. That UX was actively harmful — customers
 * switching back to the app mid-meeting (just to check that recording was
 * happening) would see "X minutes recorded, save?", tap Save, and unknowingly
 * end their attendance session at a partial duration. Any time spent back in
 * Zoom after that got zero credit because the persisted session was cleared.
 * Multiple confirmed reports of customers losing attendance this way.
 *
 * The new flow uses the existing modal resume path (see the resume branch of
 * useAttendanceTimer's launch effect, app/hooks/useAttendanceTimer.ts —
 * EXTRACTED 2026-08-05 from ExternalZoomTimerModal, referenced here by symbol
 * name rather than line number so this pointer survives the next refactor):
 * adopt the persisted startedAt, show the running timer with correct
 * wall-clock elapsed, let the user keep using Zoom and Save when the meeting
 * *actually* ends with full duration captured.
 *
 * A 6-hour staleness cap used to silently discard sessions old enough that
 * the meeting must have ended (and the device sat with no app re-entry).
 * REMOVED 2026-09-12: there is no cap any more. Loki showed users resuming
 * with 8-hour to 6-day-old sessions, mostly on the same recurring meeting,
 * and the discard threw that attendance away with no way to get it back. The
 * timer now always restores, whatever the age; the user Saves and trims the
 * duration in the Attendance tab, which both timer modals now point out.
 *
 * Place inside DatabaseProvider alongside the other *Resumer / *Hydrator
 * components, below ProfileHydrator so we have a user context.
 *
 * CHANGED 2026-08-05: the persisted session can now be an in-person timer as
 * well as an external-Zoom one. Nothing here branches on it — the restore
 * decision is identical for both — but TimerRecoveryGate
 * does, so the source is logged here to make a mis-routed recovery diagnosable
 * from Loki without a device.
 */

import { useEffect, useRef } from "react"
import { observer } from "mobx-react-lite"

import { useAuthenticationStore } from "@/models"
import { loadTimerSession, sessionSource, setRecoverySession } from "@/services/attendance"
import { EXTERNAL_MIN_CREDIT_MS } from "@/services/zoom"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "TimerSessionResumer" })

// CHANGED 2026-10-11: an observer, so the guest-mode flag in the effect's deps
// is tracked. Leaving guest mode re-renders this and re-runs the effect.
// CHANGED 2026-10-11: it now tracks `isAuthenticated` instead (see the
// effect). A sign-in or token refresh that makes the session live re-runs it.
// Leaving guest mode alone no longer does, because that lands on Login.
export const TimerSessionResumer = observer(function TimerSessionResumer(): null {
  const { status } = useDatabase()
  const authStore = useAuthenticationStore()
  const hasRun = useRef(false)

  useEffect(() => {
    if ((status !== "open" && status !== "seeded") || hasRun.current) return
    // ADDED 2026-10-11: never raise the device owner's interrupted attendance
    // timer inside guest mode (spec 2026-09-27). Not consumed — once the user
    // signs in, isGuest flips, this effect re-runs and restores it.
    // CHANGED 2026-10-11: gated on a real session (`isAuthenticated`) instead
    // of `!isGuest`. A guest is never authenticated, so guests stay covered,
    // and the spec expects this to bail without a session. The guest flag
    // clears on the Sign-in tap, before anyone has signed in, so the old gate
    // raised the owner's timer over Login after Guest → Sign in. There a
    // stranger could Cancel it, discarding the session, and a signed-out Save
    // writes the record with an empty uid (the modals save `userId ?? ""`).
    // It is still not consumed: `hasRun` is set only past this gate, so the
    // restore runs once a sign-in or token refresh makes the session live. A
    // wrong-account session is never authenticated either.
    if (!authStore.isAuthenticated) return
    hasRun.current = true

    const session = loadTimerSession()
    if (!session) return

    const elapsedMs = Date.now() - session.startedAt

    // Restore in ALL cases — even below the credit threshold, so a user who
    // got killed seconds after launch can keep counting, and however old the
    // session is (see the header: the staleness discard was removed
    // 2026-09-12). Save gating still happens inside the modal via canSave.
    log.info("Restoring persisted timer session via recovery surface", {
      mid: session.meetingId,
      source: sessionSource(session),
      elapsedMs,
      belowCredit: elapsedMs < EXTERNAL_MIN_CREDIT_MS,
    })
    setRecoverySession(session)
  }, [status, authStore.isAuthenticated])

  return null
})
