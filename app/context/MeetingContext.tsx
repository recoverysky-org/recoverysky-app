/**
 * Meeting Context
 *
 * Provides meeting data with optimized loading:
 * - Startup: Load trexes, schedules, feedback into memory
 * - Live: API returns full meeting objects (zero SQLite when online)
 * - Fallback: Local calculation + SQLite when API fails
 *
 * Key relationship: trex.id === meeting.id (1:1)
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
  scheduleRepo,
  findAllTrexes,
  feedbackCache,
  type TrexRow,
  type FeedbackRecord,
} from "@/db"
import { api, type LiveMeeting } from "@/services/api"
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
// Types
// ============================================================================

export interface MeetingWithTrex extends meeting {
  trex: trex | null
  /** User's feedback for this meeting (loves, rates, joins) - null if no feedback */
  feedback: FeedbackRecord | null
}

/** Schedule with meeting IDs (loaded at startup) */
interface ScheduleWithMeetingIds {
  id: string
  name: string
  fellowship: string
  meetingIds: string[]
}

/** API connection status */
export type ApiStatus = "connected" | "disconnected" | "unknown"

export interface MeetingContextType {
  /** Meetings currently live */
  liveMeetings: MeetingWithTrex[]
  /** Get trexes for a schedule (for grid display) - pure memory lookup */
  getTrexesForSchedule: (scheduleId: string) => trex[]
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
 * Convert LiveMeeting from API to MeetingWithTrex
 */
function toMeetingWithTrexFromApi(m: LiveMeeting, trexMap: Map<string, trex>): MeetingWithTrex {
  return {
    // From API
    id: m.id,
    sid: m.sid,
    name: m.name,
    fellowship: m.fellowship,
    url: m.url,
    password: m.password,
    language: m.language,
    description: m.description,
    meetingTypes: m.meetingTypes,
    tags: m.tags,
    // Defaults for fields not in API response
    iid: "",
    uid: "",
    zid: "",
    status: MeetingStatus.ACTIVE,
    verified: MeetingVerified.NEVER,
    locked: false,
    created: "",
    updated: "",
    version: 0,
    passwordEnc: "",
    closed: false,
    requiresLogin: false,
    restricted: false,
    restrictedDescription: "",
    email: "",
    phone: "",
    website: "",
    conferencePhone: "",
    location: "",
    sha256: "",
    // Attached from memory
    trex: trexMap.get(m.id) || null,
    feedback: feedbackCache.get(m.id),
  } as MeetingWithTrex
}

/**
 * Convert MeetingWithRelations (from SQLite) to MeetingWithTrex
 */
function toMeetingWithTrexFromDb(m: MeetingWithRelations, trexMap: Map<string, trex>): MeetingWithTrex {
  return {
    ...(m.meeting as unknown as meeting),
    meetingTypes: m.types,
    tags: m.tags,
    trex: trexMap.get(m.meeting.id) || null,
    feedback: feedbackCache.get(m.meeting.id),
  }
}

// ============================================================================
// Provider
// ============================================================================

interface MeetingProviderProps {
  children: ReactNode
}

export function MeetingProvider({ children }: MeetingProviderProps): ReactNode {
  log.debug("MeetingProvider initializing")

  const { status: dbStatus } = useDatabase()

  // Startup data (always loaded into memory)
  const [trexMap, setTrexMap] = useState<Map<string, trex>>(new Map())
  const [schedules, setSchedules] = useState<ScheduleWithMeetingIds[]>([])

  // On-demand data
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
  // Startup: Load trexes + schedules only (lightweight)
  // ============================================================================
  useEffect(() => {
    if (dbStatus !== "seeded") {
      log.debug("Database not seeded, skipping startup load", { dbStatus })
      return
    }

    if (startupComplete) {
      log.debug("Startup data already loaded")
      return
    }

    async function loadStartupData() {
      try {
        log.info("Loading startup data (trexes + schedules only)")
        setIsLoading(true)

        // Load all trexes
        const trexRows = findAllTrexes()
        const newTrexMap = new Map<string, trex>()
        for (const row of trexRows) {
          newTrexMap.set(row.id, toTrex(row))
        }

        // Load all schedules with their meetingIds
        const schedulesResult = await scheduleRepo.findAll()
        if (!schedulesResult.ok) {
          log.error("Failed to load schedules", { error: String(schedulesResult.error) })
          setIsLoading(false)
          return
        }

        const newSchedules: ScheduleWithMeetingIds[] = schedulesResult.value.map((s) => ({
          id: s.schedule.id,
          name: s.schedule.name,
          fellowship: s.schedule.fellowship,
          meetingIds: s.meetingIds,
        }))

        log.info("Startup data loaded", {
          trexCount: newTrexMap.size,
          scheduleCount: newSchedules.length,
        })

        // Batch update state
        setTrexMap(newTrexMap)
        setSchedules(newSchedules)
        setStartupComplete(true)
        setIsLoading(false)
      } catch (error) {
        log.error("Error loading startup data", { error: String(error) })
        setIsLoading(false)
      }
    }

    loadStartupData()
  }, [dbStatus, startupComplete])

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
  // API online: Zero SQLite queries (API returns full meetings)
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

        // Try API first - returns FULL meeting objects
        if (useApiRef.current) {
          try {
            const result = await api.getLiveMeetings()

            if (result.kind === "ok") {
              // API returns full meetings - NO SQLite needed!
              const newLiveMeetings = result.meetings.map((m) => toMeetingWithTrexFromApi(m, trexMap))

              setLiveMeetings(newLiveMeetings)
              setLiveSource("api")
              setLastRefresh(new Date())
              setIsLoading(false)

              log.info("✓ Live meetings from API (zero SQLite)", {
                count: newLiveMeetings.length,
              })
              return
            } else {
              log.warn("✗ API getLiveMeetings failed, falling back to local", { kind: result.kind })
              useApiRef.current = false
            }
          } catch (error) {
            log.error("✗ API getLiveMeetings error, falling back to local", { error: String(error) })
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

        const newLiveMeetings = meetingsResult.value.map((m) => toMeetingWithTrexFromDb(m, trexMap))

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

  /**
   * Get trexes for a schedule (pure memory lookup, ZERO SQLite)
   * Used by SchedulePopup for the schedule grid
   */
  const getTrexesForSchedule = useCallback(
    (scheduleId: string): trex[] => {
      const schedule = schedules.find((s) => s.id === scheduleId)
      if (!schedule) return []

      return schedule.meetingIds
        .map((mid) => trexMap.get(mid))
        .filter((t): t is trex => t !== undefined)
    },
    [schedules, trexMap],
  )

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<MeetingContextType>(
    () => ({
      liveMeetings,
      getTrexesForSchedule,
      isLoading,
      lastRefresh,
      refresh,
      liveSource,
      apiStatus,
    }),
    [liveMeetings, getTrexesForSchedule, isLoading, lastRefresh, refresh, liveSource, apiStatus],
  )

  log.debug("MeetingProvider rendering", { liveCount: liveMeetings.length, isLoading })

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
}
