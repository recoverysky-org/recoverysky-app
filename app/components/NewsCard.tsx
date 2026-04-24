/**
 * NewsCard Component
 *
 * Non-dismissible news/announcement card for the Home screen. Always visible
 * when the server returns a news payload — the card has no close affordance
 * because the server decides whether a user should see an announcement.
 */

import { FC } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export interface NewsCardProps {
  /** The news title from the API */
  title: string
  /** The news body from the API */
  body: string
}

export const NewsCard: FC<NewsCardProps> = function NewsCard({ title, body }) {
  const { themed, theme } = useAppTheme()

  return (
    <View style={themed($card)}>
      {/* Icon + Title row */}
      <View style={$headerRow}>
        <Ionicons name="megaphone-outline" size={24} color={theme.colors.tint} />
        <Text style={themed($title)} text={title} />
      </View>

      {/* News body (plain string from API) */}
      <Text style={themed($description)} text={body} />
    </View>
  )
}

// ============================================================================
// Styles
// ============================================================================

const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 16,
  padding: spacing.lg,
  marginBottom: spacing.md,
})

const $headerRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  marginBottom: 8,
}

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.text,
})

const $description: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  color: colors.textDim,
  lineHeight: 22,
})
