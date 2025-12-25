/**
 * MeetingCard Component
 *
 * Displays a meeting card with live indicator, fellowship badge,
 * meeting details, and join button.
 */

import { FC, useCallback } from "react"
import { View, ViewStyle, TextStyle, Pressable, Linking, Animated } from "react-native"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { FELLOWSHIP_COLORS, hydrateNext, type TREXJSON, Fellowship } from "@common"

interface MeetingCardProps {
  meeting: MeetingWithTrex
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
 * Get the next occurrence time formatted for display
 */
function getFormattedTime(trex: MeetingWithTrex["trex"]): string | null {
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
  return dt.toFormat("ccc h:mma").toLowerCase()
}

export const MeetingCard: FC<MeetingCardProps> = function MeetingCard({ meeting }) {
  const { themed } = useAppTheme()

  const fellowshipColor =
    FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]

  const formattedTime = getFormattedTime(meeting.trex)
  const duration = meeting.trex ? formatDuration(meeting.trex.duration_ms) : null

  const handleJoin = useCallback(() => {
    if (meeting.url) {
      Linking.openURL(meeting.url)
    }
  }, [meeting.url])

  return (
    <View style={themed($container)}>
      {/* Live indicator bar */}
      <View style={$liveBar} />

      <View style={themed($content)}>
        {/* Header row */}
        <View style={$headerRow}>
          {/* Pulsing live dot */}
          <View style={$liveDotContainer}>
            <Animated.View style={[$liveDotPulse, { backgroundColor: "#22c55e" }]} />
            <View style={$liveDot} />
          </View>

          {/* Fellowship badge */}
          {meeting.fellowship && (
            <View style={[$badge, { backgroundColor: fellowshipColor }]}>
              <Text style={$badgeText}>{meeting.fellowship}</Text>
            </View>
          )}
        </View>

        {/* Meeting name */}
        <Text style={themed($name)} numberOfLines={2}>
          {meeting.name}
        </Text>

        {/* Time and duration */}
        {(formattedTime || duration) && (
          <View style={$detailsRow}>
            {formattedTime && <Text style={themed($detailText)}>{formattedTime}</Text>}
            {formattedTime && duration && <Text style={themed($detailText)}> · </Text>}
            {duration && <Text style={themed($detailText)}>{duration}</Text>}
          </View>
        )}

        {/* Language */}
        {meeting.language && meeting.language !== "en" && (
          <Text style={themed($languageText)}>{meeting.language.toUpperCase()}</Text>
        )}

        {/* Join button */}
        {meeting.url && (
          <Pressable onPress={handleJoin} style={themed($joinButton)}>
            <Text style={$joinButtonText} tx="liveScreen:joinMeeting" />
          </Pressable>
        )}
      </View>
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 12,
  marginBottom: spacing.sm,
  overflow: "hidden",
  borderWidth: 1,
  borderColor: colors.border,
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.1,
  shadowRadius: 2,
  elevation: 2,
})

const $liveBar: ViewStyle = {
  height: 3,
  backgroundColor: "#22c55e",
}

const $content: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.md,
})

const $headerRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  marginBottom: 8,
}

const $liveDotContainer: ViewStyle = {
  width: 10,
  height: 10,
  marginRight: 8,
  justifyContent: "center",
  alignItems: "center",
}

const $liveDotPulse: ViewStyle = {
  position: "absolute",
  width: 10,
  height: 10,
  borderRadius: 5,
  opacity: 0.5,
}

const $liveDot: ViewStyle = {
  width: 8,
  height: 8,
  borderRadius: 4,
  backgroundColor: "#22c55e",
}

const $badge: ViewStyle = {
  paddingHorizontal: 8,
  paddingVertical: 2,
  borderRadius: 4,
}

const $badgeText: TextStyle = {
  color: "#fff",
  fontSize: 11,
  fontWeight: "600",
}

const $name: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.text,
  marginBottom: 4,
})

const $detailsRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
}

const $detailText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})

const $languageText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 12,
  color: colors.textDim,
  marginTop: spacing.xxs,
})

const $joinButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.tint,
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.md,
  borderRadius: 8,
  alignItems: "center",
  marginTop: spacing.sm,
})

const $joinButtonText: TextStyle = {
  color: "#fff",
  fontWeight: "600",
  fontSize: 14,
}
