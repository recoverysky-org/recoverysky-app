/**
 * useAttendanceTimer — the shared core of every attendance timer.
 *
 * Owns the elapsed clock, foreground resync, MMKV session persistence and
 * resume, and the save lock. Both timer modals consume it; neither owns a
 * clock of its own.
 *
 * EXTRACTED 2026-08-05 from ExternalZoomTimerModal, verbatim. Every behavior
 * here was already load-bearing there — see the comments on each piece. This
 * is a lift, not a redesign; do not "improve" it while moving it.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AppState, type AppStateStatus } from "react-native"

import {
  loadTimerSession,
  saveTimerSession,
  type PersistedTimerSession,
} from "@/services/attendance"

export interface UseAttendanceTimerOptions {
  /** The timer runs only while this is true. */
  active: boolean
  /**
   * Session identity. A change tears down and restarts the clock, so this MUST
   * be a stable primitive (a meeting id), never an object — see the effect's
   * dependency comment below.
   */
  sessionKey: string
  /** Build the session to persist when a NEW session starts. */
  buildSession: (startedAt: number) => PersistedTimerSession
  /** True when a persisted session belongs to this timer's target. */
  matchesPersisted: (session: PersistedTimerSession) => boolean
  /** Fired once when a NEW session starts. NOT fired on resume. */
  onStart?: () => void
}

export interface UseAttendanceTimerResult {
  startedAt: number | null
  elapsed: number
  /** True when this run adopted a persisted session rather than starting fresh. */
  isResume: boolean
  /**
   * Synchronous save lock. Returns false when a save is already in flight.
   * Call `endSave()` in a `finally`.
   */
  beginSave: () => boolean
  endSave: () => void
}

export function useAttendanceTimer(options: UseAttendanceTimerOptions): UseAttendanceTimerResult {
  const { active, sessionKey } = options

  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [isResume, setIsResume] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /**
   * The real save lock. A `saving` React state flag is for visuals only:
   * state updates are not synchronous, so a same-tick double-tap passes a
   * state-based guard twice and creates two attendance records. This ref
   * flips synchronously and is authoritative.
   */
  const savingRef = useRef(false)

  /**
   * The three callbacks live in refs, and the effect below depends only on
   * `active` and `sessionKey`.
   *
   * This is not incidental. Callers build these inline, so they are new
   * function identities on every render. Depending on them would tear down
   * and restart the timer on every parent re-render — resetting the elapsed
   * counter to 00:00 and re-firing `onStart` (which, on the Zoom path,
   * re-launches Zoom on top of a live call). That exact bug was already found
   * and fixed once in ExternalZoomTimerModal by keying the effect on
   * id + url instead of the meeting object; the refs are how that fix
   * survives the extraction.
   */
  const buildSessionRef = useRef(options.buildSession)
  const matchesPersistedRef = useRef(options.matchesPersisted)
  const onStartRef = useRef(options.onStart)
  useEffect(() => {
    buildSessionRef.current = options.buildSession
    matchesPersistedRef.current = options.matchesPersisted
    onStartRef.current = options.onStart
  })

  useEffect(() => {
    if (!active || !sessionKey) return

    // If a session for this exact target is already persisted — the app was
    // killed mid-meeting and reopened, or we re-entered the effect after a
    // transient drop — adopt the existing startedAt so the clock keeps its
    // accumulated time and we DON'T re-run onStart on top of a live meeting.
    const persisted = loadTimerSession()
    const resuming =
      persisted !== null && persisted.startedAt > 0 && matchesPersistedRef.current(persisted)

    const start = resuming ? persisted.startedAt : Date.now()
    setStartedAt(start)
    setElapsed(Date.now() - start)
    setIsResume(resuming)

    if (!resuming) {
      saveTimerSession(buildSessionRef.current(start))
      onStartRef.current?.()
    }

    const tick = () => setElapsed(Date.now() - start)
    intervalRef.current = setInterval(tick, 1000)

    // Resync on foreground — JS intervals drift or pause when backgrounded,
    // which is the normal case here (the user is in Zoom, or in a meeting
    // with the phone in a pocket).
    const appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") tick()
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      appStateSub.remove()
      setStartedAt(null)
      setElapsed(0)
      setIsResume(false)
    }
    // Stable primitives ONLY — see the ref block above for why.
  }, [active, sessionKey])

  const beginSave = useCallback(() => {
    if (savingRef.current) return false
    savingRef.current = true
    return true
  }, [])

  const endSave = useCallback(() => {
    savingRef.current = false
  }, [])

  return { startedAt, elapsed, isResume, beginSave, endSave }
}
