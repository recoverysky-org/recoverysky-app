/**
 * MeetingResultsCard Component
 *
 * Renders the meetings a Sky tool call returned.
 * - Expanded: Shows MeetingRow for each meeting
 * - Collapsed: Shows summary badge with selected meeting name
 *
 * CHANGED 2026-11-08: takes the meetings already read out of the tool result
 * (`meetingsOfToolOutput`, `utils/agentMeetingsLogic.ts`) instead of the raw result. The card used
 * to look for `meetings` / `results` / `data` on the output and cast each entry to
 * `MeetingWithTrex`, a shape no tool ever sent: meetings-mcp's results are an MCP envelope with the
 * JSON in a text part, and its Meeting has no `millis` or schedule. Each row is now MeetingRow over
 * `toRowMeeting`, and a tap hands back the Sky meeting, whose id and venue open the real schedule.
 */
import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { getLocales } from "expo-localization"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { MeetingRow } from "@/components/MeetingRow"
import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { cardShowsDay, toRowMeeting, type SkyMeeting } from "@/utils/agentMeetingsLogic"
import { formatDistance } from "@/utils/nearbyLogic"

import { CollapsedResultBadge } from "./CollapsedResultBadge"

interface MeetingResultsCardProps {
  /** The meetings the call returned, in the server's order (favorites first) */
  meetings: readonly SkyMeeting[]
  /** Whether this result is collapsed */
  isCollapsed: boolean
  /** Summary text when collapsed */
  collapsedSummary?: string
  /** Called when user selects a meeting */
  onSelectMeeting?: (meeting: SkyMeeting) => void
  /** Opens a collapsed card again, from a tap on its badge */
  onExpand?: () => void
}

export const MeetingResultsCard: FC<MeetingResultsCardProps> = ({
  meetings,
  isCollapsed,
  collapsedSummary,
  onSelectMeeting,
  onExpand,
}) => {
  const { themed, theme } = useAppTheme()
  const { t } = useTranslation()

  // CHANGED 2026-11-08: no cap. The card drew ten and said "Showing 10 of N" in English, but the
  // agent tells Sky every meeting a call returns reaches the person as a card, and she may talk
  // about any of them; she asks for as many as she means to offer (`limit`, at most 50).
  const rows = useMemo(
    () => meetings.map((meeting) => [meeting, toRowMeeting(meeting)] as const),
    [meetings],
  )
  // Read once per card, as the In-Person popup does: miles where the phone's region uses them.
  const useMiles = useMemo(() => getLocales()[0]?.measurementSystem === "us", [])
  // Decided when the card draws: a stored reply's card, reopened tomorrow, gains its weekdays.
  const showDay = cardShowsDay(meetings, Date.now())

  // Collapsed view
  // CHANGED 2026-11-08: the badge opens the card again. It collapses when a meeting opened from it
  // closes, and the agent tells Sky every meeting a call returns reaches the person as a card they
  // can tap, so the others must stay in reach ("offer both cards", `suggest_meetings`).
  if (isCollapsed && collapsedSummary) {
    return <CollapsedResultBadge summary={collapsedSummary} onPress={onExpand} />
  }

  // Empty results
  if (meetings.length === 0) {
    return (
      <View style={themed($emptyContainer)}>
        <Ionicons name="search-outline" size={16} color={theme.colors.textDim} />
        <Text style={themed($emptyText)} tx="agentScreen:noMeetingsFound" />
      </View>
    )
  }

  // Expanded view with meeting list
  return (
    <View style={themed($container)}>
      <View style={themed($header)}>
        {/* Decorative — the adjacent text already says "meetings". */}
        <Ionicons
          name="calendar-outline"
          size={14}
          color={theme.colors.tint}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <Text style={themed($headerText)} accessibilityRole="header">
          {t("agentScreen:meetingsFound", { count: meetings.length })}
        </Text>
      </View>

      <View style={themed($meetingsList)}>
        {rows.map(([meeting, row]) => (
          <MeetingRow
            key={meeting.id}
            meeting={row}
            // The server's heart, worked out from the hearts the app sent with this turn. It is
            // what Sky's words in the same reply were about ("two of your favorites are on").
            isFavorite={meeting.favorite}
            distanceLabel={formatDistance(meeting.distanceM ?? undefined, useMiles) || undefined}
            showDay={showDay}
            onPress={() => onSelectMeeting?.(meeting)}
          />
        ))}
      </View>

      <View style={themed($hint)}>
        <Text style={themed($hintText)} tx="agentScreen:tapToViewDetails" />
      </View>
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: colors.border,
  marginTop: spacing.xs,
  overflow: "hidden",
})

const $header: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xs,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
  backgroundColor: colors.tint + "10",
})

const $headerText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  fontWeight: "600",
  color: colors.tint,
})

const $meetingsList: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.xs,
})

const $hint: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xs,
  borderTopWidth: 1,
  borderTopColor: colors.border,
})

const $hintText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  color: colors.textDim,
  fontStyle: "italic",
  textAlign: "center",
})

const $emptyContainer: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.sm,
  backgroundColor: colors.card,
  borderRadius: 8,
  marginTop: spacing.xs,
})

const $emptyText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})
