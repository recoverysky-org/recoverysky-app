/**
 * ScheduleGrid Component
 *
 * Displays a weekly schedule grid showing meeting times.
 * Current day is highlighted in the header.
 */

import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle } from "react-native"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { DateTime } from "@common"

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const

interface ScheduleGridProps {
  /** Schedule data: array of rows, each row is [Mon, Tue, Wed, Thu, Fri, Sat, Sun] time strings or null */
  scheduleData: Array<Array<string | null>>
  /** Current day of week (1-7, ISO weekday where 1=Monday) - used for highlighting */
  currentDow?: number
  /** Current time key for highlighting active meeting */
  currentTime?: string
}

/**
 * ScheduleGrid displays meeting times in a weekly grid format.
 *
 * @example
 * const data = hydrateScheduleGrid(meetings)
 * const rows = Array.from(data.entries()).map(([, row]) =>
 *   row.map(dt => dt ? dt.toFormat("h:mma").toLowerCase() : null)
 * )
 * <ScheduleGrid scheduleData={rows} currentDow={DateTime.now().weekday} />
 */
export const ScheduleGrid: FC<ScheduleGridProps> = ({
  scheduleData,
  currentDow,
}) => {
  const { themed, theme } = useAppTheme()

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
        {DAYS.map((day, index) => (
          <View
            key={day}
            style={[
              themed($headerCell),
              index === currentDayIndex && { borderBottomColor: theme.colors.tint, borderBottomWidth: 2 },
            ]}
          >
            <Text
              style={[
                themed($headerText),
                index === currentDayIndex && { color: theme.colors.tint },
              ]}
            >
              {day}
            </Text>
          </View>
        ))}
      </View>

      {/* Time Rows */}
      {scheduleData.map((row, rowIndex) => (
        <View key={rowIndex} style={themed($timeRow)}>
          {row.map((time, colIndex) => (
            <View key={colIndex} style={themed($timeCell)}>
              {time ? (
                <View style={themed($timeCellInner)}>
                  <Text style={[themed($timeText), { color: theme.colors.tint }]}>
                    {time}
                  </Text>
                </View>
              ) : (
                <View style={themed($emptyCellInner)} />
              )}
            </View>
          ))}
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

const $headerText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  fontWeight: "600",
  color: colors.textDim,
})

const $timeRow: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  marginBottom: 6,
})

const $timeCell: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  paddingHorizontal: 2,
})

const $timeCellInner: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: `${colors.tint}20`, // 20 = ~12% opacity
  borderRadius: 8,
  paddingVertical: 8,
  alignItems: "center",
})

const $emptyCellInner: ThemedStyle<ViewStyle> = () => ({
  height: 32, // Match height of filled cells
})

const $timeText: ThemedStyle<TextStyle> = () => ({
  fontSize: 12,
  fontWeight: "500",
})
