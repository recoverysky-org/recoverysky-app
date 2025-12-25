/**
 * Meeting Context
 *
 * Provides meeting data and live meeting filtering to the app.
 * Loads meetings from SQLite and joins with TREX data for occurrence calculation.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from "react"
import { meetingRepo, findAllTrexes, useDatabase, type TrexRow } from "@/db"
import { logger } from "@/utils/logger"
import {
  isLiveInterval,
  normalize,
  DateTime,
  type trex,
  type meeting,
  Periodicity,
} from "@common"

const log = logger.child({ module: "MeetingContext" })

// ============================================================================
// Types
// ============================================================================

export interface MeetingWithTrex extends meeting {
  trex: trex | null
}

export interface MeetingContextType {
  /** All meetings with their TREX data */
  meetings: MeetingWithTrex[]
  /** Meetings currently live (filtered by isLiveInterval) */
  liveMeetings: MeetingWithTrex[]
  /** Loading state */
  isLoading: boolean
  /** Last time live meetings were recalculated */
  lastRefresh: Date | null
  /** Manually trigger a refresh of live meetings */
  refresh: () => void
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

/**
 * Check if a meeting is currently live
 */
function isMeetingLive(trexData: trex): boolean {
  const now = DateTime.now().setZone(trexData.timezone)

  // Normalize current time to get nowCoordinate
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

export function MeetingProvider({ children }: MeetingProviderProps): ReactNode {
  log.debug("MeetingProvider initializing")

  const { status: dbStatus } = useDatabase()
  const [meetings, setMeetings] = useState<MeetingWithTrex[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    log.info("MeetingProvider mounted", { dbStatus })
    return () => {
      log.debug("MeetingProvider unmounting")
    }
  }, [])

  // Load meetings and trexes from SQLite when database is seeded
  useEffect(() => {
    // Only load when database is seeded
    if (dbStatus !== "seeded") {
      log.debug("Database not seeded, skipping load", { dbStatus })
      return
    }

    async function loadData() {
      try {
        log.info("Loading meetings from SQLite")
        setIsLoading(true)

        // Get all meetings
        const meetingsResult = await meetingRepo.findAll()
        if (!meetingsResult.ok) {
          log.error("Failed to load meetings", { error: String(meetingsResult.error) })
          return
        }

        // Get all trexes
        const trexRows: TrexRow[] = findAllTrexes()

        // Create a map of trex by id for quick lookup
        const trexMap = new Map<string, trex>()
        for (const t of trexRows) {
          // Convert SQLite row to trex object
          const trexObj: trex = {
            id: t.id,
            coordinate: t.coordinate,
            coordinate_end: t.coordinate_end,
            timezone: t.timezone,
            periodicity: t.periodicity as Periodicity,
            duration_ms: t.duration_ms,
            dtstart: t.dtstart,
            dtend: t.dtend,
            rrule_str: t.rrule_str,
            rrule_json: typeof t.rrule_json === "string" ? JSON.parse(t.rrule_json) : t.rrule_json,
            hour: t.hour,
            minute: t.minute,
            dow: t.dow,
            dom: t.dom,
            month: t.month,
          }
          trexMap.set(t.id, trexObj)
        }

        // Join meetings with their trex data
        // MeetingWithRelations has { meeting, types, tags } structure
        // Map to MeetingWithTrex by combining meeting data + junction table arrays + trex
        // Cast needed because Drizzle infers enums as strings
        const meetingsWithTrex: MeetingWithTrex[] = meetingsResult.value.map((m) => ({
          ...(m.meeting as unknown as meeting),
          meetingTypes: m.types,
          tags: m.tags,
          trex: trexMap.get(m.meeting.id) || null,
        }))

        setMeetings(meetingsWithTrex)
        log.info("Loaded meetings", { count: meetingsWithTrex.length })
      } catch (error) {
        log.error("Error loading data", { error: String(error) })
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [dbStatus])

  // Calculate live meetings
  const liveMeetings = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = refreshTrigger // Depend on refresh trigger

    const live = meetings.filter((m) => {
      if (!m.trex) return false
      return isMeetingLive(m.trex)
    })

    setLastRefresh(new Date())
    log.debug("Calculated live meetings", { liveCount: live.length, totalCount: meetings.length })
    return live
  }, [meetings, refreshTrigger])

  // Refresh function
  const refresh = useCallback(() => {
    log.debug("Manual refresh triggered")
    setRefreshTrigger((prev) => prev + 1)
  }, [])

  const value: MeetingContextType = {
    meetings,
    liveMeetings,
    isLoading,
    lastRefresh,
    refresh,
  }

  log.debug("MeetingProvider rendering children", { meetingCount: meetings.length, isLoading })

  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
}
