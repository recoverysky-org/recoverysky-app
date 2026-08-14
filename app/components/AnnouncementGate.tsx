/**
 * AnnouncementGate
 *
 * Shows a one-time, blocking announcement modal. Evaluates on mount and on
 * every app foreground (AppState → "active"); picks the first unseen
 * announcement that passes all display gates (see selectPendingAnnouncement)
 * and renders it. Dismiss or CTA both persist the id via markAnnouncementSeen,
 * so each announcement shows exactly once.
 *
 * Mounted as a sibling to the app's other overlays in app.tsx. It reads only
 * MMKV-backed stores (no SQLite), so it has no DB-ready dependency and is safe
 * to fire on any foreground.
 */
import { FC, useCallback, useEffect, useState } from "react"
import { AppState, Modal, Pressable, StyleSheet, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Text } from "@/components/Text"
import { ANNOUNCEMENTS, type Announcement } from "@/config/announcements"
import { useSubscription } from "@/context/SubscriptionContext"
import { useAuthenticationStore, useConfigStore, useProfileStore } from "@/models"
import { navigate } from "@/navigators/navigationUtilities"
import { loadTimerSession } from "@/services/attendance"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { selectPendingAnnouncement, shouldShowCta } from "@/utils/announcementLogic"

export const AnnouncementGate: FC = observer(function AnnouncementGate() {
  const profileStore = useProfileStore()
  const authStore = useAuthenticationStore()
  const configStore = useConfigStore()
  const { hasAttendance } = useSubscription()
  const { themed, theme } = useAppTheme()

  const [active, setActive] = useState<Announcement | null>(null)

  const evaluate = useCallback(() => {
    // A modal is already up — don't stack a second one.
    if (active) return
    const pending = selectPendingAnnouncement({
      announcements: ANNOUNCEMENTS,
      seenIds: profileStore.seenAnnouncementIds.slice(),
      isAuthenticated: authStore.isAuthenticated,
      onboardingCompleted: profileStore.onboardingCompleted,
      outageMode: configStore.outageMode,
      // Non-null persisted timer session ⇒ an in-meeting timer is live; never
      // cover it. Re-read on each evaluation so a mid-timer foreground is
      // suppressed but a later clean foreground still shows the popup.
      timerSessionActive: loadTimerSession() !== null,
    })
    if (pending) setActive(pending)
  }, [active, profileStore, authStore, configStore])

  useEffect(() => {
    evaluate()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") evaluate()
    })
    return () => sub.remove()
  }, [evaluate])

  const dismiss = useCallback(() => {
    if (active) profileStore.markAnnouncementSeen(active.id)
    setActive(null)
  }, [active, profileStore])

  const handleCta = useCallback(() => {
    if (!active?.cta) return
    profileStore.markAnnouncementSeen(active.id)
    if (active.cta.target === "cloudBackupSettings") {
      // `navigate` (not navigationRef.navigate directly): it casts the nested
      // "Settings" tab route past the root-stack param types AND queues the
      // navigation if the container isn't ready yet.
      navigate("Settings", { section: "cloudBackup" })
    } else if (active.cta.target === "inPersonMeetings") {
      // The `segment` param is required, not optional flavour: MeetingsScreen
      // defaults to "live" when none is supplied, so omitting it would land the
      // user on Live and show them nothing the announcement just described.
      navigate("Meetings", { segment: "inperson" })
    }
    setActive(null)
  }, [active, profileStore])

  if (!active) return null

  const showCta = shouldShowCta(active, hasAttendance)

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <View style={themed($overlay)}>
        {/* Backdrop is NOT pressable — this is a blocking dialog; the user must
            use a button so we always record the announcement as seen. */}
        <View style={themed($backdrop)} />

        <View style={themed($card)} accessibilityViewIsModal>
          <View style={themed($header)}>
            <Ionicons
              name={(active.icon ?? "megaphone-outline") as keyof typeof Ionicons.glyphMap}
              size={24}
              color={theme.colors.tint}
            />
            <Text style={themed($title)} tx={active.titleTx} />
          </View>

          <Text style={themed($body)} tx={active.bodyTx} />

          {showCta && active.cta && (
            <Pressable onPress={handleCta} style={themed($ctaButton)} accessibilityRole="button">
              <Text style={themed($ctaButtonText)} tx={active.cta.labelTx} />
            </Pressable>
          )}

          <Pressable onPress={dismiss} style={themed($dismissButton)} accessibilityRole="button">
            <Text style={themed($dismissButtonText)} tx="announcements:dismiss" />
          </Pressable>
        </View>
      </View>
    </Modal>
  )
})

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
  gap: spacing.md,
})

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 17,
  fontWeight: "700",
  color: colors.text,
})

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  lineHeight: 20,
  color: colors.text,
})

const $ctaButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.sm,
  backgroundColor: colors.tint,
  borderRadius: 10,
  marginTop: spacing.sm,
})

const $ctaButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.background,
  fontSize: 15,
  fontWeight: "700",
})

const $dismissButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xs,
})

const $dismissButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 15,
  fontWeight: "600",
})
