/**
 * ScheduleGrid Component
 *
 * Displays a weekly schedule grid showing meeting times.
 * Current day is highlighted in the header.
 * Cells are optionally tappable (for creating/editing reminders).
 * Cells with active reminders are highlighted gold.
 * Adjacent reminder cells in the same row merge into a connected band.
 */

import { FC, useMemo, useCallback } from "react"
import { View, ViewStyle, TextStyle, Pressable } from "react-native"
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

/** Amber/gold color for reminder indicators */
const REMINDER_COLOR = "#f59e0b"

interface ScheduleGridProps {
  /** Schedule data: array of rows, each row is [Mon..Sun] with { millis, id } or null */
  scheduleData: Array<Array<{ millis: number; id: string } | null>>
  /** Current day of week (1-7, ISO weekday where 1=Monday) - used for highlighting */
  currentDow?: number
  /** Called when a non-null cell is tapped. Passes millis, id, dayIndex (0-6), rowIndex. */
  onCellPress?: (millis: number, id: string, dayIndex: number, rowIndex: number) => void
  /** Map of "rowIndex-colIndex" keys to reminder state ("enabled" | "disabled") */
  reminderCells?: Map<string, "enabled" | "disabled">
}

/**
 * ScheduleGrid displays meeting times in a weekly grid format.
 * Schedule data values are UTC milliseconds, formatted to local time for display.
 *
 * @example
 * <ScheduleGrid scheduleData={meeting.scheduleData} currentDow={DateTime.now().weekday} />
 */
export const ScheduleGrid: FC<ScheduleGridProps> = ({
  scheduleData,
  currentDow,
  onCellPress,
  reminderCells,
}) => {
  const { t } = useTranslation()
  const { themed } = useAppTheme()

  // Get current day index (0-6 for Mon-Sun)
  const currentDayIndex = useMemo(() => {
    if (currentDow !== undefined) {
      return currentDow - 1 // Convert ISO weekday (1-7) to index (0-6)
    }
    return DateTime.now().weekday - 1
  }, [currentDow])

  const handleCellPress = useCallback(
    (millis: number, id: string, colIndex: number, rowIndex: number) => {
      onCellPress?.(millis, id, colIndex, rowIndex)
    },
    [onCellPress],
  )

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
            {row.map((cell, colIndex) => {
              const cellKey = `${rowIndex}-${colIndex}`
              const reminderState = reminderCells?.get(cellKey)
              const hasReminder = reminderState !== undefined
              const isDisabled = reminderState === "disabled"
              const isTappable = cell !== null && onCellPress !== undefined

              const innerStyle = hasReminder
                ? (isDisabled ? $disabledCellInner : $reminderCellInner)
                : themed($timeCellInner)

              const textStyle = hasReminder
                ? isDisabled
                  ? $disabledTimeText
                  : $reminderTimeText
                : themed($timeText)

              return (
                <View key={colIndex} style={themed($timeCell)}>
                  {cell !== null ? (
                    isTappable ? (
                      <Pressable
                        onPress={() => handleCellPress(cell.millis, cell.id, colIndex, rowIndex)}
                        style={({ pressed }) => [innerStyle, pressed && $cellPressed]}
                      >
                        <Text style={textStyle}>
                          {cell.millis === 0 ? "24h" : formatMillisToLocalTime(cell.millis)}
                        </Text>
                      </Pressable>
                    ) : (
                      <View style={innerStyle}>
                        <Text style={textStyle}>
                          {cell.millis === 0 ? "24h" : formatMillisToLocalTime(cell.millis)}
                        </Text>
                      </View>
                    )
                  ) : (
                    <View style={themed($emptyCellInner)} />
                  )}
                </View>
              )
            })}
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

const $reminderCellInner: ViewStyle = {
  backgroundColor: `${REMINDER_COLOR}25`,
  borderRadius: 8,
  paddingVertical: 6,
  paddingHorizontal: 4,
  alignItems: "center",
}

const $disabledCellInner: ViewStyle = {
  backgroundColor: "#333",
  borderRadius: 8,
  paddingVertical: 6,
  paddingHorizontal: 4,
  alignItems: "center",
}

const $cellPressed: ViewStyle = {
  opacity: 0.7,
}

const $emptyCellInner: ThemedStyle<ViewStyle> = () => ({
  height: 32, // Match height of filled cells
})

const $timeText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  fontWeight: "600",
  color: colors.tint,
})

const $reminderTimeText: TextStyle = {
  fontSize: 11,
  fontWeight: "600",
  color: REMINDER_COLOR,
}

const $disabledTimeText: TextStyle = {
  fontSize: 11,
  fontWeight: "600",
  color: "#999",
}
