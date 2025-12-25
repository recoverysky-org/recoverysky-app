import { BottomTabScreenProps, createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { CompositeScreenProps } from "@react-navigation/native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "@/components/Icon"
import { translate } from "@/i18n"
import { HomeScreen } from "@/screens/HomeScreen"
// import { MeetingsScreen } from "@/screens/MeetingsScreen"  // Hidden for now
import { ProfileScreen } from "@/screens/ProfileScreen"
import { ScheduleScreen } from "@/screens/ScheduleScreen"
import { useAppTheme } from "@/theme/context"
import { AppStackParamList, AppStackScreenProps } from "./navigationTypes"

export type MainTabParamList = {
  Home: undefined
  Meetings: undefined
  Schedule: undefined
  Profile: undefined
}

/**
 * Helper for automatically generating navigation prop types for each route.
 *
 * More info: https://reactnavigation.org/docs/typescript/#organizing-types
 */
export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  AppStackScreenProps<keyof AppStackParamList>
>

const Tab = createBottomTabNavigator<MainTabParamList>()

/**
 * MainNavigator - Primary tab navigation for authenticated users
 *
 * 4-tab structure:
 * - Home: Dashboard/landing page
 * - Meetings: Meeting list and discovery
 * - Schedule: Schedule view and management
 * - Profile: User profile and settings
 */
export function MainNavigator() {
  const { bottom } = useSafeAreaInsets()
  const {
    theme: { colors },
  } = useAppTheme()

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          height: bottom + 70,
          paddingBottom: bottom + 10,
          paddingTop: 10,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: {
          fontSize: 12,
          fontFamily: "spaceGroteskMedium",
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: translate("mainNavigator:homeTab"),
          tabBarIcon: ({ focused }) => (
            <Icon icon="components" color={focused ? colors.tint : colors.textDim} size={24} />
          ),
        }}
      />
      {/* Meetings tab hidden for now - focusing on Schedules
      <Tab.Screen
        name="Meetings"
        component={MeetingsScreen}
        options={{
          tabBarLabel: translate("mainNavigator:meetingsTab"),
          tabBarIcon: ({ focused }) => (
            <Icon icon="community" color={focused ? colors.tint : colors.textDim} size={24} />
          ),
        }}
      />
      */}
      <Tab.Screen
        name="Schedule"
        component={ScheduleScreen}
        options={{
          tabBarLabel: translate("mainNavigator:scheduleTab"),
          tabBarIcon: ({ focused }) => (
            <Icon icon="menu" color={focused ? colors.tint : colors.textDim} size={24} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: translate("mainNavigator:profileTab"),
          tabBarIcon: ({ focused }) => (
            <Icon icon="settings" color={focused ? colors.tint : colors.textDim} size={24} />
          ),
        }}
      />
    </Tab.Navigator>
  )
}
