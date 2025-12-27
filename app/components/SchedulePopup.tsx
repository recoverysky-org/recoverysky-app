/**
 * SchedulePopup Component
 *
 * Modal popup showing meeting details and weekly schedule grid.
 * Displays:
 * - Meeting name with live indicator
 * - Fellowship badge (color-coded)
 * - Time, duration, meeting count, language
 * - Meeting types (tags)
 * - Join Meeting button
 * - Favorite heart (UI only)
 * - 5-star rating (UI only)
 * - Weekly schedule grid
 */

import { FC, useMemo, useState } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { ScheduleGrid } from "@/components/ScheduleGrid"
import { Text } from "@/components/Text"
import { useMeetings, type MeetingWithTrex } from "@/context/MeetingContext"
import { useZoomMeeting, extractZoomMeetingNumber, extractZoomPassword } from "@/services/zoom"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import {
  FELLOWSHIP_COLORS,
  hydrateNext,
  hydrateScheduleGrid,
  DateTime,
  type TREXJSON,
  Fellowship,
} from "@common"

interface SchedulePopupProps {
  visible: boolean
  meeting: MeetingWithTrex | null
  onClose: () => void
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
}

/**
 * Get formatted time from TREX data
 */
function getFormattedTime(trex: MeetingWithTrex["trex"]): { day: string; time: string } | null {
  if (!trex) return null

  const trexJson: TREXJSON = {
    coordinate: trex.coordinate,
    timezone: trex.timezone,
    periodicity: trex.periodicity,
    coordinate_end: trex.coordinate_end,
    duration_ms: trex.duration_ms,
    dtstart: trex.dtstart,
    dtend: trex.dtend,
    rrule_str: trex.rrule_str,
    rrule_json: trex.rrule_json,
    hour: trex.hour,
    minute: trex.minute,
    dow: trex.dow,
    dom: trex.dom,
    month: trex.month,
  }

  const result = hydrateNext(trexJson)
  if (!result.ok) return null

  const dt = result.value.toLocal()
  return {
    day: dt.toFormat("ccc"),
    time: dt.toFormat("h:mma").toLowerCase(),
  }
}

