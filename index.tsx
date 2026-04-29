import "@expo/metro-runtime" // this is for fast refresh on web w/o expo-router
import { registerRootComponent } from "expo"

import { App } from "@/app"
import { initSentry, wrapApp } from "@/services/crashReporting/sentry"
import { setupGlobalErrorHandler } from "@/utils/errorHandler"

// Order matters here:
// 1. initSentry() — installs the Sentry SDK + bridges logger.warn/.info/.debug
//    to Sentry breadcrumbs and logger.error/.fatal to Sentry events. Must
//    run BEFORE setupGlobalErrorHandler so that any error that handler
//    catches is already bridged into Sentry.
// 2. setupGlobalErrorHandler() — registers ErrorUtils + addEventListener
//    handlers that funnel uncaught errors / unhandled rejections through
//    the (now-bridged) logger.
// 3. registerRootComponent(wrapApp(App)) — Sentry.wrap adds an internal
//    React error boundary + touch-event tracking on the app root.
initSentry()
setupGlobalErrorHandler()

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(wrapApp(App))
