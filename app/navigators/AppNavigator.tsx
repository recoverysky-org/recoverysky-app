/**
 * The app navigator (formerly "AppNavigator" and "MainNavigator") is used for the primary
 * navigation flows of your app.
 * Generally speaking, it will contain an auth flow (registration, login, forgot password)
 * and a "main" flow which the user will use once logged in.
 */
import { useEffect } from "react"
import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { observer } from "mobx-react-lite"

import Config from "@/config"
import { useAuthenticationStore, useConfigStore, useProfileStore } from "@/models"
import { ErrorBoundary } from "@/screens/ErrorScreen/ErrorBoundary"
import { LicensesScreen } from "@/screens/LicensesScreen"
import { LoginScreen } from "@/screens/LoginScreen"
import { MaintenanceScreen } from "@/screens/MaintenanceScreen"
import { OnboardingImport } from "@/screens/onboarding/OnboardingImport"
import { TermsScreen } from "@/screens/TermsScreen"
import { ZoomLoginScreen } from "@/screens/ZoomLoginScreen"
import { ZoomSetupScreen } from "@/screens/ZoomSetupScreen"
import { useAuth0Wrapper } from "@/services/auth/useAuth0Wrapper"
import { useAppTheme } from "@/theme/context"
import { logger } from "@/utils/logger"

import { MainNavigator } from "./MainNavigator"
import type { AppStackParamList, NavigationProps } from "./navigationTypes"
import { navigationRef, useBackButtonHandler, flushPendingNavigation } from "./navigationUtilities"
import { OnboardingNavigator } from "./OnboardingNavigator"

const log = logger.child({ module: "AppNavigator" })

/**
 * This is a list of all the route names that will exit the app if the back button
 * is pressed while in that screen. Only affects Android.
 */
const exitRoutes = Config.exitRoutes

// Documentation: https://reactnavigation.org/docs/stack-navigator/
const Stack = createNativeStackNavigator<AppStackParamList>()

const AppStack = observer(function AppStack() {
  log.debug("AppStack initializing")

  useAuth0Wrapper() // Syncs Auth0 session → MST store, sets authReady
  const authStore = useAuthenticationStore()
  const configStore = useConfigStore()
  const profileStore = useProfileStore()
  const isAuthenticated = authStore.isAuthenticated
  // Zoom account connection is no longer required at first launch — meeting
  // joins now route through the external Zoom app, which doesn't need our
  // OAuth/ZAK link to function. The ZoomSetup screen + the per-screen
  // reconnect flow (ZoomLogin) are kept registered downstream so the
  // gate can be re-enabled later by restoring `!profileStore.zoomConnected`.
  // The reference to profileStore.zoomConnected is kept so a stale
  // `zoomConnected=false` in MMKV doesn't suddenly route returning users
  // through a flow we just hid.
  void profileStore.zoomConnected
  const needsZoomSetup = false
  const needsOnboarding = !profileStore.onboardingCompleted
  // Full-screen MaintenanceScreen is reserved for the cold-start outage:
  // the very first /config fetch failed with no cached data to render.
  // Runtime maintenance (server flag flips, polling failure after retries)
  // shows the non-blocking MaintenanceBanner instead and leaves navigation
  // alone — critical so the in-meeting Zoom timer modal is never unmounted
  // by a navigator swap mid-meeting.
  const showOutage = configStore.outageMode
  log.debug("Auth state retrieved", { isAuthenticated, needsZoomSetup, needsOnboarding, showOutage })

  const {
    theme: { colors },
  } = useAppTheme()
  log.debug("Theme retrieved")

  useEffect(() => {
    log.info("AppStack mounted", {
      isAuthenticated,
      authReady: authStore.authReady,
      needsZoomSetup,
      needsOnboarding,
    })
    return () => {
      log.debug("AppStack unmounting")
    }
  }, [isAuthenticated, authStore.authReady, needsZoomSetup, needsOnboarding])

  // Don't render navigation until auth is resolved — splash screen covers this
  if (!authStore.authReady) {
    return null
  }

  // Determine initial route based on outage, auth, zoom, and onboarding status
  const initialRoute = showOutage
    ? "Maintenance"
    : !isAuthenticated
      ? "Login"
      : needsZoomSetup
        ? "ZoomSetup"
        : needsOnboarding
          ? "Onboarding"
          : "Main"
  log.debug("Determining initial route", {
    initialRoute,
    showOutage,
    isAuthenticated,
    needsZoomSetup,
    needsOnboarding,
  })

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        navigationBarColor: colors.background,
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
      initialRouteName={initialRoute}
    >
      {showOutage ? (
        <Stack.Screen name="Maintenance" component={MaintenanceScreen} />
      ) : isAuthenticated ? (
        needsZoomSetup ? (
          <Stack.Screen name="ZoomSetup" component={ZoomSetupScreen} />
        ) : needsOnboarding ? (
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainNavigator} />
            <Stack.Screen
              name="ZoomLogin"
              component={ZoomLoginScreen}
              options={{
                presentation: "modal",
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="Import"
              component={OnboardingImport}
              options={{
                presentation: "modal",
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="Licenses"
              component={LicensesScreen}
              options={{
                presentation: "modal",
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="Terms"
              component={TermsScreen}
              options={{
                presentation: "modal",
                headerShown: false,
              }}
            />
          </>
        )
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}

      {/** 🔥 Your screens go here */}
      {/* IGNITE_GENERATOR_ANCHOR_APP_STACK_SCREENS */}
    </Stack.Navigator>
  )
})

export const AppNavigator = (props: NavigationProps) => {
  log.debug("AppNavigator initializing")

  const { navigationTheme } = useAppTheme()
  log.debug("Navigation theme retrieved")

  useBackButtonHandler((routeName) => exitRoutes.includes(routeName))

  useEffect(() => {
    log.info("AppNavigator mounted")
    return () => {
      log.debug("AppNavigator unmounting")
    }
  }, [])

  log.debug("AppNavigator rendering NavigationContainer")

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={flushPendingNavigation}
      {...props}
    >
      <ErrorBoundary catchErrors={Config.catchErrors}>
        <AppStack />
      </ErrorBoundary>
    </NavigationContainer>
  )
}
