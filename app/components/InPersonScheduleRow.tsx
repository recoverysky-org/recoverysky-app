/**
 * InPersonScheduleRow Component
 *
 * Condensed meeting row for the In-Person segment of the Meetings tab.
 * Deliberately dumb: `distanceLabel` is a pre-formatted string computed by
 * the caller (useNearbySchedules / the day-browse fallback) rather than
 * something this component derives from `meeting.distance_m` itself — that
 * keeps unit/locale formatting decisions in exactly one place. When the
 * label is omitted (day-browse fallback mode, no known distance) the badge
 * must not render at all, not render empty — see the omission test.
 */

import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { FELLOWSHIP_COLORS, Fellowship } from "@recoverysky-org/common/browser"

import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { translate } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { formatMillisToLocalTime } from "@/utils/formatTime"

const REMINDER_COLOR = "#f59e0b"

interface InPersonScheduleRowProps {
  /** Meeting data with millis, venue fields, and optional distance_m */
  meeting: MeetingWithTrex
  /** Pre-formatted distance ("0.8 mi") — omitted in day-browse fallback mode */
  distanceLabel?: string
  /** Whether this meeting has a reminder set */
  hasReminder?: boolean
  /** Callback when row is pressed */
  onPress?: (meeting: MeetingWithTrex) => void
}

/**
 * InPersonScheduleRow displays a condensed in-person (or hybrid) meeting row:
 * fellowship accent bar, name + reminder bell, venue/city line, and a right
 * column carrying the local start time, an optional distance badge, and a
 * hybrid glyph when the meeting also has an online option.
 *
 * @example
 * <InPersonScheduleRow
 *   meeting={meeting}
 *   distanceLabel={formatDistance(meeting.distance_m)}
 *   hasReminder={hasReminderFor(meeting.id)}
 *   onPress={(m) => openPopup(m)}
 * />
 */
export const InPersonScheduleRow: FC<InPersonScheduleRowProps> = ({
  meeting,
  distanceLabel,
  hasReminder = false,
  onPress,
}) => {
  const { themed, theme } = useAppTheme()

  const startTime = useMemo(
    () => (meeting.millis === 0 ? "24h" : formatMillisToLocalTime(meeting.millis)),
    [meeting.millis],
  )

  const fellowshipColor = useMemo(() => {
    return FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]
  }, [meeting.fellowship])

  // Venue line composes from data the meeting already carries (venue name +
  // city) rather than introducing new copy — per the i18n guidance, prefer
  // composition over new strings when the source fields are enough.
  const venueLine = [meeting.venueName, meeting.city].filter(Boolean).join(" • ")

  return (
    <Pressable
      style={themed($container)}
      onPress={() => onPress?.(meeting)}
      accessibilityRole="button"
      accessibilityLabel={`${meeting.fellowship || ""} ${meeting.name}, ${startTime}`.trim()}
      accessibilityHint={translate("accessibility:doubleTapToView")}
    >
      {/* Fellowship accent bar — same color source as LiveMeetingRow's badge,
          rendered as a bar here to leave room for the two-line venue text. */}
      <View style={[$accentBar, { backgroundColor: fellowshipColor }]} accessible={false} />

      <View style={$textColumn} accessible={false}>
        {/* Name row: meeting name + reminder bell, matching LiveMeetingRow's
            bell placement/color so the two rows read as the same family. */}
        <View style={$nameRow}>
          <Text style={themed($meetingName)} numberOfLines={1}>
            {meeting.name}
          </Text>
          {hasReminder && (
            <Ionicons
              name="notifications"
              size={14}
              color={REMINDER_COLOR}
              style={$bellIcon}
              accessible={false}
            />
          )}
        </View>

        {venueLine.length > 0 && (
          <Text style={themed($venueLine)} numberOfLines={1}>
            {venueLine}
          </Text>
        )}
      </View>

      {/* Right column: local time, distance badge (absent — not empty — when
          distanceLabel is undefined), and hybrid glyph. */}
      <View style={$rightSection} accessible={false}>
        <View style={$timeRow}>
          <Text style={themed($timeText)}>{startTime}</Text>
          {meeting.hybrid && (
            <Ionicons
              testID="hybrid-indicator"
              name="globe-outline"
              size={14}
              color={theme.colors.textDim}
              style={$hybridIcon}
            />
          )}
        </View>

        {distanceLabel && (
          <View testID="distance-badge" style={themed($distanceBadge)}>
            <Text style={themed($distanceText)}>{distanceLabel}</Text>
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

const $accentBar: ViewStyle = {
  width: 4,
  alignSelf: "stretch",
  borderRadius: 2,
}

const $textColumn: ViewStyle = {
  flex: 1,
  minWidth: 0,
}

const $nameRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
}

const $meetingName: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 14,
  fontWeight: "600",
  color: colors.text,
})

const $bellIcon: ViewStyle = {
  marginLeft: 4,
}

const $venueLine: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  marginTop: 2,
})

const $rightSection: ViewStyle = {
  alignItems: "flex-end",
  marginLeft: "auto",
}

const $timeRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
}

const $timeText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $hybridIcon: ViewStyle = {
  marginLeft: 4,
}

const $distanceBadge: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderRadius: 8,
  paddingHorizontal: 6,
  paddingVertical: 2,
  marginTop: 2,
})

const $distanceText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  color: colors.textDim,
})
