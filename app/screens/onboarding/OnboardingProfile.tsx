/**
 * OnboardingProfile - Screen 1
 *
 * Short Name and Pronouns selection
 */
import { FC, useState } from "react"
import { View, ViewStyle, TextStyle, Pressable, Modal, TouchableOpacity } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

type Pronouns = "he/him" | "she/her" | "they/them" | "em/ers"

const getPronounsLabel = (p: Pronouns | null): string => {
  switch (p) {
    case "he/him":
      return translate("settingsScreen:pronounHeHim")
    case "she/her":
      return translate("settingsScreen:pronounSheHer")
    case "they/them":
      return translate("settingsScreen:pronounTheyThem")
    case "em/ers":
      return translate("settingsScreen:pronounEmErs")
    default:
      return translate("onboarding:selectPronouns")
  }
}

export const OnboardingProfile: FC<OnboardingScreenProps<"OnboardingProfile">> = observer(
  function OnboardingProfile({ navigation }) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()
    const [pronounsModalVisible, setPronounsModalVisible] = useState(false)

    const handleNext = () => {
      navigation.navigate("OnboardingRecovery")
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
        <View style={$progress}>
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, { backgroundColor: theme.colors.tint }]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
          <View style={[$dot, $dotInactive]} />
        </View>

        {/* Content */}
        <View style={$content}>
          <Text style={themed($title)} tx="onboarding:profileTitle" />
          <Text style={themed($subtitle)} tx="onboarding:profileSubtitle" />

          {/* Short Name Input */}
          <View style={themed($inputSection)}>
            <Text style={themed($label)} tx="onboarding:shortName" />
            <TextField
              value={profileStore.shortName}
              onChangeText={profileStore.setShortName}
              placeholderTx="onboarding:shortNamePlaceholder"
              style={themed($textField)}
              inputWrapperStyle={themed($inputWrapper)}
            />
          </View>

          {/* Pronouns Picker */}
          <View style={themed($inputSection)}>
            <Text style={themed($label)} tx="onboarding:pronouns" />
            <Pressable style={themed($pickerButton)} onPress={() => setPronounsModalVisible(true)}>
              <Text style={themed($pickerText)}>{getPronounsLabel(profileStore.pronouns)}</Text>
              <Ionicons name="chevron-down" size={20} color={theme.colors.textDim} />
            </Pressable>
          </View>
        </View>

        {/* Pronouns Modal */}
        <Modal visible={pronounsModalVisible} transparent animationType="fade">
          <Pressable style={themed($modalOverlay)} onPress={() => setPronounsModalVisible(false)}>
            <View style={themed($modalContent)}>
              <Text style={themed($modalTitle)} tx="settingsScreen:selectPronouns" />
              {(["he/him", "she/her", "they/them", "em/ers"] as Pronouns[]).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    themed($modalOption),
                    profileStore.pronouns === p && themed($modalOptionSelected),
                  ]}
                  onPress={() => {
                    profileStore.setPronouns(p)
                    setPronounsModalVisible(false)
                  }}
                >
                  <Text style={themed($modalOptionText)}>{getPronounsLabel(p)}</Text>
                  {profileStore.pronouns === p && (
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

const $inputSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginBottom: spacing.lg,
})

const $label: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  fontWeight: "500",
  color: colors.textDim,
  marginBottom: spacing.xs,
})

const $textField: ThemedStyle<ViewStyle> = () => ({})

const $inputWrapper: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 10,
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
  width: "80%",
  maxWidth: 320,
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
