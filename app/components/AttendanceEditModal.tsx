/**
 * AttendanceEditModal
 *
 * Small editor that lets the user reduce an attendance record's duration
 * (minutes). The original duration acts as the hard ceiling — users can only
 * adjust the time downward. Minimum floor is 1 minute.
 *
 * CHANGED 2026-08-09: the ±1-minute stepper pair was the ONLY way to change the
 * value, so correcting an over-long record cost one tap per minute — 60 taps to
 * remove an hour. A drag slider now spans the legal range and the ± buttons are
 * demoted to fine adjustment. The reduce-only ceiling and the 1-minute floor are
 * unchanged.
 */

import { FC, useEffect, useMemo, useState } from "react"
import { Modal, Pressable, StyleSheet, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { MinuteSlider } from "@/components/MinuteSlider"
import { Text } from "@/components/Text"
import type { AttendanceRecord } from "@/db"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

const MIN_MINUTES = 1

interface AttendanceEditModalProps {
  visible: boolean
  record: AttendanceRecord | null
  onClose: () => void
  /** Fired with the new duration (minutes) when the user taps Save. */
  onSave: (record: AttendanceRecord, newDurationMinutes: number) => void | Promise<void>
}

export const AttendanceEditModal: FC<AttendanceEditModalProps> = ({
  visible,
  record,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  const originalMinutes = useMemo(() => {
    if (!record || !record.start || !record.end) return 0
    return Math.max(MIN_MINUTES, Math.round((record.end - record.start) / 60000))
  }, [record])

  const [minutes, setMinutes] = useState<number>(originalMinutes)
  const [saving, setSaving] = useState(false)

  // Re-seed from the record every time the modal opens.
  useEffect(() => {
    if (visible) {
      setMinutes(originalMinutes)
      setSaving(false)
    }
  }, [visible, originalMinutes])

  const canDecrement = minutes > MIN_MINUTES && !saving
  const canIncrement = minutes < originalMinutes && !saving
  const canSave = !saving && minutes !== originalMinutes

  const handleSave = async () => {
    if (!record || !canSave) return
    setSaving(true)
    try {
      await onSave(record, minutes)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={themed($overlay)}>
        <Pressable style={themed($backdrop)} onPress={onClose} />

        <View style={themed($card)} accessibilityViewIsModal>
          <View style={themed($header)}>
            <Ionicons name="create-outline" size={20} color={theme.colors.tint} />
            <Text style={themed($title)} tx="attendanceEdit:title" />
          </View>

          {record?.meetingName ? (
            <Text style={themed($meetingName)} numberOfLines={2}>
              {record.meetingName}
            </Text>
          ) : null}

          <View style={themed($minutesDisplay)}>
            <Text style={themed($minutesValue)}>{minutes}</Text>
            <Text style={themed($minutesUnit)} tx="attendanceEdit:minutes" />
          </View>

          <View style={themed($sliderRow)}>
            <Text style={themed($endpointLabel)}>{MIN_MINUTES}</Text>

            <MinuteSlider
              value={minutes}
              min={MIN_MINUTES}
              max={originalMinutes}
              onChange={setMinutes}
              // `saving` disables it for the same reason the buttons check it:
              // the save is in flight and the value is already committed.
              disabled={saving}
              accessibilityLabel={t("attendanceEdit:slider")}
              testID="attendance-edit-slider"
            />

            <Text style={themed($endpointLabel)}>{originalMinutes}</Text>
          </View>

          <View style={themed($stepperRow)}>
            <Pressable
              onPress={() => canDecrement && setMinutes((m) => Math.max(MIN_MINUTES, m - 1))}
              disabled={!canDecrement}
              hitSlop={8}
              style={({ pressed }) => [
                themed($stepperButton),
                !canDecrement && themed($stepperDisabled),
                pressed && canDecrement ? themed($stepperPressed) : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("attendanceEdit:decrement")}
              accessibilityState={{ disabled: !canDecrement }}
            >
              <Ionicons
                name="remove"
                size={24}
                color={canDecrement ? theme.colors.tint : theme.colors.textDim}
              />
            </Pressable>

            <Pressable
              onPress={() => canIncrement && setMinutes((m) => Math.min(originalMinutes, m + 1))}
              disabled={!canIncrement}
              hitSlop={8}
              style={({ pressed }) => [
                themed($stepperButton),
                !canIncrement && themed($stepperDisabled),
                pressed && canIncrement ? themed($stepperPressed) : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("attendanceEdit:increment")}
              accessibilityState={{ disabled: !canIncrement }}
            >
              <Ionicons
                name="add"
                size={24}
                color={canIncrement ? theme.colors.tint : theme.colors.textDim}
              />
            </Pressable>
          </View>

          <Text
            style={themed($hint)}
            tx="attendanceEdit:hint"
            txOptions={{ minutes: originalMinutes }}
          />

          <View style={themed($buttonRow)}>
            <Pressable
              onPress={onClose}
              style={themed($cancelButton)}
              accessibilityRole="button"
              accessibilityLabel={t("common:cancel")}
            >
              <Text style={themed($cancelButtonText)} tx="common:cancel" />
            </Pressable>

            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              style={[themed($saveButton), !canSave && themed($saveButtonDisabled)]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave, busy: saving }}
              accessibilityLabel={t("attendanceEdit:save")}
            >
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={canSave ? theme.colors.tint : theme.colors.textDim}
              />
              <Text
                style={[themed($saveButtonText), !canSave && themed($saveButtonTextDisabled)]}
                tx="attendanceEdit:save"
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const $overlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
})

const $backdrop: ThemedStyle<ViewStyle> = () => ({
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0, 0, 0, 0.85)",
})

const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  width: "85%",
  maxWidth: 400,
  backgroundColor: colors.card,
  borderRadius: 16,
  padding: spacing.lg,
  alignItems: "center",
  gap: spacing.sm,
})

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "700",
  color: colors.text,
})

