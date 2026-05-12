/**
 * Cross-component subscription channel for the External Zoom timer recovery
 * surface.
 *
 * On cold start (after the OS killed the JS process mid-meeting),
 * TimerSessionResumer reads the MMKV-persisted session and, if it's still
 * fresh, stashes it here. TimerRecoveryGate (mounted at the app root)
 * observes this and remounts ExternalZoomTimerModal pre-seeded with the
 * persisted session, so the user picks up the running timer where they left
 * off — instead of seeing a destructive "Save or Discard" alert that would
 * end the timer prematurely.
 *
 * Singleton state — only one external Zoom timer can be active at a time.
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
