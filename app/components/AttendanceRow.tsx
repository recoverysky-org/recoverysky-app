/**
 * AttendanceRow Component
 *
 * Displays a single attendance record with:
 * - Valid/invalid indicator (checkmark or X)
 * - Meeting name
 * - Date/time, duration, and credit info
 * - Add to Report button (for valid records)
 */

import { FC, useCallback, useMemo } from "react"
import { AccessibilityActionEvent, View, ViewStyle, TextStyle, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { DateTime } from "@recoverysky-org/common/browser"

import { Text } from "@/components/Text"
import type { AttendanceRecord } from "@/db"
import { translate } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface AttendanceRowProps {
  /** Attendance record */
  record: AttendanceRecord
  /** Whether this record is selected */
  isSelected?: boolean
  /** Whether to show the report selection toggle (requires entitlement) */
  showReportSelect?: boolean
  /** Callback when selection toggle is pressed */
  onToggleSelect?: () => void
  /** Callback when Archive is pressed */
  onArchive?: () => void
  /** Callback when Delete is pressed */
  onDelete?: () => void
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
export const AttendanceRow: FC<AttendanceRowProps> = ({
  record,
  isSelected = false,
  showReportSelect = false,
  onToggleSelect,
  onArchive,
  onDelete,
}) => {
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

  const accessibilityActions = useMemo(() => {
    const actions: { name: string; label: string }[] = []
    if (onArchive) actions.push({ name: "archive", label: translate("accessibility:actionArchive") })
    if (onDelete) actions.push({ name: "delete", label: translate("accessibility:actionDelete") })
    return actions
  }, [onArchive, onDelete])

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      switch (event.nativeEvent.actionName) {
        case "archive":
          onArchive?.()
          break
        case "delete":
          onDelete?.()
          break
      }
    },
    [onArchive, onDelete],
  )

  return (
    <View
      style={themed($container)}
      accessibilityActions={accessibilityActions.length > 0 ? accessibilityActions : undefined}
      onAccessibilityAction={accessibilityActions.length > 0 ? handleAccessibilityAction : undefined}
    >
      {/* Report selection toggle (far left) */}
      {showReportSelect && (
        <Pressable
          onPress={onToggleSelect}
          hitSlop={8}
          style={({ pressed }) => [themed($actionButton), pressed && $pressed]}
          accessibilityRole="button"
          accessibilityLabel={translate("accessibility:selectForReport")}
          accessibilityState={{ selected: isSelected }}
          accessibilityHint={translate("accessibility:doubleTapToSelect")}
        >
          <Ionicons
            name={isSelected ? "checkmark-circle" : "add-circle-outline"}
            size={24}
            color={isSelected ? "#4CAF50" : theme.colors.tint}
          />
        </Pressable>
      )}

      {/* Meeting info */}
      <View
        style={$content}
        accessible
        accessibilityLabel={`${record.meetingName ?? "Unknown Meeting"}${record.meetingTopic ? `, ${record.meetingTopic}` : ""}, ${dateTimeStr}${duration > 0 ? `, ${duration} min` : ""}`}
      >
        <Text style={themed($meetingName)} numberOfLines={1}>
          {record.meetingName ?? "Unknown Meeting"}
        </Text>
        {record.meetingTopic ? (
          <Text style={themed($topic)} numberOfLines={1}>
            {record.meetingTopic}
          </Text>
        ) : null}
        <Text style={themed($meta)}>
          {dateTimeStr}
          {duration > 0 && ` · ${duration} min`}
        </Text>
      </View>

      {/* Archive button (hidden when already archived) */}
      {onArchive && (
        <Pressable
          onPress={onArchive}
          hitSlop={8}
          style={({ pressed }) => [themed($actionButton), pressed && $pressed]}
          accessibilityRole="button"
          accessibilityLabel={translate("common:archive")}
          accessibilityHint={translate("accessibility:doubleTapToArchive")}
        >
          <Ionicons name="archive-outline" size={22} color={theme.colors.textDim} />
        </Pressable>
      )}

      {/* Delete button (hidden when not applicable, e.g. archived records tied to reports) */}
      {onDelete && (
        <Pressable
          onPress={onDelete}
          hitSlop={8}
          style={({ pressed }) => [themed($actionButton), pressed && $pressed]}
          accessibilityRole="button"
          accessibilityLabel={translate("common:delete")}
          accessibilityHint={translate("accessibility:doubleTapToDelete")}
        >
          <Ionicons name="trash-outline" size={22} color={theme.colors.textDim} />
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

const $topic: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontStyle: "italic",
  color: colors.tint,
  marginTop: 2,
})

const $meta: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
  marginTop: 2,
})

const $actionButton: ThemedStyle<ViewStyle> = () => ({
  padding: 4,
})

const $pressed: ViewStyle = {
  opacity: 0.7,
}
