/**
 * ProgressDots Component
 *
 * Tappable progress indicator for onboarding screens.
 * Each dot navigates to the corresponding screen.
 */

import { FC } from "react"
import { View, ViewStyle, Pressable } from "react-native"
import { NavigationProp, useNavigation } from "@react-navigation/native"
import { useTranslation } from "react-i18next"

import type { OnboardingParamList } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"

/** Onboarding screen names in order */
const SCREENS: (keyof OnboardingParamList)[] = [
  "OnboardingWelcome",
  "OnboardingProfile",
  "OnboardingRecovery",
  "OnboardingZoom",
  "OnboardingTheme",
  "OnboardingPrivacy",
  "OnboardingOSS",
]

interface ProgressDotsProps {
  /** Current screen index (0-6) */
  currentIndex: number
}

/**
 * Tappable progress dots for onboarding navigation
 */
export const ProgressDots: FC<ProgressDotsProps> = ({ currentIndex }) => {
  const { theme } = useAppTheme()
  const { t } = useTranslation()
  const navigation = useNavigation<NavigationProp<OnboardingParamList>>()

  const handleDotPress = (index: number) => {
    if (index !== currentIndex) {
      navigation.navigate(SCREENS[index])
    }
  }

  return (
    // tablist/tab rather than button: the dots are a set of peers with exactly
    // one selected, which is what lets VoiceOver announce "2 of 7" positionally
    // and matches how SegmentedControl models the same relationship.
    <View style={$progress} accessibilityRole="tablist">
      {SCREENS.map((_, index) => (
        <Pressable
          key={index}
          onPress={() => handleDotPress(index)}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          accessibilityRole="tab"
          // The dot itself is an 8pt circle with no text, so the position in
          // the flow is the only thing there is to announce. Selected state
          // is otherwise carried purely by the tint fill.
          accessibilityLabel={t("accessibility:onboardingStep", {
            step: index + 1,
            total: SCREENS.length,
          })}
          accessibilityState={{ selected: index === currentIndex }}
          // Tapping the current dot is a no-op (see handleDotPress), so don't
          // promise navigation that won't happen.
          accessibilityHint={
            index === currentIndex ? undefined : t("accessibility:doubleTapToGoToStep")
          }
        >
          <View
            style={[
              $dot,
              index === currentIndex ? { backgroundColor: theme.colors.tint } : $dotInactive,
            ]}
          />
        </Pressable>
      ))}
    </View>
  )
}

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
