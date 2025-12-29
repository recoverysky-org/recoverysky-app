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

import { FC, useMemo, useState, useEffect, useCallback } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  Modal,
  Pressable,
  StyleSheet,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { ScheduleGrid } from "@/components/ScheduleGrid"
import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { feedbackCache, type FeedbackRecord } from "@/db"
import { useZoomMeeting, extractZoomMeetingNumber, extractZoomPassword } from "@/services/zoom"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"
import { formatMillisToLocalTime } from "@/utils/formatTime"
import { FELLOWSHIP_COLORS, DateTime, Fellowship } from "@common"

const log = logger.child({ module: "SchedulePopup" })

interface SchedulePopupProps {
  visible: boolean
  meeting: MeetingWithTrex | null
  onClose: () => void
}

export const SchedulePopup: FC<SchedulePopupProps> = function SchedulePopup({
  visible,
  meeting,
  onClose,
}) {
  const { themed, theme } = useAppTheme()
  const { joinMeeting, isJoining, isSDKReady } = useZoomMeeting()
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)

  // Local feedback state - initialized from cache, updated on interactions
  const [feedback, setFeedback] = useState<FeedbackRecord | null>(null)

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

    // Extract meeting number and password from URL
    const meetingNumber = extractZoomMeetingNumber(meeting.url)
    const password = extractZoomPassword(meeting.url) || meeting.password || ""

    if (!meetingNumber) {
      // Fallback for non-Zoom URLs
      const { Linking } = await import("react-native")
      await Linking.openURL(meeting.url)
      return
    }

    try {
      await joinMeeting({
        meetingId: meeting.id,
        meetingNumber,
        userName: "RecoverySky User", // TODO: Get from user profile
        password,
      })
    } catch {
      // Error handling done in provider
    }
  }

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

        <View style={themed($content)}>
          {/* Header */}
          <View style={themed($header)}>
            {/* Fellowship badge */}
            <View style={[$fellowshipBadge, { borderColor: theme.colors.tint, shadowColor: theme.colors.tint }]}>
              <Text style={[$fellowshipBadgeText, { color: fellowshipColor }]}>
                {meeting.fellowship || "?"}
              </Text>
            </View>

            {/* Time */}
            {formattedTime && (
              <Text style={themed($headerTime)}>{formattedTime}</Text>
            )}

            {/* Meeting name */}
            <Text style={themed($title)} numberOfLines={1}>
              {meeting.name}
            </Text>

            {/* Close button */}
            <Pressable onPress={onClose} style={themed($closeButton)}>
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
              <Ionicons name="people-outline" size={14} color={theme.colors.textDim} />
              <Text style={themed($metaText)}>{meetingCount} meetings</Text>
            </View>
            {meeting.language && (
              <View style={$metaItem}>
                <Ionicons name="globe-outline" size={14} color={theme.colors.textDim} />
                <Text style={themed($metaText)}>{meeting.language.toUpperCase()}</Text>
              </View>
            )}
            {joinCount > 0 && (
              <View style={$metaItem}>
                <Ionicons name="enter-outline" size={14} color={theme.colors.textDim} />
                <Text style={themed($metaText)}>
                  {joinCount} {joinCount === 1 ? "join" : "joins"}
                  {lastJoin > 0 && ` · ${DateTime.fromMillis(lastJoin).toRelative()}`}
                </Text>
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

          {/* Join button, Heart, and Rating row */}
          <View style={themed($actionRow)}>
            {/* Join button */}
            {meeting.url && (
              <Pressable
                onPress={handleJoin}
                style={[themed($joinButton), isJoining && { opacity: 0.7 }]}
                disabled={isJoining}
              >
                <Text style={themed($joinButtonText)}>
                  {isJoining ? "Joining..." : "Join Meeting"}
                </Text>
                <Ionicons
                  name={isSDKReady ? "videocam" : "open-outline"}
                  size={16}
                  color={theme.colors.tint}
                />
              </Pressable>
            )}

            {/* Favorite heart */}
            <Pressable onPress={handleToggleLove} style={themed($heartButton)}>
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={26}
                color={isFavorite ? "#ef4444" : theme.colors.textDim}
              />
            </Pressable>

            {/* Rating stars */}
            <View style={themed($ratingContainer)}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable key={star} onPress={() => handleSetRating(star)}>
                  <Ionicons
                    name={star <= rating ? "star" : "star-outline"}
                    size={20}
                    color={star <= rating ? "#fbbf24" : theme.colors.textDim}
                  />
                </Pressable>
              ))}
            </View>
          </View>

          {/* Description - tap to expand */}
          {meeting.description ? (
            <Pressable onPress={() => setDescriptionExpanded(!descriptionExpanded)}>
              <Text
                style={themed($description)}
                numberOfLines={descriptionExpanded ? undefined : 5}
              >
                {meeting.description}
              </Text>
              {!descriptionExpanded && meeting.description.length > 200 && (
                <Text style={themed($readMore)}>Tap to read more...</Text>
              )}
            </Pressable>
          ) : null}

          {/* Schedule Grid */}
          <ScheduleGrid
            scheduleData={scheduleGridData}
            currentDow={currentDow}
          />
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
  maxHeight: "85%",
  paddingTop: spacing.md,
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.xl,
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
  alignItems: "center",
  gap: spacing.md,
  marginBottom: spacing.md,
})

const $heartButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.xs,
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

const $joinButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 16,
  fontWeight: "600",
})

const $ratingContainer: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  gap: 4,
})
