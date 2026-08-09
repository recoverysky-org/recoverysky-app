export interface ConfigBaseProps {
  persistNavigation: "always" | "dev" | "prod" | "never"
  catchErrors: "always" | "dev" | "prod" | "never"
  exitRoutes: string[]
}

export type PersistNavigationConfig = ConfigBaseProps["persistNavigation"]

const BaseConfig: ConfigBaseProps = {
  // This feature is particularly useful in development mode, but
  // can be used in production as well if you prefer.
  persistNavigation: "dev",

  /**
   * Only enable if we're catching errors in the right environment
   */
  catchErrors: "always",

  /**
   * This is a list of all the route names that will exit the app if the back button
   * is pressed while in that screen. Only affects Android.
   *
   * CHANGED 2026-08-09: was `["Welcome"]`, an Ignite-template route that this app
   * never registered — so the list never matched a live route. Emptying it is
   * behavior-identical: `useBackButtonHandler` (navigationUtilities.ts) falls
   * through to `return false` on a non-match, letting Android's default handling
   * exit at the root. Add a real root route name here only if you want the back
   * button to hard-exit from a screen that still has navigation history.
   */
  exitRoutes: [],
}

export default BaseConfig
