/**
 * Meeting Context
 *
 * Provides live meeting data:
 * - API returns live schedules with meeting IDs and pre-computed grid data
 * - Loads only the meetings referenced by live schedules from SQLite
 * - Falls back to local trex calculation when API fails
 *
 * Key relationship: schedule.mid === meeting.id (1:1)
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
import {
  meetingRepo,
  findAllTrexes,
  feedbackCache,
  type TrexRow,
  type FeedbackRecord,
} from "@/db"
import { api, type LiveSchedule, type ScheduleDataRow } from "@/services/api"
import { useDatabase } from "@/db"
import { logger } from "@/utils/logger"
import {
  isLiveInterval,
  normalize,
  DateTime,
  type trex,
  type meeting,
  Periodicity,
  MeetingStatus,
  MeetingVerified,
} from "@common"
import type { MeetingWithRelations } from "@sqlite"

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
// Helper Functions
// ============================================================================

/**
 * Convert TrexRow to trex object
 */
function toTrex(row: TrexRow): trex {
  return {
    id: row.id,
    coordinate: row.coordinate,
    coordinate_end: row.coordinate_end,
    timezone: row.timezone,
    periodicity: row.periodicity as Periodicity,
    duration_ms: row.duration_ms,
    dtstart: row.dtstart,
    dtend: row.dtend,
    rrule_str: row.rrule_str,
    rrule_json: typeof row.rrule_json === "string" ? JSON.parse(row.rrule_json) : row.rrule_json,
    hour: row.hour,
    minute: row.minute,
    dow: row.dow,
    dom: row.dom,
    month: row.month,
  }
}

/**
 * Check if a trex (meeting occurrence) is currently live
 */
function isMeetingLive(trexData: trex): boolean {
  const now = DateTime.now().setZone(trexData.timezone)

  const normalizeResult = normalize(
    {
      hour: now.hour,
      minute: now.minute,
      timezone: trexData.timezone,
      dow: now.weekday,
      dom: now.day,
      month: now.month,
    },
    trexData.periodicity as Periodicity,
  )

  if (!normalizeResult.ok) return false

  return isLiveInterval(trexData.coordinate, trexData.coordinate_end, normalizeResult.value.coordinate)
}

/**
 * Convert MeetingWithRelations (from SQLite) to MeetingWithTrex
 */
function toMeetingWithTrexFromDb(
  m: MeetingWithRelations,
  trexMap: Map<string, trex>,
  scheduleData: ScheduleDataRow[] | null,
): MeetingWithTrex {
  return {
    ...(m.meeting as unknown as meeting),
    meetingTypes: m.types,
    tags: m.tags,
    trex: trexMap.get(m.meeting.id) || null,
    feedback: feedbackCache.get(m.meeting.id),
    scheduleData,
  }
}

// ============================================================================
// Provider
// ============================================================================

interface MeetingProviderProps {
  children: ReactNode
}

export function MeetingProvider({ children }: MeetingProviderProps): ReactNode {
  const { status: dbStatus } = useDatabase()
  log.debug("MeetingProvider initializing", { dbStatus })

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
    if (!startupComplete) {
      return
    }

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

        // Fallback: Calculate live from trexes + load from SQLite
        log.debug("Using local fallback...")
        const liveMeetingIds: string[] = []
        for (const [id, trexData] of trexMap) {
          if (isMeetingLive(trexData)) {
            liveMeetingIds.push(id)
          }
        }

        if (liveMeetingIds.length === 0) {
          log.info("No live meetings (local fallback)")
          setLiveMeetings([])
          setLiveSource("local")
          setLastRefresh(new Date())
          setIsLoading(false)
          return
        }

        // Load only live meetings from SQLite (fallback)
        const meetingsResult = await meetingRepo.findByIds(liveMeetingIds)
        if (!meetingsResult.ok) {
          log.error("Failed to load meetings from SQLite", { error: String(meetingsResult.error) })
          setIsLoading(false)
          return
        }

        // No scheduleData in fallback mode - SchedulePopup will compute it
        const newLiveMeetings = meetingsResult.value.map((m) =>
          toMeetingWithTrexFromDb(m, trexMap, null),
        )

        setLiveMeetings(newLiveMeetings)
        setLiveSource("local")
        setLastRefresh(new Date())

        log.info("✓ Live meetings from local fallback", {
          count: newLiveMeetings.length,
        })
      } catch (error) {
        log.error("Error refreshing live meetings", { error: String(error) })
      } finally {
        setIsLoading(false)
      }
    }

    refreshLiveMeetings()
  }, [startupComplete, refreshTrigger, trexMap])

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
