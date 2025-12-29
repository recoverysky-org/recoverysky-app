/**
 * OnboardingNavigator - Stack navigator for user onboarding flow
 *
 * 6-screen wizard:
 * 1. Welcome - Intro message
 * 2. Profile - Name & Pronouns
 * 3. Recovery - Fellowship & Recovery Date
 * 4. Theme - Dark/Light mode & Color
 * 5. Attendance - Attendance tracking explanation & toggle
 * 6. Privacy - Data privacy & documentation links
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack"

import {
  OnboardingWelcome,
  OnboardingProfile,
  OnboardingRecovery,
  OnboardingTheme,
  OnboardingAttendance,
  OnboardingPrivacy,
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
      <Stack.Screen name="OnboardingWelcome" component={OnboardingWelcome} />
      <Stack.Screen name="OnboardingProfile" component={OnboardingProfile} />
      <Stack.Screen name="OnboardingRecovery" component={OnboardingRecovery} />
      <Stack.Screen name="OnboardingTheme" component={OnboardingTheme} />
      <Stack.Screen name="OnboardingAttendance" component={OnboardingAttendance} />
      <Stack.Screen name="OnboardingPrivacy" component={OnboardingPrivacy} />
    </Stack.Navigator>
  )
}
