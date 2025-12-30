/**
 * Meeting Context
 *
 * Provides live meeting data from the API.
 * API returns full meeting objects with millis and pre-computed grid data.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react"
import { type meeting } from "@common"

import { feedbackCache, type FeedbackRecord } from "@/db"
import { api, type ScheduleDataRow } from "@/services/api"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "MeetingContext" })

// ============================================================================
// Types
// ============================================================================

export interface MeetingWithTrex extends meeting {
  /** User's feedback for this meeting (loves, rates, joins) - null if no feedback */
  feedback: FeedbackRecord | null
  /** Current meeting time in UTC milliseconds */
  millis: number
  /** Meeting duration in milliseconds */
  duration_ms: number
  /** Pre-computed schedule grid data from API (values are UTC millis) */
  scheduleData: ScheduleDataRow[] | null
}

/** API connection status */
export type ApiStatus = "connected" | "disconnected" | "unknown"

export interface MeetingContextType {
  /** Meetings currently live */
  liveMeetings: MeetingWithTrex[]
  /** Loading state */
  isLoading: boolean
  /** Last time live meetings were refreshed */
  lastRefresh: Date | null
  /** Manually trigger a refresh */
  refresh: () => void
  /** API connection status */
  apiStatus: ApiStatus
  /** Error message if API failed */
  error: string | null
}

const MeetingContext = createContext<MeetingContextType | null>(null)

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access meeting data and live filtering
 */
export function useMeetings(): MeetingContextType {
  const context = useContext(MeetingContext)
  if (!context) {
    throw new Error("useMeetings must be used within a MeetingProvider")
  }
  return context
}

// ============================================================================
// Provider
// ============================================================================

interface MeetingProviderProps {
  children: ReactNode
}

export function MeetingProvider({ children }: MeetingProviderProps): ReactNode {
  log.debug("MeetingProvider initializing")

  // Live meetings data
  const [liveMeetings, setLiveMeetings] = useState<MeetingWithTrex[]>([])

  // Status
  const [isLoading, setIsLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [apiStatus, setApiStatus] = useState<ApiStatus>("unknown")
  const [error, setError] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // ============================================================================
  // Check API status
  // ============================================================================
  useEffect(() => {
    async function checkApiStatus() {
      log.debug("Checking API status...")
      const result = await api.getStatus()
      if (result.kind === "ok") {
        log.info("✓ API status: connected", { status: result.status })
        setApiStatus("connected")
      } else {
        log.warn("✗ API status: disconnected", { kind: result.kind })
        setApiStatus("disconnected")
      }
    }
    checkApiStatus()
  }, [refreshTrigger])

  // ============================================================================
  // Refresh live meetings from API
  // ============================================================================
  useEffect(() => {
    async function refreshLiveMeetings() {
      try {
        log.debug("Refreshing live meetings from API...")
        setIsLoading(true)
        setError(null)

        const result = await api.getLiveSchedules()

        if (result.kind !== "ok") {
          log.error("API getLiveSchedules failed", { kind: result.kind })
          setError(`API error: ${result.kind}`)
          setLiveMeetings([])
          setIsLoading(false)
          return
        }

        const { schedules } = result
        log.info("API returned schedules", { count: schedules.length })

        if (schedules.length === 0) {
          log.info("No live meetings")
          setLiveMeetings([])
          setLastRefresh(new Date())
          setIsLoading(false)
          return
        }

        // Convert API schedules to MeetingWithTrex
        const newLiveMeetings: MeetingWithTrex[] = schedules.map((s) => ({
          ...s.meeting,
          feedback: feedbackCache.get(s.meeting.id),
          millis: s.millis,
          duration_ms: s.duration_ms ?? 0,
          scheduleData: s.data,
        }))

        setLiveMeetings(newLiveMeetings)
        setLastRefresh(new Date())

        log.info("✓ Live meetings ready", { count: newLiveMeetings.length })
      } catch (err) {
        log.error("Error refreshing live meetings", { error: String(err) })
        setError(String(err))
      } finally {
        setIsLoading(false)
      }
    }

    refreshLiveMeetings()
  }, [refreshTrigger])

  // ============================================================================
  // Public API
  // ============================================================================

  const refresh = useCallback(() => {
    log.info("Manual refresh triggered")
    setRefreshTrigger((prev) => prev + 1)
  }, [])

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<MeetingContextType>(
    () => ({
      liveMeetings,
      isLoading,
      lastRefresh,
      refresh,
      apiStatus,
      error,
    }),
    [liveMeetings, isLoading, lastRefresh, refresh, apiStatus, error],
  )

  log.debug("MeetingProvider rendering", { liveCount: liveMeetings.length, isLoading })

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
}
