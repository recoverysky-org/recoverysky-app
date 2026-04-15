/**
 * SchedulePopup Component
 *
 * Modal popup showing meeting details and weekly schedule grid.
 * Displays:
 * - Meeting name with live indicator
 * - Fellowship badge (color-coded)
 * - Time, meeting count, language
 * - Meeting types (tags)
 * - Join Meeting button
 * - Favorite heart (UI only)
 * - 5-star rating (UI only)
 * - Weekly schedule grid
 */

import { FC, useMemo, useState, useEffect, useCallback, useRef } from "react"
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Platform,
  View,
  ViewStyle,
  TextStyle,
  Modal,
  Pressable,
  StyleSheet,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useIsFocused } from "@react-navigation/native"
import { FELLOWSHIP_COLORS, DateTime, Fellowship } from "@recoverysky-org/common/browser"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { ExternalZoomTimerModal } from "@/components/ExternalZoomTimerModal"
import { ReminderEditorModal } from "@/components/ReminderEditorModal"
import { ScheduleGrid } from "@/components/ScheduleGrid"
import { Text } from "@/components/Text"
import { TopicPromptContent } from "@/components/TopicPromptContent"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useSubscription } from "@/context/SubscriptionContext"
import {
  attendanceEvents,
  attendanceRepo,
  feedbackCache,
  type FeedbackRecord,
  type ReminderRecord,
} from "@/db"
import { useReminders } from "@/hooks/useReminders"
import { useProfileStore } from "@/models"
import { navigate } from "@/navigators/navigationUtilities"
import { trackEvent } from "@/services/tracking"
import { useZoomMeeting, extractZoomMeetingNumber, buildExternalZoomUrl } from "@/services/zoom"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { formatMillisToLocalTime } from "@/utils/formatTime"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "SchedulePopup" })

interface SchedulePopupProps {
  visible: boolean
  meeting: MeetingWithTrex | null
  onClose: () => void
}

