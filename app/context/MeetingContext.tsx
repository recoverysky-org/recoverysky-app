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
import { type meeting } from "@recoverysky-org/common/browser"
import { reaction } from "mobx"

import { feedbackCache, type FeedbackRecord } from "@/db"
import { useConfigStore } from "@/models"
import { api, type ScheduleDataRow } from "@/services/api"
import { isLiveRefreshBlocked, isServiceRecoveryEdge } from "@/utils/connectivityLogic"
import { logger } from "@/utils/logger"

import { projectOnline } from "./meetingPools"

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
 *
 * CHANGED 2026-09-09: the `maxAttempts` parameter is gone with the
 * in-person live pool it existed for (see the refresh effect below). Every
 * caller now gets the full `RETRY_CONFIG` budget.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  isSuccess: (result: T) => boolean,
  label: string,
): Promise<{ result: T; attempts: number } | { error: string; attempts: number }> {
  const maxAttempts = RETRY_CONFIG.maxAttempts
  let lastResult: T | undefined
  let lastError: string | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

      if (attempt < maxAttempts) {
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

      if (attempt < maxAttempts) {
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
  log.error(`${label} failed after ${maxAttempts} attempts`, {
    error: lastError,
  })

  if (lastResult !== undefined) {
    return { result: lastResult, attempts: maxAttempts }
  }

  return { error: lastError ?? "Unknown error", attempts: maxAttempts }
}

// ============================================================================
// Types
// ============================================================================

export interface MeetingWithTrex extends meeting {
  /** User's feedback for this meeting (loves, rates, joins) - null if no feedback */
  feedback: FeedbackRecord | null
  /** Schedule ID from the API */
  sid: string
  /** Current meeting time in UTC milliseconds */
  millis: number
  /** Meeting duration in milliseconds */
  duration_ms: number
  /** Pre-computed schedule grid data from API (values are UTC millis) */
  scheduleData: ScheduleDataRow[] | null
  /** Whether this meeting requires a password to join externally */
  external?: boolean
  /**
   * Meters from the user's location — present only when the row came from
   * /schedules/nearby (the In-Person segment). Every other fetch path leaves
   * it undefined, which sorts last and hides the distance badge.
   */
  distance_m?: number
}

/** API connection status */
export type ApiStatus = "connected" | "disconnected" | "unknown"

export interface MeetingContextType {
  /**
   * Meetings currently live — the online pool only. In-person meetings are
   * served by `useNearbySchedules` (location-scoped, user-initiated), never
   * by this context. The merged `allLiveMeetings` pool was removed
   * 2026-09-09: nothing ever read it, and its `/schedules/live?venueType=in_person`
   * fetch (~1.4 MB, every quarter-hour) timed out at every cache boundary.
   */
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
  const configStore = useConfigStore()

  // Live meetings data — online pool only (see MeetingContextType.liveMeetings).
  const [liveMeetings, setLiveMeetings] = useState<MeetingWithTrex[]>([])

  // Status
  const [isLoading, setIsLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [apiStatus, setApiStatus] = useState<ApiStatus>("unknown")
  const [error, setError] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Auto-refresh when maintenance mode ends so meetings are up to date.
  // CHANGED 2026-09-14: observes the combined blocked flag (maintenance OR
  // cold-start outage), not `maintenanceMode` alone. On the outage path
  // maintenance never flips true, so there was no edge to fire on and the
  // Live list sat empty after the outage cleared until a manual pull.
  // Production hid this because outage recovery reloads the app — but
  // `Updates.reloadAsync` throws in `__DEV__`, and relying on the reload is
  // fragile anyway. See `isLiveRefreshBlocked` for the full story.
  useEffect(() => {
    const dispose = reaction(
      () =>
        isLiveRefreshBlocked({
          maintenanceMode: configStore.maintenanceMode,
          outageMode: configStore.outageMode,
        }),
      (isBlocked, wasBlocked) => {
        if (isServiceRecoveryEdge(wasBlocked, isBlocked)) {
          log.info("Maintenance/outage ended, refreshing live meetings")
          setRefreshTrigger((prev) => prev + 1)
        }
      },
    )
    return () => dispose()
  }, [configStore])

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
      // Skip the API call entirely while server-side maintenance is on.
      // We keep showing whatever cached schedules we already have. The
      // existing maintenance-exit reaction above will trigger a refresh
      // automatically when the flag clears.
      // CHANGED 2026-09-14: also skips during cold-start outage. The
      // MaintenanceScreen is up and the API just failed its precheck, so the
      // ~47 s retry ladder could only burn radio and log a guaranteed
      // `getLiveSchedules(online) failed`. The recovery-edge reaction above
      // fetches the moment either flag clears.
      if (
        isLiveRefreshBlocked({
          maintenanceMode: configStore.maintenanceMode,
          outageMode: configStore.outageMode,
        })
      ) {
        log.debug("Skipping live meetings refresh — maintenance/outage mode")
        setIsLoading(false)
        return
      }

      log.debug("Refreshing live meetings from API...")
      setIsLoading(true)
      setError(null)

      // Online pool only.
      // CHANGED 2026-09-09: this used to dual-fetch online + in_person in
      // parallel and merge the pools (2026-08-02 in-person data-layer spec).
      // The in-person half was never rendered — every consumer read the
      // online-only projection — and it failed on schedule: the API's
      // schedule cache expires at :00/:15/:30/:45, exactly when
      // useLivePolling fires, and the uncached in-person pipeline takes
      // 8–30 s against our 10 s client timeout. Result: a guaranteed
      // `getLiveSchedules(in_person) failed` error log every quarter-hour for
      // a 1.4 MB payload nobody used. In-person data is fetched on demand by
      // useNearbySchedules instead. Do not re-add the in-person fetch here.
      const outcome = await retryWithBackoff(
        () => api.getLiveSchedules("online"),
        (result) => result.kind === "ok",
        "getLiveSchedules(online)",
      )

      if (!("result" in outcome) || outcome.result.kind !== "ok") {
        // "kind" from an API problem (e.g. "not-found", "timeout") or the
        // transport-level error string retryWithBackoff carries when every
        // attempt threw. No consumer reads `error` today, but the field
        // should carry the actual failure, not a generic string.
        const kind = "result" in outcome ? outcome.result.kind : outcome.error
        setError(`Network error: live schedules unavailable (${kind})`)
        // CHANGED 2026-09-14: a failed refresh no longer clears `liveMeetings`.
        // This used to `setLiveMeetings([])`, so the first quarter-hour poll
        // that timed out while the API slid into maintenance wiped a list the
        // user was looking at, and the Live tab showed "no meetings" until
        // the service came back. The last successful list is the better
        // fallback: a stale meeting is more useful than none, `error` still
        // records the failure, and the next successful refresh replaces it.
        setIsLoading(false)
        return
      }

      // Convert API schedules to MeetingWithTrex.
      const meetings: MeetingWithTrex[] = outcome.result.schedules.map((s) => ({
        ...s.meeting,
        // Prefer schedule-level password over meeting-level (API provides it per-schedule)
        password: s.password || s.meeting.password || "",
        passwordEnc: s.passwordEnc || s.meeting.passwordEnc || "",
        feedback: feedbackCache.get(s.meeting.id),
        sid: s.sid,
        millis: s.millis,
        duration_ms: s.duration_ms ?? 0,
        scheduleData: s.data,
      }))

      // projectOnline stays as a belt-and-braces filter: the server defaults
      // to online and we ask for it explicitly, but a row with a physical
      // venueType must never reach the Live list.
      setLiveMeetings(projectOnline(meetings))
      setLastRefresh(new Date())
      setIsLoading(false)

      log.info("✓ Live meetings ready", { total: meetings.length })
    }

    refreshLiveMeetings()
    // `configStore.maintenanceMode` / `outageMode` are read inside but are
    // deliberately NOT deps: this effect must fire only on `refreshTrigger`.
    // The flags are observed by the MobX reaction above, which bumps the
    // trigger on the recovery edge; listing them here would run a second,
    // duplicate refresh on every flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  log.debug("MeetingProvider rendering", {
    liveCount: liveMeetings.length,
    isLoading,
  })

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
}
