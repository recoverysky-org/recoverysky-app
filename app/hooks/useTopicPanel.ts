/**
 * useTopicPanel — state, animation, and persistence for the post-attendance
 * topic/host panel.
 *
 * EXTRACTED 2026-08-05 from SchedulePopup so InPersonPopup renders the same
 * panel rather than a second copy. The extraction is worth doing for exactly
 * one reason: dismissKeyboardAndSettle() below. A hand-written second copy
 * would have to independently remember to serialize keyboard-hide before
 * slide-out, and forgetting is a native crash, not a visual glitch.
 *
 * What deliberately does NOT live here: the "acknowledged" subscription and
 * the confirmation UI it drives. SchedulePopup shows an animated banner,
 * InPersonPopup shows a toast — genuinely different, and each popup keeps its
 * own.
 *
 * CHANGED 2026-08-06: that last paragraph's premise is gone — InPersonPopup
 * now shows the same in-card banner, so the two are duplicates rather than
 * genuinely different. They still live in the popups (moving them here means
 * the hook owning host-card chrome, which is a wider job than it has), but a
 * third venue is the trigger to extract them; two copies is the ceiling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Dimensions, Easing, LayoutChangeEvent, ViewStyle } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"

import type { TopicPanelOverlayProps } from "@/components/TopicPanelOverlay"
import { attendanceEvents, attendanceRepo } from "@/db"
import { useProfileStore } from "@/models"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useTopicPanel" })

/**
 * Dismiss the keyboard and wait for it to fully settle, capped at 400 ms
 * (> iOS's ~250 ms hide animation) so we never hang if the event doesn't fire.
 *
 * MUST run before the panel slides out. Without it, three layout systems
 * mutate the same subtree on one frame — keyboard-controller's Reanimated
 * KeyboardAvoidingView animating off the keyboard-height shared value, the
 * translateY/cardExpansion tween, and the topicActive reconcile — and
 * Reanimated's per-frame shadow-tree clone reads a prop map the others just
 * freed. Result: EXC_BAD_ACCESS in folly::dynamic::hash
 * (cloneShadowTreeWithNewPropsRecursive). Serializing hide → slide is the fix.
 */
async function dismissKeyboardAndSettle(): Promise<void> {
  await Promise.race([
    KeyboardController.dismiss(),
    new Promise<void>((resolve) => setTimeout(resolve, 400)),
  ])
}

export interface UseTopicPanelOptions {
  /** The host popup is open. */
  visible: boolean
  meetingId?: string
  meetingName?: string
  /** Also prompt for a host. True for both callers today. */
  includeHost: boolean
}

export interface UseTopicPanelResult {
  topicActive: boolean
  /** Spread onto the host popup's own Animated.View card. */
  cardAnimatedStyle: Animated.WithAnimatedObject<ViewStyle>
  /** Pass as the host card's onLayout — measures the panel's slide distance. */
  onCardLayout: (event: LayoutChangeEvent) => void
  /** Spread onto <TopicPanelOverlay />. */
  panelProps: TopicPanelOverlayProps
}

