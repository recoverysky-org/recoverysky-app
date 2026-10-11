/**
 * GuestNavigator — Android guest mode's whole app: the Meetings tab, alone.
 *
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md).
 * A bottom-tab navigator typed with MainTabParamList (tab bar hidden) rather
 * than a stack, so MeetingsScreen's route/param handling (`segment`,
 * `meetingId`, setParams) works unchanged — it reads
 * RouteProp<MainTabParamList, "Meetings">. Home, Attendance and Settings are
 * deliberately NOT registered: a guest has no data for them. A navigate() to
 * one of them from a stale push/deep link logs a React Navigation warning and
 * does nothing.
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"

import { MeetingsScreen } from "@/screens/MeetingsScreen"

import type { MainTabParamList } from "./navigationTypes"

const Tab = createBottomTabNavigator<MainTabParamList>()

export function GuestNavigator() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={() => null}>
      <Tab.Screen name="Meetings" component={MeetingsScreen} />
    </Tab.Navigator>
  )
}