export const SchedulePopup: FC<SchedulePopupProps> = function SchedulePopup({
  visible,
  meeting,
  onClose,
}) {
  const { themed, theme } = useAppTheme()
  const { getMeetingsForSchedule } = useMeetings()
  const { joinMeeting, isJoining, isSDKReady } = useZoomMeeting()
  const [isFavorite, setIsFavorite] = useState(false)
  const [rating, setRating] = useState(0)

  // Get all meetings for this schedule (from pre-loaded cache)
  const scheduleMeetings = useMemo(() => {
    if (!meeting?.sid) return []
    return getMeetingsForSchedule(meeting.sid)
  }, [getMeetingsForSchedule, meeting?.sid])

  // Generate schedule grid data using hydrateScheduleGrid from @common
  const scheduleGridData = useMemo(() => {
    if (scheduleMeetings.length === 0) return []

    // Debug: log input meetings and their trex data
    console.log("[SchedulePopup] scheduleMeetings:", scheduleMeetings.length)
    for (const m of scheduleMeetings.slice(0, 5)) {
      console.log(`  - ${m.name}: trex.dow=${m.trex?.dow}, hour=${m.trex?.hour}, min=${m.trex?.minute}`)
    }

    const gridMap = hydrateScheduleGrid(scheduleMeetings)

    // Debug: log the grid map
    console.log("[SchedulePopup] gridMap size:", gridMap.size)
    for (const [timeKey, row] of gridMap) {
      const filled = row.map((dt, i) => dt ? `${i}:${dt.toFormat("ccc h:mma")}` : null).filter(Boolean)
      console.log(`  ${timeKey}: [${filled.join(", ")}]`)
    }

    // Convert Map to array format expected by ScheduleGrid
    // Sort by time, then convert DateTime to formatted string
    const sortedEntries = Array.from(gridMap.entries()).sort(([a], [b]) => {
      return a.localeCompare(b)
    })

    return sortedEntries.map(([, row]) =>
      row.map((dt) => {
        if (!dt) return null
        // Format as "12:00p" (no 'm', lowercase)
        const time = dt.toFormat("h:mm")
        const period = dt.hour >= 12 ? "p" : "a"
        return `${time}${period}`
      })
    )
  }, [scheduleMeetings])

  // Current day for highlighting
  const currentDow = DateTime.now().weekday

  const fellowshipColor = meeting
    ? FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]
    : "#888"

  const timeInfo = meeting ? getFormattedTime(meeting.trex) : null
  const duration = meeting?.trex ? formatDuration(meeting.trex.duration_ms) : null

  const handleJoin = async () => {
    if (!meeting?.url) return

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
            {/* Live indicator */}
            <View style={$liveDot} />

            {/* Time */}
            {timeInfo && (
              <Text style={themed($headerTime)}>{timeInfo.time}</Text>
            )}

            {/* Meeting name */}
            <Text style={themed($title)} numberOfLines={1}>
              {meeting.name}
            </Text>

            {/* Fellowship badge */}
            <View style={[$fellowshipBadge, { backgroundColor: fellowshipColor }]}>
              <Text style={$fellowshipBadgeText}>{meeting.fellowship || "?"}</Text>
            </View>

            {/* Close button */}
            <Pressable onPress={onClose} style={themed($closeButton)}>
              <Ionicons name="chevron-up" size={24} color={theme.colors.textDim} />
            </Pressable>
          </View>

          {/* Meta info */}
          <View style={themed($metaRow)}>
            {timeInfo && (
              <View style={$metaItem}>
                <Ionicons name="time-outline" size={14} color={theme.colors.textDim} />
                <Text style={themed($metaText)}>
                  {timeInfo.day} {timeInfo.time}
                </Text>
              </View>
            )}
            {duration && <Text style={themed($metaText)}>{duration}</Text>}
            <View style={$metaItem}>
              <Ionicons name="people-outline" size={14} color={theme.colors.textDim} />
              <Text style={themed($metaText)}>{scheduleMeetings.length} meetings</Text>
            </View>
            {meeting.language && (
              <View style={$metaItem}>
                <Ionicons name="globe-outline" size={14} color={theme.colors.textDim} />
                <Text style={themed($metaText)}>{meeting.language.toUpperCase()}</Text>
              </View>
            )}
          </View>

          {/* Meeting tags + Favorite */}
          <View style={themed($tagsAndFavRow)}>
            <View style={themed($tagsRow)}>
              {[...(meeting.tags || []), ...(meeting.meetingTypes || [])].map((tag, idx) => (
                <View key={idx} style={themed($tag)}>
                  <Text style={themed($tagText)}>{tag}</Text>
                </View>
              ))}
            </View>

            {/* Favorite button (UI only) */}
            <Pressable onPress={() => setIsFavorite(!isFavorite)}>
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={24}
                color={isFavorite ? "#ef4444" : theme.colors.textDim}
              />
            </Pressable>
          </View>

          <ScrollView style={themed($scrollContent)} showsVerticalScrollIndicator={false}>
            {/* Join button and Rating row */}
            <View style={themed($actionRow)}>
              {/* Join button */}
              {meeting.url && (
                <Pressable
                  onPress={handleJoin}
                  style={[themed($joinButton), isJoining && { opacity: 0.7 }]}
                  disabled={isJoining}
                >
                  <Text style={$joinButtonText}>
                    {isJoining ? "Joining..." : "Join Meeting"}
                  </Text>
                  <Ionicons
                    name={isSDKReady ? "videocam" : "open-outline"}
                    size={16}
                    color="#fff"
                  />
                </Pressable>
              )}

              {/* Rating stars (UI only) */}
              <View style={themed($ratingContainer)}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable key={star} onPress={() => setRating(star)}>
                    <Ionicons
                      name={star <= rating ? "star" : "star-outline"}
                      size={20}
                      color={star <= rating ? "#fbbf24" : theme.colors.textDim}
                    />
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Schedule Grid */}
            <ScheduleGrid
              scheduleData={scheduleGridData}
              currentDow={currentDow}
            />
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
  backgroundColor: "rgba(0, 0, 0, 0.5)",
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

const $liveDot: ViewStyle = {
  width: 10,
  height: 10,
  borderRadius: 5,
  backgroundColor: "#22c55e",
}

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
}

const $fellowshipBadgeText: TextStyle = {
  color: "#fff",
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

const $tagsAndFavRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "flex-start",
  paddingBottom: spacing.sm,
})

const $tagsRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.xs,
  flex: 1,
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

const $scrollContent: ThemedStyle<ViewStyle> = () => ({
  flexGrow: 0,
})

const $actionRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: spacing.md,
})

const $joinButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: colors.tint,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  borderRadius: 10,
  gap: spacing.xs,
})

const $joinButtonText: TextStyle = {
  color: "#fff",
  fontSize: 16,
  fontWeight: "600",
}

const $ratingContainer: ThemedStyle<ViewStyle> = () => ({
  flexDirection: "row",
  gap: 4,
})
