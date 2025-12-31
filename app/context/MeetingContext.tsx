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
// Retry Configuration
// ============================================================================

const RETRY_CONFIG = {
  maxAttempts: 4,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute an async function with exponential backoff retry
 * Only logs error after all retries exhausted
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  isSuccess: (result: T) => boolean,
  label: string,
): Promise<{ result: T; attempts: number } | { error: string; attempts: number }> {
  let lastResult: T | undefined
  let lastError: string | undefined

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      const result = await fn()

      if (isSuccess(result)) {
        if (attempt > 1) {
          log.info(`${label} succeeded after ${attempt} attempts`)
        }
        return { result, attempts: attempt }
      }

      // API returned error response
      lastResult = result
      const errorKind = (result as { kind?: string })?.kind ?? "unknown"

      if (attempt < RETRY_CONFIG.maxAttempts) {
        const delay = Math.min(
          RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1),
          RETRY_CONFIG.maxDelayMs,
        )
        log.debug(`${label} attempt ${attempt} failed (${errorKind}), retrying in ${delay}ms...`)
        await sleep(delay)
      } else {
        lastError = errorKind
      }
    } catch (err) {
      lastError = String(err)

      if (attempt < RETRY_CONFIG.maxAttempts) {
        const delay = Math.min(
          RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1),
          RETRY_CONFIG.maxDelayMs,
        )
        log.debug(`${label} attempt ${attempt} threw error, retrying in ${delay}ms...`)
        await sleep(delay)
      }
    }
  }

  // All retries exhausted
  log.error(`${label} failed after ${RETRY_CONFIG.maxAttempts} attempts`, {
    error: lastError,
  })

  if (lastResult !== undefined) {
    return { result: lastResult, attempts: RETRY_CONFIG.maxAttempts }
  }

  return { error: lastError ?? "Unknown error", attempts: RETRY_CONFIG.maxAttempts }
}

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
  // Check API status (with retry)
  // ============================================================================
  useEffect(() => {
    async function checkApiStatus() {
      log.debug("Checking API status...")

      const outcome = await retryWithBackoff(
        () => api.getStatus(),
        (result) => result.kind === "ok",
        "API status check",
      )

      if ("result" in outcome && outcome.result.kind === "ok") {
        log.info("✓ API status: connected", { status: outcome.result.status })
        setApiStatus("connected")
      } else {
        log.warn("✗ API status: disconnected after retries")
        setApiStatus("disconnected")
      }
    }
    checkApiStatus()
  }, [refreshTrigger])

  // ============================================================================
  // Refresh live meetings from API (with retry)
  // ============================================================================
  useEffect(() => {
    async function refreshLiveMeetings() {
      log.debug("Refreshing live meetings from API...")
      setIsLoading(true)
      setError(null)

      const outcome = await retryWithBackoff(
        () => api.getLiveSchedules(),
        (result) => result.kind === "ok",
        "getLiveSchedules",
      )

      // Handle retry failure
      if ("error" in outcome) {
        setError(`Network error: ${outcome.error}`)
        setLiveMeetings([])
        setIsLoading(false)
        return
      }

      // Handle API error response after retries exhausted
      if (outcome.result.kind !== "ok") {
        setError(`API error: ${outcome.result.kind}`)
        setLiveMeetings([])
        setIsLoading(false)
        return
      }

      // Success!
      const { schedules } = outcome.result
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
      setIsLoading(false)

      log.info("✓ Live meetings ready", { count: newLiveMeetings.length })
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
