/**
 * TermsScreen - Displays Terms & Conditions (EUA + Disclaimer)
 *
 * Read-only view with Close button. Presented as a modal from Settings.
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, Pressable, ScrollView } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { getDisclaimerText } from "@assets/content"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export const TermsScreen: FC = function TermsScreen() {
  const navigation = useNavigation()
  const { themed, theme } = useAppTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={[themed($container), { paddingTop: insets.top }]}>
      <View style={themed($header)}>
        <Text style={themed($title)} tx="settingsScreen:termsAndConditions" />
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>
      </View>
      <ScrollView style={$scroll} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <Text style={themed($body)}>{getDisclaimerText()}</Text>
      </ScrollView>
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flex: 1,
  backgroundColor: colors.background,
})

const $header: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.sm,
  paddingBottom: spacing.sm,
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.text,
})

const $scroll: ViewStyle = {
  flex: 1,
  paddingHorizontal: 20,
  paddingTop: 20,
}

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  lineHeight: 22,
  color: colors.text,
})

const $divider: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  height: 1,
  backgroundColor: colors.separator,
  marginVertical: spacing.xl,
})
