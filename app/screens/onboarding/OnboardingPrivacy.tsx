/**
 * OnboardingPrivacy - Screen 4
 *
 * Data privacy assurances and documentation links
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, Pressable, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

// Privacy bullet items with icons
const PRIVACY_ITEMS = [
  { icon: "phone-portrait-outline", txKey: "dataOnDevice" },
  // { icon: "eye-off-outline", txKey: "noTracking" },
  { icon: "finger-print-outline", txKey: "totalAnonymity" },
  { icon: "cloud-outline", txKey: "minimalNetwork" },
  { icon: "lock-closed-outline", txKey: "encryptedStorage" },
  { icon: "shield-checkmark-outline", txKey: "hipaaCompliant" },
  { icon: "code-outline", txKey: "openSource" },
] as const

export const OnboardingPrivacy: FC<OnboardingScreenProps<"OnboardingPrivacy">> = observer(
  function OnboardingPrivacy(_props) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()

    const handleFinish = () => {
      profileStore.completeOnboarding()
    }

    const handleSkip = () => {
      profileStore.completeOnboarding()
    }

    const openPrivacyPolicy = () => {
      Linking.openURL("https://recoverysky.org/privacy.html")
    }

    const openTerms = () => {
      Linking.openURL("https://recoverysky.org/tos.html")
    }

    return (
      <Screen preset="fixed" safeAreaEdges={["top", "bottom"]} contentContainerStyle={themed($container)}>
        {/* Progress dots - 6th active */}
        <View style={$progress}>
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, { backgroundColor: theme.colors.tint }]} />
        </View>

        {/* Content */}
        <View style={$content}>
          <Text style={themed($title)} tx="onboarding:privacyTitle" />
          <Text style={themed($subtitle)} tx="onboarding:privacySubtitle" />

          {/* Privacy bullets */}
          <View style={themed($privacyList)}>
            {PRIVACY_ITEMS.map((item) => (
              <View key={item.txKey} style={themed($privacyRow)}>
                <Ionicons
                  name={item.icon as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={theme.colors.tint}
                />
                <Text style={themed($privacyText)} tx={`onboarding:${item.txKey}`} />
              </View>
            ))}
          </View>

          {/* Links - inline */}
          <View style={themed($linksRow)}>
            <Pressable onPress={openPrivacyPolicy} style={themed($linkButton)}>
              <Text style={[themed($linkText), { color: theme.colors.tint }]} tx="onboarding:privacyPolicy" />
              <Ionicons name="open-outline" size={14} color={theme.colors.tint} />
            </Pressable>
            <Text style={themed($linkSeparator)}>|</Text>
            <Pressable onPress={openTerms} style={themed($linkButton)}>
              <Text style={[themed($linkText), { color: theme.colors.tint }]} tx="onboarding:termsOfService" />
              <Ionicons name="open-outline" size={14} color={theme.colors.tint} />
            </Pressable>
          </View>
        </View>

        {/* Footer */}
        <View style={themed($footer)}>
          <Pressable
            style={[themed($button), { borderColor: theme.colors.tint, shadowColor: theme.colors.tint }]}
            onPress={handleFinish}
          >
            <Text style={[themed($buttonText), { color: theme.colors.tint }]} tx="onboarding:finish" />
          </Pressable>

          <Pressable onPress={handleSkip} style={$skipButton}>
            <Text style={themed($skipText)} tx="onboarding:skipForNow" />
          </Pressable>
        </View>
      </Screen>
    )
  }
)

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
})

const $progress: ViewStyle = {
  flexDirection: "row",
  justifyContent: "center",
  gap: 8,
  paddingVertical: 16,
}

const $dot: ViewStyle = {
  width: 8,
  height: 8,
  borderRadius: 4,
}

const $dotInactive: ViewStyle = {
  backgroundColor: "rgba(255, 255, 255, 0.3)",
}

const $content: ViewStyle = {
  flex: 1,
  paddingTop: 32,
}

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 28,
  fontWeight: "700",
  lineHeight: 38,
  color: colors.text,
  marginBottom: 8,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 16,
  color: colors.textDim,
  marginBottom: spacing.lg,
})

const $privacyList: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.sm,
})

const $privacyRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  paddingVertical: spacing.xs,
})

const $privacyText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  color: colors.text,
  flex: 1,
})

const $linksRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  marginTop: spacing.lg,
  gap: spacing.sm,
})

const $linkButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $linkSeparator: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 14,
})

const $linkText: ThemedStyle<TextStyle> = () => ({
  fontSize: 15,
  fontWeight: "500",
})

const $footer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.lg,
  gap: spacing.md,
})

const $button: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  backgroundColor: colors.background,
  borderWidth: 1.5,
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  alignItems: "center",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $buttonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 18,
  fontWeight: "600",
})

const $skipButton: ViewStyle = {
  alignItems: "center",
  paddingVertical: 12,
}

const $skipText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})
