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

// Full day names, same Mon..Sun order as DAY_KEYS. Screen readers announce the
// abbreviated header labels literally ("Mon"), and a cell's day is otherwise
// only conveyed by its column position — which a screen reader can't see. Every
// cell label therefore restates the day from these.
const DAY_KEYS_FULL = [
  "accessibility:weekdays.mon",
  "accessibility:weekdays.tue",
  "accessibility:weekdays.wed",
  "accessibility:weekdays.thu",
  "accessibility:weekdays.fri",
  "accessibility:weekdays.sat",
  "accessibility:weekdays.sun",
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

  /**
   * Builds the screen-reader label for one cell: "Monday, 7:00 PM" plus the
   * reminder state when there is one. The reminder state has to be spoken
   * because sighted users read it from the gold (enabled) / grey (disabled)
   * fill, which is invisible to VoiceOver and also fails as a colour-only
   * signal for low-vision users.
   */
  const cellLabel = useCallback(
    (millis: number, colIndex: number, reminderState: "enabled" | "disabled" | undefined) => {
      const day = t(DAY_KEYS_FULL[colIndex])
      // millis === 0 is the sentinel for a continuous (24/7) meeting, rendered
      // visually as the string "24h" — spell that out rather than say "24 h".
      const time =
        millis === 0 ? t("accessibility:continuousMeeting") : formatMillisToLocalTime(millis)
      if (reminderState === "enabled") {
        return t("accessibility:scheduleCellReminderOn", { day, time })
      }
      if (reminderState === "disabled") {
        return t("accessibility:scheduleCellReminderOff", { day, time })
      }
      return t("accessibility:scheduleCell", { day, time })
    },
    [t],
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
            // The header is one a11y element per column rather than a header
            // element wrapping a text node, so the "today" underline (a purely
            // visual tint + border) gets spoken. Announce the full day name,
            // not the "Mon" the sighted user sees.
            accessible
            accessibilityRole="header"
            accessibilityLabel={
              index === currentDayIndex
                ? t("accessibility:dayToday", { day: t(DAY_KEYS_FULL[index]) })
                : t(DAY_KEYS_FULL[index])
            }
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
                ? isDisabled
                  ? $disabledCellInner
                  : $reminderCellInner
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
                        accessibilityRole="button"
                        accessibilityLabel={cellLabel(cell.millis, colIndex, reminderState)}
                        // Which action the tap performs depends on whether a
                        // reminder already exists — same branch the caller takes
                        // in handleCellPress, so keep the two in step.
                        accessibilityHint={
                          hasReminder
                            ? t("accessibility:doubleTapToEditReminder")
                            : t("accessibility:doubleTapToSetReminder")
                        }
                      >
                        <Text style={textStyle}>
                          {cell.millis === 0 ? "24h" : formatMillisToLocalTime(cell.millis)}
                        </Text>
                      </Pressable>
                    ) : (
                      // Read-only grid (no onCellPress): still one labelled
                      // element per cell so the day is announced with the time.
                      <View
                        style={innerStyle}
                        accessible
                        accessibilityLabel={cellLabel(cell.millis, colIndex, reminderState)}
                      >
                        <Text style={textStyle}>
                          {cell.millis === 0 ? "24h" : formatMillisToLocalTime(cell.millis)}
                        </Text>
                      </View>
                    )
                  ) : (
                    // Spacer for a day with no meeting in this row. A full grid
                    // is mostly empties, so leaving them focusable made
                    // VoiceOver swipe through dozens of silent stops between
                    // real times. Hide them from the accessibility tree on both
                    // platforms (iOS reads accessibilityElementsHidden, Android
                    // reads importantForAccessibility).
                    <View
                      style={themed($emptyCellInner)}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
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
