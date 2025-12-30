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
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

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
        <View style={$progress}>
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, { backgroundColor: theme.colors.tint }]} />
          <View style={[$dot, $dotInactive]} />
        </View>

        {/* Content */}
        <View style={$content}>
          <Text style={themed($title)} tx="onboarding:attendanceTitle" />
          <Text style={themed($subtitle)} tx="onboarding:attendanceSubtitle" />

          {/* Info bullets */}
          <View style={themed($bulletList)}>
            <View style={$bulletItem}>
              <Ionicons name="checkmark-circle-outline" size={20} color={theme.colors.tint} />
              <Text style={themed($bulletText)} tx="onboarding:attendanceFreeFeature" />
            </View>
            <View style={$bulletItem}>
              <Ionicons name="time-outline" size={20} color={theme.colors.tint} />
              <Text style={themed($bulletText)} tx="onboarding:attendanceDuration" />
            </View>
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
            <View style={$settingLabelRow}>
              <Text style={themed($settingLabel)} tx="onboarding:enableAttendance" />
              <Text style={themed($settingHint)} tx="onboarding:enableAttendanceHint" />
            </View>
            <Switch
              value={profileStore.attendanceEnabled}
              onValueChange={toggleAttendance}
              trackColor={{ false: "#767577", true: theme.colors.tint }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <View style={{ height: 24 }} />

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

const $settingLabelRow: ViewStyle = {
  flex: 1,
  marginRight: 16,
}

const $settingLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.text,
})

const $settingHint: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
  marginTop: 2,
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
