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
  useRef,
  useMemo,
  type ReactNode,
} from "react"
import { feedbackCache, type FeedbackRecord } from "@/db"
import { api, type ScheduleDataRow } from "@/services/api"
import { logger } from "@/utils/logger"
import { type meeting } from "@common"

const log = logger.child({ module: "MeetingContext" })

// ============================================================================
// Helper: Condense Schedule Rows
// ============================================================================

/**
 * Condense schedule rows by combining rows where possible.
 *
 * Each row has 7 columns (Mon-Sun). A time can be placed in a row
 * only if that day column is currently null.
 *
 * Example:
 *   Input:  [[8am, null, null, ...], [null, null, 9am, ...], [10am, null, null, ...]]
 *   Output: [[8am, null, 9am, ...], [10am, null, null, ...]]
 *
 * Row 1 and 2 combined because Mon and Wed don't conflict.
 * Row 3 stays separate because Mon is already occupied in combined row.
 */
function condenseScheduleRows(rows: ScheduleDataRow[]): ScheduleDataRow[] {
  if (rows.length <= 1) return rows

  const result: ScheduleDataRow[] = []

  // Process each cell from input rows
  for (const inputRow of rows) {
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const time = inputRow[dayIndex]
      if (time === null) continue

      // Try to find an existing output row where this day is empty
      let placed = false
      for (const outputRow of result) {
        if (outputRow[dayIndex] === null) {
          outputRow[dayIndex] = time
          placed = true
          break
        }
      }

      // No room in existing rows, create a new one
      if (!placed) {
        const newRow: ScheduleDataRow = [null, null, null, null, null, null, null]
        newRow[dayIndex] = time
        result.push(newRow)
      }
    }
  }

  return result
}

// ============================================================================
// Types
// ============================================================================

export interface MeetingWithTrex extends meeting {
  trex: trex | null
  /** User's feedback for this meeting (loves, rates, joins) - null if no feedback */
  feedback: FeedbackRecord | null
  /** Pre-computed schedule grid data from API (for SchedulePopup) */
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
  /** Whether live meetings are from API or local calculation */
  liveSource: "api" | "local"
  /** API connection status */
  apiStatus: ApiStatus
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

  // Startup data: trexes loaded into memory
  const [trexMap, setTrexMap] = useState<Map<string, trex>>(new Map())

  // Live meetings data
  const [liveMeetings, setLiveMeetings] = useState<MeetingWithTrex[]>([])

  // Status
  const [isLoading, setIsLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [liveSource, setLiveSource] = useState<"api" | "local">("local")
  const [apiStatus, setApiStatus] = useState<ApiStatus>("unknown")
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [startupComplete, setStartupComplete] = useState(false)

  // Track if we should use API or local fallback
  const useApiRef = useRef(true)

  // ============================================================================
  // Startup: Load trexes only (lightweight)
  // Re-runs when dbStatus changes to ensure we load after seeding completes
  // ============================================================================
  useEffect(() => {
    if (dbStatus !== "seeded") {
      log.debug("Database not seeded, skipping startup load", { dbStatus })
      return
    }

    function loadStartupData() {
      try {
        log.info("Loading startup data (trexes only)")

        // Load all trexes
        const trexRows = findAllTrexes()
        const newTrexMap = new Map<string, trex>()
        for (const row of trexRows) {
          newTrexMap.set(row.id, toTrex(row))
        }

        log.info("Startup data loaded", { trexCount: newTrexMap.size })

        setTrexMap(newTrexMap)
        setStartupComplete(true)
      } catch (error) {
        log.error("Error loading startup data", { error: String(error) })
      }
    }

    loadStartupData()
  }, [dbStatus])

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
  // Refresh live meetings
  // API online: Fetches schedules from API, loads meetings by ID from SQLite
  // API offline: Fallback to local trex calculation + SQLite
  // ============================================================================
  useEffect(() => {
    async function refreshLiveMeetings() {
      try {
        log.debug("Refreshing live meetings...")
        setIsLoading(true)

        // Try API first - returns live schedules with meeting IDs and grid data
        if (useApiRef.current) {
          try {
            const result = await api.getLiveSchedules()

            if (result.kind === "ok") {
              const { schedules } = result
              log.info("API returned schedules", { count: schedules.length })

              // Collect unique meeting IDs and map schedule data by mid
              // Apply condenseScheduleRows to minimize row count
              const meetingIds = new Set<string>()
              const scheduleDataByMid = new Map<string, ScheduleDataRow[]>()
              for (const s of schedules) {
                meetingIds.add(s.mid)
                scheduleDataByMid.set(s.mid, condenseScheduleRows(s.data))
              }

              const uniqueMids = Array.from(meetingIds)
              log.info("Unique meeting IDs from schedules", {
                count: uniqueMids.length,
                first3: uniqueMids.slice(0, 3).join(", "),
              })

              // Load just those meetings from SQLite
              log.debug("Querying SQLite for meetings...")
              const meetingsResult = await meetingRepo.findByIds(uniqueMids)
              if (!meetingsResult.ok) {
                log.error("Failed to load meetings from SQLite", { error: String(meetingsResult.error) })
                throw new Error("Failed to load meetings")
              }

              log.info("SQLite returned meetings", {
                requested: uniqueMids.length,
                returned: meetingsResult.value.length,
              })

              // Convert to MeetingWithTrex with scheduleData
              const newLiveMeetings = meetingsResult.value.map((m) =>
                toMeetingWithTrexFromDb(m, trexMap, scheduleDataByMid.get(m.meeting.id) || null),
              )

              setLiveMeetings(newLiveMeetings)
              setLiveSource("api")
              setLastRefresh(new Date())
              setIsLoading(false)

              log.info("✓ Live meetings ready", {
                schedules: schedules.length,
                meetings: newLiveMeetings.length,
                trexMapSize: trexMap.size,
              })
              return
            } else {
              log.warn("✗ API getLiveSchedules failed, falling back to local", { kind: result.kind })
              useApiRef.current = false
            }
          } catch (error) {
            log.error("✗ API getLiveSchedules error, falling back to local", { error: String(error) })
            useApiRef.current = false
          }
        }

        const { schedules } = result
        log.info("API returned schedules", { count: schedules.length })

        if (schedules.length === 0) {
          log.info("No live meetings")
          setLiveMeetings([])
          setLiveSource("local")
          setLastRefresh(new Date())
          setIsLoading(false)
          return
        }

        // Convert API schedules to MeetingWithTrex
        const newLiveMeetings: MeetingWithTrex[] = schedules.map((s) => ({
          ...s.meeting,
          feedback: feedbackCache.get(s.meeting.id),
          millis: s.millis,
          scheduleData: s.data,
        }))

        setLiveMeetings(newLiveMeetings)
        setLiveSource("local")
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
    log.info("Manual refresh triggered - will retry API")
    useApiRef.current = true
    setRefreshTrigger((prev) => prev + 1)
  }, [])

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<MeetingContextType>(
    () => ({
      liveMeetings,
      isLoading,
      lastRefresh,
      refresh,
      liveSource,
      apiStatus,
    }),
    [liveMeetings, isLoading, lastRefresh, refresh, liveSource, apiStatus],
  )

  log.debug("MeetingProvider rendering", { liveCount: liveMeetings.length, isLoading })

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
}
