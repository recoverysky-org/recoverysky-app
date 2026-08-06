/**
 * TopicPanelOverlay
 *
 * The slide-up panel that captures a meeting topic (and host) after
 * attendance is recorded. Rendered INSIDE the host popup's card — NOT as its
 * own RN Modal — because presenting a second native modal while another is
 * mid-dismiss is silently refused by iOS. That is the race that killed the
 * original standalone TopicPromptModal.
 *
 * EXTRACTED 2026-08-05 from SchedulePopup so the in-person popup can render
 * the identical panel instead of a second hand-written copy. All state and
 * animation lives in useTopicPanel; this is the render half only.
 */

import { FC } from "react"
import { Animated, StyleSheet, ViewStyle } from "react-native"
// react-native-keyboard-controller's KeyboardAvoidingView is a drop-in
// replacement for RN's that reads the actual keyboard frame from the
// native side and handles Android + edge-to-edge correctly. Using RN's
// KeyboardAvoidingView with behavior="height" on Android caused a flash
// + scroll feedback loop because it competed with the OS adjustResize
// AND the parent Animated.View's non-native-driver layout animation —
// three layout systems racing on every keyboard frame.
// RESTORED 2026-08-05: this note didn't survive the move from SchedulePopup
// and matters more here — Animated/StyleSheet/ViewStyle are imported from
// react-native one line above, which makes "just import KeyboardAvoidingView
// from react-native too, tidier" a plausible, silently-wrong future edit.
import { KeyboardAvoidingView } from "react-native-keyboard-controller"

import { TopicPromptContent } from "@/components/TopicPromptContent"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export interface TopicPanelOverlayProps {
  active: boolean
  meetingName?: string
  includeHost: boolean
  /** Native-driver translate + opacity driver, produced by useTopicPanel. */
  progress: Animated.Value
  /** Host card height, measured by useTopicPanel's onCardLayout. */
  contentHeight: number
  onSave: (result: { topic: string; host?: string }) => void
  onSkip: () => void
}

export const TopicPanelOverlay: FC<TopicPanelOverlayProps> = ({
  active,
  meetingName,
  includeHost,
  progress,
  contentHeight,
  onSave,
  onSkip,
}) => {
  const { themed } = useAppTheme()

  return (
    <Animated.View
      pointerEvents={active ? "auto" : "none"}
      style={[
        themed($topicOverlay),
        {
          opacity: progress,
          // Until the host card has been measured, park the panel far
          // off-screen rather than at translateY 0 — otherwise it flashes
          // over the card on the first frame.
          transform:
            contentHeight > 0
              ? [
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [contentHeight, 0],
                    }),
                  },
                ]
              : [{ translateY: 9999 }],
        },
      ]}
    >
      <KeyboardAvoidingView
        style={themed($topicKeyboardAvoider)}
        // `padding` on BOTH platforms. This was conditional on Platform.OS
        // with "height" on Android, which double-resized against the OS and
        // against the parent's layout animation. The keyboard-controller KAV
        // normalizes via the native KeyboardEvent stream, so padding is
        // correct everywhere.
        behavior="padding"
      >
        <TopicPromptContent
          active={active}
          meetingName={meetingName}
          includeHost={includeHost}
          onSave={onSave}
          onSkip={onSkip}
        />
      </KeyboardAvoidingView>
    </Animated.View>
  )
}

// Slide-in panel that covers the popup body while the topic prompt is active.
// Matches the content card's background so the transition feels like the
// popup's contents swapping rather than a layered modal.
const $topicOverlay: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  ...StyleSheet.absoluteFillObject,
  backgroundColor: colors.background,
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  paddingTop: spacing.md,
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.xl,
})

// KeyboardAvoidingView handles vertical centering so that when the keyboard
// appears, the topic card lifts above it instead of being half-covered.
const $topicKeyboardAvoider: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  justifyContent: "center",
})
