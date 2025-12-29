import { BottomTabScreenProps, createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { CompositeScreenProps } from "@react-navigation/native"
import { View, Text, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"
import { observer } from "mobx-react-lite"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "@/components/Icon"
import { useMeetings } from "@/context/MeetingContext"
import { useAttendanceBadge } from "@/hooks/useAttendanceBadge"
import { useProfileStore } from "@/models"
import { HomeScreen } from "@/screens/HomeScreen"
import { LiveScreen } from "@/screens/LiveScreen"
import { ListingsScreen } from "@/screens/ListingsScreen"
import { AttendanceScreen } from "@/screens/AttendanceScreen"
// import { MeetingsScreen } from "@/screens/MeetingsScreen"  // Hidden for now
import { SettingsScreen } from "@/screens/SettingsScreen"
// import { ScheduleScreen } from "@/screens/ScheduleScreen"  // Hidden for now
import { useAppTheme } from "@/theme/context"
import { AppStackParamList, AppStackScreenProps } from "./navigationTypes"

export type MainTabParamList = {
  Home: undefined
  Live: undefined
  Listings: undefined
  Attendance: undefined
  Meetings: undefined
  Schedule: undefined
  Settings: undefined
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
 * 3-tab structure (MVP):
 * - Home: Dashboard/landing page
 * - Live: Live meetings currently in progress
 * - Settings: User profile, account, and app settings
 *
 * Hidden tabs (for future):
 * - Meetings: Meeting list and discovery
 * - Schedule: Schedule view and management
 */
export const MainNavigator = observer(function MainNavigator() {
  const { bottom } = useSafeAreaInsets()
  const { t } = useTranslation()
  const {
    theme: { colors },
  } = useAppTheme()
  const { liveMeetings } = useMeetings()
  const { validUnproducedCount } = useAttendanceBadge()
  const profileStore = useProfileStore()

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
          tabBarLabel: t("mainNavigator:homeTab"),
          tabBarIcon: ({ focused }) => (
            <Icon icon="components" color={focused ? colors.tint : colors.textDim} size={24} />
          ),
        }}
      />
      <Tab.Screen
        name="Live"
        component={LiveScreen}
        options={{
          tabBarLabel: t("mainNavigator:liveTab"),
          tabBarIcon: ({ focused }) => (
            <View style={styles.iconContainer}>
              <Ionicons
                name="videocam"
                size={24}
                color={focused ? colors.tint : colors.textDim}
              />
              {liveMeetings.length > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.tint }]}>
                  <Text style={styles.badgeText}>
                    {liveMeetings.length > 99 ? "99+" : liveMeetings.length}
                  </Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Listings"
        component={ListingsScreen}
        options={{
          tabBarLabel: t("mainNavigator:listingsTab"),
          tabBarIcon: ({ focused }) => (
            <Ionicons
              name="list-outline"
              size={24}
              color={focused ? colors.tint : colors.textDim}
            />
          ),
        }}
      />
      {profileStore.attendanceEnabled && (
        <Tab.Screen
          name="Attendance"
          component={AttendanceScreen}
          options={{
            tabBarLabel: t("mainNavigator:attendanceTab"),
            tabBarIcon: ({ focused }) => (
              <View style={styles.iconContainer}>
                <Ionicons
                  name="clipboard"
                  size={24}
                  color={focused ? colors.tint : colors.textDim}
                />
                {validUnproducedCount > 0 && (
                  <View style={[styles.badge, { backgroundColor: colors.tint }]}>
                    <Text style={styles.badgeText}>
                      {validUnproducedCount > 99 ? "99+" : validUnproducedCount}
                    </Text>
                  </View>
                )}
              </View>
            ),
          }}
        />
      )}
      {/* Meetings and Schedule tabs hidden for now - focusing on Live
      <Tab.Screen
        name="Meetings"
        component={MeetingsScreen}
        options={{
          tabBarLabel: t("mainNavigator:meetingsTab"),
          tabBarIcon: ({ focused }) => (
            <Icon icon="community" color={focused ? colors.tint : colors.textDim} size={24} />
          ),
        }}
      />
      <Tab.Screen
        name="Schedule"
        component={ScheduleScreen}
        options={{
          tabBarLabel: t("mainNavigator:scheduleTab"),
          tabBarIcon: ({ focused }) => (
            <Icon icon="menu" color={focused ? colors.tint : colors.textDim} size={24} />
          ),
        }}
      />
      */}
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: t("mainNavigator:settingsTab"),
          tabBarIcon: ({ focused }) => (
            <Icon icon="settings" color={focused ? colors.tint : colors.textDim} size={24} />
          ),
        }}
      />
    </Tab.Navigator>
  )
})

const styles = StyleSheet.create({
  iconContainer: {
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "bold",
  },
})
