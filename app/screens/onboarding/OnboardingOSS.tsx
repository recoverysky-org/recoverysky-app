/**
 * OnboardingOSS - Screen 6 (Final)
 *
 * Open Source Software explanation and AGPLv3 license info
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, Pressable, Image, ImageStyle, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { ProgressDots } from "./ProgressDots"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ossImage = require("@assets/images/OSS.png")

// OSS benefit items with icons
const OSS_BENEFITS = [
  { icon: "eye-outline", txKey: "ossTransparency" },
  { icon: "shield-checkmark-outline", txKey: "ossSecurity" },
  // { icon: "code-slash-outline", txKey: "ossReview" },
] as const

export const OnboardingOSS: FC<OnboardingScreenProps<"OnboardingOSS">> = observer(
  function OnboardingOSS(_props) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()

    const handleFinish = () => {
      profileStore.completeOnboarding()
    }

    const handleSkip = () => {
      profileStore.completeOnboarding()
    }

    const openSourceCode = () => {
      Linking.openURL("https://github.com/recoverysky-org/recoverysky-app")
    }

    const openLicense = () => {
      Linking.openURL("https://www.gnu.org/licenses/agpl-3.0.html")
    }

    return (
      <Screen
        preset="scroll"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        {/* Progress dots */}
        <ProgressDots currentIndex={6} />

        {/* Content */}
        <View style={$content}>
          {/* OSS Image */}
          <View style={themed($imageContainer)}>
            <Image source={ossImage} style={$ossImage} resizeMode="contain" />
          </View>

          <Text style={themed($title)} tx="onboarding:ossTitle" />
          <Text style={themed($subtitle)} tx="onboarding:ossSubtitle" />

          {/* OSS benefits */}
          <View style={themed($benefitsList)}>
            {OSS_BENEFITS.map((item) => (
              <View key={item.txKey} style={themed($benefitRow)}>
                <Ionicons
                  name={item.icon as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={theme.colors.tint}
                />
                <Text style={themed($benefitText)} tx={`onboarding:${item.txKey}`} />
              </View>
            ))}
          </View>

          {/* Links */}
          <View style={themed($linksRow)}>
            <Pressable
              onPress={openSourceCode}
              style={themed($linkButton)}
              accessibilityRole="link"
              accessibilityLabel={translate("onboarding:viewSource")}
            >
              <Ionicons name="logo-github" size={18} color={theme.colors.tint} />
              <Text style={themed($linkText)} tx="onboarding:viewSource" />
            </Pressable>
            <Text style={themed($linkSeparator)}>|</Text>
            <Pressable
              onPress={openLicense}
              style={themed($linkButton)}
              accessibilityRole="link"
              accessibilityLabel={translate("onboarding:viewLicense")}
            >
              <Ionicons name="document-outline" size={18} color={theme.colors.tint} />
              <Text style={themed($linkText)} tx="onboarding:viewLicense" />
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
            onPress={handleFinish}
            accessibilityRole="button"
            accessibilityLabel={translate("onboarding:finish")}
          >
            <Text
              style={[themed($buttonText), { color: theme.colors.tint }]}
              tx="onboarding:finish"
            />
          </Pressable>

          <Pressable
            onPress={handleSkip}
            style={$skipButton}
            accessibilityRole="button"
            accessibilityLabel={translate("onboarding:skipForNow")}
          >
            <Text style={themed($skipText)} tx="onboarding:skipForNow" />
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
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
})

const $content: ViewStyle = {
  flex: 1,
  paddingTop: 16,
}

const $imageContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  marginBottom: spacing.md,
})

const $ossImage: ImageStyle = {
  width: 120,
  height: 120,
}

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 28,
  fontWeight: "700",
  lineHeight: 38,
  color: colors.text,
  marginBottom: 8,
  textAlign: "center",
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 16,
  color: colors.textDim,
  marginBottom: spacing.lg,
  textAlign: "center",
})

const $benefitsList: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.sm,
  marginBottom: spacing.md,
})

const $benefitRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  paddingVertical: spacing.xs,
})

const $benefitText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  color: colors.text,
  flex: 1,
})

const $linksRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  marginTop: spacing.sm,
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

const $linkText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  fontWeight: "500",
  color: colors.tint,
})

const $footer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.lg,
  paddingTop: spacing.md,
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
