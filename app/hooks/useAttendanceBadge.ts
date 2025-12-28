/**
 * useAttendanceBadge Hook
 *
 * Provides count of valid unproduced attendance records for tab badge display.
 * Automatically refreshes on focus and periodically.
 */

import { useState, useEffect, useCallback } from "react"
import { useFocusEffect } from "@react-navigation/native"

import { attendanceRepo, useDatabaseReady } from "@/db"
import { logger } from "@/utils/logger"

interface AttendanceBadgeState {
  /** Count of valid unproduced attendance records */
  validUnproducedCount: number
  /** Whether data is currently loading */
  isLoading: boolean
  /** Manually refresh the count */
  refresh: () => Promise<void>
}

/**
 * Hook to get count of valid unproduced attendance records.
 * Used for tab badge display in MainNavigator.
 *
 * @example
 * const { validUnproducedCount } = useAttendanceBadge()
 * // Use validUnproducedCount for badge display
 */
export function useAttendanceBadge(): AttendanceBadgeState {
  const isDbReady = useDatabaseReady()
  const [validUnproducedCount, setValidUnproducedCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    // Don't try to load if database isn't ready
    if (!isDbReady) {
      return
    }

    setIsLoading(true)
    try {
      const result = await attendanceRepo.findUnproduced()
      if (result.ok) {
        // Count only valid records
        const validCount = result.value.filter((r) => r.valid).length
        setValidUnproducedCount(validCount)
      } else {
        logger.warn("Failed to load attendance badge count", { error: String(result.error) })
      }
    } catch (error) {
      logger.error("Error loading attendance badge", { error: String(error) })
    } finally {
      setIsLoading(false)
    }
  }, [isDbReady])

  // Refresh when database becomes ready
  useEffect(() => {
    if (isDbReady) {
      void refresh()
    }
  }, [isDbReady, refresh])

  // Refresh when navigator gains focus (only if db is ready)
  useFocusEffect(
    useCallback(() => {
      if (isDbReady) {
        void refresh()
      }
    }, [isDbReady, refresh]),
  )

  return {
    validUnproducedCount,
    isLoading,
    refresh,
  }
}
