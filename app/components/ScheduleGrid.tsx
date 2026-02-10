/**
 * ScheduleGrid Component
 *
 * Displays a weekly schedule grid showing meeting times.
 * Current day is highlighted in the header.
 */

import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { DateTime } from "@recoverysky-org/common/browser"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { formatMillisToLocalTime } from "@/utils/formatTime"

// Translation keys for day names
const DAY_KEYS = [
  "liveScreen:mon",
  "liveScreen:tue",
  "liveScreen:wed",
  "liveScreen:thu",
  "liveScreen:fri",
  "liveScreen:sat",
  "liveScreen:sun",
] as const

interface ScheduleGridProps {
  /** Schedule data: array of rows, each row is [Mon, Tue, Wed, Thu, Fri, Sat, Sun] UTC millis or null */
  scheduleData: Array<Array<number | null>>
  /** Current day of week (1-7, ISO weekday where 1=Monday) - used for highlighting */
  currentDow?: number
}

/**
 * ScheduleGrid displays meeting times in a weekly grid format.
 * Schedule data values are UTC milliseconds, formatted to local time for display.
 *
 * @example
 * <ScheduleGrid scheduleData={meeting.scheduleData} currentDow={DateTime.now().weekday} />
 */
export const ScheduleGrid: FC<ScheduleGridProps> = ({ scheduleData, currentDow }) => {
  const { t } = useTranslation()
  const { themed } = useAppTheme()

  // Get current day index (0-6 for Mon-Sun)
  const currentDayIndex = useMemo(() => {
    if (currentDow !== undefined) {
      return currentDow - 1 // Convert ISO weekday (1-7) to index (0-6)
    }
    return DateTime.now().weekday - 1
  }, [currentDow])

  if (scheduleData.length === 0) {
    return null
  }

  return (
    <View style={themed($container)}>
      {/* Header Row */}
      <View style={themed($headerRow)}>
        {DAY_KEYS.map((dayKey, index) => (
          <View
            key={dayKey}
            style={[themed($headerCell), index === currentDayIndex && themed($headerCellActive)]}
          >
            <Text
              style={[themed($headerText), index === currentDayIndex && themed($headerTextActive)]}
            >
              {t(dayKey)}
            </Text>
          </View>
        ))}
      </View>

      {/* Time Rows */}
      {scheduleData.map((row, rowIndex) => (
        <View key={rowIndex}>
          {rowIndex > 0 && <View style={themed($separator)} />}
          <View style={themed($timeRow)}>
            {row.map((millis, colIndex) => (
              <View key={colIndex} style={themed($timeCell)}>
                {millis !== null ? (
                  <View style={themed($timeCellInner)}>
                    <Text style={themed($timeText)}>
                      {millis === 0 ? "24h" : formatMillisToLocalTime(millis)}
                    </Text>
                  </View>
                ) : (
                  <View style={themed($emptyCellInner)} />
                )}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.sm,
})

const $headerRow: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  marginBottom: 8,
})

const $headerCell: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  alignItems: "center",
  paddingBottom: 4,
})

const $headerCellActive: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderBottomColor: colors.tint,
  borderBottomWidth: 2,
})

const $headerText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  fontWeight: "600",
  color: colors.textDim,
})

const $headerTextActive: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
})

const $separator: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 1,
  backgroundColor: colors.border,
  marginVertical: 6,
})

const $timeRow: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
})

const $timeCell: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  paddingHorizontal: 2,
})

const $timeCellInner: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: `${colors.tint}20`,
  borderRadius: 8,
  paddingVertical: 6,
  paddingHorizontal: 4,
  alignItems: "center",
})

const $emptyCellInner: ThemedStyle<ViewStyle> = () => ({
  height: 32, // Match height of filled cells
})

const $timeText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  fontWeight: "600",
  color: colors.tint,
})
