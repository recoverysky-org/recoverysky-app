/**
 * OnboardingTheme - Screen 3
 *
 * Dark/Light mode toggle and Theme Color picker
 */
import { FC, useState } from "react"
import { View, ViewStyle, TextStyle, Pressable, Switch } from "react-native"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { ThemeColorPicker } from "@/components/ThemeColorPicker"
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { ProgressDots } from "./ProgressDots"

export const OnboardingTheme: FC<OnboardingScreenProps<"OnboardingTheme">> = observer(
  function OnboardingTheme({ navigation }) {
    const { themed, theme, setThemeContextOverride } = useAppTheme()
    const profileStore = useProfileStore()
    const [colorPickerVisible, setColorPickerVisible] = useState(false)

    const handleNext = () => {
      navigation.navigate("OnboardingAttendance")
    }

    const handleSkip = () => {
      profileStore.completeOnboarding()
    }

    const toggleDarkMode = () => {
      setThemeContextOverride(theme.isDark ? "light" : "dark")
    }

    return (
      <Screen
        preset="fixed"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        {/* Progress dots */}
        <ProgressDots currentIndex={3} />

        {/* Content */}
        <View style={$content}>
          <Text style={themed($title)} tx="onboarding:themeTitle" />
          <Text style={themed($subtitle)} tx="onboarding:themeSubtitle" />

          {/* Dark Mode Toggle */}
          <View style={themed($settingRow)}>
            <Text style={themed($settingLabel)} tx="onboarding:darkMode" />
            <Switch
              value={theme.isDark}
              onValueChange={toggleDarkMode}
              trackColor={{ false: "#767577", true: theme.colors.tint }}
              thumbColor="#fff"
              accessibilityLabel={translate("onboarding:darkMode")}
            />
          </View>

          {/* Theme Color */}
          <Pressable
            style={themed($settingRow)}
            onPress={() => setColorPickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={translate("onboarding:themeColor")}
          >
            <Text style={themed($settingLabel)} tx="onboarding:themeColor" />
            <View style={$colorPreviewRow}>
              <View style={[$colorPreview, { backgroundColor: theme.colors.tint }]} />
            </View>
          </Pressable>
        </View>

        {/* Color Picker Modal */}
        <ThemeColorPicker
          visible={colorPickerVisible}
          onClose={() => setColorPickerVisible(false)}
        />

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
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
})

const $content: ViewStyle = {
  flex: 1,
  paddingTop: 48,
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
  marginBottom: spacing.xl,
})

const $settingRow: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: spacing.md,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
})

const $settingLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})

const $colorPreviewRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
}

const $colorPreview: ViewStyle = {
  width: 28,
  height: 28,
  borderRadius: 14,
}

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