const $meetingName: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
  textAlign: "center",
})

const $stepperRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: spacing.xl,
  marginBottom: spacing.xs,
})

const $stepperButton: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 44,
  height: 44,
  borderRadius: 22,
  borderWidth: 1.5,
  borderColor: colors.tint,
  alignItems: "center",
  justifyContent: "center",
})

const $stepperDisabled: ThemedStyle<ViewStyle> = ({ colors }) => ({
  opacity: 0.4,
  borderColor: colors.border,
})

const $stepperPressed: ThemedStyle<ViewStyle> = () => ({
  opacity: 0.7,
})

const $minutesDisplay: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  marginTop: spacing.xs,
})

const $sliderRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  width: "100%",
  marginBottom: spacing.xs,
})

const $endpointLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  fontVariant: ["tabular-nums"],
  // Keeps the slider's travel from shifting as the ceiling label goes from
  // two digits to three.
  minWidth: 26,
  textAlign: "center",
})

const $minutesValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 44,
  lineHeight: 52,
  fontWeight: "700",
  fontVariant: ["tabular-nums"],
  color: colors.text,
})

const $minutesUnit: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  textTransform: "uppercase",
  letterSpacing: 1,
})

const $hint: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  textAlign: "center",
})

const $buttonRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  gap: spacing.md,
  marginTop: spacing.md,
  width: "100%",
})

const $cancelButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  paddingVertical: spacing.sm,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: colors.border,
  alignItems: "center",
  justifyContent: "center",
})

const $cancelButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 15,
  fontWeight: "600",
})

const $saveButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: spacing.xs,
  paddingVertical: spacing.sm,
  // Was a hardcoded "#000". CHANGED 2026-08-09: that painted a black slab onto the
  // white light-mode modal. Note this is `background`, NOT the `card` used by the
  // matching fix in SettingsScreen ($upgradeButton, ba05fea) — that button sits on
  // the screen background, where `card` is the elevated surface, but this one sits
  // ON a `card` modal, so `card` here would be fill-on-identical-fill (white on
  // white in light, #1A1A1C on #1A1A1C in dark) leaving only the border and glow.
  // `background` contrasts against the card in both themes and keeps the near-black
  // look this button originally had in dark mode.
  backgroundColor: colors.background,
  borderWidth: 1.5,
  borderColor: colors.tint,
  borderRadius: 10,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $saveButtonDisabled: ThemedStyle<ViewStyle> = ({ colors }) => ({
  opacity: 0.5,
  borderColor: colors.border,
  shadowOpacity: 0,
  elevation: 0,
})

const $saveButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 15,
  fontWeight: "600",
})

const $saveButtonTextDisabled: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
})
