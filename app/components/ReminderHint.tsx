/**
 * ReminderHint — "Tap times to set reminders" under a meeting popup's schedule grid.
 *
 * ADDED 2026-11-19 (Jenova): the hint was 11pt grey text in each popup and easy to miss, so few
 * people found reminders. It now carries a bell and the tint (the grid cells' colour, so it reads
 * as being about them), at 13pt medium. Shared by SchedulePopup and InPersonPopup, which pass their
 * own string key and spacing.
 *
 * Not a button: the grid's cells are what take the tap. The bell is decoration and hidden from
 * screen readers; the text is read as it is.
 */
import { FC } from "react"
import { StyleProp, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import type { TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export interface ReminderHintProps {
  tx: TxKeyPath
  style?: StyleProp<ViewStyle>
}

export const ReminderHint: FC<ReminderHintProps> = ({ tx, style }) => {
  const { themed, theme } = useAppTheme()
  return (
    <View style={[themed($row), style]}>
      <Ionicons
        name="notifications-outline"
        size={16}
        color={theme.colors.tint}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text tx={tx} weight="medium" style={themed($text)} />
    </View>
  )
}

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  alignSelf: "center",
  flexDirection: "row",
  gap: spacing.xs,
  marginTop: spacing.sm,
})

const $text: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 13,
})
