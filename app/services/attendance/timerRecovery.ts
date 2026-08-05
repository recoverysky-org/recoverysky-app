/**
 * Cross-component subscription channel for the attendance timer recovery
 * surface.
 *
 * On cold start (after the OS killed the JS process mid-meeting),
 * TimerSessionResumer reads the MMKV-persisted session and, if it's still
 * fresh, stashes it here. TimerRecoveryGate (mounted at the app root)
 * observes this and remounts the matching timer modal — ExternalZoomTimerModal
 * or InPersonTimerModal, chosen by the session's source — pre-seeded with the
 * persisted session, so the user picks up the running timer where they left
 * off — instead of seeing a destructive "Save or Discard" alert that would
 * end the timer prematurely.
 *
 * MOVED 2026-08-05 from app/services/zoom/. Its payload is a
 * PersistedTimerSession, which is source-agnostic as of the in-person timer,
 * and it is always read together with timerSession.ts — leaving it behind
 * would split a pair.
 *
 * Singleton state — only one attendance timer can be active at a time,
 * regardless of source.
 */

import { useEffect, useState } from "react"

import type { PersistedTimerSession } from "./timerSession"

let currentSession: PersistedTimerSession | null = null
const listeners = new Set<() => void>()

export function getRecoverySession(): PersistedTimerSession | null {
  return currentSession
}

export function setRecoverySession(session: PersistedTimerSession | null): void {
  currentSession = session
  listeners.forEach((listener) => listener())
}

export function useRecoverySession(): PersistedTimerSession | null {
  const [session, setSession] = useState(currentSession)
  useEffect(() => {
    const listener = () => setSession(currentSession)
    listeners.add(listener)
    // Resync in case the singleton changed between render and effect mount.
    if (currentSession !== session) setSession(currentSession)
    return () => {
      listeners.delete(listener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return session
}
