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
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { MeetingsScreen } from "@/screens/MeetingsScreen"
import { useAppTheme } from "@/theme/context"

import type { MainTabParamList } from "./navigationTypes"

const Tab = createBottomTabNavigator<MainTabParamList>()

export function GuestNavigator() {
  const { bottom } = useSafeAreaInsets()
  const {
    theme: { colors },
  } = useAppTheme()

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        // ADDED 2026-10-11: the scene clears the bottom system inset itself.
        // In Main the tab bar does it (MainNavigator's tabBarStyle grows by
        // `bottom`), and MeetingsScreen pads only the top. With the tab bar
        // hidden and Android edge-to-edge on (app.json edgeToEdgeEnabled),
        // the lists, the map and Search would otherwise draw under the system
        // navigation bar. This gives Main's layout minus the tab bar, and
        // leaves MeetingsScreen inside Main untouched. The background is the
        // app's colors.background, as on Main's tab bar: the scene's default
        // is React Navigation's stock theme colour, a shade off it.
        sceneStyle: { paddingBottom: bottom, backgroundColor: colors.background },
      }}
      tabBar={() => null}
    >
      <Tab.Screen name="Meetings" component={MeetingsScreen} />
    </Tab.Navigator>
  )
}
