/**
 * NewsCard Component
 *
 * Dismissible news/announcement card for the Home screen.
 * Features:
 * - Icon + dynamic title + body from API
 * - Dismiss X button (top-right)
 * - Slide-out animation on dismiss (same as HelpCard)
 */

import { FC, useRef } from "react"
import { View, ViewStyle, TextStyle, Pressable, Animated, Dimensions } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

const SCREEN_WIDTH = Dimensions.get("window").width

export interface NewsCardProps {
  /** The news title from the API */
  title: string
  /** The news body from the API */
  body: string
  /** Called when card is dismissed */
  onDismiss: () => void
}

export const NewsCard: FC<NewsCardProps> = function NewsCard({ title, body, onDismiss }) {
  const { themed, theme } = useAppTheme()
  const slideAnim = useRef(new Animated.Value(0)).current

  const handleDismiss = () => {
    Animated.timing(slideAnim, {
      toValue: -SCREEN_WIDTH,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      onDismiss()
    })
  }

  return (
    <Animated.View
      style={[
        themed($card),
        {
          transform: [{ translateX: slideAnim }],
        },
      ]}
    >
      {/* Dismiss button */}
      <Pressable
        style={themed($dismissButton)}
        onPress={handleDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={[themed($dismissText), { color: theme.colors.tint }]} tx="common:close" />
      </Pressable>

      {/* Icon + Title row */}
      <View style={$headerRow}>
        <Ionicons name="megaphone-outline" size={24} color={theme.colors.tint} />
        <Text style={themed($title)} text={title} />
      </View>

      {/* News body (plain string from API) */}
      <Text style={themed($description)} text={body} />
    </Animated.View>
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

const $dismissButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  position: "absolute",
  top: spacing.sm,
  right: spacing.sm,
  zIndex: 1,
  paddingVertical: 2,
  paddingHorizontal: spacing.xs,
})

const $dismissText: ThemedStyle<TextStyle> = () => ({
  fontSize: 13,
  fontWeight: "600",
})

const $headerRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  marginBottom: 8,
  paddingRight: 24,
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
