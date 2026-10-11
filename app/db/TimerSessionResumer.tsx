/**
 * TimerSessionResumer Component
 *
 * Headless. Once the database is ready and the device owner's identity
 * (`userId`) is present, check MMKV for an External Zoom attendance timer
 * that was running when the process was last killed. If one is found,
 * surface it to the recovery channel so TimerRecoveryGate can remount the
 * running modal pre-seeded with the persisted session.
 *
 * CHANGED 2026-10-11: this said the check runs "on app startup (once the
 * database is ready)" and restores a session that "is recent enough". It
 * also waits for `userId` now, which a sign-in can record long after
 * startup, and runs once per mount, the first time both hold (the gate in
 * the effect says why it keys on `userId`). "Recent enough" went with the
 * staleness cap, removed 2026-09-12 (see below).
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

// CHANGED 2026-10-11: an observer, so `userId` in the effect's deps is
// tracked. A sign-in that records the owner's identity re-runs the effect
// (see the gate there for why it keys on `userId`).
export const TimerSessionResumer = observer(function TimerSessionResumer(): null {
  const { status } = useDatabase()
  const authStore = useAuthenticationStore()
  const hasRun = useRef(false)

  useEffect(() => {
    if ((status !== "open" && status !== "seeded") || hasRun.current) return
    // ADDED 2026-10-11: never raise the device owner's interrupted attendance
    // timer inside guest mode (spec 2026-09-27). Not consumed — once the
    // owner signs in, this effect re-runs and restores it.
    // CHANGED 2026-10-11: gated on the owner identity (`userId`), not on
    // `!isGuest`. Guest mode never sets userId and a real sign-out clears it,
    // so neither a guest nor a stranger on Login after Guest → Sign in gets
    // the owner's timer. The guest flag alone was not enough: it clears on
    // the Sign-in tap, before anyone signs in, so the timer came up over
    // Login. A stranger could Cancel it there, discarding the session, or
    // Save it with an empty uid (the modals save `userId ?? ""`).
    // Why `userId` and not a live token (`isAuthenticated`): a forced logout
    // deferred for a live timer keeps userId set. So on a cold start with a
    // dead refresh token the timer still comes up (over Login, as before
    // guest mode), and its Save/Cancel fires the pending logout. Gated on a
    // live token, the timer waited for a re-login, and that re-login
    // inherited the deferred logout: the refresher stayed latched, so its
    // requests went out with no bearer, and Save then ejected it. userId comes
    // from the persisted snapshot, so a signed-in owner whose token only needs
    // renewal still restores at once.
    // Still not consumed: `hasRun` is set only past this gate.
    if (!authStore.userId) return
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
  }, [status, authStore.userId])

  return null
})
