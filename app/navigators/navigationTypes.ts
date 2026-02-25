import { ComponentProps } from "react"
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs"
import {
  CompositeScreenProps,
  NavigationContainer,
  NavigatorScreenParams,
} from "@react-navigation/native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"

// Segment options for Meetings tab
export type MeetingsSegment = "live" | "listings"

// Section options for Attendance tab
export type AttendanceSection = "new" | "archive" | "reports"

// Main Tab Navigator types
export type MainTabParamList = {
  Home: undefined
  Live: undefined
  Listings: undefined
  Attendance: { section?: AttendanceSection } | undefined
  Meetings: { segment?: MeetingsSegment } | undefined
  Schedule: undefined
  Agent: undefined
  Settings: undefined
}

// Onboarding Stack Navigator types
export type OnboardingParamList = {
  OnboardingImport: undefined
  OnboardingWelcome: undefined
  OnboardingProfile: undefined
  OnboardingRecovery: undefined
  OnboardingTheme: undefined
  OnboardingAttendance: undefined
  OnboardingPrivacy: undefined
  OnboardingOSS: undefined
}

// App Stack Navigator types
export type AppStackParamList = {
  Welcome: undefined
  Login: undefined
  ZoomSetup: undefined
  ZoomLogin: undefined
  Onboarding: NavigatorScreenParams<OnboardingParamList>
  Main: NavigatorScreenParams<MainTabParamList>
  // 🔥 Your screens go here
  // IGNITE_GENERATOR_ANCHOR_APP_STACK_PARAM_LIST
}

export type AppStackScreenProps<T extends keyof AppStackParamList> = NativeStackScreenProps<
  AppStackParamList,
  T
>

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  AppStackScreenProps<keyof AppStackParamList>
>

export type OnboardingScreenProps<T extends keyof OnboardingParamList> = NativeStackScreenProps<
  OnboardingParamList,
  T
>

export interface NavigationProps extends Partial<
  ComponentProps<typeof NavigationContainer<AppStackParamList>>
> {}
