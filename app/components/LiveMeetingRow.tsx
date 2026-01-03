/**
 * LiveMeetingRow Component
 *
 * Condensed meeting row for the Live screen.
 * Format: • [Fellowship] [Name]   [heart] [start time][language]
 *                                         [★★★★★]
 */

import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { FELLOWSHIP_COLORS, Fellowship } from "@recoverysky-org/common/browser"

import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { formatMillisToLocalTime } from "@/utils/formatTime"

interface LiveMeetingRowProps {
  /** Meeting data with millis and feedback */
  meeting: MeetingWithTrex
  /** User's rating (0-5 stars) - overrides meeting.feedback.rates for live updates */
  rating?: number
  /** Whether user has favorited - overrides meeting.feedback.loves for live updates */
  isFavorite?: boolean
  /** Callback when row is pressed */
  onPress?: (meeting: MeetingWithTrex) => void
}

/**
 * LiveMeetingRow displays a condensed meeting row.
 * Props override meeting.feedback values for live UI updates.
 *
 * @example
 * <LiveMeetingRow
 *   meeting={meeting}
 *   rating={feedback?.rates ?? 0}
 *   isFavorite={feedback?.loves ?? false}
 *   onPress={(m) => openPopup(m)}
 * />
 */
export const LiveMeetingRow: FC<LiveMeetingRowProps> = ({
  meeting,
  rating = 0,
  isFavorite = false,
  onPress,
}) => {
  const { themed, theme } = useAppTheme()

  const startTime = useMemo(() => formatMillisToLocalTime(meeting.millis), [meeting.millis])

  const fellowshipColor = useMemo(() => {
    return FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]
  }, [meeting.fellowship])

  return (
    <Pressable style={themed($container)} onPress={() => onPress?.(meeting)}>
      {/* Fellowship Badge */}
      <View
        style={[
          $fellowshipBadge,
          { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
        ]}
      >
        <Text style={[$fellowshipText, { color: fellowshipColor }]}>
          {meeting.fellowship || "?"}
        </Text>
      </View>

      {/* Meeting Name */}
      <Text style={themed($meetingName)} numberOfLines={1}>
        {meeting.name}
      </Text>

      {/* Heart (if favorited) */}
      {isFavorite && <Ionicons name="heart" size={16} color="#ef4444" style={$heartIcon} />}

      {/* Right side: Time/Language + Stars */}
      <View style={$rightSection}>
        {/* Top row: Time + Language */}
        <View style={$timeRow}>
          <Text style={themed($timeText)}>{startTime}</Text>
          {meeting.language && (
            <Text style={themed($languageText)}>{meeting.language.toUpperCase()}</Text>
          )}
        </View>

        {/* Bottom row: Stars (only if rated) */}
        {rating > 0 && (
          <View style={$starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Ionicons
                key={star}
                name={star <= rating ? "star" : "star-outline"}
                size={10}
                color={star <= rating ? "#fbbf24" : theme.colors.textDim}
              />
            ))}
          </View>
        )}
      </View>
    </Pressable>
  )
}

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: spacing.sm,
  gap: spacing.xs,
  minHeight: 44,
})

const $fellowshipBadge: ViewStyle = {
  paddingHorizontal: 8,
  paddingVertical: 2,
  borderRadius: 10,
  minWidth: 32,
  alignItems: "center",
  backgroundColor: "#000",
  borderWidth: 1.5,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 6,
  elevation: 8,
}

const $fellowshipText: TextStyle = {
  fontSize: 11,
  fontWeight: "700",
}

const $meetingName: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 14,
  color: colors.text,
})

const $heartIcon: ViewStyle = {
  marginRight: 4,
}

const $rightSection: ViewStyle = {
  alignItems: "flex-end",
  marginLeft: "auto",
}

const $timeRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
}

const $starsRow: ViewStyle = {
  flexDirection: "row",
  marginTop: 2,
}

const $timeText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $languageText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  color: colors.textDim,
  marginLeft: 4,
})
