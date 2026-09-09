/**
 * useLivePolling Hook
 *
 * Polls for live meeting updates at 15-minute clock marks (:00, :15, :30, :45).
 * Pauses when app is backgrounded to save resources.
 *
 * CHANGED 2026-09-09: each refresh now lands a random 5–90 s *after* the
 * mark instead of exactly on it. The whole fleet firing in the same second
 * the API's schedule cache expires caused a pipeline stampede and 10 s
 * client timeouts at every boundary — see livePollingLogic.ts for the
 * numbers. Do not "fix" the delay back to the exact mark.
 */

import { useEffect, useRef } from "react"
import { AppState, type AppStateStatus } from "react-native"

import { logger } from "@/utils/logger"

import { msUntilNextRefresh, pickRefreshJitterMs } from "./livePollingLogic"

const log = logger.child({ module: "LivePolling" })

interface UseLivePollingOptions {
  /** Whether polling is enabled (default: true) */
  enabled?: boolean
  /** Callback to run on each poll */
  onRefresh: () => void
}

/**
 * Hook that polls for updates at 15-minute clock marks
 *
 * Refreshes shortly after :00, :15, :30, :45 of each hour (jittered).
 * Also refreshes immediately when app comes to foreground.
 *
 * @example
 * useLivePolling({
 *   enabled: true,
 *   onRefresh: () => refreshLiveMeetings(),
 * })
 */
export function useLivePolling({ enabled = true, onRefresh }: UseLivePollingOptions): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }

    // Schedule next refresh just after the 15-minute mark. The jitter is
    // drawn fresh per firing so no install is pinned to the boundary.
    const scheduleNextRefresh = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      const jitterMs = pickRefreshJitterMs()
      const msUntilNext = msUntilNextRefresh(new Date(), jitterMs)
      log.debug("Scheduled next refresh", {
        minutesUntil: Math.round(msUntilNext / 1000 / 60),
        jitterSeconds: Math.round(jitterMs / 1000),
      })

      timeoutRef.current = setTimeout(() => {
        onRefresh()
        scheduleNextRefresh() // Schedule next one
      }, msUntilNext)
    }

    // Stop polling
    const stopPolling = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    // Handle app state changes
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === "active") {
        // App came to foreground - refresh immediately and reschedule
        onRefresh()
        scheduleNextRefresh()
      } else if (nextAppState.match(/inactive|background/)) {
        // App went to background - stop polling
        stopPolling()
      }
      appStateRef.current = nextAppState
    }

    // Subscribe to app state changes
    const subscription = AppState.addEventListener("change", handleAppStateChange)

    // Schedule first refresh (don't refresh immediately on mount)
    scheduleNextRefresh()

    // Cleanup
    return () => {
      stopPolling()
      subscription.remove()
    }
  }, [enabled, onRefresh])
}
