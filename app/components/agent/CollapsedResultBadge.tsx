/**
 * CollapsedResultBadge Component
 *
 * Displays a compact summary badge after a tool result has been interacted with.
 * Example: "Selected: Morning Meditation Meeting"
 *
 * CHANGED 2026-11-08: with `onPress` it is a button that opens the card again. A Sky meeting card
 * collapses when the person closes a meeting they opened from it, and before this the card's other
 * meetings stayed out of reach until a restart, though the agent tells Sky every meeting a call
 * returns reaches the person as a card they can tap.
 */
import { FC } from "react"
import { Pressable, View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface CollapsedResultBadgeProps {
  /** Summary text to display */
  summary: string
  /** Optional icon name (defaults to checkmark-circle) */
  icon?: keyof typeof Ionicons.glyphMap
  /** Opens the card again. Without it the badge is plain text. */
  onPress?: () => void
}

export const CollapsedResultBadge: FC<CollapsedResultBadgeProps> = ({
  summary,
  icon = "checkmark-circle",
  onPress,
}) => {
  const { themed, theme } = useAppTheme()
  const { t } = useTranslation()

  const content = (
    <>
      <Ionicons
        name={icon}
        size={14}
        color={theme.colors.tint}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={themed($text)} numberOfLines={1}>
        {summary}
      </Text>
      {onPress ? (
        // Decorative: the button's hint says what a tap does.
        <Ionicons
          name="chevron-down"
          size={14}
          color={theme.colors.tint}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
    </>
  )

  if (!onPress) return <View style={themed($badge)}>{content}</View>

  return (
    <Pressable
      style={({ pressed }) => [themed($badge), pressed && $pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={summary}
      accessibilityHint={t("agentScreen:showMeetingsAgain")}
    >
      {content}
    </Pressable>
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

const $pressed: ViewStyle = { opacity: 0.7 }

const $text: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.tint,
  flex: 1,
})
