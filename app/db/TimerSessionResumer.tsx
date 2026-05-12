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
 * The new flow uses the existing modal resume path (see
 * ExternalZoomTimerModal lines 115–131): adopt the persisted startedAt, show
 * the running timer with correct wall-clock elapsed, let the user keep using
 * Zoom and Save when the meeting *actually* ends with full duration captured.
 *
 * A 6-hour staleness cap silently discards sessions old enough that the
 * meeting must have ended (and the device sat with no app re-entry). Tunable
 * if our 4-hour conferences ever bump against it.
 *
 * Place inside DatabaseProvider alongside the other *Resumer / *Hydrator
 * components, below ProfileHydrator so we have a user context.
 */

import { useEffect, useRef } from "react"

import {
  clearTimerSession,
  EXTERNAL_MIN_CREDIT_MS,
  loadTimerSession,
  setRecoverySession,
} from "@/services/zoom"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "TimerSessionResumer" })

// Meetings rarely run longer than 4 hours; 6h gives generous headroom while
// still discarding clearly-stale persisted sessions (e.g. device left
// untouched overnight with the app killed mid-meeting).
const MAX_RECOVERY_AGE_MS = 6 * 60 * 60 * 1000

export function TimerSessionResumer(): null {
  const { status } = useDatabase()
  const hasRun = useRef(false)

  useEffect(() => {
    if ((status !== "open" && status !== "seeded") || hasRun.current) return
    hasRun.current = true

    const session = loadTimerSession()
    if (!session) return

    const elapsedMs = Date.now() - session.startedAt

    if (elapsedMs > MAX_RECOVERY_AGE_MS) {
      log.warn("Discarding stale persisted timer session", {
        mid: session.meetingId,
        elapsedMs,
      })
      clearTimerSession()
      return
    }

    // Restore in all in-range cases — even below the credit threshold — so
    // a user who got killed seconds after launch can keep counting. Save
    // gating still happens inside the modal via canSave.
    log.info("Restoring persisted timer session via recovery surface", {
      mid: session.meetingId,
      elapsedMs,
      belowCredit: elapsedMs < EXTERNAL_MIN_CREDIT_MS,
    })
    setRecoverySession(session)
  }, [status])

  return null
}
