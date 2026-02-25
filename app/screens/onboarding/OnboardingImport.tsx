/**
 * OnboardingImport - Import data from old app
 *
 * Shown when /firebase/user/:uid returned 200 (old data exists).
 * Offers import options before continuing to Profile.
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useProfileStore } from "@/models"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export const OnboardingImport: FC<OnboardingScreenProps<"OnboardingImport">> =
  function OnboardingImport({ navigation }) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()

    const handleSkip = () => {
      // profileStore.setImported(true) // TODO: re-enable after dev
      navigation.replace("OnboardingProfile")
    }

    const handleImportCloudData = () => {
      // TODO: implement cloud data import
      // profileStore.setImported(true) // TODO: re-enable after dev
      navigation.replace("OnboardingProfile")
    }

    const handleExportJournal = () => {
      // TODO: implement journal PDF export
    }

    return (
      <Screen
        preset="fixed"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        {/* Content */}
        <View style={$content}>
          <Ionicons name="cloud-download-outline" size={80} color={theme.colors.tint} />

          <Text style={themed($title)} tx="onboarding:importTitle" />
          <Text style={themed($subtitle)} tx="onboarding:importSubtitle" />
          <Text style={themed($subtitle)} tx="onboarding:importJournalHint" />
        </View>

        {/* Buttons */}
        <View style={themed($footer)}>
          <Pressable
            style={[
              themed($button),
              { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
            ]}
            onPress={handleImportCloudData}
          >
            <Ionicons name="cloud-download-outline" size={20} color={theme.colors.tint} />
            <Text
              style={[themed($buttonText), { color: theme.colors.tint }]}
              tx="onboarding:importCloudData"
            />
          </Pressable>

          <Pressable
            style={[
              themed($button),
              { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
            ]}
            onPress={handleExportJournal}
          >
            <Ionicons name="document-outline" size={20} color={theme.colors.tint} />
            <Text
              style={[themed($buttonText), { color: theme.colors.tint }]}
              tx="onboarding:exportJournalPdf"
            />
          </Pressable>

          <Pressable onPress={handleSkip} style={$skipButton}>
            <Text style={themed($skipText)} tx="onboarding:importSkip" />
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
  gap: 16,
}

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 28,
  fontWeight: "700",
  lineHeight: 38,
  color: colors.text,
  textAlign: "center",
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
  flexDirection: "row",
  backgroundColor: colors.background,
  borderWidth: 1.5,
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  alignItems: "center",
  justifyContent: "center",
  gap: spacing.xs,
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
