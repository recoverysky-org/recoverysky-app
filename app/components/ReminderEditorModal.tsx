/**
 * ReminderEditorModal Component
 *
 * Modal for creating and editing meeting reminders.
 * Opens over the SchedulePopup when a schedule grid cell is tapped.
 */

import { FC, useState, useEffect, useCallback, useMemo } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Alert,
  ScrollView,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { ScheduleGrid } from "@/components/ScheduleGrid"
import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import type { ReminderRecord, ReminderCreateInput, ReminderUpdateInput } from "@/db"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

const REMINDER_COLOR = "#f59e0b"

const MINUTE_PRESETS = [
  { value: 5, key: "reminderEditor:min5" },
  { value: 10, key: "reminderEditor:min10" },
  { value: 15, key: "reminderEditor:min15" },
  { value: 30, key: "reminderEditor:min30" },
  { value: 60, key: "reminderEditor:min60" },
] as const

interface ReminderEditorModalProps {
  visible: boolean
  onClose: () => void
  meeting: MeetingWithTrex
  /** Existing reminder if editing, null if creating */
  existingReminder: ReminderRecord | null
  /** The tapped cell coordinates */
  selectedCell: { row: number; col: number } | null
  /** Schedule ID for "all meetings at this time" mode */
  sid: string
  /** Create handler from useReminders */
  onCreate: (input: Omit<ReminderCreateInput, "uid">) => Promise<ReminderRecord | null>
  /** Update handler from useReminders */
  onUpdate: (id: string, input: ReminderUpdateInput) => Promise<void>
  /** Delete handler from useReminders */
  onDelete: (id: string) => Promise<void>
}

