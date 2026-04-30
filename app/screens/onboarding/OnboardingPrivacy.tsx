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
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { ProgressDots } from "./ProgressDots"

// Privacy bullet items with icons
const PRIVACY_ITEMS = [
  { icon: "finger-print-outline", txKey: "totalAnonymity" },
  { icon: "phone-portrait-outline", txKey: "dataOnDevice" },
  { icon: "lock-closed-outline", txKey: "encryptedStorage" },
  { icon: "shield-checkmark-outline", txKey: "hipaaCompliant" },
] as const

export const OnboardingPrivacy: FC<OnboardingScreenProps<"OnboardingPrivacy">> = observer(
  function OnboardingPrivacy({ navigation }) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()

    const handleNext = () => {
      trackEvent("onboarding_step", { step: "privacy" })
      navigation.navigate("OnboardingOSS")
    }


    const openPrivacyPolicy = () => {
      Linking.openURL("https://www.recoverysky.app/content/RecoverySky_Content/privacy")
    }

    const openTerms = () => {
      Linking.openURL("https://www.recoverysky.app/content/RecoverySky_Content/terms")
    }

    return (
      <Screen
        preset="fixed"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        {/* Progress dots */}
        <ProgressDots currentIndex={6} />

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
            <Pressable
              onPress={openPrivacyPolicy}
              style={themed($linkButton)}
              accessibilityRole="link"
              accessibilityLabel={translate("onboarding:privacyPolicy")}
            >
              <Text
                style={[themed($linkText), { color: theme.colors.tint }]}
                tx="onboarding:privacyPolicy"
              />
              <Ionicons name="open-outline" size={14} color={theme.colors.tint} />
            </Pressable>
            <Text style={themed($linkSeparator)}>|</Text>
            <Pressable
              onPress={openTerms}
              style={themed($linkButton)}
              accessibilityRole="link"
              accessibilityLabel={translate("onboarding:termsOfService")}
            >
              <Text
                style={[themed($linkText), { color: theme.colors.tint }]}
                tx="onboarding:termsOfService"
              />
              <Ionicons name="open-outline" size={14} color={theme.colors.tint} />
            </Pressable>
          </View>
        </View>

        {/* Footer */}
        <View style={themed($footer)}>
          <Pressable
            style={[
              themed($button),
              { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
            ]}
            onPress={handleNext}
            accessibilityRole="button"
            accessibilityLabel={translate("onboarding:next")}
          >
            <Text
              style={[themed($buttonText), { color: theme.colors.tint }]}
              tx="onboarding:next"
            />
          </Pressable>

        </View>
      </Screen>
    )
  },
)

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
})

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

