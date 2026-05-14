/**
 * ProgressDots Component
 *
 * Tappable progress indicator for onboarding screens.
 * Each dot navigates to the corresponding screen.
 */

import { FC } from "react"
import { View, ViewStyle, Pressable } from "react-native"
import { NavigationProp, useNavigation } from "@react-navigation/native"

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
  const navigation = useNavigation<NavigationProp<OnboardingParamList>>()

  const handleDotPress = (index: number) => {
    if (index !== currentIndex) {
      navigation.navigate(SCREENS[index])
    }
  }

  return (
    <View style={$progress}>
      {SCREENS.map((_, index) => (
        <Pressable
          key={index}
          onPress={() => handleDotPress(index)}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
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
