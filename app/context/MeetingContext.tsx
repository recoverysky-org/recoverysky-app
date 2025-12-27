/**
 * Meeting Context
 *
 * Provides meeting data with lazy loading architecture:
 * - Startup: Load only trexes and schedules (lightweight)
 * - On-demand: Load meetings when needed for display
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
  type ReactNode,
} from "react"
import { meetingRepo, scheduleRepo, findAllTrexes, type TrexRow } from "@/db"
import { api } from "@/services/api"
import { useDatabase } from "@/db"
import { logger } from "@/utils/logger"
import {
  isLiveInterval,
  normalize,
  DateTime,
  type trex,
  type meeting,
  Periodicity,
} from "@common"
import type { MeetingWithRelations } from "@sqlite"

const log = logger.child({ module: "MeetingContext" })

// ============================================================================
// Types
// ============================================================================

export interface MeetingWithTrex extends meeting {
  trex: trex | null
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
  /** Get all meetings for a schedule (from cache) */
  getMeetingsForSchedule: (scheduleId: string) => MeetingWithTrex[]
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
    trexData.periodicity as Periodicity
  )

  if (!normalizeResult.ok) return false

  return isLiveInterval(
    trexData.coordinate,
    trexData.coordinate_end,
    normalizeResult.value.coordinate
  )
}

/**
 * Convert MeetingWithRelations to MeetingWithTrex
 */
function toMeetingWithTrex(
  m: MeetingWithRelations,
  trexMap: Map<string, trex>
): MeetingWithTrex {
  return {
    ...(m.meeting as unknown as meeting),
    meetingTypes: m.types,
    tags: m.tags,
    trex: trexMap.get(m.meeting.id) || null,
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

  // Startup data (always loaded)
  const [trexMap, setTrexMap] = useState<Map<string, trex>>(new Map())
  const [schedules, setSchedules] = useState<ScheduleWithMeetingIds[]>([])
  const [meetingToSchedule, setMeetingToSchedule] = useState<Map<string, string>>(new Map())

  // On-demand data (loaded when needed)
  const [liveMeetings, setLiveMeetings] = useState<MeetingWithTrex[]>([])
  const [scheduleMeetingsCache, setScheduleMeetingsCache] = useState<Map<string, MeetingWithTrex[]>>(
    new Map()
  )

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

        // Build reverse lookup: meetingId → scheduleId
        const newMeetingToSchedule = new Map<string, string>()
        for (const schedule of newSchedules) {
          for (const mid of schedule.meetingIds) {
            newMeetingToSchedule.set(mid, schedule.id)
          }
        }

        log.info("Startup data loaded", {
          trexCount: newTrexMap.size,
          scheduleCount: newSchedules.length,
          meetingMappings: newMeetingToSchedule.size,
        })

        // Batch update state - React will batch these
        setTrexMap(newTrexMap)
        setSchedules(newSchedules)
        setMeetingToSchedule(newMeetingToSchedule)
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
  // Refresh live meetings (on-demand loading)
  // ============================================================================
  useEffect(() => {
    // Only run after startup data is loaded
    if (!startupComplete) {
      return
    }

    async function refreshLiveMeetings() {
      try {
        log.debug("Refreshing live meetings...")
        setIsLoading(true)

        let liveMeetingIds: string[] | null = null
        let source: "api" | "local" = "local"

        // Try API first
        if (useApiRef.current) {
          try {
            const result = await api.getLiveMeetingIds()

            if (result.kind === "ok") {
              liveMeetingIds = result.ids
              source = "api"
              log.debug("Got live IDs from API", { count: result.count })
            } else {
              log.warn("✗ API liveIds failed, falling back to local", { kind: result.kind })
              useApiRef.current = false
            }
          } catch (error) {
            log.error("✗ API liveIds error, falling back to local", { error: String(error) })
            useApiRef.current = false
          }
        }

        // Fallback: local calculation from trexes
        if (liveMeetingIds === null) {
          liveMeetingIds = []
          for (const [id, trexData] of trexMap) {
            if (isMeetingLive(trexData)) {
              liveMeetingIds.push(id) // trex.id === meeting.id
            }
          }
          source = "local"
          log.debug("Calculated live IDs locally", { count: liveMeetingIds.length })
        }

        setLiveSource(source)

        if (liveMeetingIds.length === 0) {
          log.info("No live meetings", { source })
          setLiveMeetings([])
          setScheduleMeetingsCache(new Map())
          setLastRefresh(new Date())
          setIsLoading(false)
          return
        }

        // Find unique schedule IDs for live meetings
        const liveScheduleIds = new Set<string>()
        for (const mid of liveMeetingIds) {
          const sid = meetingToSchedule.get(mid)
          if (sid) liveScheduleIds.add(sid)
        }

        log.debug("Live schedules", { count: liveScheduleIds.size })

        // Collect ALL meeting IDs for those schedules (for popup)
        const allMeetingIdsToLoad = new Set<string>()
        for (const sid of liveScheduleIds) {
          const schedule = schedules.find((s) => s.id === sid)
          if (schedule) {
            for (const mid of schedule.meetingIds) {
              allMeetingIdsToLoad.add(mid)
            }
          }
        }

        log.debug("Loading meetings for live schedules", { count: allMeetingIdsToLoad.size })

        // Load meetings from SQLite
        const meetingsResult = await meetingRepo.findByIds([...allMeetingIdsToLoad])
        if (!meetingsResult.ok) {
          log.error("Failed to load meetings", { error: String(meetingsResult.error) })
          setIsLoading(false)
          return
        }

        // Convert to MeetingWithTrex
        const meetingsWithTrex = meetingsResult.value.map((m) => toMeetingWithTrex(m, trexMap))

        // Filter to just live ones for display
        const liveIdSet = new Set(liveMeetingIds)
        const newLiveMeetings = meetingsWithTrex.filter((m) => liveIdSet.has(m.id))

        // Cache by schedule for popup
        const cache = new Map<string, MeetingWithTrex[]>()
        for (const m of meetingsWithTrex) {
          // Use meeting.sid field to group by schedule
          const sid = m.sid
          if (sid) {
            if (!cache.has(sid)) cache.set(sid, [])
            cache.get(sid)!.push(m)
          }
        }

        setLiveMeetings(newLiveMeetings)
        setScheduleMeetingsCache(cache)
        setLastRefresh(new Date())

        log.info("✓ Live meetings refreshed", {
          liveCount: newLiveMeetings.length,
          cachedSchedules: cache.size,
          source,
        })
      } catch (error) {
        log.error("Error refreshing live meetings", { error: String(error) })
      } finally {
        setIsLoading(false)
      }
    }

    refreshLiveMeetings()
  }, [startupComplete, refreshTrigger])

  // ============================================================================
  // Public API
  // ============================================================================

  const refresh = useCallback(() => {
    log.info("Manual refresh triggered - will retry API")
    useApiRef.current = true
    setRefreshTrigger((prev) => prev + 1)
  }, [])

  const getMeetingsForSchedule = useCallback(
    (scheduleId: string): MeetingWithTrex[] => {
      return scheduleMeetingsCache.get(scheduleId) || []
    },
    [scheduleMeetingsCache]
  )

  const value: MeetingContextType = {
    liveMeetings,
    getMeetingsForSchedule,
    isLoading,
    lastRefresh,
    refresh,
    liveSource,
    apiStatus,
  }

  log.debug("MeetingProvider rendering", { liveCount: liveMeetings.length, isLoading })

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
}
