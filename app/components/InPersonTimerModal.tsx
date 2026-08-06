/**
 * InPersonTimerModal
 *
 * Runs the attendance timer for a GPS-verified in-person meeting. Opened by
 * InPersonPopup only after usePresenceCheck returns `verified`, and by
 * TimerRecoveryGate when a persisted in-person session survives a cold start.
 *
 * Structurally identical to ExternalZoomTimerModal minus the launcher: there
 * is no app to open, so the timer simply starts. Both share useAttendanceTimer,
 * so the clock, foreground resync, persistence, resume, and save lock are one
 * implementation.
 *
 * Verification happens BEFORE this modal mounts and is never repeated at Save.
 * A user who ends a meeting in a basement with no signal must not be blocked
 * from recording time they already spent — see the spec's decision table.
 */

import { FC, useEffect, useMemo, useState } from "react"
import { Alert, Modal, Pressable, StyleSheet, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAttendanceTimer } from "@/hooks/useAttendanceTimer"
import { translate } from "@/i18n"
import { useAuthenticationStore } from "@/models"
import { navigate } from "@/navigators/navigationUtilities"
import {
  clearTimerSession,
  loadTimerSession,
  sessionSource,
  type PersistedPresence,
} from "@/services/attendance"
import { saveInPersonTimerAttendance } from "@/services/inPerson/timerAttendance"
import { EXTERNAL_MIN_CREDIT_MS } from "@/services/zoom"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"
import { load, save } from "@/utils/storage"

const log = logger.child({ module: "InPersonTimerModal" })

// Shared with ExternalZoomTimerModal — same threshold, same MMKV flag, so a
// user who dismissed the notice on one path never sees it on the other.
const LONG_ATTENDANCE_NOTICE_MS = 2 * 60 * 60 * 1000
const LONG_ATTENDANCE_NOTICE_DISMISSED_KEY = "long-attendance-notice-dismissed-v1"

interface InPersonMeetingTarget {
  id: string
  name: string
  zid: string
}

