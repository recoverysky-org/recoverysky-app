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
  Platform,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker"
import { DateTime } from "@recoverysky-org/common/browser"
import { useTranslation } from "react-i18next"

import { ScheduleGrid } from "@/components/ScheduleGrid"
import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import type { ReminderRecord, ReminderCreateInput, ReminderUpdateInput } from "@/db"
import { useStores } from "@/models"
import {
  hasNotificationPermission,
  requestNotificationPermission,
  loginNotificationUser,
} from "@/services/notifications"
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
  /** Check if proposed cells overlap with existing reminders */
  onCheckOverlap: (proposedCells: Set<string>, excludeId?: string) => ReminderRecord[]
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
  onCheckOverlap,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const { authenticationStore: authStore } = useStores()
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

  // 24/7 meeting time picker state
  const [customTime, setCustomTime] = useState<Date>(new Date())
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [hasCustomTime, setHasCustomTime] = useState(false)

  // Detect if selected cell is a 24/7 meeting (millis === 0)
  const is24h = useMemo(() => {
    if (!activeCell || !meeting.scheduleData) return false
    const cell = meeting.scheduleData[activeCell.row]?.[activeCell.col]
    return cell !== null && cell.millis === 0
  }, [activeCell, meeting.scheduleData])

  // On iOS, time picker is always visible for continuous meetings — auto-enable hasCustomTime
  useEffect(() => {
    if (is24h && Platform.OS === "ios" && !hasCustomTime) {
      setHasCustomTime(true)
    }
  }, [is24h, hasCustomTime])

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setActiveCell(selectedCell)
      if (existingReminder) {
        setMinutesBefore(existingReminder.minutes_before)
        setAtStart(existingReminder.at_start)
        setScope((existingReminder.scope as "single" | "row" | "all") ?? "single")
        setEnabled(existingReminder.enabled)
        // Restore custom time from existing reminder
        if (existingReminder.time > 0) {
          const hours = Math.floor(existingReminder.time / 60)
          const mins = existingReminder.time % 60
          const d = new Date()
          d.setHours(hours, mins, 0, 0)
          setCustomTime(d)
          setHasCustomTime(true)
        } else {
          setCustomTime(new Date())
          setHasCustomTime(false)
        }
      } else {
        setMinutesBefore(15)
        setAtStart(false)
        setScope("single")
        setEnabled(true)
        setCustomTime(new Date())
        setHasCustomTime(false)
      }
      setShowTimePicker(false)
    }
  }, [visible, existingReminder, selectedCell])

  // Handle cell tap inside the editor grid — change selection
  const handleEditorCellPress = useCallback(
    (_millis: number, _id: string, dayIndex: number, rowIndex: number) => {
      setActiveCell({ row: rowIndex, col: dayIndex })
    },
    [],
  )

  // Handle time picker change
  const handleTimeChange = useCallback((_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setShowTimePicker(false)
    if (date) {
      setCustomTime(date)
      setHasCustomTime(true)
    }
  }, [])

  // Format custom time for display
  const formattedCustomTime = useMemo(() => {
    if (!hasCustomTime) return null
    return DateTime.fromJSDate(customTime).toFormat("h:mm a")
  }, [customTime, hasCustomTime])

  // Highlight based on scope:
  // "single" → one cell, "row" → all at this time, "all" → entire schedule
  const highlightedCells = useMemo(() => {
    const cells = new Map<string, "enabled" | "disabled">()
    if (!activeCell || !meeting.scheduleData) return cells

    const state = enabled ? "enabled" : "disabled"

    if (scope === "all") {
      meeting.scheduleData.forEach((row, ri) => {
        row.forEach((cell, ci) => {
          if (cell !== null) cells.set(`${ri}-${ci}`, state)
        })
      })
    } else if (scope === "row") {
      const row = meeting.scheduleData[activeCell.row]
      if (row) {
        row.forEach((cell, ci) => {
          if (cell !== null) cells.set(`${activeCell.row}-${ci}`, state)
        })
      }
    } else {
      cells.set(`${activeCell.row}-${activeCell.col}`, state)
    }
    return cells
  }, [activeCell, scope, enabled, meeting.scheduleData])

  const doSave = useCallback(async () => {
    if (!activeCell) return
    setIsSaving(true)

    try {
      // Best-effort notification permission + token registration
      const permitted = await hasNotificationPermission()
      if (!permitted) {
        const granted = await requestNotificationPermission()
        if (granted && authStore.userIdentifier && authStore.deviceId) {
          loginNotificationUser(authStore.userIdentifier, authStore.deviceId).catch(() => {})
        }
      }

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const cell = meeting.scheduleData?.[activeCell.row]?.[activeCell.col]
      const cellMid = cell?.id ?? meeting.id

      // dow: ISO weekday from grid column (col 0=Mon → dow 1, col 6=Sun → dow 7)
      const dow = activeCell.col + 1

      // time: minutes from midnight — server uses this as the reference for minutes_before
      let time = -1
      if (is24h && hasCustomTime) {
        // 24/7 meetings: user picks the notification time
        time = customTime.getHours() * 60 + customTime.getMinutes()
      } else if (!is24h && cell?.millis) {
        // Regular meetings: derive from the cell's UTC start time → local
        const local = DateTime.fromMillis(cell.millis).toLocal()
        time = local.hour * 60 + local.minute
      }

      // Continuous meetings: time IS the reminder, no "minutes before" concept
      const effectiveMinutes = is24h ? 0 : minutesBefore
      const effectiveAtStart = is24h ? false : atStart

      if (isEditing && existingReminder) {
        await onUpdate(existingReminder.id, {
          minutes_before: effectiveMinutes,
          at_start: effectiveAtStart,
          mid: cellMid,
          sid: scope !== "single" ? sid : "",
          scope,
          dow,
          time,
          enabled,
        })
      } else {
        await onCreate({
          mid: cellMid,
          sid: scope !== "single" ? sid : undefined,
          scope,
          dow,
          time,
          name: meeting.name,
          timezone: tz,
          minutes_before: effectiveMinutes,
          at_start: effectiveAtStart,
          enabled: true,
        })
      }
      onClose()
    } finally {
      setIsSaving(false)
    }
  }, [
    activeCell,
    isEditing,
    existingReminder,
    minutesBefore,
    atStart,
    scope,
    enabled,
    is24h,
    hasCustomTime,
    customTime,
    sid,
    meeting,
    onCreate,
    onUpdate,
    onClose,
  ])

  // Reactively check overlap whenever scope or selected cell changes
  const hasOverlap = useMemo(() => {
    if (!activeCell || !meeting.scheduleData) return false

    // Compute proposed cell keys directly from current state
    const proposedKeys = new Set<string>()
    if (scope === "all") {
      meeting.scheduleData.forEach((row, ri) => {
        row.forEach((cell, ci) => {
          if (cell !== null) proposedKeys.add(`${ri}-${ci}`)
        })
      })
    } else if (scope === "row") {
      const row = meeting.scheduleData[activeCell.row]
      if (row) {
        row.forEach((cell, ci) => {
          if (cell !== null) proposedKeys.add(`${activeCell.row}-${ci}`)
        })
      }
    } else {
      proposedKeys.add(`${activeCell.row}-${activeCell.col}`)
    }

    return onCheckOverlap(proposedKeys, existingReminder?.id).length > 0
  }, [activeCell, scope, meeting.scheduleData, onCheckOverlap, existingReminder?.id])

  const canSave = !isSaving && !!activeCell && (!is24h || hasCustomTime)

  const handleSave = useCallback(() => {
    if (!canSave) return
    doSave()
  }, [canSave, doSave])

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
                  style={[themed($saveButton), !canSave && $savingDisabled]}
                  onPress={handleSave}
                  disabled={!canSave}
                >
                  <Ionicons name="checkmark" size={18} color="#000" />
                  <Text style={$saveButtonText}>{t("reminderEditor:save")}</Text>
                </Pressable>
              </View>
            </View>

            {/* Overlap warning */}
            {hasOverlap && (
              <View style={$overlapWarning}>
                <Ionicons name="warning" size={16} color="#f59e0b" />
                <Text style={$overlapWarningText}>{t("reminderEditor:overlapMessage")}</Text>
              </View>
            )}

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

            {/* Time picker for continuous (24/7) meetings — time IS the reminder */}
            {is24h && (
              <View style={themed($section)}>
                <Text style={themed($sectionLabel)}>{t("reminderEditor:reminderTime")}</Text>
                {Platform.OS === "ios" ? (
                  <DateTimePicker
                    value={customTime}
                    mode="time"
                    display="spinner"
                    onChange={handleTimeChange}
                    minuteInterval={5}
                    themeVariant={theme.isDark ? "dark" : "light"}
                  />
                ) : (
                  <>
                    <Pressable
                      style={themed(hasCustomTime ? $timeDisplay : $selectTimeButton)}
                      onPress={() => setShowTimePicker(true)}
                    >
                      <Ionicons name="time-outline" size={18} color={REMINDER_COLOR} />
                      <Text style={hasCustomTime ? $timeDisplayText : $selectTimeButtonText}>
                        {hasCustomTime ? formattedCustomTime : t("reminderEditor:selectTime")}
                      </Text>
                    </Pressable>
                    {showTimePicker && (
                      <DateTimePicker
                        value={customTime}
                        mode="time"
                        display="default"
                        onChange={handleTimeChange}
                        minuteInterval={5}
                      />
                    )}
                  </>
                )}
              </View>
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

            {/* Minutes before & at-start — only for scheduled meetings, not continuous */}
            {!is24h && (
              <>
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

                <View style={themed($toggleRow)}>
                  <Text style={themed($toggleLabel)}>{t("reminderEditor:atStart")}</Text>
                  <Switch
                    value={atStart}
                    onValueChange={setAtStart}
                    trackColor={{ false: theme.colors.border, true: `${REMINDER_COLOR}80` }}
                    thumbColor={atStart ? REMINDER_COLOR : theme.colors.textDim}
                  />
                </View>
              </>
            )}

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

const $overlapWarning: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  marginTop: 12,
  paddingVertical: 8,
  paddingHorizontal: 10,
  backgroundColor: "rgba(245, 158, 11, 0.12)",
  borderRadius: 8,
}

const $overlapWarningText: TextStyle = {
  flex: 1,
  fontSize: 13,
  fontWeight: "500",
  color: "#f59e0b",
}

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
  opacity: 0.35,
}

const $saveButtonText: TextStyle = {
  fontSize: 14,
  fontWeight: "700",
  color: "#000",
}

const $selectTimeButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: REMINDER_COLOR,
  backgroundColor: `${REMINDER_COLOR}15`,
  alignSelf: "flex-start",
})

const $selectTimeButtonText: TextStyle = {
  fontSize: 14,
  fontWeight: "600",
  color: REMINDER_COLOR,
}

const $timeDisplay: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  borderRadius: 10,
  backgroundColor: `${REMINDER_COLOR}20`,
  alignSelf: "flex-start",
})

const $timeDisplayText: TextStyle = {
  fontSize: 16,
  fontWeight: "700",
  color: REMINDER_COLOR,
}