export const ReminderEditorModal: FC<ReminderEditorModalProps> = ({
  visible,
  onClose,
  meeting,
  existingReminder,
  selectedCell,
  sid,
  onCreate,
  onUpdate,
  onDelete,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const isEditing = existingReminder !== null

  // Form state
  const [minutesBefore, setMinutesBefore] = useState(15)
  const [atStart, setAtStart] = useState(false)
  /** "single" = this meeting, "row" = all at this time, "all" = entire schedule */
  const [scope, setScope] = useState<"single" | "row" | "all">("single")
  const [enabled, setEnabled] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  // Local selected cell — initialized from prop, user can change by tapping grid
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setActiveCell(selectedCell)
      if (existingReminder) {
        setMinutesBefore(existingReminder.minutes_before)
        setAtStart(existingReminder.at_start)
        setScope(
          existingReminder.sid && !existingReminder.mid ? "all" :
          existingReminder.sid ? "row" : "single"
        )
        setEnabled(existingReminder.enabled)
      } else {
        setMinutesBefore(15)
        setAtStart(false)
        setScope("single")
        setEnabled(true)
      }
    }
  }, [visible, existingReminder, selectedCell])

  // Handle cell tap inside the editor grid — change selection
  const handleEditorCellPress = useCallback(
    (_millis: number, dayIndex: number, rowIndex: number) => {
      setActiveCell({ row: rowIndex, col: dayIndex })
    },
    [],
  )

  // Highlight based on scope:
  // "single" → one cell, "row" → all at this time, "all" → entire schedule
  const highlightedCells = useMemo(() => {
    const cells = new Set<string>()
    if (!activeCell || !meeting.scheduleData) return cells

    if (scope === "all") {
      // Every non-null cell in the grid
      meeting.scheduleData.forEach((row, ri) => {
        row.forEach((millis, ci) => {
          if (millis !== null) cells.add(`${ri}-${ci}`)
        })
      })
    } else if (scope === "row") {
      // All non-null cells in the active row
      const row = meeting.scheduleData[activeCell.row]
      if (row) {
        row.forEach((millis, ci) => {
          if (millis !== null) cells.add(`${activeCell.row}-${ci}`)
        })
      }
    } else {
      cells.add(`${activeCell.row}-${activeCell.col}`)
    }
    return cells
  }, [activeCell, scope, meeting.scheduleData])

  const handleSave = useCallback(async () => {
    if (isSaving) return
    setIsSaving(true)

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

      if (isEditing && existingReminder) {
        await onUpdate(existingReminder.id, {
          minutes_before: minutesBefore,
          at_start: atStart,
          mid: scope === "all" ? "" : meeting.id,
          sid: scope !== "single" ? sid : "",
          enabled,
        })
      } else {
        await onCreate({
          mid: scope === "all" ? "" : meeting.id,
          sid: scope !== "single" ? sid : undefined,
          name: meeting.name,
          timezone: tz,
          minutes_before: minutesBefore,
          at_start: atStart,
          enabled: true,
        })
      }
      onClose()
    } finally {
      setIsSaving(false)
    }
  }, [
    isSaving,
    isEditing,
    existingReminder,
    minutesBefore,
    atStart,
    scope,
    enabled,
    sid,
    meeting,
    onCreate,
    onUpdate,
    onClose,
  ])

  const handleDelete = useCallback(() => {
    if (!existingReminder) return

    Alert.alert(t("reminderEditor:delete"), t("reminderEditor:deleteConfirm"), [
      { text: t("reminderEditor:cancel"), style: "cancel" },
      {
        text: t("reminderEditor:delete"),
        style: "destructive",
        onPress: async () => {
          await onDelete(existingReminder.id)
          onClose()
        },
      },
    ])
  }, [existingReminder, onDelete, onClose, t])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={themed($overlay)}>
        <Pressable style={themed($backdrop)} onPress={onClose} />

        <View style={themed($content)}>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={themed($header)}>
              <Ionicons name="notifications" size={20} color={REMINDER_COLOR} />
              <Text style={themed($headerTitle)}>
                {t(isEditing ? "reminderEditor:editReminder" : "reminderEditor:newReminder")}
              </Text>
              <Pressable onPress={onClose} style={themed($closeButton)}>
                <Ionicons name="close" size={22} color={theme.colors.textDim} />
              </Pressable>
            </View>

            {/* Meeting name */}
            <Text style={themed($meetingName)} numberOfLines={1}>
              {meeting.name}
            </Text>

            {/* Interactive schedule grid — tap to change selection */}
            {meeting.scheduleData && meeting.scheduleData.length > 0 && (
              <ScheduleGrid
                scheduleData={meeting.scheduleData}
                reminderCells={highlightedCells}
                onCellPress={handleEditorCellPress}
              />
            )}

            {/* Scope toggle */}
            {sid ? (
              <View style={themed($section)}>
                <View style={themed($chipRow)}>
                  {(
                    [
                      { value: "single", key: "reminderEditor:thisMeetingOnly" },
                      { value: "row", key: "reminderEditor:allMeetingsAtTime" },
                      { value: "all", key: "reminderEditor:allMeetingsInSchedule" },
                    ] as const
                  ).map(({ value, key }) => (
                    <Pressable
                      key={value}
                      style={[themed($scopeChip), scope === value && themed($scopeChipActive)]}
                      onPress={() => setScope(value)}
                    >
                      <Text
                        style={[
                          themed($scopeChipText),
                          scope === value && themed($scopeChipTextActive),
                        ]}
                      >
                        {t(key)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Minutes before */}
            <View style={themed($section)}>
              <Text style={themed($sectionLabel)}>{t("reminderEditor:minutesBefore")}</Text>
              <View style={themed($chipRow)}>
                {MINUTE_PRESETS.map(({ value, key }) => (
                  <Pressable
                    key={value}
                    style={[
                      themed($minuteChip),
                      minutesBefore === value && themed($minuteChipActive),
                    ]}
                    onPress={() => setMinutesBefore(value)}
                  >
                    <Text
                      style={[
                        themed($minuteChipText),
                        minutesBefore === value && themed($minuteChipTextActive),
                      ]}
                    >
                      {t(key)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* At start toggle */}
            <View style={themed($toggleRow)}>
              <Text style={themed($toggleLabel)}>{t("reminderEditor:atStart")}</Text>
              <Switch
                value={atStart}
                onValueChange={setAtStart}
                trackColor={{ false: theme.colors.border, true: `${REMINDER_COLOR}80` }}
                thumbColor={atStart ? REMINDER_COLOR : theme.colors.textDim}
              />
            </View>

            {/* Enabled toggle (edit mode only) */}
            {isEditing && (
              <View style={themed($toggleRow)}>
                <Text style={themed($toggleLabel)}>{t("reminderEditor:enabled")}</Text>
                <Switch
                  value={enabled}
                  onValueChange={setEnabled}
                  trackColor={{ false: theme.colors.border, true: `${REMINDER_COLOR}80` }}
                  thumbColor={enabled ? REMINDER_COLOR : theme.colors.textDim}
                />
              </View>
            )}

            {/* Action buttons */}
            <View style={themed($actionRow)}>
              {isEditing && (
                <Pressable style={themed($deleteButton)} onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  <Text style={$deleteButtonText}>{t("reminderEditor:delete")}</Text>
                </Pressable>
              )}

              <View style={themed($rightActions)}>
                <Pressable style={themed($cancelButton)} onPress={onClose}>
                  <Text style={themed($cancelButtonText)}>{t("reminderEditor:cancel")}</Text>
                </Pressable>
                <Pressable
                  style={[themed($saveButton), isSaving && $savingDisabled]}
                  onPress={handleSave}
                  disabled={isSaving}
                >
                  <Ionicons name="checkmark" size={18} color="#000" />
                  <Text style={$saveButtonText}>{t("reminderEditor:save")}</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

// ============================================================================
// Styles
// ============================================================================

const $overlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  justifyContent: "flex-end",
})

const $backdrop: ThemedStyle<ViewStyle> = () => ({
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0, 0, 0, 0.85)",
})

const $content: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  maxHeight: "80%",
  paddingTop: spacing.md,
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.xl,
})

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  marginBottom: spacing.xs,
})

const $headerTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 18,
  fontWeight: "700",
  color: colors.text,
})

