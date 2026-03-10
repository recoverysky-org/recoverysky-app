import { useEffect } from "react"
import { View, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { useNavigation } from "@react-navigation/native"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "@/components/Icon"
import { Text } from "@/components/Text"
import { useMeetings } from "@/context/MeetingContext"
import { useSubscription } from "@/context/SubscriptionContext"
import { useAttendanceBadge } from "@/hooks/useAttendanceBadge"
import { useProfileStore } from "@/models"
// import { AgentScreen } from "@/screens/AgentScreen" // Hidden until ready
import { AttendanceScreen } from "@/screens/AttendanceScreen"
import { HomeScreen } from "@/screens/HomeScreen"
import { MeetingsScreen } from "@/screens/MeetingsScreen"
import { SettingsScreen } from "@/screens/SettingsScreen"
import { useAppTheme } from "@/theme/context"

import type { MainTabParamList, SettingsSection } from "./navigationTypes"
import { loadString, remove } from "@/utils/storage"

const Tab = createBottomTabNavigator<MainTabParamList>()

/**
 * MainNavigator - Primary tab navigation for authenticated users
 *
 * Tab structure:
 * - Home: Dashboard/landing page
 * - Meetings: Combined Live + Listings with segment control
 * - Attendance: (optional) User attendance tracking
 * - Settings: User profile, account, and app settings
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
  const { isPremium: _isPremium } = useSubscription() // Agent tab hidden
  const navigation = useNavigation<any>()

  // Post-login redirect: navigate to Settings section if stored before login flow
  useEffect(() => {
    const postLoginSection = loadString("POST_LOGIN_SECTION") as SettingsSection | null
    if (!postLoginSection) return
    remove("POST_LOGIN_SECTION")
    // Delay to let tab navigator fully mount before navigating
    const timer = setTimeout(() => {
      navigation.navigate("Settings", { section: postLoginSection })
    }, 300)
    return () => clearTimeout(timer)
  }, [navigation])

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
        name="Meetings"
        component={MeetingsScreen}
        options={{
          tabBarLabel: t("mainNavigator:meetingsTab"),
          tabBarIcon: ({ focused }) => (
            <View style={styles.iconContainer}>
              <Ionicons name="videocam" size={24} color={focused ? colors.tint : colors.textDim} />
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
      {/* Agent tab hidden until ready for release
      {isPremium && (
        <Tab.Screen
          name="Agent"
          component={AgentScreen}
          options={{
            tabBarLabel: t("mainNavigator:agentTab"),
            tabBarIcon: ({ focused }) => (
              <Ionicons name="sparkles" size={24} color={focused ? colors.tint : colors.textDim} />
            ),
          }}
        />
      )}
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

// Badge text color constant
const BADGE_TEXT_COLOR = "#FFFFFF"

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    borderRadius: 9,
    height: 18,
    justifyContent: "center",
    minWidth: 18,
    paddingHorizontal: 4,
    position: "absolute",
    right: -10,
    top: -6,
  },
  badgeText: {
    color: BADGE_TEXT_COLOR,
    fontSize: 10,
    fontWeight: "bold",
  },
  iconContainer: {
    position: "relative",
  },
})
