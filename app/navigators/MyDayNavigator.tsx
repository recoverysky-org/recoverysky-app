/**
 * MyDayNavigator — the My Day tab: a native stack of the Daily Dash package's six screens
 * under seven routes (ADDED 2026-11-04, My Day tab spec §4.5). MainNavigator registers it as
 * the `MyDay` tab for premium accounts.
 *
 * The Daily Dash client (`DailyDashClient`, i.e. `ClientProvider`) mounts here, once per tab
 * mount, around the whole stack, so every `MyDayFrame` below it sits inside the provider that
 * `useSession()` and `useDb()` read. CHANGED 2026-11-04: it used to wrap the app at app level,
 * which remounted the whole app whenever the My Day gate flipped (see DailyDashProvider.tsx).
 *
 * Route names are `MyDay*` (`myDayNavigationLogic.ts` maps the package's `MyDayRoutes` keys to
 * them). `RoutineItemScreen` serves two routes: `MyDayRoutineNew` (no `itemId`, a new item) and
 * `MyDayRoutineItem` (an existing one).
 *
 * Each screen is a module-scope component, not an inline render function, so React Navigation
 * never sees a new component type on re-render (which would remount the screen). Each wraps
 * its package screen in `MyDayFrame`, which builds the provider from that screen's own
 * `navigation`: `back()` then pops this stack, and `go()` pushes onto it.
 *
 * Header hidden: the package draws its own glass header.
 */
import { FC } from "react"
import {
  CheckInScreen,
  NightScreen,
  NightsScreen,
  RoutineItemScreen,
  RoutineScreen,
  TodayScreen,
} from "@daily-dash/my-day"
import { createNativeStackNavigator } from "@react-navigation/native-stack"

import { DailyDashClient } from "@/context/DailyDashProvider"
import { MyDayFrame } from "@/screens/myDay/MyDayFrame"

import type { MyDayScreenProps, MyDayStackParamList } from "./navigationTypes"

const Stack = createNativeStackNavigator<MyDayStackParamList>()

const MyDayTodayRoute: FC<MyDayScreenProps<"MyDayToday">> = ({ navigation }) => (
  <MyDayFrame navigation={navigation}>
    <TodayScreen />
  </MyDayFrame>
)

const MyDayCheckInRoute: FC<MyDayScreenProps<"MyDayCheckIn">> = ({ navigation, route }) => (
  <MyDayFrame navigation={navigation}>
    <CheckInScreen typeKey={route.params.typeKey} />
  </MyDayFrame>
)

const MyDayRoutineRoute: FC<MyDayScreenProps<"MyDayRoutine">> = ({ navigation }) => (
  <MyDayFrame navigation={navigation}>
    <RoutineScreen />
  </MyDayFrame>
)

const MyDayRoutineNewRoute: FC<MyDayScreenProps<"MyDayRoutineNew">> = ({ navigation }) => (
  <MyDayFrame navigation={navigation}>
    <RoutineItemScreen />
  </MyDayFrame>
)

const MyDayRoutineItemRoute: FC<MyDayScreenProps<"MyDayRoutineItem">> = ({ navigation, route }) => (
  <MyDayFrame navigation={navigation}>
    <RoutineItemScreen itemId={route.params.itemId} />
  </MyDayFrame>
)

const MyDayNightRoute: FC<MyDayScreenProps<"MyDayNight">> = ({ navigation, route }) => (
  <MyDayFrame navigation={navigation}>
    <NightScreen date={route.params.date} />
  </MyDayFrame>
)

const MyDayNightsRoute: FC<MyDayScreenProps<"MyDayNights">> = ({ navigation }) => (
  <MyDayFrame navigation={navigation}>
    <NightsScreen />
  </MyDayFrame>
)

export const MyDayNavigator = () => (
  <DailyDashClient>
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="MyDayToday">
      <Stack.Screen name="MyDayToday" component={MyDayTodayRoute} />
      <Stack.Screen name="MyDayCheckIn" component={MyDayCheckInRoute} />
      <Stack.Screen name="MyDayRoutine" component={MyDayRoutineRoute} />
      <Stack.Screen name="MyDayRoutineNew" component={MyDayRoutineNewRoute} />
      <Stack.Screen name="MyDayRoutineItem" component={MyDayRoutineItemRoute} />
      <Stack.Screen name="MyDayNight" component={MyDayNightRoute} />
      <Stack.Screen name="MyDayNights" component={MyDayNightsRoute} />
    </Stack.Navigator>
  </DailyDashClient>
)