const $closeButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.xs,
})

const $meetingName: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  fontWeight: "500",
  color: colors.textDim,
  marginBottom: spacing.sm,
})

const $section: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.md,
})

const $sectionLabel: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 13,
  fontWeight: "600",
  color: colors.textDim,
  marginBottom: spacing.xs,
})

const $chipRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xs,
})

const $scopeChip: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.sm,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: colors.border,
})

const $scopeChipActive: ThemedStyle<ViewStyle> = () => ({
  backgroundColor: `${REMINDER_COLOR}20`,
  borderColor: REMINDER_COLOR,
})

const $scopeChipText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontWeight: "500",
  color: colors.textDim,
})

const $scopeChipTextActive: ThemedStyle<TextStyle> = () => ({
  color: REMINDER_COLOR,
  fontWeight: "600",
})

const $minuteChip: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.sm,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: colors.border,
})

const $minuteChipActive: ThemedStyle<ViewStyle> = () => ({
  backgroundColor: `${REMINDER_COLOR}20`,
  borderColor: REMINDER_COLOR,
})

const $minuteChipText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontWeight: "500",
  color: colors.textDim,
})

const $minuteChipTextActive: ThemedStyle<TextStyle> = () => ({
  color: REMINDER_COLOR,
  fontWeight: "600",
})

const $toggleRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: spacing.md,
  paddingVertical: spacing.xs,
})

const $toggleLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  fontWeight: "500",
  color: colors.text,
})

const $actionRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: spacing.lg,
  paddingTop: spacing.md,
  borderTopWidth: 1,
  borderTopColor: "rgba(255,255,255,0.1)",
})

const $rightActions: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  gap: spacing.sm,
  marginLeft: "auto",
})

const $deleteButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
})

const $deleteButtonText: TextStyle = {
  fontSize: 14,
  fontWeight: "600",
  color: "#ef4444",
}

const $cancelButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
})

const $cancelButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  fontWeight: "600",
  color: colors.textDim,
})

const $saveButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  backgroundColor: REMINDER_COLOR,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  borderRadius: 10,
})

const $savingDisabled: ViewStyle = {
  opacity: 0.6,
}

const $saveButtonText: TextStyle = {
  fontSize: 14,
  fontWeight: "700",
  color: "#000",
}
