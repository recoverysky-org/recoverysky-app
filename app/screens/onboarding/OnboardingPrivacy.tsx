/**
 * OnboardingPrivacy - Screen 4
 *
 * Data privacy assurances and documentation links
 *
 * CHANGED 2026-10-03: rewritten as four cards (title + one sentence). The old one-line bullets promised things that stopped being
 * true: "Your data never leaves your device" (reports and cloud backup send
 * it), "100% local" storage, and "anonymity" (the user signs in with an
 * account). Keep every claim here checkable against what the app does; this
 * is the screen a privacy complaint will quote.
 */
import { FC } from "react"
import { View, ViewStyle, TextStyle, Pressable, Linking } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import type { OnboardingScreenProps } from "@/navigators/navigationTypes"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { ProgressDots } from "./ProgressDots"

// Privacy cards: icon, title, one-sentence body.
const PRIVACY_ITEMS = [
  {
    icon: "shield-checkmark-outline",
    titleTx: "onboarding:privacySecureTitle",
    bodyTx: "onboarding:privacySecureBody",
  },
  {
    icon: "lock-closed-outline",
    titleTx: "onboarding:privacyEncryptedTitle",
    bodyTx: "onboarding:privacyEncryptedBody",
  },
  {
    icon: "phone-portrait-outline",
    titleTx: "onboarding:privacyControlTitle",
    bodyTx: "onboarding:privacyControlBody",
  },
  {
    icon: "medkit-outline",
    titleTx: "onboarding:privacyHipaaTitle",
    bodyTx: "onboarding:privacyHipaaBody",
  },
] as const

export const OnboardingPrivacy: FC<OnboardingScreenProps<"OnboardingPrivacy">> = observer(
  function OnboardingPrivacy({ navigation }) {
    const { themed, theme } = useAppTheme()

    const handleNext = () => {
      trackEvent("onboarding_step", { step: "privacy" })
      navigation.navigate("OnboardingOSS")
    }

    const openPrivacyPolicy = () => {
      Linking.openURL("https://www.recoverysky.app/content/RecoverySky_Content/privacy")
    }

    const openTerms = () => {
      Linking.openURL("https://www.recoverysky.app/content/RecoverySky_Content/terms")
    }

    return (
      <Screen
        // CHANGED 2026-10-03: "fixed" → "scroll". Four cards overflow a small phone, more so in the longer locales.
        preset="scroll"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        {/* Progress dots */}
        <ProgressDots currentIndex={4} />

        {/* Content */}
        <View style={$content}>
          <Text style={themed($title)} tx="onboarding:privacyTitle" />

          {/* Privacy cards. Each card is one accessibility element so a
              screen reader reads the title and its sentence together. */}
          <View style={themed($privacyList)}>
            {PRIVACY_ITEMS.map((item) => (
              <View
                key={item.titleTx}
                style={themed($card)}
                accessible
                accessibilityLabel={`${translate(item.titleTx)}. ${translate(item.bodyTx)}`}
              >
                <View style={[themed($iconBadge), { borderColor: theme.colors.tint }]}>
                  <Ionicons name={item.icon} size={20} color={theme.colors.tint} />
                </View>
                <View style={$cardText}>
                  <Text style={themed($cardTitle)} tx={item.titleTx} />
                  <Text style={themed($cardBody)} tx={item.bodyTx} />
                </View>
              </View>
            ))}
          </View>

          {/* Links - inline */}
          <View style={themed($linksRow)}>
            <Pressable
              onPress={openPrivacyPolicy}
              style={themed($linkButton)}
              accessibilityRole="link"
              accessibilityLabel={translate("onboarding:privacyPolicy")}
            >
              <Text
                style={[themed($linkText), { color: theme.colors.tint }]}
                tx="onboarding:privacyPolicy"
              />
              <Ionicons name="open-outline" size={14} color={theme.colors.tint} />
            </Pressable>
            <Text style={themed($linkSeparator)}>|</Text>
            <Pressable
              onPress={openTerms}
              style={themed($linkButton)}
              accessibilityRole="link"
              accessibilityLabel={translate("onboarding:termsOfService")}
            >
              <Text
                style={[themed($linkText), { color: theme.colors.tint }]}
                tx="onboarding:termsOfService"
              />
              <Ionicons name="open-outline" size={14} color={theme.colors.tint} />
            </Pressable>
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
        </View>
      </Screen>
    )
  },
)

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  // flexGrow, not flex: the scroll preset's content must be able to grow past
  // the viewport while still pinning the footer when it is short.
  flexGrow: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
})

const $content: ViewStyle = {
  flex: 1,
  paddingTop: 32,
}

const $title: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 28,
  fontWeight: "700",
  lineHeight: 38,
  color: colors.text,
  // No subheading under this title (removed 2026-10-03), so the title carries
  // the gap down to the cards itself.
  marginBottom: spacing.lg,
})

const $privacyList: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.sm,
})

const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "flex-start",
  gap: spacing.sm,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 14,
  padding: spacing.md,
})

const $iconBadge: ThemedStyle<ViewStyle> = ({ colors }) => ({
  width: 38,
  height: 38,
  borderRadius: 19,
  borderWidth: 1,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.background,
})

const $cardText: ViewStyle = {
  flex: 1,
}

const $cardTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.text,
})

const $cardBody: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  lineHeight: 20,
  color: colors.textDim,
  marginTop: 2,
})

const $linksRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  marginTop: spacing.lg,
  gap: spacing.sm,
})

const $linkButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $linkSeparator: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 14,
})

const $linkText: ThemedStyle<TextStyle> = () => ({
  fontSize: 15,
  fontWeight: "500",
})

const $footer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingTop: spacing.lg,
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
