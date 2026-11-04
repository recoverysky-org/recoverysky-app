/**
 * The Daily Dash host service (My Day tab). ADDED 2026-11-04.
 * app.tsx calls `configureDailyDash` once; everything else reads from here.
 * Task 8 adds `getDailyDashDriver`.
 */
export { createDailyDashSignIn } from "./dailyDashSignIn"
export type { DailyDashSignInDeps } from "./dailyDashSignIn"
export {
  configureDailyDash,
  dailyDashLoadSignIn,
  dailyDashOnRefused,
  getDailyDashClientIdentity,
  getDailyDashConnectivity,
  getDailyDashLogger,
  getDailyDashSession,
  peekDailyDashSession,
} from "./dailyDashSession"
export type { DailyDashHostDeps } from "./dailyDashSession"
