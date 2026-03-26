/**
 * TermsScreen - Displays Terms & Conditions (EUA + Disclaimer)
 *
 * Read-only view with Close button. Presented as a modal from Settings.
 * Content fetched from CMS via API.
 */
import { FC, useState, useEffect, useRef } from "react"
import { View, ViewStyle, TextStyle, Pressable, ScrollView, ActivityIndicator } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation } from "@react-navigation/native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Text } from "@/components/Text"
import { api } from "@/services/api"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/** Strip HTML tags and convert to readable plain text */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export const TermsScreen: FC = function TermsScreen() {
  const navigation = useNavigation()
  const { themed, theme } = useAppTheme()
  const insets = useSafeAreaInsets()

  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const fetched = useRef(false)

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    api
      .getContent("disclaimer")
      .then((result) => {
        if (result.kind === "ok") setContent(htmlToText(result.content))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <View style={[themed($container), { paddingTop: insets.top }]}>
      <View style={themed($header)}>
        <Text style={themed($title)} tx="settingsScreen:termsAndConditions" />
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>
      </View>
      <ScrollView style={$scroll} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {loading ? (
          <ActivityIndicator size="large" color={theme.colors.tint} style={{ marginTop: 40 }} />
        ) : (
          <Text style={themed($body)}>{content}</Text>
        )}
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
