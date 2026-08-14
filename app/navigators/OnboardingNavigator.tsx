/**
 * OnboardingNavigator - Stack navigator for user onboarding flow
 *
 * 6-screen wizard:
 * 1. Welcome - Intro message
 * 2. Recovery - Short Name, Fellowship & Recovery Date
 * 3. Zoom - Required Zoom Workplace install link
 * 4. Theme - Dark/Light mode & Color
 * 5. Privacy - Data privacy & documentation links
 * 6. OSS - Open source software & AGPLv3 license
 *
 * Attendance is no longer surfaced during onboarding — users opt in from
 * Settings instead. profileStore.attendanceEnabled still drives the
 * MainNavigator tab gate, and the OnboardingAttendance screen was removed
 * outright (no more "skip" button; the route doesn't exist).
 *
 * CHANGED 2026-08-13: the Profile screen ("Tell us about yourself") is no
 * longer registered — it merged into Recovery, which took over its title. The
 * app joins via the external Zoom app now and can't pass a display name, so
 * pronouns and the display-name toggles left the UI; only Short Name survived,
 * because attendance reports and the 90-in-90 certificate print it.
 * OnboardingProfile.tsx is parked (still exported, still in OnboardingParamList)
 * for the community release — re-register it here and re-add it to
 * ProgressDots' SCREENS to bring it back.
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack"

import {
  OnboardingImport,
  OnboardingWelcome,
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
      {/* OnboardingProfile intentionally unregistered — see the docblock. */}
      <Stack.Screen name="OnboardingRecovery" component={OnboardingRecovery} />
      <Stack.Screen name="OnboardingZoom" component={OnboardingZoom} />
      <Stack.Screen name="OnboardingTheme" component={OnboardingTheme} />
      <Stack.Screen name="OnboardingPrivacy" component={OnboardingPrivacy} />
      <Stack.Screen name="OnboardingOSS" component={OnboardingOSS} />
    </Stack.Navigator>
  )
}
