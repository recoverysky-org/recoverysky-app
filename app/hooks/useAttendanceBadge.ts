/**
 * useAttendanceBadge Hook
 *
 * Provides count of valid unproduced attendance records for tab badge display.
 * Automatically refreshes on focus and periodically.
 */

import { useState, useEffect, useCallback } from "react"
import { useFocusEffect } from "@react-navigation/native"

import { attendanceRepo } from "@/db"
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
  const [validUnproducedCount, setValidUnproducedCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
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
  }, [])

  // Refresh on mount
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Refresh when navigator gains focus
  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh]),
  )

  return {
    validUnproducedCount,
    isLoading,
    refresh,
  }
}
