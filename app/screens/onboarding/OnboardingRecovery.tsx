/**
 * OnboardingRecovery - Screen 2
 *
 * Fellowship and Recovery Date selection
 */
import { FC, useState } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  Pressable,
  Modal,
  TouchableOpacity,
  Platform,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker"
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

const FELLOWSHIPS = ["AA", "NA", "RD"] as const
type _Fellowship = (typeof FELLOWSHIPS)[number]

const getFellowshipLabel = (f: string): string => {
  switch (f) {
    case "AA":
      return "Alcoholics Anonymous (AA)"
    case "NA":
      return "Narcotics Anonymous (NA)"
    case "RD":
      return "Recovery Dharma (RD)"
    case "Other":
      return translate("onboarding:otherFellowship")
    default:
      return f
  }
}

export const OnboardingRecovery: FC<OnboardingScreenProps<"OnboardingRecovery">> = observer(
  function OnboardingRecovery({ navigation }) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()
    const [fellowshipModalVisible, setFellowshipModalVisible] = useState(false)
    const [showDatePicker, setShowDatePicker] = useState(false)

    const handleNext = () => {
      trackEvent("onboarding_step", { step: "recovery" })
      navigation.navigate("OnboardingTheme")
    }

    const handleSkip = () => {
      profileStore.completeOnboarding()
    }

    const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === "android") {
        setShowDatePicker(false)
      }
      if (selectedDate) {
        profileStore.setRecoveryDate(selectedDate)
      }
    }

    const formatDate = (date: Date): string => {
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    }

    return (
      <Screen
        preset="scroll"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        {/* Progress dots */}
        <ProgressDots currentIndex={2} />

        {/* Content */}
        <View style={$content}>
          <Text style={themed($title)} tx="onboarding:recoveryTitle" />
          <Text style={themed($subtitle)} tx="onboarding:recoverySubtitle" />

          {/* Fellowship Picker */}
          <View style={themed($inputSection)}>
            <Text style={themed($label)} tx="onboarding:fellowship" />
            <Pressable
              style={themed($pickerButton)}
              onPress={() => setFellowshipModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={translate("onboarding:fellowship")}
            >
              <Text style={themed($pickerText)}>{getFellowshipLabel(profileStore.fellowship)}</Text>
              <Ionicons name="chevron-down" size={20} color={theme.colors.textDim} />
            </Pressable>
          </View>

          {/* Recovery Date Picker */}
          <View style={themed($inputSection)}>
            <Text style={themed($label)} tx="onboarding:recoveryDate" />
            <Pressable
              style={themed($pickerButton)}
              onPress={() => setShowDatePicker(true)}
              accessibilityRole="button"
              accessibilityLabel={translate("onboarding:recoveryDate")}
            >
              <Text style={themed($pickerText)}>{formatDate(profileStore.recoveryDateAsDate)}</Text>
              <Ionicons name="calendar-outline" size={20} color={theme.colors.textDim} />
            </Pressable>
          </View>

          {/* iOS Date Picker (inline) — OK at top to mirror Settings */}
          {Platform.OS === "ios" && showDatePicker && (
            <View style={themed($datePickerContainer)}>
              <View style={themed($datePickerHeader)}>
                <Pressable
                  onPress={() => setShowDatePicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel={translate("common:ok")}
                >
                  <Text style={themed($datePickerDoneText)} tx="common:ok" />
                </Pressable>
              </View>
              <DateTimePicker
                value={profileStore.recoveryDateAsDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
                maximumDate={new Date()}
                themeVariant={theme.isDark ? "dark" : "light"}
              />
            </View>
          )}

          {/* Android Date Picker (modal) */}
          {Platform.OS === "android" && showDatePicker && (
            <DateTimePicker
              value={profileStore.recoveryDateAsDate}
              mode="date"
              display="default"
              onChange={handleDateChange}
              maximumDate={new Date()}
            />
          )}
        </View>

        {/* Fellowship Modal */}
        <Modal visible={fellowshipModalVisible} transparent animationType="fade">
          <Pressable
            style={themed($modalOverlay)}
            onPress={() => setFellowshipModalVisible(false)}
            accessibilityLabel={translate("common:close")}
          >
            <View style={themed($modalContent)} accessibilityViewIsModal>
              <Text style={themed($modalTitle)} tx="onboarding:selectFellowship" />
              {FELLOWSHIPS.map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[
                    themed($modalOption),
                    profileStore.fellowship === f && themed($modalOptionSelected),
                  ]}
                  onPress={() => {
                    profileStore.setFellowship(f)
                    setFellowshipModalVisible(false)
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={getFellowshipLabel(f)}
                  accessibilityState={{ selected: profileStore.fellowship === f }}
                >
                  <Text style={themed($modalOptionText)}>{getFellowshipLabel(f)}</Text>
                  {profileStore.fellowship === f && (
                    <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>

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
  flexGrow: 1,
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

const $inputSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginBottom: spacing.lg,
})

const $label: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  fontWeight: "500",
  color: colors.textDim,
  marginBottom: spacing.xs,
})

const $pickerButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 10,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
})

const $pickerText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})

const $datePickerContainer: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 12,
  marginTop: spacing.sm,
  padding: spacing.sm,
})

const $datePickerHeader: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "flex-end",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.xs,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
})

const $datePickerDoneText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 16,
  fontWeight: "600",
})

const $modalOverlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  justifyContent: "center",
  alignItems: "center",
})

const $modalContent: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 16,
  padding: spacing.lg,
  width: "85%",
  maxWidth: 360,
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.text,
  marginBottom: spacing.md,
  textAlign: "center",
})

const $modalOption: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.sm,
  borderRadius: 8,
})

const $modalOptionSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.border,
})

const $modalOptionText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
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
