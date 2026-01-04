/**
 * MeetingResultsCard Component
 *
 * Renders a list of meetings from AI tool results.
 * - Expanded: Shows LiveMeetingRow for each meeting
 * - Collapsed: Shows summary badge with selected meeting name
 */
import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { LiveMeetingRow } from "@/components/LiveMeetingRow"
import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { CollapsedResultBadge } from "./CollapsedResultBadge"

/**
 * Expected structure from tool results.
 * The backend may return meetings in various formats.
 */
interface MeetingToolResult {
  meetings?: MeetingWithTrex[]
  results?: MeetingWithTrex[]
  data?: MeetingWithTrex[]
  query?: string
  count?: number
}

interface MeetingResultsCardProps {
  /** Tool call ID for tracking */
  toolCallId: string
  /** Tool result data */
  result: MeetingToolResult
  /** Whether this result is collapsed */
  isCollapsed: boolean
  /** Summary text when collapsed */
  collapsedSummary?: string
  /** Called when user selects a meeting */
  onSelectMeeting?: (meeting: MeetingWithTrex) => void
}

export const MeetingResultsCard: FC<MeetingResultsCardProps> = ({
  result,
  isCollapsed,
  collapsedSummary,
  onSelectMeeting,
}) => {
  const { themed, theme } = useAppTheme()
  const { t } = useTranslation()

  // Extract meetings from various possible result structures
  const meetings = useMemo(() => {
    if (!result) return []
    return result.meetings ?? result.results ?? result.data ?? []
  }, [result])

  // Collapsed view
  if (isCollapsed && collapsedSummary) {
    return <CollapsedResultBadge summary={collapsedSummary} />
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
        <Ionicons name="calendar-outline" size={14} color={theme.colors.tint} />
        <Text style={themed($headerText)}>
          {t("agentScreen:meetingsFound", { count: meetings.length })}
        </Text>
      </View>

      <View style={themed($meetingsList)}>
        {meetings.map((meeting) => (
          <LiveMeetingRow
            key={meeting.id}
            meeting={meeting}
            rating={meeting.feedback?.rates ?? 0}
            isFavorite={meeting.feedback?.loves ?? false}
            onPress={onSelectMeeting}
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
