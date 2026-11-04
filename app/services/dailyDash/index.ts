/**
 * The Daily Dash host service (My Day tab). ADDED 2026-11-04.
 * app.tsx calls `configureDailyDash` once; everything else reads from here.
 * Task 8 adds `getDailyDashDriver` / `peekDailyDashDriver` and the driver's
 * types.
 */
export { createDailyDashSignIn } from "./dailyDashSignIn"
export type { DailyDashSignInDeps } from "./dailyDashSignIn"
export {
  configureDailyDash,
  dailyDashLoadSignIn,
  dailyDashOnRefused,
  getDailyDashClientIdentity,
  getDailyDashConnectivity,
  getDailyDashDriver,
  getDailyDashLogger,
  getDailyDashSession,
  peekDailyDashDriver,
  peekDailyDashSession,
} from "./dailyDashSession"
export type { DailyDashHostDeps } from "./dailyDashSession"
export type { DailyDashDriver } from "./dailyDashDriver"
export type { Attempt, DriverAction, Trigger } from "./dailyDashDriverLogic"
