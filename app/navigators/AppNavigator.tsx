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
import { useAuthenticationStore, useProfileStore } from "@/models"
import { ErrorBoundary } from "@/screens/ErrorScreen/ErrorBoundary"
import { LoginScreen } from "@/screens/LoginScreen"
import { OnboardingImport } from "@/screens/onboarding/OnboardingImport"
import { ZoomLoginScreen } from "@/screens/ZoomLoginScreen"
import { ZoomSetupScreen } from "@/screens/ZoomSetupScreen"
import { useAppTheme } from "@/theme/context"
import { logger } from "@/utils/logger"

import { MainNavigator } from "./MainNavigator"
import type { AppStackParamList, NavigationProps } from "./navigationTypes"
import { navigationRef, useBackButtonHandler } from "./navigationUtilities"
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

  const authStore = useAuthenticationStore()
  const profileStore = useProfileStore()
  const isAuthenticated = authStore.isAuthenticated
  const needsZoomSetup = !profileStore.zoomConnected
  const needsOnboarding = !profileStore.onboardingCompleted
  log.debug("Auth state retrieved", { isAuthenticated, needsZoomSetup, needsOnboarding })

  const {
    theme: { colors },
  } = useAppTheme()
  log.debug("Theme retrieved")

  useEffect(() => {
    log.info("AppStack mounted", { isAuthenticated, needsZoomSetup, needsOnboarding })
    return () => {
      log.debug("AppStack unmounting")
    }
  }, [isAuthenticated, needsZoomSetup, needsOnboarding])

  // Determine initial route based on auth, zoom, and onboarding status
  const initialRoute = !isAuthenticated
    ? "Login"
    : needsZoomSetup
      ? "ZoomSetup"
      : needsOnboarding
        ? "Onboarding"
        : "Main"
  log.debug("Determining initial route", {
    initialRoute,
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
      {isAuthenticated ? (
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
    <NavigationContainer ref={navigationRef} theme={navigationTheme} {...props}>
      <ErrorBoundary catchErrors={Config.catchErrors}>
        <AppStack />
      </ErrorBoundary>
    </NavigationContainer>
  )
}
