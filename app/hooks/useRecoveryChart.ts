/**
 * useRecoveryChart Hook
 *
 * Computes daily meeting minutes for a bar chart over a selectable time range.
 * Handles meetings that span midnight by splitting credit across two calendar days.
 */

import { useState, useEffect, useCallback, useMemo } from "react"

import { attendanceRepo, attendanceEvents, type AttendanceRecord } from "@/db"
import { useAuthenticationStore } from "@/models"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useRecoveryChart" })

export type ChartRange = 7 | 30 | 60 | 90 | "all"

export interface ChartDay {
  /** ISO date key "YYYY-MM-DD" */
  date: string
  /** Display label e.g. "4/5" or "Today" */
  label: string
  /** Total meeting minutes on this day */
  minutes: number
}

export interface RecoveryChartData {
  days: ChartDay[]
  maxMinutes: number
  isLoading: boolean
  refresh: () => Promise<void>
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
 * Format a date key as a short label "M/D"
 */
function toShortLabel(dateKey: string): string {
  const [_y, m, d] = dateKey.split("-")
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`
}

/**
 * Split a meeting's duration across calendar days when it spans midnight.
 * Returns a map of date key → milliseconds credited to that day.
 */
function splitCreditByDay(start: number, end: number): Map<string, number> {
  const result = new Map<string, number>()

  if (end <= start) return result

  const startKey = toLocalDateKey(start)
  const endKey = toLocalDateKey(end)

  if (startKey === endKey) {
    result.set(startKey, end - start)
  } else {
    // Split at midnight boundary
    const endDate = new Date(end)
    const midnight = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
    const midnightMs = midnight.getTime()
    result.set(startKey, midnightMs - start)
    result.set(endKey, end - midnightMs)
  }

  return result
}

/**
 * Build a complete array of days from startDate to today, with minutes per day.
 */
function buildDailyData(records: AttendanceRecord[], rangeStartMs: number): ChartDay[] {
  // Accumulate minutes per date key using midnight-aware splitting
  const minutesByDate = new Map<string, number>()
  for (const r of records) {
    if (r.start < rangeStartMs) continue
    const splits = splitCreditByDay(r.start, r.end)
    for (const [dateKey, creditMs] of splits) {
      minutesByDate.set(dateKey, (minutesByDate.get(dateKey) ?? 0) + creditMs)
    }
  }

  // Build array from today backwards to rangeStart
  const result: ChartDay[] = []
  const today = new Date()
  const startDate = new Date(rangeStartMs)

  // Iterate from today backwards
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const end = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())

  while (current >= end) {
    const key = toLocalDateKey(current.getTime())
    const creditMs = minutesByDate.get(key) ?? 0
    const minutes = Math.floor(creditMs / 60_000)
    const label = toShortLabel(key)
    result.push({ date: key, label, minutes })
    current.setDate(current.getDate() - 1)
  }

  return result
}

export function useRecoveryChart(range: ChartRange): RecoveryChartData {
  const authStore = useAuthenticationStore()
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const uid = authStore.userId

  const refresh = useCallback(async () => {
    if (!uid) {
      setRecords([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const result = await attendanceRepo.findValidByUserId(uid)
      if (result.ok) {
        setRecords(result.value)
      } else {
        log.warn("Failed to load attendance for chart", { error: String(result.error) })
      }
    } catch (error) {
      log.error("Error loading chart attendance", { error: String(error) })
    } finally {
      setIsLoading(false)
    }
  }, [uid])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return attendanceEvents.subscribe((event) => {
      if (event.type === "processed" || event.type === "created") {
        void refresh()
      }
    })
  }, [refresh])

  const chartData = useMemo(() => {
    const today = new Date()

    let rangeStartMs: number
    if (range === "all") {
      // Find earliest record, or default to 90 days ago
      const earliest = records.reduce((min, r) => Math.min(min, r.start), Date.now())
      rangeStartMs = records.length > 0 ? earliest : today.getTime() - 90 * 86_400_000
    } else {
      const start = new Date(today)
      start.setDate(start.getDate() - range + 1) // include today
      start.setHours(0, 0, 0, 0)
      rangeStartMs = start.getTime()
    }

    const days = buildDailyData(records, rangeStartMs)
    const maxMinutes = days.length > 0 ? Math.max(...days.map((d) => d.minutes)) : 0

    return { days, maxMinutes }
  }, [records, range])

  return {
    ...chartData,
    isLoading,
    refresh,
  }
}
