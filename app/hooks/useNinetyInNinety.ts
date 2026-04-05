/**
 * useNinetyInNinety Hook
 *
 * Computes stats for the "90 meetings in 90 days" challenge by querying
 * valid attendance records since the challenge start date.
 */

import { useState, useEffect, useCallback, useMemo } from "react"

import { attendanceRepo, attendanceEvents, type AttendanceRecord } from "@/db"
import { useAuthenticationStore, useProfileStore } from "@/models"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useNinetyInNinety" })

/** 60 minutes in milliseconds */
const SIXTY_MINUTES_MS = 3_600_000

/** Minutes attended on a single day (day 1-indexed from challenge start) */
export interface DailyMinutes {
  day: number
  minutes: number
}

export interface NinetyStats {
  meetingsAttended: number
  totalCreditMs: number
  totalTimeFormatted: string
  /** Total hours with one decimal, e.g. "12.5" */
  totalHours: string
  daysElapsed: number
  daysRemaining: number
  progress: number
  strictCompliantDays: number
  isComplete: boolean
  strictSatisfied: boolean
  strictFailed: boolean
  isExpired: boolean
  /** Minutes per day since challenge start (for bar chart) */
  dailyMinutes: DailyMinutes[]
  isLoading: boolean
  refresh: () => Promise<void>
}

/**
 * Format milliseconds as "HH:MM"
 */
function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

/**
 * Get the local calendar date string "YYYY-MM-DD" for a Unix ms timestamp
 */
function toLocalDateKey(timestampMs: number): string {
  const d = new Date(timestampMs)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * Calculate days between two dates (ignoring time)
 */
function daysBetween(startIso: string, endDate: Date): number {
  const start = new Date(startIso + "T00:00:00")
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
  const diffMs = end.getTime() - start.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Compute strict-mode compliance: for each elapsed day since start,
 * check if there's at least one record with credit >= 60 minutes.
 */
function computeStrictCompliance(
  records: AttendanceRecord[],
  startDateIso: string,
  daysElapsed: number,
): number {
  // Build a set of date keys that have a qualifying record
  const qualifiedDates = new Set<string>()
  for (const r of records) {
    if (r.credit >= SIXTY_MINUTES_MS) {
      qualifiedDates.add(toLocalDateKey(r.start))
    }
  }

  // Check each day from start through daysElapsed
  let compliant = 0
  const startDate = new Date(startDateIso + "T00:00:00")
  for (let i = 0; i < daysElapsed; i++) {
    const checkDate = new Date(startDate)
    checkDate.setDate(checkDate.getDate() + i)
    const key = toLocalDateKey(checkDate.getTime())
    if (qualifiedDates.has(key)) {
      compliant++
    }
  }

  return compliant
}

/**
 * Build an array of total minutes per day from start through the latest
 * day that has data (or daysElapsed, whichever is greater).
 * Day 1 = start date, aggregates all record credits per calendar day.
 */
function computeDailyMinutes(
  records: AttendanceRecord[],
  startDateIso: string,
  daysElapsed: number,
): DailyMinutes[] {
  if (records.length === 0 && daysElapsed <= 0) return []

  const startDate = new Date(startDateIso + "T00:00:00")
  const startMs = startDate.getTime()

  // Sum credit per calendar date key
  const creditByDate = new Map<string, number>()
  let maxDayIndex = 0
  for (const r of records) {
    const key = toLocalDateKey(r.start)
    creditByDate.set(key, (creditByDate.get(key) ?? 0) + r.credit)
    // Track the furthest day with data (may be future days from debug inserts)
    const dayIndex = Math.floor((r.start - startMs) / (1000 * 60 * 60 * 24))
    if (dayIndex > maxDayIndex) maxDayIndex = dayIndex
  }

  const totalDays = Math.max(daysElapsed, maxDayIndex + 1)

  const result: DailyMinutes[] = []
  for (let i = 0; i < totalDays; i++) {
    const checkDate = new Date(startDate)
    checkDate.setDate(checkDate.getDate() + i)
    const key = toLocalDateKey(checkDate.getTime())
    const creditMs = creditByDate.get(key) ?? 0
    result.push({ day: i + 1, minutes: Math.floor(creditMs / 60_000) })
  }

  return result
}

export function useNinetyInNinety(): NinetyStats {
  const profileStore = useProfileStore()
  const authStore = useAuthenticationStore()
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const startDate = profileStore.ninetyStartDate
  const startEpoch = profileStore.ninetyStartEpoch
  const uid = authStore.userId

  const refresh = useCallback(async () => {
    if (!startDate || !uid) {
      setRecords([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const result = await attendanceRepo.findValidByUserId(uid)
      if (result.ok) {
        // Filter to records created after the challenge was started
        const startMs = new Date(startDate + "T00:00:00").getTime()
        const filtered = result.value.filter((r) => r.start >= startMs && r.created >= startEpoch)
        setRecords(filtered)
      } else {
        log.warn("Failed to load attendance for 90/90", { error: String(result.error) })
      }
    } catch (error) {
      log.error("Error loading 90/90 attendance", { error: String(error) })
    } finally {
      setIsLoading(false)
    }
  }, [startDate, startEpoch, uid])

  // Refresh on mount and when startDate changes
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Subscribe to attendance events for real-time updates
  useEffect(() => {
    return attendanceEvents.subscribe((event) => {
      if (event.type === "processed" || event.type === "created") {
        void refresh()
      }
    })
  }, [refresh])

  // Compute stats from records
  const stats = useMemo(() => {
    if (!startDate) {
      return {
        meetingsAttended: 0,
        totalCreditMs: 0,
        totalTimeFormatted: "00:00",
        totalHours: "0.0",
        daysElapsed: 0,
        daysRemaining: 90,
        progress: 0,
        strictCompliantDays: 0,
        isComplete: false,
        strictSatisfied: false,
        strictFailed: false,
        isExpired: false,
        dailyMinutes: [],
      }
    }

    const today = new Date()
    const rawDaysSinceStart = daysBetween(startDate, today)
    // Day 1 = start date, so daysElapsed = daysSinceStart + 1 (capped at 90)
    const daysElapsed = Math.max(Math.min(rawDaysSinceStart + 1, 90), 1)
    const daysRemaining = Math.max(90 - daysElapsed, 0)

    const meetingsAttended = records.length
    const totalCreditMs = records.reduce((sum, r) => sum + r.credit, 0)
    const totalTimeFormatted = formatDuration(totalCreditMs)
    const totalHours = (totalCreditMs / 3_600_000).toFixed(1)
    const progress = Math.min(meetingsAttended / 90, 1)

    const strictCompliantDays = computeStrictCompliance(records, startDate, daysElapsed)
    const isComplete = meetingsAttended >= 90 && daysElapsed <= 90
    const strictSatisfied = daysElapsed > 0 && strictCompliantDays === daysElapsed
    const strictFailed = daysElapsed > 0 && strictCompliantDays < daysElapsed
    const isExpired = daysElapsed >= 90 && !isComplete
    const dailyMinutes = computeDailyMinutes(records, startDate, daysElapsed)

    return {
      meetingsAttended,
      totalCreditMs,
      totalTimeFormatted,
      totalHours,
      daysElapsed,
      daysRemaining,
      progress,
      strictCompliantDays,
      isComplete,
      strictSatisfied,
      strictFailed,
      isExpired,
      dailyMinutes,
    }
  }, [records, startDate])

  return {
    ...stats,
    isLoading,
    refresh,
  }
}
