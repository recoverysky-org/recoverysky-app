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
import { api, type LiveSchedule, type ScheduleDataRow } from "@/services/api"
import { logger } from "@/utils/logger"

import {
  mergePools,
  projectOnline,
  isInPersonVenue,
  inPersonPoolOf,
  type PoolOutcome,
} from "./meetingPools"

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
 * Retry budget for the in-person pool only. It's fetched but unrendered by
 * every surface today (hold-back), so it must never make the visible online
 * pool wait on it — see the `retryWithBackoff` JSDoc. 1 attempt, no backoff
 * sleeps: a flaky in-person endpoint costs one extra round-trip, not ~7s.
 */
const IN_PERSON_MAX_ATTEMPTS = 1

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
 * @param maxAttemptsOverride - Caller-supplied retry budget, defaulting to
 *   `RETRY_CONFIG.maxAttempts`. Added for the in-person pool (2026-08-02
 *   in-person data-layer fix wave): its data is unrendered by any surface
 *   today (hold-back), so burning the full 4-attempt/~7s budget when that
 *   endpoint is unavailable only delays the visible online pool for no
 *   user-facing benefit. Don't remove this parameter to "simplify" the
 *   signature — the asymmetry between pools is intentional.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  isSuccess: (result: T) => boolean,
  label: string,
  maxAttemptsOverride: number = RETRY_CONFIG.maxAttempts,
): Promise<{ result: T; attempts: number } | { error: string; attempts: number }> {
  let lastResult: T | undefined
  let lastError: string | undefined

  for (let attempt = 1; attempt <= maxAttemptsOverride; attempt++) {
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

      if (attempt < maxAttemptsOverride) {
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

      if (attempt < maxAttemptsOverride) {
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
  log.error(`${label} failed after ${maxAttemptsOverride} attempts`, {
    error: lastError,
  })

  if (lastResult !== undefined) {
    return { result: lastResult, attempts: maxAttemptsOverride }
  }

  return { error: lastError ?? "Unknown error", attempts: maxAttemptsOverride }
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
   * Both venue pools merged (online + in_person). In-person UI reads this.
   * Populated since the in-person data-layer piece (2026-08-02 spec);
   * existing surfaces keep reading `liveMeetings` (online-only hold-back).
   */
  allLiveMeetings: MeetingWithTrex[]
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
  const configStore = useConfigStore()

  // Live meetings data — the merged pool (both venues). What existing UI
  // consumes is the derived online-only projection below (hold-back).
  const [allLiveMeetings, setAllLiveMeetings] = useState<MeetingWithTrex[]>([])

  // Hold-back projection: pre-in-person surfaces (LiveScreen, MainNavigator
  // badge) render online-only until the in-person UI/UX design lands. Do NOT
  // switch consumers to allLiveMeetings without that design.
  const liveMeetings = useMemo(() => projectOnline(allLiveMeetings), [allLiveMeetings])

  // Status
  const [isLoading, setIsLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [apiStatus, setApiStatus] = useState<ApiStatus>("unknown")
  const [error, setError] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Auto-refresh when maintenance mode ends so meetings are up to date
  useEffect(() => {
    const dispose = reaction(
      () => configStore.maintenanceMode,
      (inMaintenance, was) => {
        if (was && !inMaintenance) {
          log.info("Maintenance ended, refreshing live meetings")
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
      if (configStore.maintenanceMode) {
        log.debug("Skipping live meetings refresh — maintenance mode")
        setIsLoading(false)
        return
      }

      log.debug("Refreshing live meetings from API...")
      setIsLoading(true)
      setError(null)

      // Dual-fetch: one call per venue pool, in parallel, each with its own
      // retry budget. retryWithBackoff never rejects, so Promise.all is safe.
      // (2026-08-02 in-person data-layer spec: dual-fetch & merge.)
      // CHANGED 2026-08-02 (fix wave): the in-person pool gets a reduced
      // budget (IN_PERSON_MAX_ATTEMPTS) — see that constant's comment. The
      // online pool keeps the full budget since it's what every surface
      // renders.
      const [onlineOutcome, inPersonOutcome] = await Promise.all([
        retryWithBackoff(
          () => api.getLiveSchedules("online"),
          (result) => result.kind === "ok",
          "getLiveSchedules(online)",
        ),
        retryWithBackoff(
          () => api.getLiveSchedules("in_person"),
          (result) => result.kind === "ok",
          "getLiveSchedules(in_person)",
          IN_PERSON_MAX_ATTEMPTS,
        ),
      ])

      // Convert API schedules to MeetingWithTrex (same mapping both pools).
      const toMeetings = (schedules: LiveSchedule[]): MeetingWithTrex[] =>
        schedules.map((s) => ({
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

      type Outcome =
        | { result: Awaited<ReturnType<typeof api.getLiveSchedules>>; attempts: number }
        | { error: string; attempts: number }

      const toPool = (outcome: Outcome): PoolOutcome<MeetingWithTrex> => {
        if ("result" in outcome && outcome.result.kind === "ok") {
          return { ok: true, items: toMeetings(outcome.result.schedules) }
        }
        return { ok: false, items: [] }
      }

      // The failure kind behind an outcome, for logging — "kind" from an API
      // problem (e.g. "not-found", "timeout") or the transport-level error
      // string retryWithBackoff carries when every attempt threw.
      const outcomeKind = (outcome: Outcome): string =>
        "result" in outcome ? outcome.result.kind : outcome.error

      const onlinePool = toPool(onlineOutcome)
      // In-person pool is self-verified, not trusted — a server that ignores
      // venueType (production, as of this fix wave) answers with the same
      // rows as the online call. inPersonPoolOf filters toPool()'s items down
      // to genuine in_person rows so an unaware server yields an empty pool
      // instead of duplicating every online meeting. See meetingPools.ts.
      const inPersonRaw = toPool(inPersonOutcome)
      const inPersonPool = inPersonPoolOf(inPersonRaw.ok, inPersonRaw.items)

      const merged = mergePools(onlinePool, inPersonPool)

      // Only a total failure surfaces as an error — one pool failing
      // degrades gracefully to the other (spec decision 4).
      if (merged.bothFailed) {
        // Interpolate both kinds — no consumer reads `error` today, but the
        // field should carry the actual failure, not a generic string.
        setError(
          `Network error: live schedules unavailable (online: ${outcomeKind(onlineOutcome)}, in_person: ${outcomeKind(inPersonOutcome)})`,
        )
        setAllLiveMeetings([])
        setIsLoading(false)
        return
      }
      if (merged.onlineFailed || merged.inPersonFailed) {
        // Include the failed pool's kind — this log is the primary
        // production signal for whether the in-person pool actually works
        // (booleans alone can't distinguish "server rejects/strips the
        // param" from "flaky network").
        log.warn("One venue pool failed; serving partial live data", {
          onlineFailed: merged.onlineFailed,
          inPersonFailed: merged.inPersonFailed,
          onlineKind: merged.onlineFailed ? outcomeKind(onlineOutcome) : undefined,
          inPersonKind: merged.inPersonFailed ? outcomeKind(inPersonOutcome) : undefined,
        })
      }

      setAllLiveMeetings(merged.items)
      setLastRefresh(new Date())
      setIsLoading(false)

      log.info("✓ Live meetings ready", {
        total: merged.items.length,
        inPerson: merged.items.filter((m) => isInPersonVenue(m.venueType)).length,
      })
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
      allLiveMeetings,
      liveMeetings,
      isLoading,
      lastRefresh,
      refresh,
      apiStatus,
      error,
    }),
    [allLiveMeetings, liveMeetings, isLoading, lastRefresh, refresh, apiStatus, error],
  )

  log.debug("MeetingProvider rendering", {
    liveCount: liveMeetings.length,
    allCount: allLiveMeetings.length,
    isLoading,
  })

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
}
