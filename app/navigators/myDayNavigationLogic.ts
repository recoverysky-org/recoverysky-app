/**
 * My Day route table (ADDED 2026-11-04, My Day tab spec §4.5).
 *
 * The Daily Dash package names its screens by `MyDayRoutes` keys (`today`, `checkIn`, …);
 * the app's native stack names them `MyDay*` so they sit apart from every other route in the
 * navigation state (and in `ScreenTracker`'s screen names). This table is the only place the
 * two meet.
 *
 * Pure, no runtime imports: vitest loads it (it cannot resolve `@/`, and the package's runtime
 * pulls in React Native). Both imports below are type-only and erased.
 */
import type { MyDayRoutes } from "@daily-dash/my-day"

import type { MyDayStackParamList } from "./navigationTypes"

/**
 * Package route → stack screen. Typed as a mapped type over `keyof MyDayRoutes` on purpose
 * (package amendment A6): when My Day adds a route, this object is missing a key and
 * `npm run compile` fails, instead of `go()` navigating to a screen that does not exist.
 * Don't loosen it to `Record<string, …>` or a `Partial`.
 */
export const MY_DAY_SCREEN: { [R in keyof MyDayRoutes]: keyof MyDayStackParamList } = {
  today: "MyDayToday",
  checkIn: "MyDayCheckIn",
  routine: "MyDayRoutine",
  routineNew: "MyDayRoutineNew",
  routineItem: "MyDayRoutineItem",
  night: "MyDayNight",
  nights: "MyDayNights",
}

/**
 * The stack screen and params for one My Day route. The params pass through unchanged: each
 * `MyDayStackParamList` entry carries exactly its `MyDayRoutes` counterpart's params.
 */
export function myDayRouteFor<R extends keyof MyDayRoutes>(
  route: R,
  params: MyDayRoutes[R] | undefined,
): { name: keyof MyDayStackParamList; params: MyDayRoutes[R] | undefined } {
  return { name: MY_DAY_SCREEN[route], params }
}
