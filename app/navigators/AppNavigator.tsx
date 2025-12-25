/**
 * The app navigator (formerly "AppNavigator" and "MainNavigator") is used for the primary
 * navigation flows of your app.
 * Generally speaking, it will contain an auth flow (registration, login, forgot password)
 * and a "main" flow which the user will use once logged in.
 */
import { useEffect } from "react"
import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"

import Config from "@/config"
import { useAuth } from "@/context/AuthContext"
import { ErrorBoundary } from "@/screens/ErrorScreen/ErrorBoundary"
import { LoginScreen } from "@/screens/LoginScreen"
import { WelcomeScreen } from "@/screens/WelcomeScreen"
import { useAppTheme } from "@/theme/context"
import { logger } from "@/utils/logger"

import { MainNavigator } from "./MainNavigator"
import type { AppStackParamList, NavigationProps } from "./navigationTypes"
import { navigationRef, useBackButtonHandler } from "./navigationUtilities"

const log = logger.child({ module: "AppNavigator" })

/**
 * This is a list of all the route names that will exit the app if the back button
 * is pressed while in that screen. Only affects Android.
 */
const exitRoutes = Config.exitRoutes

// Documentation: https://reactnavigation.org/docs/stack-navigator/
const Stack = createNativeStackNavigator<AppStackParamList>()

const AppStack = () => {
  log.debug("AppStack initializing")

  const { isAuthenticated } = useAuth()
  log.debug("Auth state retrieved", { isAuthenticated })

  const {
    theme: { colors },
  } = useAppTheme()
  log.debug("Theme retrieved")

  useEffect(() => {
    log.info("AppStack mounted", { isAuthenticated })
    return () => {
      log.debug("AppStack unmounting")
    }
  }, [isAuthenticated])

  const initialRoute = isAuthenticated ? "Welcome" : "Login"
  log.debug("Determining initial route", { initialRoute, isAuthenticated })

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
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />

          <Stack.Screen name="Main" component={MainNavigator} />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
        </>
      )}

      {/** 🔥 Your screens go here */}
      {/* IGNITE_GENERATOR_ANCHOR_APP_STACK_SCREENS */}
    </Stack.Navigator>
  )
}

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
