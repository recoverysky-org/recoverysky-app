/**
 * CollapsedResultBadge Component
 *
 * Displays a compact summary badge after a tool result has been interacted with.
 * Example: "Selected: Morning Meditation Meeting"
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface CollapsedResultBadgeProps {
  /** Summary text to display */
  summary: string
  /** Optional icon name (defaults to checkmark-circle) */
  icon?: keyof typeof Ionicons.glyphMap
}

export const CollapsedResultBadge: FC<CollapsedResultBadgeProps> = ({
  summary,
  icon = "checkmark-circle",
}) => {
  const { themed, theme } = useAppTheme()

  return (
    <View style={themed($badge)}>
      <Ionicons name={icon} size={14} color={theme.colors.tint} />
      <Text style={themed($text)} numberOfLines={1}>
        {summary}
      </Text>
    </View>
  )
}

const $badge: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.sm,
  backgroundColor: colors.tint + "15",
  borderRadius: 8,
  borderWidth: 1,
  borderColor: colors.tint + "30",
})

const $text: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.tint,
  flex: 1,
})
