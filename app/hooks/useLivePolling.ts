/**
 * useLivePolling Hook
 *
 * Polls for live meeting updates at a configurable interval.
 * Pauses when app is backgrounded to save resources.
 */

import { useEffect, useRef } from "react"
import { AppState, type AppStateStatus } from "react-native"

interface UseLivePollingOptions {
  /** Polling interval in milliseconds (default: 30000) */
  interval?: number
  /** Whether polling is enabled (default: true) */
  enabled?: boolean
  /** Callback to run on each poll */
  onRefresh: () => void
}

/**
 * Hook that polls for updates at a regular interval
 *
 * @example
 * useLivePolling({
 *   interval: 30000,
 *   enabled: true,
 *   onRefresh: () => refreshLiveMeetings(),
 * })
 */
export function useLivePolling({
  interval = 30000,
  enabled = true,
  onRefresh,
}: UseLivePollingOptions): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Start polling
    const startPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
      intervalRef.current = setInterval(() => {
        onRefresh()
      }, interval)
    }

    // Stop polling
    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    // Handle app state changes
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === "active") {
        // App came to foreground - refresh immediately and restart polling
        onRefresh()
        startPolling()
      } else if (nextAppState.match(/inactive|background/)) {
        // App went to background - stop polling
        stopPolling()
      }
      appStateRef.current = nextAppState
    }

    // Subscribe to app state changes
    const subscription = AppState.addEventListener("change", handleAppStateChange)

    // Start polling immediately
    startPolling()

    // Cleanup
    return () => {
      stopPolling()
      subscription.remove()
    }
  }, [enabled, interval, onRefresh])
}