export const SchedulePopup: FC<SchedulePopupProps> = observer(function SchedulePopup({
  visible,
  meeting,
  onClose,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const isFocused = useIsFocused()

  // Auto-close when parent screen loses focus (e.g. navigating to Settings from review prompt)
  useEffect(() => {
    if (!isFocused && visible) onClose()
  }, [isFocused, visible, onClose])
  const { joinMeeting, isJoining, isSDKReady } = useZoomMeeting()
  const { isPremium } = useSubscription()
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)

  // External Zoom timer modal state
  const [timerVisible, setTimerVisible] = useState(false)

  // Topic/host prompt shown after attendance is recorded for this meeting.
  // Rendered INLINE as a slide-up panel over the popup's body so it doesn't
  // present a new RN Modal during the Zoom SDK's native dismiss animation
  // (which iOS silently refuses). Both SDK and external paths funnel through
  // the shared `attendanceEvents` "processed" subscription below.
  const [topicActive, setTopicActive] = useState(false)
  const topicContextRef = useRef<{ attendanceId: string; mid: string } | null>(null)
  const attendanceSourceRef = useRef<"sdk" | "external" | null>(null)

  // Slide animation for the topic panel. `progress` is 0 when hidden
  // (translated below the card) and 1 when fully shown. We measure the
  // popup card's layout height so the panel can translate by exactly that
  // amount, keeping native-driver transforms.
  const topicProgress = useRef(new Animated.Value(0)).current
  const [contentHeight, setContentHeight] = useState(0)

  // Separate driver for the card's own expansion: when the topic panel is
  // active we grow the popup card to full screen so the topic editor gets
  // the whole canvas. Uses `useNativeDriver: false` because layout props
  // (minHeight/maxHeight/border radius) aren't native-drivable.
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

  // Reset the topic panel each time a fresh popup opens or the meeting
  // changes. Without this, a prior meeting's source/context could bleed
  // into the next one.
  useEffect(() => {
    if (visible) {
      setTopicActive(false)
      topicContextRef.current = null
      attendanceSourceRef.current = null
      topicProgress.setValue(0)
      cardExpansion.setValue(0)
    }
  }, [visible, meeting?.id, topicProgress, cardExpansion])

  // Reminder state
  const [reminderEditorVisible, setReminderEditorVisible] = useState(false)
  const [editingReminder, setEditingReminder] = useState<ReminderRecord | null>(null)
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)
  const {
    reminderCells,
    createReminder,
    updateReminder,
    deleteReminder,
    findExistingReminder,
    checkOverlap,
  } = useReminders(visible ? meeting : null, meeting?.sid ?? "")

  // Handle schedule grid cell tap → open reminder editor (premium only)
  const handleCellPress = useCallback(
    (_millis: number, id: string, dayIndex: number, rowIndex: number) => {
      if (!isPremium) {
        Alert.alert(t("reminderEditor:premiumTitle"), t("reminderEditor:premiumMessage"), [
          { text: t("reminderEditor:cancel"), style: "cancel" },
          {
            text: t("reminderEditor:goToSettings"),
            onPress: () => {
              onClose()
              navigate(
                "Settings" as never,
                {
                  section: "subscription",
                  returnTo: `Meetings:meetingId:${meeting!.id}`,
                } as never,
              )
            },
          },
        ])
        return
      }

      const existing = findExistingReminder(id, dayIndex)
      setEditingReminder(existing)
      setSelectedCell({ row: rowIndex, col: dayIndex })
      setReminderEditorVisible(true)
    },
    [isPremium, findExistingReminder, t, onClose],
  )

  // Local feedback state - initialized from cache, updated on interactions
  const [feedback, setFeedback] = useState<FeedbackRecord | null>(null)

  // Attendance banner state
  const [showBanner, setShowBanner] = useState(false)
  const bannerOpacity = useRef(new Animated.Value(0)).current
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Subscribe to attendance events. The popup owns two reactions:
  //   1. "processed" (valid) → if topic capture is on, slide the topic panel
  //      in; otherwise emit "acknowledged" immediately so the banner fires.
  //   2. "acknowledged" → show the "Attendance Saved" banner.
  useEffect(() => {
    if (!visible || !meeting?.id) return

    const unsub = attendanceEvents.subscribe((event) => {
      if (event.mid !== meeting.id) return

      if (event.type === "processed" && event.valid) {
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
        return
      }

      // Banner fires on "acknowledged" (emitted after the topic panel resolves
      // or immediately when topic capture is disabled) so it never flashes
      // behind the topic UI.
      if (event.type === "acknowledged" && event.valid) {
        setShowBanner(true)
        Animated.timing(bannerOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start()

        // Auto-hide after 4 seconds
        bannerTimeoutRef.current = setTimeout(() => {
          Animated.timing(bannerOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => setShowBanner(false))
        }, 4000)
      }
    })

    return () => {
      unsub()
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current)
    }
  }, [visible, meeting?.id, bannerOpacity, profileStore.enableMeetingTopic])

  // Reset banner when popup closes
  useEffect(() => {
    if (!visible) {
      setShowBanner(false)
      bannerOpacity.setValue(0)
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current)
        bannerTimeoutRef.current = null
      }
    }
  }, [visible, bannerOpacity])

  // Track popup views
  useEffect(() => {
    if (visible && meeting?.id) {
      trackEvent("schedule_popup_viewed", { fellowship: meeting.fellowship || "" })
    }
  }, [visible, meeting?.id])

  // Load feedback from cache when popup opens (synchronous read)
  useEffect(() => {
    if (visible && meeting?.id) {
      const cached = feedbackCache.get(meeting.id)
      setFeedback(cached)
      log.debug("Loaded feedback from cache", { mid: meeting.id, hasValue: !!cached })
    } else {
      setFeedback(null)
    }
  }, [visible, meeting?.id])

  // Derived state from feedback
  const isFavorite = feedback?.loves ?? false
  const rating = feedback?.rates ?? 0
  const joinCount = feedback?.joins ?? 0
  const lastJoin = feedback?.lastJoin ?? 0

  // Toggle love/favorite
  const handleToggleLove = useCallback(async () => {
    if (!meeting?.id) return
    const newLoves = await feedbackCache.toggleLove(meeting.id)
    setFeedback((prev: FeedbackRecord | null) =>
      prev
        ? { ...prev, loves: newLoves }
        : { mid: meeting.id, loves: newLoves, rates: 0, joins: 0, lastJoin: 0 },
    )
    trackEvent("meeting_favorited", { action: newLoves ? "add" : "remove" })
    log.debug("Toggled love", { mid: meeting.id, loves: newLoves })
  }, [meeting?.id])

  // Set rating
  const handleSetRating = useCallback(
    async (star: number) => {
      if (!meeting?.id) return
      await feedbackCache.setRating(meeting.id, star)
      setFeedback((prev: FeedbackRecord | null) =>
        prev
          ? { ...prev, rates: star }
          : { mid: meeting.id, loves: false, rates: star, joins: 0, lastJoin: 0 },
      )
      log.debug("Set rating", { mid: meeting.id, rating: star })
    },
    [meeting?.id],
  )

  // Schedule grid data comes directly from API
  const scheduleGridData = useMemo(() => {
    return meeting?.scheduleData || []
  }, [meeting?.scheduleData])

  // Meeting count from schedule data
  const meetingCount = useMemo(() => {
    if (!scheduleGridData.length) return 0
    // Count non-null entries across all rows
    return scheduleGridData.reduce((count, row) => {
      return count + row.filter((cell) => cell !== null).length
    }, 0)
  }, [scheduleGridData])

  // Current day for highlighting (1=Mon, 7=Sun)
  const currentDow = DateTime.now().weekday

  const fellowshipColor = meeting
    ? FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]
    : "#888"

  const formattedTime = meeting ? formatMillisToLocalTime(meeting.millis) : null

  const handleJoin = async () => {
    if (!meeting?.url || !meeting?.id) return

    // Record the join in feedback BEFORE joining
    await feedbackCache.recordJoin(meeting.id)
    const now = Date.now()
    setFeedback((prev: FeedbackRecord | null) =>
      prev
        ? { ...prev, joins: prev.joins + 1, lastJoin: now }
        : { mid: meeting.id, loves: false, rates: 0, joins: 1, lastJoin: now },
    )
    log.info("Recorded join", { mid: meeting.id, joins: (feedback?.joins ?? 0) + 1 })
    trackEvent("meeting_joined", { fellowship: meeting.fellowship || "" })

    // Extract meeting number from URL
    const meetingNumber = extractZoomMeetingNumber(meeting.url)
    // SDK expects the plaintext passcode, not the encrypted pwd from URLs
    const password = meeting.password || ""

    if (!meetingNumber) {
      // Fallback for non-Zoom URLs
      const { Linking } = await import("react-native")
      await Linking.openURL(meeting.url)
      return
    }

    // External Zoom mode: show timer modal instead of the SDK join flow.
    // The modal itself launches the Zoom app and tracks a user-confirmed
    // attendance window. Skip the timer if the user hasn't opted into
    // attendance tracking — just open Zoom.
    if (profileStore.useExternalZoom) {
      if (profileStore.attendanceEnabled) {
        // Tag the source so the "processed" subscription shows the host
        // field when the topic panel slides in.
        attendanceSourceRef.current = "external"
        setTimerVisible(true)
      } else {
        const { Linking } = await import("react-native")
        const zoomUrl = buildExternalZoomUrl({
          meetingNumber,
          meetingUrl: meeting.url,
          password: meeting.password,
          passwordEnc: meeting.passwordEnc,
        })
        await Linking.openURL(zoomUrl)
      }
      return
    }

    attendanceSourceRef.current = "sdk"
    try {
      await joinMeeting({
        meetingId: meeting.id,
        meetingNumber,
        userName: profileStore.displayName,
        meetingName: meeting.name,
        password,
        passwordEnc: meeting.passwordEnc,
        meetingUrl: meeting.url,
        external: meeting.external,
      })
    } catch {
      // Error handling done in provider
    }
  }

  const handleTopicSave = useCallback(
    async ({ topic, host }: { topic: string; host?: string }) => {
      const pending = topicContextRef.current
      if (!pending) return
      topicContextRef.current = null
      setTopicActive(false)
      try {
        const result = await attendanceRepo.update(pending.attendanceId, {
          meetingTopic: topic,
          ...(host ? { meetingHost: host } : {}),
        })
        if (!result.ok) {
          log.error("Failed to persist meeting topic/host", {
            attendanceId: pending.attendanceId,
          })
        } else {
          log.info("Meeting topic saved", {
            attendanceId: pending.attendanceId,
            hasHost: !!host,
          })
        }
      } catch (err) {
        log.error("Failed to persist meeting topic/host", {
          attendanceId: pending.attendanceId,
          error: String(err),
        })
      }
      attendanceEvents.emit({
        type: "acknowledged",
        id: pending.attendanceId,
        mid: pending.mid,
        valid: true,
      })
    },
    [],
  )

  const handleTopicSkip = useCallback(() => {
    const pending = topicContextRef.current
    topicContextRef.current = null
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

  if (!meeting) return null

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

        <Animated.View
          style={[
            themed($content),
            {
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
            },
          ]}
          accessibilityViewIsModal
          onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}
        >
          {/* Attendance banner */}
          {showBanner && (
            <Pressable
              onPress={() => {
                onClose()
                navigate("Attendance", { section: "new" })
              }}
            >
              <Animated.View
                style={[
                  $attendanceBanner,
                  { backgroundColor: theme.colors.tint, opacity: bannerOpacity },
                ]}
              >
                <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                <Text style={$attendanceBannerText} tx="zoomMeeting:attendanceSaved" />
              </Animated.View>
            </Pressable>
          )}

          {/* Header */}
          <View style={themed($header)}>
            {/* Fellowship badge */}
            <View
              style={[
                $fellowshipBadge,
                { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
              ]}
            >
              <Text style={[$fellowshipBadgeText, { color: fellowshipColor }]}>
                {meeting.fellowship || "?"}
              </Text>
            </View>

            {/* Time */}
            {formattedTime && <Text style={themed($headerTime)}>{formattedTime}</Text>}

            {/* Meeting name */}
            <Text style={themed($title)} numberOfLines={1}>
              {meeting.name}
            </Text>

            {/* Close button */}
            <Pressable
              onPress={onClose}
              style={themed($closeButton)}
              accessibilityRole="button"
              accessibilityLabel={t("common:close")}
            >
              <Ionicons name="chevron-up" size={24} color={theme.colors.textDim} />
            </Pressable>
          </View>

          {/* Meta info */}
          <View style={themed($metaRow)}>
            {formattedTime && (
              <View style={$metaItem}>
                <Ionicons name="time-outline" size={14} color={theme.colors.textDim} />
                <Text style={themed($metaText)}>{formattedTime}</Text>
              </View>
            )}
            <View style={$metaItem}>
              <Ionicons name="hourglass-outline" size={14} color={theme.colors.textDim} />
              <Text style={themed($metaText)}>
                {meeting.duration_ms
                  ? `${Math.round(meeting.duration_ms / 60000)} ${t("liveScreen:min")}`
                  : "24h"}
              </Text>
            </View>
            <View style={$metaItem}>
              <Ionicons name="people-outline" size={14} color={theme.colors.textDim} />
              <Text style={themed($metaText)}>
                {meetingCount === 1
                  ? t("liveScreen:meeting", { count: meetingCount })
                  : t("liveScreen:meetings", { count: meetingCount })}
              </Text>
            </View>
            {meeting.language && (
              <View style={$metaItem}>
                <Ionicons name="globe-outline" size={14} color={theme.colors.textDim} />
                <Text style={themed($metaText)}>{meeting.language.toUpperCase()}</Text>
              </View>
            )}
          </View>

          {/* Meeting tags */}
          <View style={themed($tagsRow)}>
            {[...(meeting.tags || []), ...(meeting.meetingTypes || [])].map((tag, idx) => (
              <View key={idx} style={themed($tag)}>
                <Text style={themed($tagText)}>{tag}</Text>
              </View>
            ))}
          </View>

          {/* Join button and Feedback row */}
          <View style={themed($actionRow)}>
            {/* Join button (left) */}
            {meeting.url && (
              <Pressable
                onPress={handleJoin}
                style={[themed($joinButton), isJoining && themed($joinButtonDisabled)]}
                disabled={isJoining}
                accessibilityRole="button"
                accessibilityLabel={isJoining ? t("liveScreen:joining") : t("liveScreen:joinMeeting")}
                accessibilityState={{ disabled: isJoining }}
              >
                <Text style={themed($joinButtonText)}>
                  {isJoining ? t("liveScreen:joining") : t("liveScreen:joinMeeting")}
                </Text>
                <Ionicons
                  name={isSDKReady ? "videocam" : "open-outline"}
                  size={16}
                  color={theme.colors.tint}
                />
              </Pressable>
            )}

            {/* Feedback section (right) */}
            <View style={themed($feedbackSection)}>
              {/* Heart and Stars row */}
              <View style={themed($heartStarsRow)}>
                <Pressable
                  onPress={handleToggleLove}
                  style={themed($heartButton)}
                  accessibilityRole="button"
                  accessibilityLabel={t("accessibility:favoriteToggle")}
                  accessibilityState={{ selected: isFavorite }}
                  accessibilityHint={t("accessibility:doubleTapToToggleFavorite")}
                >
                  <Ionicons
                    name={isFavorite ? "heart" : "heart-outline"}
                    size={26}
                    color={isFavorite ? "#ef4444" : theme.colors.textDim}
                  />
                </Pressable>
                <View style={themed($ratingContainer)}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Pressable
                      key={star}
                      onPress={() => handleSetRating(star)}
                      accessibilityRole="button"
                      accessibilityLabel={t("accessibility:rateStars", { count: star })}
                      accessibilityState={{ selected: star <= rating }}
                      accessibilityHint={t("accessibility:doubleTapToRate")}
                    >
                      <Ionicons
                        name={star <= rating ? "star" : "star-outline"}
                        size={20}
                        color={star <= rating ? "#fbbf24" : theme.colors.textDim}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Joins and time ago row */}
              {joinCount > 0 && (
                <View style={themed($joinsRow)}>
                  <Ionicons name="enter-outline" size={14} color={theme.colors.textDim} />
                  <Text style={themed($joinsText)}>
                    {joinCount} {joinCount === 1 ? t("liveScreen:join") : t("liveScreen:joins")}
                    {lastJoin > 0 && ` · ${DateTime.fromMillis(lastJoin).toRelative()}`}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Description - tap to expand */}
          {meeting.description ? (
            <Pressable
              onPress={() => setDescriptionExpanded(!descriptionExpanded)}
              accessibilityRole="button"
              accessibilityLabel={t("accessibility:expandDescription")}
              accessibilityHint={t("accessibility:doubleTapToExpand")}
            >
              <Text
                style={themed($description)}
                numberOfLines={descriptionExpanded ? undefined : 5}
              >
                {meeting.description}
              </Text>
              {!descriptionExpanded && meeting.description.length > 200 && (
                <Text style={themed($readMore)}>{t("liveScreen:tapToReadMore")}</Text>
              )}
            </Pressable>
          ) : null}

          {/* Schedule Grid */}
          <ScheduleGrid
            scheduleData={scheduleGridData}
            currentDow={currentDow}
            onCellPress={handleCellPress}
            reminderCells={reminderCells}
          />

          <Text style={themed($reminderHint)} tx="liveScreen:tapTimesHint" />

          {/* Slide-in topic panel. Rendered inside $content (not as its own
              Modal) so iOS doesn't have to present a second native modal
              over the Zoom SDK's dismiss animation — which is the race that
              broke the previous TopicPromptModal approach. */}
          <Animated.View
            pointerEvents={topicActive ? "auto" : "none"}
            style={[
              themed($topicOverlay),
              {
                opacity: topicProgress,
                transform:
                  contentHeight > 0
                    ? [
                        {
                          translateY: topicProgress.interpolate({
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
              behavior={Platform.OS === "ios" ? "padding" : "height"}
            >
              <TopicPromptContent
                active={topicActive}
                meetingName={meeting.name}
                includeHost={attendanceSourceRef.current === "external"}
                onSave={handleTopicSave}
                onSkip={handleTopicSkip}
              />
            </KeyboardAvoidingView>
          </Animated.View>
        </Animated.View>
      </View>

      {/* External Zoom Timer Modal */}
      {meeting && (
        <ExternalZoomTimerModal
          visible={timerVisible}
          meeting={
            meeting.url && meeting.id
              ? {
                  id: meeting.id,
                  name: meeting.name,
                  url: buildExternalZoomUrl({
                    meetingNumber: extractZoomMeetingNumber(meeting.url) ?? "",
                    meetingUrl: meeting.url,
                    password: meeting.password,
                    passwordEnc: meeting.passwordEnc,
                  }),
                }
              : null
          }
          onClose={() => setTimerVisible(false)}
          onSaved={() => {
            // Just close the timer. saveTimerAttendance (inside the timer
            // modal) already emitted `attendanceEvents.processed`, which
            // the subscription above picks up to slide in the topic panel
            // or fire the banner directly.
            setTimerVisible(false)
          }}
        />
      )}

      {/* Reminder Editor Modal */}
      {meeting && (
        <ReminderEditorModal
          visible={reminderEditorVisible}
          onClose={() => setReminderEditorVisible(false)}
          meeting={meeting}
          existingReminder={editingReminder}
          selectedCell={selectedCell}
          sid={meeting.sid}
          onCreate={createReminder}
          onUpdate={updateReminder}
          onDelete={deleteReminder}
          onCheckOverlap={checkOverlap}
        />
      )}
    </Modal>
  )
})

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
  maxHeight: "85%",
  paddingTop: spacing.md,
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.xl,
})

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

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingBottom: spacing.sm,
  gap: spacing.xs,
})

const $headerTime: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  fontWeight: "600",
  color: colors.text,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 16,
  fontWeight: "700",
  color: colors.text,
})

