/**
 * ToolResultRenderer Component
 *
 * Dispatches tool-result parts to the appropriate renderer based on toolName.
 * Handles collapse state and selection callbacks.
 */
import { FC, useCallback } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import type { MeetingWithTrex } from "@/context/MeetingContext"
import { useConversationStore } from "@/models"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { MeetingResultsCard } from "./MeetingResultsCard"

/**
 * Tool result part structure from Vercel AI SDK
 */
interface ToolResultPart {
  type: "tool-result"
  toolCallId: string
  toolName: string
  result: unknown
}

interface ToolResultRendererProps {
  /** The tool-result part from the message */
  part: ToolResultPart
  /** Parent message ID */
  messageId: string
  /** Called when user selects a meeting from results */
  onSelectMeeting: (meeting: MeetingWithTrex, toolCallId: string) => void
}

/** Tool names that render as meeting results */
const MEETING_TOOLS = new Set([
  "searchMeetings",
  "search_meetings",
  "getLiveMeetings",
  "get_live_meetings",
  "findMeetings",
  "find_meetings",
  "findMeetingsByFellowship",
  "find_meetings_by_fellowship",
])

/**
 * ToolResultRenderer dispatches tool results to specialized renderers.
 * Unrecognized tools render as a default badge.
 */
export const ToolResultRenderer: FC<ToolResultRendererProps> = ({ part, onSelectMeeting }) => {
  const { themed, theme } = useAppTheme()
  const conversationStore = useConversationStore()

  // Get collapse state for this tool call
  const collapseState = conversationStore.getCollapseState(part.toolCallId)
  const isCollapsed = collapseState !== null

  // Handle meeting selection
  const handleSelectMeeting = useCallback(
    (meeting: MeetingWithTrex) => {
      onSelectMeeting(meeting, part.toolCallId)
    },
    [onSelectMeeting, part.toolCallId],
  )

  // Render meeting tools with MeetingResultsCard
  if (MEETING_TOOLS.has(part.toolName)) {
    return (
      <MeetingResultsCard
        toolCallId={part.toolCallId}
        result={part.result as Record<string, unknown>}
        isCollapsed={isCollapsed}
        collapsedSummary={collapseState?.summary}
        onSelectMeeting={handleSelectMeeting}
      />
    )
  }

  // Default: render a simple badge for unrecognized tools
  return (
    <View style={themed($defaultBadge)}>
      <Ionicons name="checkmark-done" size={14} color={theme.colors.textDim} />
      <Text style={themed($defaultText)}>{part.toolName} completed</Text>
    </View>
  )
}

const $defaultBadge: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.sm,
  backgroundColor: colors.background,
  borderRadius: 8,
  marginTop: spacing.xs,
})

const $defaultText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  fontStyle: "italic",
})
