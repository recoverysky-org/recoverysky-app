/**
 * OnboardingNavigator - Stack navigator for user onboarding flow
 *
 * 7-screen wizard:
 * 1. Welcome - Intro message
 * 2. Profile - Name & Pronouns
 * 3. Recovery - Fellowship & Recovery Date
 * 4. Zoom - Required Zoom Workplace install link
 * 5. Theme - Dark/Light mode & Color
 * 6. Privacy - Data privacy & documentation links
 * 7. OSS - Open source software & AGPLv3 license
 *
 * Attendance is no longer surfaced during onboarding — users opt in from
 * Settings instead. profileStore.attendanceEnabled still drives the
 * MainNavigator tab gate, and the OnboardingAttendance screen was removed
 * outright (no more "skip" button; the route doesn't exist).
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack"

import {
  OnboardingImport,
  OnboardingWelcome,
  OnboardingProfile,
  OnboardingRecovery,
  OnboardingZoom,
  OnboardingTheme,
  OnboardingPrivacy,
  OnboardingOSS,
} from "@/screens/onboarding"
import { useAppTheme } from "@/theme/context"

import type { OnboardingParamList } from "./navigationTypes"

const Stack = createNativeStackNavigator<OnboardingParamList>()

export function OnboardingNavigator() {
  const {
    theme: { colors },
  } = useAppTheme()

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        navigationBarColor: colors.background,
        contentStyle: {
          backgroundColor: colors.background,
        },
        animation: "slide_from_right",
      }}
      initialRouteName="OnboardingWelcome"
    >
      <Stack.Screen name="OnboardingImport" component={OnboardingImport} />
      <Stack.Screen name="OnboardingWelcome" component={OnboardingWelcome} />
      <Stack.Screen name="OnboardingProfile" component={OnboardingProfile} />
      <Stack.Screen name="OnboardingRecovery" component={OnboardingRecovery} />
      <Stack.Screen name="OnboardingZoom" component={OnboardingZoom} />
      <Stack.Screen name="OnboardingTheme" component={OnboardingTheme} />
      <Stack.Screen name="OnboardingPrivacy" component={OnboardingPrivacy} />
      <Stack.Screen name="OnboardingOSS" component={OnboardingOSS} />
    </Stack.Navigator>
  )
}
