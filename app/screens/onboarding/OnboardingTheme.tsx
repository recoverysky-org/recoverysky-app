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
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

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
        <View style={$progress}>
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, { backgroundColor: theme.colors.tint }]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
        </View>

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
            />
          </View>

          {/* Theme Color */}
          <Pressable style={themed($settingRow)} onPress={() => setColorPickerVisible(true)}>
            <Text style={themed($settingLabel)} tx="onboarding:themeColor" />
            <View style={$colorPreviewRow}>
              <View style={[$colorPreview, { backgroundColor: theme.colors.tint }]} />
            </View>
          </Pressable>

          {/* Color Preview */}
          <View style={themed($previewSection)}>
            <Text style={themed($previewLabel)}>Preview</Text>
            <View style={themed($previewCard)}>
              <View
                style={[
                  themed($previewBadge),
                  { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
                ]}
              >
                <Text style={[themed($previewBadgeText), { color: "#3b82f6" }]}>AA</Text>
              </View>
              <Text style={themed($previewText)}>Your app will look like this</Text>
              <Pressable
                style={[
                  themed($previewButton),
                  { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
                ]}
              >
                <Text style={{ color: theme.colors.tint, fontWeight: "600" }}>Sample Button</Text>
              </Pressable>
            </View>
          </View>
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
          >
            <Text
              style={[themed($buttonText), { color: theme.colors.tint }]}
              tx="onboarding:next"
            />
          </Pressable>

          <Pressable onPress={handleSkip} style={$skipButton}>
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

const $previewSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.xl,
})

const $previewLabel: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  color: colors.textDim,
  marginBottom: spacing.sm,
})

const $previewCard: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 12,
  padding: spacing.lg,
  alignItems: "center",
  gap: spacing.md,
})

const $previewBadge: ThemedStyle<ViewStyle> = ({ colors }) => ({
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 12,
  backgroundColor: colors.background,
  borderWidth: 1.5,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 6,
  elevation: 8,
})

const $previewBadgeText: ThemedStyle<TextStyle> = () => ({
  fontSize: 12,
  fontWeight: "700",
})

const $previewText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})

const $previewButton: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.background,
  borderWidth: 1.5,
  paddingVertical: 8,
  paddingHorizontal: 20,
  borderRadius: 10,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 6,
  elevation: 8,
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
