import { ComponentProps } from "react"
import { BottomTabScreenProps } from "@react-navigation/bottom-tabs"
import {
  CompositeScreenProps,
  NavigationContainer,
  NavigatorScreenParams,
} from "@react-navigation/native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"

// Segment options for Meetings tab
// "listings" is labeled "Search" in the UI (2026-08-03 relabel) — the key
// is unchanged so stored nav state and deep links keep working.
export type MeetingsSegment = "live" | "inperson" | "listings"

// Section options for Attendance tab
export type AttendanceSection = "new" | "archive" | "reports"

// Section options for Settings tab
// "permissions" replaced "notifications" 2026-08-08 when the Settings
// Permissions section (location + gated push) took over the
// trackSection("permissions") key — see SettingsScreen.tsx. Deep-linking
// with the old "notifications" literal would type-check but silently no-op
// (sectionOffsets lookup miss), so it can't be left behind alongside the
// rename.
export type SettingsSection =
  | "recovery"
  | "profile"
  | "appSettings"
  | "permissions"
  | "attendance"
  | "subscription"
  | "cloudBackup"
  | "account"
  | "import"
  | "legal"

// Main Tab Navigator types
export type MainTabParamList = {
  Home: undefined
  Live: undefined
  Listings: undefined
  Attendance: { section?: AttendanceSection } | undefined
  Meetings: { segment?: MeetingsSegment; meetingId?: string } | undefined
  Schedule: undefined
  Agent: undefined
  Social: undefined
  Settings: { section?: SettingsSection; returnTo?: string } | undefined
}

// Onboarding Stack Navigator types
export type OnboardingParamList = {
  OnboardingImport: undefined
  OnboardingWelcome: undefined
  OnboardingProfile: undefined
  OnboardingRecovery: undefined
  OnboardingZoom: undefined
  OnboardingTheme: undefined
  OnboardingPrivacy: undefined
  OnboardingOSS: undefined
}

// App Stack Navigator types
export type AppStackParamList = {
  Welcome: undefined
  Maintenance: undefined
  Login: undefined
  Import: undefined
  Licenses: undefined
  Terms: undefined
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
