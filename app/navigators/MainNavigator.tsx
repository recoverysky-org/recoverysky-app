import { View, StyleSheet } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Icon } from "@/components/Icon"
import { Text } from "@/components/Text"
import { useMeetings } from "@/context/MeetingContext"
import { useSubscription } from "@/context/SubscriptionContext"
import { useAttendanceBadge } from "@/hooks/useAttendanceBadge"
import { useProfileStore } from "@/models"
import { AgentScreen } from "@/screens/AgentScreen"
import { AttendanceScreen } from "@/screens/AttendanceScreen"
import { HomeScreen } from "@/screens/HomeScreen"
import { MeetingsScreen } from "@/screens/MeetingsScreen"
import { SettingsScreen } from "@/screens/SettingsScreen"
import { SocialScreen } from "@/screens/SocialScreen"
import { isTimerSessionActive } from "@/services/attendance"
import { useAppTheme } from "@/theme/context"
import { decideAgentTabVisible } from "@/utils/agentTabLogic"

import type { MainTabParamList } from "./navigationTypes"

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
  const { isPremium } = useSubscription()
  // Agent tab stays hidden until ready for release.
  // CHANGED 2026-10-10: no longer a hard `false`. Shown when the build carries
  // a valid EXPO_PUBLIC_AGENT_URL and the user passes the entitlement gate
  // (`__DEV__ || isPremium`); see agentTabLogic.ts. To hide it again, remove
  // the var from the build's environment (eas.json + EAS production env for
  // OTAs), not from ConfigStore, which falls back to a default URL. isPremium
  // used to be read only to keep it from being flagged unused; it is now this
  // gate's input.
  const agentTabVisible = decideAgentTabVisible({
    // Must stay a direct `process.env.EXPO_PUBLIC_*` access: Expo inlines
    // these at bundle time only for that exact form.
    agentUrlEnv: process.env.EXPO_PUBLIC_AGENT_URL,
    isDev: __DEV__,
    isPremium,
  })
  // Community (Social) tab hidden for this release. Re-enable with
  // `__DEV__ || isPremium` once the SPA-side bugs are addressed.
  const socialTabVisible = false

  // Observable read — this is what makes the tab bar re-render when a timer
  // starts or ends. See the screenListeners comment below.
  const timerLocked = isTimerSessionActive()

  return (
    <Tab.Navigator
      initialRouteName="Home"
      // Tab switching is refused while an attendance timer is running. Leaving
      // the tab unmounts the popup that hosts the timer modal (RN Modal returns
      // null once hidden), which runs useAttendanceTimer's cleanup and destroys
      // the clock — nothing re-surfaces it until a cold start, so the user
      // silently loses the meeting they are sitting in. Save and Cancel both
      // call clearTimerSession(), so those are the only ways out and the lock
      // cannot strand anyone. preventDefault() is the supported way to refuse a
      // tab press; the greyed tabBarStyle below is the matching affordance.
      // NOTE: this covers taps only. Programmatic navigation (notification
      // taps -> navTo) bypasses tabPress entirely and is gated separately in
      // app.tsx's handleNotificationData — fixing one without the other leaves
      // the more likely path open.
      screenListeners={{
        tabPress: (e) => {
          if (isTimerSessionActive()) e.preventDefault()
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          height: bottom + 70,
          paddingBottom: bottom + 10,
          paddingTop: 10,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          // Reads as disabled while the timer holds the lock. Observed at
          // render (not inside the listener) so this component re-renders when
          // the flag flips.
          opacity: timerLocked ? 0.4 : 1,
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
          tabBarAccessibilityLabel:
            liveMeetings.length > 0
              ? `${t("mainNavigator:meetingsTab")}, ${liveMeetings.length} live`
              : t("mainNavigator:meetingsTab"),
          tabBarIcon: ({ focused }) => (
            <View style={styles.iconContainer}>
              <Ionicons name="videocam" size={24} color={focused ? colors.tint : colors.textDim} />
              {liveMeetings.length > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.tint }]} accessible={false}>
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
            tabBarAccessibilityLabel:
              validUnproducedCount > 0
                ? `${t("mainNavigator:attendanceTab")}, ${validUnproducedCount} new`
                : t("mainNavigator:attendanceTab"),
            tabBarIcon: ({ focused }) => (
              <View style={styles.iconContainer}>
                <Ionicons
                  name="clipboard"
                  size={24}
                  color={focused ? colors.tint : colors.textDim}
                />
                {validUnproducedCount > 0 && (
                  <View style={[styles.badge, { backgroundColor: colors.tint }]} accessible={false}>
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
      {agentTabVisible && (
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
      {socialTabVisible && (
        <Tab.Screen
          name="Social"
          component={SocialScreen}
          options={{
            tabBarLabel: t("mainNavigator:socialTab"),
            tabBarIcon: ({ focused }) => (
              <Ionicons name="people" size={24} color={focused ? colors.tint : colors.textDim} />
            ),
          }}
        />
      )}
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
