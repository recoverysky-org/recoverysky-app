/**
 * HelpCard Component
 *
 * Dismissible help/tip card for the Home screen.
 * Features:
 * - Icon + title + description
 * - Optional action button with glowing outline
 * - Dismiss X button (top-right)
 * - Slide-out animation on dismiss
 */

import { FC, useRef } from "react"
import { View, ViewStyle, TextStyle, Pressable, Animated, Dimensions } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import { translate, type TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

const SCREEN_WIDTH = Dimensions.get("window").width

export interface HelpCardProps {
  /** Ionicons icon name */
  icon: keyof typeof Ionicons.glyphMap
  /** i18n key for title */
  titleTx: TxKeyPath
  /** i18n key for description */
  descriptionTx: TxKeyPath
  /** i18n key for action button (optional) */
  actionTx?: TxKeyPath
  /** Called when action button pressed */
  onAction?: () => void
  /** Called when card is dismissed */
  onDismiss: () => void
}

export const HelpCard: FC<HelpCardProps> = function HelpCard({
  icon,
  titleTx,
  descriptionTx,
  actionTx,
  onAction,
  onDismiss,
}) {
  const { themed, theme } = useAppTheme()
  const slideAnim = useRef(new Animated.Value(0)).current

  const handleDismiss = () => {
    // Slide out to the left
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
        accessibilityRole="button"
        accessibilityLabel={translate("common:close")}
      >
        <Text style={[themed($dismissText), { color: theme.colors.tint }]} tx="common:close" />
      </Pressable>

      {/* Icon + Title row */}
      <View style={$headerRow}>
        <Ionicons name={icon} size={24} color={theme.colors.tint} />
        <Text style={themed($title)} tx={titleTx} />
      </View>

      {/* Description */}
      <Text style={themed($description)} tx={descriptionTx} />

      {/* Action button (optional) */}
      {actionTx && onAction && (
        <Pressable
          style={[
            themed($actionButton),
            { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
          ]}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={translate(actionTx)}
        >
          <Text style={[themed($actionButtonText), { color: theme.colors.tint }]} tx={actionTx} />
        </Pressable>
      )}
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
  paddingRight: 24, // Space for dismiss button
}

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.text,
})

const $description: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 15,
  color: colors.textDim,
  lineHeight: 22,
  marginBottom: spacing.md,
})

const $actionButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderWidth: 1.5,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  borderRadius: 10,
  alignItems: "center",
  alignSelf: "flex-start",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 6,
  elevation: 6,
})

const $actionButtonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 15,
  fontWeight: "600",
})
