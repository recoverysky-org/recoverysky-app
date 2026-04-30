/**
 * OnboardingZoom - Screen 3
 *
 * Tells the user the Zoom Workplace app is required to attend meetings and
 * provides a platform-aware install link (App Store on iOS, Play Store on
 * Android). Users who already have Zoom can tap Next directly.
 *
 * No gating: the screen does not check whether Zoom is actually installed
 * before allowing Next. Detection via `Linking.canOpenURL("zoomus://")`
 * would require an LSApplicationQueriesSchemes entry on iOS and would
 * still be unreliable across Android OEMs, so we keep the screen
 * informational and let the meeting-join flows handle missing-Zoom errors
 * downstream (which they already do via SchedulePopup's non-Zoom URL
 * fallback and the existing Linking.openURL .catch handlers).
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, Pressable, Linking, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

import { ProgressDots } from "./ProgressDots"

const log = logger.child({ module: "OnboardingZoom" })

// Store URLs for the official Zoom Workplace app.
const ZOOM_APP_STORE_URL = "https://apps.apple.com/us/app/zoom-workplace/id546505307"
const ZOOM_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=us.zoom.videomeetings"

const ZOOM_BENEFITS = [
  { icon: "cloud-download-outline", txKey: "zoomBenefitFree" },
  { icon: "videocam-outline", txKey: "zoomBenefitRequired" },
  { icon: "checkmark-circle-outline", txKey: "zoomBenefitAlready" },
] as const

export const OnboardingZoom: FC<OnboardingScreenProps<"OnboardingZoom">> = observer(
  function OnboardingZoom({ navigation }) {
    const { themed, theme } = useAppTheme()

    const handleNext = () => {
      trackEvent("onboarding_step", { step: "zoom" })
      navigation.navigate("OnboardingTheme")
    }

    // Web fallback to App Store on Mac App Store / browser when running
    // on Expo Web; otherwise the platform-native store link is preferred.
    const handleInstallZoom = () => {
      const url = Platform.OS === "android" ? ZOOM_PLAY_STORE_URL : ZOOM_APP_STORE_URL
      trackEvent("onboarding_zoom_install_tap", { platform: Platform.OS })
      Linking.openURL(url).catch((err: unknown) => {
        log.error("Failed to open Zoom store URL", {
          url,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    return (
      <Screen
        preset="fixed"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        <ProgressDots currentIndex={3} />

        <View style={$content}>
          <Text style={themed($title)} tx="onboarding:zoomTitle" />
          <Text style={themed($subtitle)} tx="onboarding:zoomSubtitle" />

          <View style={themed($benefitsList)}>
            {ZOOM_BENEFITS.map((item) => (
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
        </View>

        <View style={themed($footer)}>
          {/* Install button — primary action, filled tint */}
          <Pressable
            style={[themed($installButton), { backgroundColor: theme.colors.tint }]}
            onPress={handleInstallZoom}
            accessibilityRole="button"
            accessibilityLabel={translate("onboarding:installZoom")}
          >
            <Ionicons name="download-outline" size={20} color={theme.colors.background} />
            <Text
              style={[themed($installButtonText), { color: theme.colors.background }]}
              tx="onboarding:installZoom"
            />
          </Pressable>

          {/* Next button — secondary, outlined (mirrors other onboarding screens) */}
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
  paddingTop: 32,
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
  marginBottom: spacing.lg,
})

const $benefitsList: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.sm,
  marginTop: spacing.md,
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

const $footer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.lg,
  gap: spacing.md,
})

const $installButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: spacing.sm,
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
})

const $installButtonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 18,
  fontWeight: "600",
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