export function useTopicPanel(options: UseTopicPanelOptions): UseTopicPanelResult {
  const { visible, meetingId, meetingName, includeHost } = options
  const profileStore = useProfileStore()

  const [topicActive, setTopicActive] = useState(false)
  const topicContextRef = useRef<{ attendanceId: string; mid: string } | null>(null)
  const [contentHeight, setContentHeight] = useState(0)

  // Panel slide + fade. Native driver: transform and opacity only.
  const topicProgress = useRef(new Animated.Value(0)).current

  // Separate driver for the HOST CARD's expansion: when the panel is active
  // the card grows to full screen so the editor gets the whole canvas. This
  // one is useNativeDriver:false because minHeight/maxHeight/borderRadius are
  // layout props and are not native-drivable. This is the one piece that
  // cannot be encapsulated in the overlay component — a child cannot restyle
  // its parent — which is why the hook hands the style back out.
  const cardExpansion = useRef(new Animated.Value(0)).current
  const screenHeight = useMemo(() => Dimensions.get("window").height, [])

  useEffect(() => {
    Animated.parallel([
      Animated.timing(topicProgress, {
        toValue: topicActive ? 1 : 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardExpansion, {
        toValue: topicActive ? 1 : 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start()
  }, [topicActive, topicProgress, cardExpansion])

  // Reset each time a fresh popup opens or the meeting changes. Without this,
  // a prior meeting's pending context bleeds into the next one.
  useEffect(() => {
    if (visible) {
      setTopicActive(false)
      topicContextRef.current = null
      topicProgress.setValue(0)
      cardExpansion.setValue(0)
    }
  }, [visible, meetingId, topicProgress, cardExpansion])

  // On a valid "processed" event for this meeting: slide the panel in when
  // topic capture is on, otherwise emit "acknowledged" immediately so the
  // host popup's confirmation UI fires without waiting on a panel that will
  // never appear.
  useEffect(() => {
    if (!visible || !meetingId) return

    const unsub = attendanceEvents.subscribe((event) => {
      if (event.mid !== meetingId) return
      if (event.type !== "processed" || !event.valid) return

      if (profileStore.enableMeetingTopic) {
        topicContextRef.current = { attendanceId: event.id, mid: event.mid }
        setTopicActive(true)
      } else {
        attendanceEvents.emit({
          type: "acknowledged",
          id: event.id,
          mid: event.mid,
          valid: true,
        })
      }
    })

    return unsub
  }, [visible, meetingId, profileStore])

  const handleTopicSave = useCallback(async ({ topic, host }: { topic: string; host?: string }) => {
    const pending = topicContextRef.current
    if (!pending) return
    topicContextRef.current = null

    // Keyboard first, THEN the slide — see dismissKeyboardAndSettle's comment.
    await dismissKeyboardAndSettle()
    setTopicActive(false)

    try {
      const result = await attendanceRepo.update(pending.attendanceId, {
        meetingTopic: topic,
        ...(host ? { meetingHost: host } : {}),
      })
      if (!result.ok) {
        log.error("Failed to persist meeting topic/host", { attendanceId: pending.attendanceId })
      } else {
        log.info("Meeting topic saved", { attendanceId: pending.attendanceId, hasHost: !!host })
      }
    } catch (err) {
      log.error("Failed to persist meeting topic/host", {
        attendanceId: pending.attendanceId,
        error: String(err),
      })
    }

    // Emitted even when the update failed: the attendance record itself is
    // already durable, and holding the user's confirmation hostage to an
    // optional field would make a saved meeting look unsaved.
    attendanceEvents.emit({
      type: "acknowledged",
      id: pending.attendanceId,
      mid: pending.mid,
      valid: true,
    })
  }, [])

  const handleTopicSkip = useCallback(async () => {
    const pending = topicContextRef.current
    topicContextRef.current = null
    // Same teardown ordering as handleTopicSave, same crash avoided.
    await dismissKeyboardAndSettle()
    setTopicActive(false)
    if (pending) {
      attendanceEvents.emit({
        type: "acknowledged",
        id: pending.attendanceId,
        mid: pending.mid,
        valid: true,
      })
    }
  }, [])

  const cardAnimatedStyle = useMemo(
    () => ({
      minHeight: cardExpansion.interpolate({
        inputRange: [0, 1],
        outputRange: [0, screenHeight],
      }),
      maxHeight: cardExpansion.interpolate({
        inputRange: [0, 1],
        outputRange: [screenHeight * 0.85, screenHeight],
      }),
      borderTopLeftRadius: cardExpansion.interpolate({
        inputRange: [0, 1],
        outputRange: [20, 0],
      }),
      borderTopRightRadius: cardExpansion.interpolate({
        inputRange: [0, 1],
        outputRange: [20, 0],
      }),
    }),
    [cardExpansion, screenHeight],
  )

  const onCardLayout = useCallback((event: LayoutChangeEvent) => {
    setContentHeight(event.nativeEvent.layout.height)
  }, [])

  return {
    topicActive,
    cardAnimatedStyle,
    onCardLayout,
    panelProps: {
      active: topicActive,
      meetingName,
      includeHost,
      progress: topicProgress,
      contentHeight,
      onSave: handleTopicSave,
      onSkip: handleTopicSkip,
    },
  }
}
