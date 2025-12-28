/**
 * LiveMeetingRow Component
 *
 * Condensed meeting row for the Live screen.
 * Format: • [Fellowship] [Name]   [start time][language]
 */

import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle, Pressable } from "react-native"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import {
  FELLOWSHIP_COLORS,
  hydrateNext,
  type TREXJSON,
  Fellowship,
} from "@common"

interface LiveMeetingRowProps {
  /** Meeting data with trex */
  meeting: MeetingWithTrex
  /** Callback when row is pressed */
  onPress?: (meeting: MeetingWithTrex) => void
}

/**
 * Get formatted start time from TREX data
 */
function getStartTime(trex: MeetingWithTrex["trex"]): string {
  if (!trex) return ""

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
  if (!result.ok) return ""

  return result.value.toLocal().toFormat("h:mma").toLowerCase()
}

/**
 * LiveMeetingRow displays a condensed meeting row.
 *
 * @example
 * <LiveMeetingRow
 *   meeting={meeting}
 *   onPress={(m) => openPopup(m)}
 * />
 */
export const LiveMeetingRow: FC<LiveMeetingRowProps> = ({
  meeting,
  onPress,
}) => {
  const { themed, theme } = useAppTheme()

  const startTime = useMemo(() => getStartTime(meeting.trex), [meeting.trex])

  const fellowshipColor = useMemo(() => {
    return FELLOWSHIP_COLORS[meeting.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]
  }, [meeting.fellowship])

  return (
    <Pressable
      style={themed($container)}
      onPress={() => onPress?.(meeting)}
    >
      {/* Fellowship Badge */}
      <View style={[$fellowshipBadge, { borderColor: theme.colors.tint, shadowColor: theme.colors.tint }]}>
        <Text style={[$fellowshipText, { color: fellowshipColor }]}>
          {meeting.fellowship || "?"}
        </Text>
      </View>

      {/* Meeting Name */}
      <Text style={themed($meetingName)} numberOfLines={1}>
        {meeting.name}
      </Text>

      {/* Start Time */}
      <Text style={themed($timeText)}>{startTime}</Text>

      {/* Language */}
      {meeting.language && (
        <Text style={themed($languageText)}>
          {meeting.language.toUpperCase()}
        </Text>
      )}
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

const $timeText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
  marginLeft: "auto",
})

const $languageText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  color: colors.textDim,
  marginLeft: 4,
})
