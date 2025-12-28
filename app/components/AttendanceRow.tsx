/**
 * AttendanceRow Component
 *
 * Displays a single attendance record with:
 * - Valid/invalid indicator (checkmark or X)
 * - Meeting name
 * - Date/time, duration, and credit info
 * - Add to Report button (for valid records)
 */

import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { DateTime } from "@common"

import { Text } from "@/components/Text"
import type { AttendanceRecord } from "@/db"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export interface AttendanceWithMeeting extends AttendanceRecord {
  meetingName?: string
}

interface AttendanceRowProps {
  /** Attendance record with optional meeting name */
  record: AttendanceWithMeeting
  /** Callback when Add to Report is pressed */
  onAddToReport?: () => void
}

/**
 * AttendanceRow displays a single attendance record.
 *
 * @example
 * <AttendanceRow
 *   record={attendance}
 *   onAddToReport={() => handleAdd(attendance.id)}
 * />
 */
export const AttendanceRow: FC<AttendanceRowProps> = ({ record, onAddToReport }) => {
  const { themed, theme } = useAppTheme()

  const startDt = useMemo(() => {
    return record.start > 0 ? DateTime.fromMillis(record.start) : null
  }, [record.start])

  const duration = useMemo(() => {
    if (!record.start || !record.end) return 0
    return Math.round((record.end - record.start) / 60000)
  }, [record.start, record.end])

  const dateTimeStr = useMemo(() => {
    if (!startDt) return "Pending"
    return startDt.toFormat("MMM d, h:mma").toLowerCase()
  }, [startDt])

  return (
    <View style={themed($container)}>
      {/* Valid indicator */}
      <Ionicons
        name={record.valid ? "checkmark-circle" : "close-circle"}
        size={22}
        color={record.valid ? theme.colors.palette.secondary500 : theme.colors.error}
      />

      {/* Meeting info */}
      <View style={$content}>
        <Text style={themed($meetingName)} numberOfLines={1}>
          {record.meetingName ?? "Unknown Meeting"}
        </Text>
        <Text style={themed($meta)}>
          {dateTimeStr}
          {duration > 0 && ` · ${duration} min`}
          {record.credit > 0 && ` · ${record.credit} credit`}
        </Text>
      </View>

      {/* Add to Report button (only for valid records) */}
      {record.valid && (
        <Pressable
          onPress={onAddToReport}
          hitSlop={8}
          style={({ pressed }) => [themed($addButton), pressed && $pressed]}
        >
          <Ionicons name="add-circle-outline" size={26} color={theme.colors.tint} />
        </Pressable>
      )}
    </View>
  )
}

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  gap: spacing.sm,
  backgroundColor: colors.card,
  borderRadius: 8,
})

const $content: ViewStyle = {
  flex: 1,
  minWidth: 0,
}

const $meetingName: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  fontWeight: "500",
  color: colors.text,
})

const $meta: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
  marginTop: 2,
})

const $addButton: ThemedStyle<ViewStyle> = () => ({
  padding: 4,
})

const $pressed: ViewStyle = {
  opacity: 0.7,
}
