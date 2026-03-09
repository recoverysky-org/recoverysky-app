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
  /** Schedule data: array of rows, each row is [Mon, Tue, Wed, Thu, Fri, Sat, Sun] UTC millis or null */
  scheduleData: Array<Array<number | null>>
  /** Current day of week (1-7, ISO weekday where 1=Monday) - used for highlighting */
  currentDow?: number
  /** Called when a non-null cell is tapped. Passes millis, dayIndex (0-6), rowIndex. */
  onCellPress?: (millis: number, dayIndex: number, rowIndex: number) => void
  /** Set of "rowIndex-colIndex" keys for cells that have active reminders */
  reminderCells?: Set<string>
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
    (millis: number, colIndex: number, rowIndex: number) => {
      onCellPress?.(millis, colIndex, rowIndex)
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
            {row.map((millis, colIndex) => {
              const cellKey = `${rowIndex}-${colIndex}`
              const hasReminder = reminderCells?.has(cellKey) ?? false
              const isTappable = millis !== null && onCellPress !== undefined

              // Check adjacent reminder cells for connected band styling
              const leftKey = `${rowIndex}-${colIndex - 1}`
              const rightKey = `${rowIndex}-${colIndex + 1}`
              const hasLeft = hasReminder && (reminderCells?.has(leftKey) ?? false)
              const hasRight = hasReminder && (reminderCells?.has(rightKey) ?? false)

              // Dynamic border-radius: flatten sides that connect to neighbors
              const bandStyle: ViewStyle | undefined = hasReminder
                ? {
                    borderTopLeftRadius: hasLeft ? 0 : 8,
                    borderBottomLeftRadius: hasLeft ? 0 : 8,
                    borderTopRightRadius: hasRight ? 0 : 8,
                    borderBottomRightRadius: hasRight ? 0 : 8,
                    // Remove border on connected sides
                    borderLeftWidth: hasLeft ? 0 : 1,
                    borderRightWidth: hasRight ? 0 : 1,
                  }
                : undefined

              // Remove horizontal padding between connected cells
              const cellGap: ViewStyle | undefined =
                hasReminder && (hasLeft || hasRight)
                  ? {
                      paddingLeft: hasLeft ? 0 : 2,
                      paddingRight: hasRight ? 0 : 2,
                    }
                  : undefined

              const innerStyle = hasReminder
                ? [$reminderCellInner, bandStyle]
                : themed($timeCellInner)

              return (
                <View key={colIndex} style={[themed($timeCell), cellGap]}>
                  {millis !== null ? (
                    isTappable ? (
                      <Pressable
                        onPress={() => handleCellPress(millis, colIndex, rowIndex)}
                        style={({ pressed }) => [
                          ...(Array.isArray(innerStyle) ? innerStyle : [innerStyle]),
                          pressed && $cellPressed,
                        ]}
                      >
                        <Text style={hasReminder ? $reminderTimeText : themed($timeText)}>
                          {millis === 0 ? "24h" : formatMillisToLocalTime(millis)}
                        </Text>
                      </Pressable>
                    ) : (
                      <View style={Array.isArray(innerStyle) ? innerStyle : [innerStyle]}>
                        <Text style={hasReminder ? $reminderTimeText : themed($timeText)}>
                          {millis === 0 ? "24h" : formatMillisToLocalTime(millis)}
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
  borderWidth: 1,
  borderColor: `${REMINDER_COLOR}60`,
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
