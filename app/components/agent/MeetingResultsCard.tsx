/**
 * MeetingResultsCard Component
 *
 * Renders a list of meetings from AI tool results.
 * - Expanded: Shows MeetingRow for each meeting
 * - Collapsed: Shows summary badge with selected meeting name
 */
import { FC, useMemo } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { MeetingRow } from "@/components/MeetingRow"
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

/**
 * Whether MeetingRow can draw this. It calls `language.toUpperCase()`, hands `name` and `fellowship`
 * to Text as children (an object there throws) and gives `millis` to luxon (a non-number throws).
 * A missing field is fine: the row draws what is there.
 */
function isDrawableMeeting(value: unknown): value is MeetingWithTrex {
  if (typeof value !== "object" || value === null) return false
  const { name, fellowship, language, millis } = value as Record<string, unknown>
  return (
    typeof name === "string" &&
    (fellowship === undefined || fellowship === null || typeof fellowship === "string") &&
    (language === undefined || language === null || typeof language === "string") &&
    (millis === undefined || millis === null || typeof millis === "number")
  )
}

/**
 * The meetings in a tool result, from the first of its fields that is a list.
 *
 * ADDED 2026-11-06 (final review, spec D1: never a crash). The result is typed as what we expect,
 * but it can be read back from the agent with nothing checked. A throw in render comes back on every
 * open of a thread holding that row, with the tab dead and New conversation out of reach.
 */
function meetingsOfResult(result: unknown): MeetingWithTrex[] {
  if (typeof result !== "object" || result === null) return []
  const { meetings, results, data } = result as Record<string, unknown>
  const list = [meetings, results, data].find((field) => Array.isArray(field)) as
    | unknown[]
    | undefined
  return list?.filter(isDrawableMeeting) ?? []
}

export const MeetingResultsCard: FC<MeetingResultsCardProps> = ({
  result,
  isCollapsed,
  collapsedSummary,
  onSelectMeeting,
}) => {
  const { themed, theme } = useAppTheme()
  const { t } = useTranslation()

  // Extract meetings from various possible result structures (limit to 10)
  const MAX_DISPLAY = 10
  // CHANGED 2026-11-06 (final review): picks by Array.isArray rather than `??`, which threw on the
  // `.slice` below for a field that was an object, and on `.length` further down for a number.
  const allMeetings = useMemo(() => meetingsOfResult(result), [result])
  const meetings = allMeetings.slice(0, MAX_DISPLAY)
  const hasMore = allMeetings.length > MAX_DISPLAY

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
        {/* Decorative — the adjacent text already says "meetings". */}
        <Ionicons
          name="calendar-outline"
          size={14}
          color={theme.colors.tint}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <Text style={themed($headerText)} accessibilityRole="header">
          {hasMore
            ? `Showing ${meetings.length} of ${allMeetings.length} meetings`
            : t("agentScreen:meetingsFound", { count: allMeetings.length })}
        </Text>
      </View>

      <View style={themed($meetingsList)}>
        {meetings.map((meeting) => (
          <MeetingRow
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
