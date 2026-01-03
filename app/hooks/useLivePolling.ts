/**
 * useLivePolling Hook
 *
 * Polls for live meeting updates at 15-minute clock marks (:00, :15, :30, :45).
 * Pauses when app is backgrounded to save resources.
 */

import { useEffect, useRef } from "react"
import { AppState, type AppStateStatus } from "react-native"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "LivePolling" })

interface UseLivePollingOptions {
  /** Whether polling is enabled (default: true) */
  enabled?: boolean
  /** Callback to run on each poll */
  onRefresh: () => void
}

/**
 * Calculate milliseconds until next 15-minute mark
 */
function msUntilNext15MinMark(): number {
  const now = new Date()
  const minutes = now.getMinutes()
  const seconds = now.getSeconds()
  const ms = now.getMilliseconds()

  // Find next 15-minute mark (0, 15, 30, 45)
  const nextMark = Math.ceil((minutes + 1) / 15) * 15
  const minutesUntil = (nextMark - minutes) % 60 || 15 // If exactly on mark, wait 15 min

  // Convert to milliseconds, subtracting current seconds/ms
  return minutesUntil * 60 * 1000 - seconds * 1000 - ms
}

/**
 * Hook that polls for updates at 15-minute clock marks
 *
 * Refreshes at :00, :15, :30, :45 of each hour.
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

    // Schedule next refresh at 15-minute mark
    const scheduleNextRefresh = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      const msUntilNext = msUntilNext15MinMark()
      log.debug("Scheduled next refresh", { minutesUntil: Math.round(msUntilNext / 1000 / 60) })

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
