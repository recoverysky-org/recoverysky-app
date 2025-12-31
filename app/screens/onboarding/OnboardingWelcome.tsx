/**
 * OnboardingWelcome - Screen 0
 *
 * Welcome intro screen with recovery message
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, Pressable, Image, ImageStyle } from "react-native"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { ProgressDots } from "./ProgressDots"

const welcomeImage = require("@assets/images/welcome-face.png")

export const OnboardingWelcome: FC<OnboardingScreenProps<"OnboardingWelcome">> =
  function OnboardingWelcome({ navigation }) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()

    const handleGetStarted = () => {
      navigation.navigate("OnboardingProfile")
    }

    const handleSkip = () => {
      profileStore.completeOnboarding()
    }

    return (
      <Screen
        preset="fixed"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        {/* Progress dots */}
        <ProgressDots currentIndex={0} />

        {/* Content */}
        <View style={$content}>
          <Image source={welcomeImage} style={$welcomeImage} resizeMode="contain" />

          <Text style={themed($title)} tx="onboarding:welcomeTitle" />
          <Text style={themed($subtitle)} tx="onboarding:welcomeSubtitle" />
        </View>

        {/* Footer */}
        <View style={themed($footer)}>
          <Pressable
            style={[
              themed($button),
              { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
            ]}
            onPress={handleGetStarted}
          >
            <Text
              style={[themed($buttonText), { color: theme.colors.tint }]}
              tx="onboarding:getStarted"
            />
          </Pressable>

          <Pressable onPress={handleSkip} style={$skipButton}>
            <Text style={themed($skipText)} tx="onboarding:skipForNow" />
          </Pressable>
        </View>
      </Screen>
    )
  }

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
  justifyContent: "center",
  alignItems: "center",
  paddingTop: 16,
}

const $welcomeImage: ImageStyle = {
  width: 200,
  height: 200,
  marginBottom: 32,
}

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 28,
  fontWeight: "700",
  lineHeight: 38,
  color: colors.text,
  textAlign: "center",
  marginBottom: 16,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.textDim,
  textAlign: "center",
  lineHeight: 24,
  paddingHorizontal: 20,
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
