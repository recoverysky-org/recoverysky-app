/**
 * ToolResultRenderer Component
 *
 * Draws a finished tool call: a meeting card when its answer holds meetings, else a finished badge.
 * Handles collapse state and selection callbacks.
 *
 * CHANGED 2026-11-08: decided by the answer's shape (`meetingsOfToolOutput`,
 * `utils/agentMeetingsLogic.ts`), not by tool name. The name list held only the retired tools
 * (`searchMeetings`, `findMeetings`, `getLiveMeetings`, ...), so once Sky moved to meetings-mcp
 * (`find_meetings_now`, `get_meeting`, ...) every meeting answer drew a "completed" badge and no
 * meeting at all, while Sky's words, by design, name none: the cards are the only way a meeting
 * she offers reaches the person.
 *
 * CHANGED 2026-11-08 (routine card): a `get_today` answer from the Daily Dash draws the person's
 * routine (`todayOfToolOutput`, `utils/agentRoutineLogic.ts`; RoutineResultsCard), by shape too. On
 * a RecoverySky turn the agent tells Sky the card shows the routine, so she never lists it.
 */
import { FC, useCallback, useMemo } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useConversationStore } from "@/models"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { meetingsOfToolOutput, type SkyMeeting } from "@/utils/agentMeetingsLogic"
import { todayOfToolOutput } from "@/utils/agentRoutineLogic"

import { MeetingResultsCard } from "./MeetingResultsCard"
import { RoutineResultsCard } from "./RoutineResultsCard"

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
  /** Called when user selects a meeting from results, with the call it came from */
  onSelectMeeting: (meeting: SkyMeeting, toolCallId: string) => void
  /** Opens the My Day tab from a routine card; left out when there is no My Day tab */
  onOpenMyDay?: () => void
}

/**
 * ToolResultRenderer dispatches tool results to specialized renderers.
 * A result that holds no meetings and no routine renders as a finished badge.
 *
 * CHANGED 2026-11-06 (spec D5): an observer, because the collapse state now lives in the store's
 * volatile map. As a plain component it read the map once and the card would never redraw when
 * its popup closed.
 */
export const ToolResultRenderer: FC<ToolResultRendererProps> = observer(
  function ToolResultRenderer({ part, onSelectMeeting, onOpenMyDay }) {
    const { themed, theme } = useAppTheme()
    const { t } = useTranslation()
    const conversationStore = useConversationStore()

    // Get collapse state for this tool call
    const collapseState = conversationStore.getCollapseState(part.toolCallId)
    const isCollapsed = collapseState !== null

    // Parsed once per result: the text part is JSON, read on every redraw of the thread otherwise.
    const meetings = useMemo(() => meetingsOfToolOutput(part.result), [part.result])
    // Asked only of an answer that is not a meeting one: the two shapes never overlap, and the
    // meeting card keeps its place first.
    const today = useMemo(
      () => (meetings === null ? todayOfToolOutput(part.result) : null),
      [meetings, part.result],
    )

    // Handle meeting selection
    const handleSelectMeeting = useCallback(
      (meeting: SkyMeeting) => {
        onSelectMeeting(meeting, part.toolCallId)
      },
      [onSelectMeeting, part.toolCallId],
    )

    // ADDED 2026-11-08: a tap on the collapsed badge opens the card again (see expandToolResult).
    const handleExpand = useCallback(
      () => conversationStore.expandToolResult(part.toolCallId),
      [conversationStore, part.toolCallId],
    )

    if (meetings !== null) {
      return (
        <MeetingResultsCard
          meetings={meetings}
          isCollapsed={isCollapsed}
          collapsedSummary={collapseState?.summary}
          onSelectMeeting={handleSelectMeeting}
          onExpand={handleExpand}
        />
      )
    }

    // ADDED 2026-11-08: no collapse state. Nothing on the card is picked, so it never collapses.
    if (today !== null) {
      return <RoutineResultsCard today={today} onOpenMyDay={onOpenMyDay} />
    }

    // Any other tool, a refusal, or a retired tool's answer from an old thread.
    // CHANGED 2026-11-08: the screen's own translated words ("{{toolName}} finished"), the badge
    // AgentScreen draws for a finished call with no output; this one said "completed" in English.
    return (
      <View style={themed($defaultBadge)}>
        <Ionicons name="checkmark-done" size={14} color={theme.colors.textDim} />
        <Text style={themed($defaultText)}>
          {t("agentScreen:toolFinished", { toolName: part.toolName })}
        </Text>
      </View>
    )
  },
)

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
