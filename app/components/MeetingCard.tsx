/**
 * MeetingCard Component
 *
 * Displays a meeting card with live indicator, fellowship badge,
 * meeting details, and join button.
 */

import { FC, useCallback } from "react"
import { View, ViewStyle, TextStyle, Pressable, Linking, Animated } from "react-native"
import { FELLOWSHIP_COLORS, Fellowship } from "@recoverysky-org/common/browser"

import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { formatMillisToLocalTime } from "@/utils/formatTime"

interface MeetingCardProps {
  meeting: MeetingWithTrex
}

export const MeetingCard: FC<MeetingCardProps> = function MeetingCard({ meeting }) {
  const { themed } = useAppTheme()

  const fellowshipColor =
    FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]

  const formattedTime = formatMillisToLocalTime(meeting.millis)

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
            <Animated.View style={$liveDotPulse} />
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

        {/* Time */}
        {formattedTime && (
          <View style={$detailsRow}>
            <Text style={themed($detailText)}>{formattedTime}</Text>
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

// Live indicator green color
const LIVE_GREEN = "#22c55e"

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
  backgroundColor: LIVE_GREEN,
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
  backgroundColor: LIVE_GREEN,
  opacity: 0.5,
}

const $liveDot: ViewStyle = {
  width: 8,
  height: 8,
  borderRadius: 4,
  backgroundColor: LIVE_GREEN,
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