interface InPersonTimerModalProps {
  visible: boolean
  meeting: InPersonMeetingTarget | null
  /** The verified fix from usePresenceCheck. Persisted so a cold start keeps it. */
  presence: PersistedPresence | null
  /** Fired for any dismissal — Save or Cancel. */
  onClose: () => void
  /** Fired only on a successful Save, so the parent can react to a real commit. */
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

export const InPersonTimerModal: FC<InPersonTimerModalProps> = ({
  visible,
  meeting,
  presence,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const authStore = useAuthenticationStore()

  const [saving, setSaving] = useState(false)

  const meetingId = meeting?.id
  const meetingName = meeting?.name
  const uid = authStore.userId || "anonymous"

  const { startedAt, elapsed, isResume, beginSave, endSave } = useAttendanceTimer({
    active: visible && !!meetingId && !!presence,
    sessionKey: meetingId ?? "",
    // A persisted session belongs to THIS timer only when its source is
    // "in-person" — the external-Zoom sibling gates on "external-zoom" for the
    // same reason. Without this source check, a recovered Zoom session (same
    // meetingId, different venue type) would get adopted here and saved as
    // in-person attendance, which would falsely claim a GPS-verified presence
    // that was never checked.
    matchesPersisted: (s) => sessionSource(s) === "in-person" && s.meetingId === meetingId,
    buildSession: (start) => ({
      startedAt: start,
      uid,
      meetingId: meetingId!,
      meetingName: meetingName ?? "",
      source: "in-person",
      presence: presence!,
      // Carried so a cold-start recovery (TimerRecoveryGate, Task 11) can
      // write the attendance record without a URL to re-derive zid from.
      zid: meeting?.zid ?? "",
    }),
    // No onStart: unlike ExternalZoomTimerModal, this modal launches nothing.
    // The user is already physically at the venue — usePresenceCheck already
    // verified that before this modal ever mounts — so the timer just starts.
    // This is the one structural difference from the Zoom sibling.
  })

  // ADDED 2026-08-05 (Task 3 review): mirror the Zoom modal's resume log. The
  // resume branch has no automated coverage and is the one documented in
  // TimerSessionResumer as having cost customers their attendance — without
  // this line, "we adopted the persisted session" is only provable from Loki
  // by its absence. Logged here rather than through a hook callback because a
  // callback would have to hand over the whole PersistedTimerSession, which
  // carries a `presence` GPS fix that must never reach Loki. Log scalars only
  // (mid, startedAt, elapsedMs) — never the session object.
  //
  // `meetingId` is included in the deps array: this effect only logs, it
  // holds no timer state, so re-firing on a meetingId change costs nothing —
  // same reasoning ExternalZoomTimerModal's equivalent effect documents.
  // exhaustive-deps is a registered warning in this repo (via `extends:
  // ["expo"]"); satisfying it here is free, so there's no reason not to.
  useEffect(() => {
    if (!isResume || !startedAt) return
    log.info("In-person timer resumed from persisted session", {
      mid: meetingId,
      startedAt,
      elapsedMs: Date.now() - startedAt,
    })
  }, [isResume, startedAt, meetingId])

  const minMinutes = Math.ceil(EXTERNAL_MIN_CREDIT_MS / 60000)
  const canSave = elapsed >= EXTERNAL_MIN_CREDIT_MS && !saving

  const handleSave = async () => {
    if (!meeting || !startedAt || !canSave) return
    if (!beginSave()) return
    setSaving(true)

    const endedAt = Date.now()

    // The PERSISTED presence wins over the prop. On a recovered session the
    // prop is whatever TimerRecoveryGate reconstructed, but the persisted
    // block is the original verification taken at the venue — that is the one
    // the record must carry.
    const persisted = loadTimerSession()
    const verified = persisted?.presence ?? presence
    if (!verified) {
      // Cannot happen via either entry point (both require a verified fix),
      // but writing an unverified record would silently break the feature's
      // one promise, so refuse instead.
      log.error("In-person save reached with no verified presence", { mid: meeting.id })
      endSave()
      setSaving(false)
      onClose()
      return
    }

    // PRIVACY: mid + credit only. Never log `verified` — it carries the GPS fix.
    log.info("Saving in-person timer attendance", {
      mid: meeting.id,
      creditMs: endedAt - startedAt,
    })

    try {
      const result = await saveInPersonTimerAttendance({
        uid,
        mid: meeting.id,
        // Falls back to "" like the Zoom path (extractZoomMeetingNumber(...)
        // ?? "") and Task 11's recovery code — three call sites writing the
        // same field should agree on the fallback rather than each deciding
        // separately. Nothing downstream branches on zid: it's absent from
        // the SQLite schema's indexed/matched columns and unused by
        // syncLogic.ts or useReportSender.ts, so an empty string here is a
        // no-op, not a latent bug.
        zid: meeting.zid ?? "",
        meetingName: meeting.name,
        startedAt,
        endedAt,
        presence: verified,
      })

      if (!result.ok) {
        log.error("In-person timer attendance save returned not ok", { mid: meeting.id })
        // Keep the persisted session so TimerSessionResumer can recover it on
        // the next cold start rather than silently dropping the attempt.
        onClose()
        return
      }

      clearTimerSession()

      // Heads-up for very long sessions — the user probably forgot to end the
      // timer. Non-blocking: the attendance is already saved, this just points
      // at the trim-down path. Shares the MMKV dismissed flag with the Zoom
      // timer's identical notice.
      const creditMs = endedAt - startedAt
      const dismissed = load<boolean>(LONG_ATTENDANCE_NOTICE_DISMISSED_KEY) === true
      if (creditMs > LONG_ATTENDANCE_NOTICE_MS && !dismissed) {
        // Mirrors ExternalZoomTimerModal's three long-attendance-notice logs
        // (shown / dismissed-permanently / navigated-away). Scalars only.
        log.info("Showing in-person long-attendance notice", {
          mid: meeting.id,
          creditMs,
        })
        Alert.alert(
          translate("externalZoomTimer:longAttendanceTitle"),
          translate("externalZoomTimer:longAttendanceMessage"),
          [
            { text: translate("common:ok"), style: "cancel" },
            {
              text: translate("externalZoomTimer:longAttendanceDontShow"),
              style: "destructive",
              onPress: () => {
                save(LONG_ATTENDANCE_NOTICE_DISMISSED_KEY, true)
                log.info("User dismissed in-person long-attendance notice permanently")
              },
            },
            {
              text: translate("externalZoomTimer:longAttendanceGoTo"),
              onPress: () => {
                log.info("User chose to navigate to Attendance from in-person notice")
                navigate("Attendance", { section: "new" })
              },
            },
          ],
        )
      }

      if (result.attendanceId && onSaved) {
        onSaved(result.attendanceId)
      } else {
        onClose()
      }
    } catch (err) {
      // The timer modal must NEVER get stuck open. The record is written
      // before any event is emitted, so by the time anything downstream could
      // throw the attendance is already persisted — and even if the write
      // itself failed, trapping the user in a frozen modal is worse. An
      // un-cleared session is recoverable on the next launch.
      log.error("In-person timer save flow threw — closing modal defensively", {
        mid: meeting?.id,
        error: err instanceof Error ? err.message : String(err),
      })
      onClose()
    } finally {
      endSave()
      setSaving(false)
    }
  }

  const handleCancel = () => {
    // Below the credit floor there is nothing to lose — close immediately.
    if (elapsed < EXTERNAL_MIN_CREDIT_MS) {
      // Mirrors ExternalZoomTimerModal's cancel-below-threshold log. Scalars
      // only (mid, elapsed duration) — never `presence`, which this modal
      // holds for its whole life.
      log.info("In-person timer cancelled below credit threshold", {
        mid: meeting?.id,
        elapsedMs: elapsed,
      })
      clearTimerSession()
      onClose()
      return
    }
    // Above it, an accidental dismissal would silently discard a saveable
    // session. Confirm first.
    Alert.alert(
      translate("externalZoomTimer:cancelTitle"),
      translate("externalZoomTimer:cancelMessage", { minutes: Math.floor(elapsed / 60000) }),
      [
        { text: translate("externalZoomTimer:keepRunning"), style: "cancel" },
        {
          text: translate("externalZoomTimer:save"),
          onPress: () => {
            void handleSave()
          },
        },
        {
          text: translate("externalZoomTimer:discard"),
          style: "destructive",
          onPress: () => {
            // Mirrors ExternalZoomTimerModal's discard-after-confirm log.
            log.info("In-person timer discarded after confirm", {
              mid: meeting?.id,
              elapsedMs: elapsed,
            })
            clearTimerSession()
            onClose()
          },
        },
      ],
    )
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
        {/* Non-dismissible backdrop — a stray tap outside the card must not
            throw away an in-progress timer. Closing goes through the buttons
            or the hardware back button, which routes to handleCancel. */}
        <View style={themed($backdrop)} />

        <View style={themed($card)} accessibilityViewIsModal>
          <View style={themed($header)}>
            <Ionicons name="timer-outline" size={20} color={theme.colors.tint} />
            <Text style={themed($title)} tx="inPersonTimer:title" />
          </View>

          {!!meeting?.name && (
            <Text style={themed($meetingName)} numberOfLines={2}>
              {meeting.name}
            </Text>
          )}

          <Text style={themed($timer)} accessibilityLabel={formatted}>
            {formatted}
          </Text>

          <Text style={themed($hint)} tx="inPersonTimer:hint" txOptions={{ minutes: minMinutes }} />

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
              onPress={() => {
                void handleSave()
              }}
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

// Copied verbatim from ExternalZoomTimerModal 2026-08-05. The two timers must
// look identical — a user who has used both should not feel the layout shift.
// Copied rather than imported: they are module-private there, and exporting
// them to share would couple the two components for no benefit. If you restyle
// one timer, restyle both.

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
