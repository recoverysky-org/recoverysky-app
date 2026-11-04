/**
 * My Day's navigation port over React Navigation (ADDED 2026-11-04, My Day tab spec §4.5).
 *
 * The package's screens move only through `MyDayNavigation`; this builds one from the My Day
 * stack's own `navigation` prop. Route names come from `myDayRouteFor` (the pure table).
 */
import type { MyDayNavigation } from "@daily-dash/my-day"

import { myDayRouteFor } from "./myDayNavigationLogic"

/**
 * The two methods the adapter uses, typed loosely on purpose: React Navigation's own
 * `navigate` is overloaded and generic over the param list, so a stack screen's `navigation`
 * does not accept a computed `keyof MyDayStackParamList` name, nor a tab name (`Meetings`)
 * the stack itself lacks. `MyDayHost` casts its `navigation` to this once, with the reason.
 */
export interface MyDayNavigationLike {
  navigate(name: string, params?: object): void
  goBack(): void
}

/**
 * No `signOut`: the package's today card offers Sign out only when the host gives one, and
 * Settings owns sign-out here, so the today card shows no Sign out link (spec §4.5).
 */
export function createMyDayNavigation(nav: MyDayNavigationLike): MyDayNavigation {
  return {
    go: (route, ...params) => {
      const r = myDayRouteFor(route, params[0])
      nav.navigate(r.name, r.params)
    },
    back: () => nav.goBack(),
    // Spec D3: the crisis path is the Meetings tab's Online (live) segment. The My Day stack
    // has no `Meetings` route, so React Navigation bubbles this navigate to the parent tab
    // navigator, which does. `segment: "live"` is the key the Online segment still carries.
    openCrisisPath: () => nav.navigate("Meetings", { segment: "live" }),
  }
}
