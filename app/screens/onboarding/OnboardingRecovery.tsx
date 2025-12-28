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
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { translate } from "@/i18n"

const FELLOWSHIPS = ["AA", "NA", "CMA", "RD", "Other"] as const
type Fellowship = (typeof FELLOWSHIPS)[number]

const getFellowshipLabel = (f: string): string => {
  switch (f) {
    case "AA":
      return "Alcoholics Anonymous (AA)"
    case "NA":
      return "Narcotics Anonymous (NA)"
    case "CMA":
      return "Crystal Meth Anonymous (CMA)"
    case "RD":
      return "Refuge Dharma (RD)"
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
      <Screen preset="fixed" safeAreaEdges={["top", "bottom"]} contentContainerStyle={themed($container)}>
        {/* Progress dots */}
        <View style={$progress}>
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, { backgroundColor: theme.colors.tint }]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
        </View>

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
            >
              <Text style={themed($pickerText)}>
                {getFellowshipLabel(profileStore.fellowship)}
              </Text>
              <Ionicons name="chevron-down" size={20} color={theme.colors.textDim} />
            </Pressable>
          </View>

          {/* Recovery Date Picker */}
          <View style={themed($inputSection)}>
            <Text style={themed($label)} tx="onboarding:recoveryDate" />
            <Pressable
              style={themed($pickerButton)}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={themed($pickerText)}>
                {formatDate(profileStore.recoveryDateAsDate)}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={theme.colors.textDim} />
            </Pressable>
          </View>

          {/* iOS Date Picker (inline) */}
          {Platform.OS === "ios" && showDatePicker && (
            <View style={themed($datePickerContainer)}>
              <DateTimePicker
                value={profileStore.recoveryDateAsDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
                maximumDate={new Date()}
                themeVariant={theme.isDark ? "dark" : "light"}
              />
              <Pressable
                style={themed($datePickerDone)}
                onPress={() => setShowDatePicker(false)}
              >
                <Text style={{ color: theme.colors.tint, fontSize: 16, fontWeight: "600" }}>
                  Done
                </Text>
              </Pressable>
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
          <Pressable style={themed($modalOverlay)} onPress={() => setFellowshipModalVisible(false)}>
            <View style={themed($modalContent)}>
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
            style={[themed($button), { borderColor: theme.colors.tint, shadowColor: theme.colors.tint }]}
            onPress={handleNext}
          >
            <Text style={[themed($buttonText), { color: theme.colors.tint }]} tx="onboarding:next" />
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

const $datePickerDone: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  paddingVertical: spacing.sm,
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
