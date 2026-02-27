/**
 * OnboardingAttendance - Screen 4
 *
 * Attendance tracking explanation and enable/disable toggle
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, Pressable, Switch } from "react-native"
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

export const OnboardingAttendance: FC<OnboardingScreenProps<"OnboardingAttendance">> = observer(
  function OnboardingAttendance({ navigation }) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()

    const handleNext = () => {
      navigation.navigate("OnboardingPrivacy")
    }

    const handleSkip = () => {
      profileStore.completeOnboarding()
    }

    const toggleAttendance = () => {
      profileStore.setAttendanceEnabled(!profileStore.attendanceEnabled)
    }

    return (
      <Screen
        preset="scroll"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        {/* Progress dots */}
        <ProgressDots currentIndex={4} />

        {/* Content */}
        <View style={$content}>
          <Text style={themed($title)} tx="onboarding:attendanceTitle" />
          <Text style={themed($subtitle)} tx="onboarding:attendanceSubtitle" />

          {/* Info bullets */}
          <View style={themed($bulletList)}>
            {/* <View style={$bulletItem}>
              <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.tint} />
              <Text style={themed($bulletText)} tx="onboarding:attendanceFreeFeature" />
            </View> */}
            <View style={$bulletItem}>
              <Ionicons name="lock-closed-outline" size={20} color={theme.colors.tint} />
              <Text style={themed($bulletText)} tx="onboarding:attendancePrivate" />
            </View>
            <View style={$bulletItem}>
              <Ionicons name="ribbon-outline" size={20} color={theme.colors.tint} />
              <Text style={themed($bulletText)} tx="onboarding:attendancePaidFeature" />
            </View>
          </View>

          {/* Enable Toggle */}
          <View style={themed($settingRow)}>
            <Text style={themed($settingLabel)} tx="onboarding:enableAttendance" />
            <Switch
              value={profileStore.attendanceEnabled}
              onValueChange={toggleAttendance}
              trackColor={{ false: "#767577", true: theme.colors.tint }}
              thumbColor="#fff"
              accessibilityLabel={translate("onboarding:enableAttendance")}
            />
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

const $bulletList: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.md,
  marginBottom: spacing.xl,
})

const $bulletItem: ViewStyle = {
  flexDirection: "row",
  alignItems: "flex-start",
  gap: 12,
}

const $bulletText: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 15,
  color: colors.text,
  lineHeight: 22,
})

const $settingRow: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.md,
  backgroundColor: colors.card,
  borderRadius: 12,
  marginTop: spacing.md,
  marginBottom: spacing.xl,
})

const $settingLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.text,
})

const $footer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingTop: spacing.xl,
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