const $fellowshipBadge: ViewStyle = {
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 12,
  backgroundColor: "#000",
  borderWidth: 1.5,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 6,
  elevation: 8,
}

const $fellowshipBadgeText: TextStyle = {
  fontSize: 12,
  fontWeight: "700",
}

const $closeButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.xs,
})

const $metaRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: spacing.md,
  paddingBottom: spacing.sm,
})

const $metaItem: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
}

const $metaText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $description: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  color: colors.textDim,
  lineHeight: 20,
  marginBottom: spacing.xs,
})

const $readMore: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 13,
  color: colors.tint,
  marginBottom: spacing.sm,
})

const $reminderHint: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 11,
  color: colors.textDim,
  textAlign: "center",
  marginTop: spacing.xs,
})

const $tagsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xs,
  paddingBottom: spacing.sm,
})

const $tag: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.border,
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 12,
})

const $tagText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  fontWeight: "600",
  color: colors.text,
})

const $actionRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "flex-start",
  gap: spacing.md,
  marginBottom: spacing.md,
})

const $feedbackSection: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  alignItems: "flex-end",
})

const $heartStarsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $joinsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  marginTop: spacing.xs,
})

const $joinsText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $heartButton: ThemedStyle<ViewStyle> = () => ({
  paddingHorizontal: 4,
})

const $joinButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: "#000",
  borderWidth: 1.5,
  borderColor: colors.tint,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  borderRadius: 10,
  gap: spacing.xs,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $joinButtonDisabled: ThemedStyle<ViewStyle> = () => ({
  opacity: 0.7,
})

const $joinButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 16,
  fontWeight: "600",
})

const $ratingContainer: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  gap: 4,
})

const $attendanceBanner: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  paddingVertical: 10,
  paddingHorizontal: 16,
  borderRadius: 10,
  marginBottom: 8,
}

const $attendanceBannerText: TextStyle = {
  fontSize: 15,
  fontWeight: "600",
  color: "#FFFFFF",
}
