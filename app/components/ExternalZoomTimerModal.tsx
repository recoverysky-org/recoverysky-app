/**
 * ExternalZoomTimerModal
 *
 * Shown when the user joins a meeting with "Use External Zoom" enabled.
 * Launches the external Zoom app immediately on mount and runs a timer the
 * user can Save or Cancel when they return. Save writes a valid attendance
 * record (gated on EXPO_PUBLIC_MIN_CREDIT_MINUTES) via saveTimerAttendance.
 */

import { FC, useEffect, useMemo, useRef, useState } from "react"
import {
  AppState,
  type AppStateStatus,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAuthenticationStore } from "@/models"
import { EXTERNAL_MIN_CREDIT_MS, saveTimerAttendance } from "@/services/zoom"
import { extractZoomMeetingNumber } from "@/services/zoom/useZoomMeeting"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ExternalZoomTimerModal" })

interface MeetingTarget {
  id: string
  name: string
  url: string
}

interface ExternalZoomTimerModalProps {
  visible: boolean
  meeting: MeetingTarget | null
  /** Fired for any dismissal — Save, Cancel, or backdrop tap. */
  onClose: () => void
  /**
   * Fired only when the user taps Save and the attendance record was written
   * successfully. Parent uses this to distinguish a real commit (which can
   * trigger the topic/host prompt) from a cancel/dismiss.
   */
  onSaved?: (attendanceId: string) => void
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export const ExternalZoomTimerModal: FC<ExternalZoomTimerModalProps> = ({
  visible,
  meeting,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const authStore = useAuthenticationStore()

  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [saving, setSaving] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const minMinutes = Math.ceil(EXTERNAL_MIN_CREDIT_MS / 60000)
  const canSave = elapsed >= EXTERNAL_MIN_CREDIT_MS && !saving

  // Launch external Zoom + start timer on open
  useEffect(() => {
    if (!visible || !meeting) return

    const start = Date.now()
    setStartedAt(start)
    setElapsed(0)
    log.info("Timer started, launching external Zoom", {
      mid: meeting.id,
      url: meeting.url,
    })

    // Fire and forget — failures surface in logs; the timer still runs so the
    // user can retry opening Zoom manually if the first launch fails.
    Linking.openURL(meeting.url).catch((err: unknown) => {
      log.error("Failed to launch external Zoom", { error: String(err) })
    })

    const tick = () => setElapsed(Date.now() - start)
    intervalRef.current = setInterval(tick, 1000)

    // Resync on foreground — intervals in JS can drift or pause when backgrounded
    const appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") tick()
    })

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      appStateSub.remove()
      setStartedAt(null)
      setElapsed(0)
    }
  }, [visible, meeting])

  const handleSave = async () => {
    if (!meeting || !startedAt || !canSave) return
    setSaving(true)
    const endedAt = Date.now()
    log.info("Saving timer attendance", {
      mid: meeting.id,
      startedAt,
      endedAt,
      creditMs: endedAt - startedAt,
    })
    const result = await saveTimerAttendance({
      uid: authStore.userId || "anonymous",
      mid: meeting.id,
      zid: extractZoomMeetingNumber(meeting.url) ?? "",
      meetingName: meeting.name,
      startedAt,
      endedAt,
    })
    setSaving(false)
    if (!result.ok) {
      log.error("Timer attendance save returned not ok", { mid: meeting.id })
      onClose()
      return
    }
    // Only notify the parent of a successful Save — lets the parent
    // distinguish this from a Cancel and trigger the topic/host prompt.
    if (result.attendanceId && onSaved) {
      onSaved(result.attendanceId)
    } else {
      onClose()
    }
  }

  const handleCancel = () => {
    log.info("Timer cancelled", { mid: meeting?.id, elapsedMs: elapsed })
    onClose()
  }

  const formatted = useMemo(() => formatElapsed(elapsed), [elapsed])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
      statusBarTranslucent
    >
      <View style={themed($overlay)}>
        <Pressable style={themed($backdrop)} onPress={handleCancel} />

        <View style={themed($card)} accessibilityViewIsModal>
          <View style={themed($header)}>
            <Ionicons name="timer-outline" size={20} color={theme.colors.tint} />
            <Text style={themed($title)} tx="externalZoomTimer:title" />
          </View>

          {meeting?.name && (
            <Text style={themed($meetingName)} numberOfLines={2}>
              {meeting.name}
            </Text>
          )}

          <Text style={themed($timer)}>{formatted}</Text>

          <Text
            style={themed($hint)}
            tx="externalZoomTimer:hint"
            txOptions={{ minutes: minMinutes }}
          />

          <View style={themed($buttonRow)}>
            <Pressable
              onPress={handleCancel}
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
              accessibilityState={{ disabled: !canSave }}
              accessibilityLabel={t("externalZoomTimer:save")}
            >
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={canSave ? theme.colors.tint : theme.colors.textDim}
              />
              <Text
                style={[themed($saveButtonText), !canSave && themed($saveButtonTextDisabled)]}
                tx="externalZoomTimer:save"
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

const $timer: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 48,
  lineHeight: 56,
  fontWeight: "700",
  fontVariant: ["tabular-nums"],
  color: colors.text,
  marginVertical: spacing.sm,
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
  backgroundColor: "#000",
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
