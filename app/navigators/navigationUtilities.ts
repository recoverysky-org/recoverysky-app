import { useState, useEffect, useRef } from "react"
import { BackHandler, Linking, Platform } from "react-native"
import {
  NavigationState,
  PartialState,
  createNavigationContainerRef,
} from "@react-navigation/native"

import Config from "@/config"
import type { PersistNavigationConfig } from "@/config/config.base"
import { trackScreenView } from "@/services/tracking"
import * as storage from "@/utils/storage"
import { useIsMounted } from "@/utils/useIsMounted"

import type { AppStackParamList, NavigationProps } from "./navigationTypes"

type Storage = typeof storage

/**
 * Reference to the root App Navigator.
 *
 * If needed, you can use this to access the navigation object outside of a
 * `NavigationContainer` context. However, it's recommended to use the `useNavigation` hook whenever possible.
 * @see [Navigating Without Navigation Prop]{@link https://reactnavigation.org/docs/navigating-without-navigation-prop/}
 *
 * The types on this reference will only let you reference top level navigators. If you have
 * nested navigators, you'll need to use the `useNavigation` with the stack navigator's ParamList type.
 */
export const navigationRef = createNavigationContainerRef<AppStackParamList>()

/**
 * Gets the current screen from any navigation state.
 * @param {NavigationState | PartialState<NavigationState>} state - The navigation state to traverse.
 * @returns {string} - The name of the current screen.
 */
export function getActiveRouteName(state: NavigationState | PartialState<NavigationState>): string {
  const route = state.routes[state.index ?? 0]

  // Found the active route -- return the name
  if (!route.state) return route.name as keyof AppStackParamList

  // Recursive call to deal with nested routers
  return getActiveRouteName(route.state as NavigationState<AppStackParamList>)
}

const iosExit = () => false

/**
 * Hook that handles Android back button presses and forwards those on to
 * the navigation or allows exiting the app.
 * @see [BackHandler]{@link https://reactnative.dev/docs/backhandler}
 * @param {(routeName: string) => boolean} canExit - Function that returns whether we can exit the app.
 * @returns {void}
 */
export function useBackButtonHandler(canExit: (routeName: string) => boolean) {
  // The reason we're using a ref here is because we need to be able
  // to update the canExit function without re-setting up all the listeners
  const canExitRef = useRef(Platform.OS !== "android" ? iosExit : canExit)

  useEffect(() => {
    canExitRef.current = canExit
  }, [canExit])

  useEffect(() => {
    // We'll fire this when the back button is pressed on Android.
    const onBackPress = () => {
      if (!navigationRef.isReady()) {
        return false
      }

      // grab the current route
      // CHANGED 2026-09-12: @react-navigation/native 7.3 types getRootState() as
      // possibly undefined (the ref is ready, but the root navigator may not
      // have produced a state yet). Treat that like "not ready" and let the OS
      // handle the back press rather than crash inside getActiveRouteName.
      const rootState = navigationRef.getRootState()
      if (!rootState) {
        return false
      }
      const routeName = getActiveRouteName(rootState)

      // are we allowed to exit?
      if (canExitRef.current(routeName)) {
        // exit and let the system know we've handled the event
        BackHandler.exitApp()
        return true
      }

      // we can't exit, so let's turn this into a back action
      if (navigationRef.canGoBack()) {
        navigationRef.goBack()
        return true
      }

      return false
    }

    // Subscribe when we come to life
    const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress)

    // Unsubscribe when we're done
    return () => subscription.remove()
  }, [])
}

/**
 * This helper function will determine whether we should enable navigation persistence
 * based on a config setting and the __DEV__ environment (dev or prod).
 * @param {PersistNavigationConfig} persistNavigation - The config setting for navigation persistence.
 * @returns {boolean} - Whether to restore navigation state by default.
 */
function navigationRestoredDefaultState(persistNavigation: PersistNavigationConfig) {
  if (persistNavigation === "always") return false
  if (persistNavigation === "dev" && __DEV__) return false
  if (persistNavigation === "prod" && !__DEV__) return false

  // all other cases, disable restoration by returning true
  return true
}

/**
 * Custom hook for persisting navigation state.
 * @param {Storage} storage - The storage utility to use.
 * @param {string} persistenceKey - The key to use for storing the navigation state.
 * @returns {object} - The navigation state and persistence functions.
 */
export function useNavigationPersistence(storage: Storage, persistenceKey: string) {
  const [initialNavigationState, setInitialNavigationState] =
    useState<NavigationProps["initialState"]>()
  const isMounted = useIsMounted()

  const initNavState = navigationRestoredDefaultState(Config.persistNavigation)
  const [isRestored, setIsRestored] = useState(initNavState)

  const routeNameRef = useRef<keyof AppStackParamList | undefined>(undefined)

  const onNavigationStateChange = (state: NavigationState | undefined) => {
    const previousRouteName = routeNameRef.current
    if (state !== undefined) {
      const currentRouteName = getActiveRouteName(state)

      if (previousRouteName !== currentRouteName) {
        // track screens.
        if (__DEV__) {
          console.log(currentRouteName)
        }
        trackScreenView(currentRouteName)
      }

      // Save the current route name for later comparison
      routeNameRef.current = currentRouteName as keyof AppStackParamList

      // Persist state to storage
      storage.save(persistenceKey, state)
    }
  }

  const restoreState = async () => {
    try {
      const initialUrl = await Linking.getInitialURL()

      // Only restore the state if app has not started from a deep link
      if (!initialUrl) {
        const state = (await storage.load(persistenceKey)) as NavigationProps["initialState"] | null
        if (state) setInitialNavigationState(state)
      }
    } finally {
      if (isMounted()) setIsRestored(true)
    }
  }

  useEffect(() => {
    if (!isRestored) restoreState()
    // runs once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { onNavigationStateChange, restoreState, isRestored, initialNavigationState }
}

/**
 * Pending navigation queued before the NavigationContainer was ready (e.g., cold-start from notification).
 * Flushed by `flushPendingNavigation` once the container mounts.
 */
let pendingNavigation: { name: unknown; params?: unknown } | null = null

/**
 * Pending Meeting ID — notification → schedule popup bridge
 *
 * When a push notification carries a meetingId, we need to open the SchedulePopup
 * on the Meetings/Live screen. This is surprisingly tricky because:
 *
 * 1. Route params are unreliable — MeetingsScreen clears meetingId from params
 *    immediately to prevent re-triggering on app restart, but this races with
 *    LiveContent's useEffect that reads the param.
 *
 * 2. Cold-start remounts — during cold start, auth state sync causes the entire
 *    AppNavigator tree (including LiveContent) to unmount and remount. Any
 *    component-level state or refs from the first mount are lost.
 *
 * 3. Warm-start needs reactivity — when the app is already running and a
 *    notification is tapped, LiveContent is already mounted. We need to trigger
 *    its useEffect to re-fire with the new meetingId.
 *
 * Solution: Store the meetingId in a module-level variable (survives remounts)
 * with a pub/sub mechanism (triggers re-renders for warm start).
 *
 * Flow:
 *   app.tsx handleNotificationData → setPendingMeetingId(id) → navigate("Meetings")
 *   LiveContent subscribes via usePendingMeetingId() → effect fires →
 *   peekPendingMeetingId() reads ID → fetches schedule from API → opens popup →
 *   consumePendingMeetingId() clears it
 *
 * The peek/consume split ensures the ID isn't lost if the component unmounts
 * before the API response arrives (cold-start remount scenario).
 *
 * CHANGED 2026-08-03: the store now carries a TARGET alongside the id. Two
 * different segments of the Meetings tab reopen a popup this way — LiveContent
 * (SchedulePopup) and InPersonContent (InPersonPopup) — and both are mounted
 * simultaneously, so an untagged id would be raced for by whichever effect ran
 * first. `peek` filters by target, so each consumer only ever sees ids meant
 * for it. The target defaults to "live" everywhere, which is why LiveContent
 * needed no changes.
 *
 * CHANGED 2026-08-07: the notification path in app.tsx DOES pass a target now.
 * Reminder pushes carry a `segment` derived from the meeting's venueType, and
 * an in-person reminder has to reach InPersonPopup (the only surface with a
 * Directions button) rather than land on a segment whose popup discards
 * in-person records. The default stays "live" for every other caller and for
 * pushes from API builds that predate the field.
 */

/** Which segment's popup should consume a pending meetingId. */
export type PendingMeetingTarget = "live" | "inperson"

let _pendingMeetingId: string | undefined
let _pendingMeetingTarget: PendingMeetingTarget = "live"
const _meetingIdListeners = new Set<() => void>()

/**
 * Store a meetingId for a popup to pick up. Notifies usePendingMeetingId()
 * subscribers. `target` selects which segment consumes it — default "live"
 * because that is where a deep link with no segment information belongs
 * (originally the only kind; now also any push from an API build that predates
 * the `segment` field). Callers that know the venue should say so: app.tsx
 * passes `pendingTargetForSegment(...)`.
 */
export function setPendingMeetingId(id: string, target: PendingMeetingTarget = "live") {
  _pendingMeetingId = id
  _pendingMeetingTarget = target
  _meetingIdListeners.forEach((fn) => fn())
}

/**
 * Read the pending meetingId without consuming it. Safe to call multiple
 * times. Returns undefined when the pending id is addressed to a different
 * target — that is the whole point of the target field, so always pass the
 * caller's own target rather than relying on the default.
 */
export function peekPendingMeetingId(target: PendingMeetingTarget = "live"): string | undefined {
  return _pendingMeetingTarget === target ? _pendingMeetingId : undefined
}

/** Clear the pending meetingId. Call only after the popup has been shown. */
export function consumePendingMeetingId(): void {
  _pendingMeetingId = undefined
  _pendingMeetingTarget = "live"
}

/**
 * React hook that re-renders when setPendingMeetingId is called.
 * Returns the current pending meetingId for `target` (without consuming it).
 * Used as a useEffect dependency in LiveContent / InPersonContent to trigger
 * popup logic. A store write for the OTHER target still re-renders both
 * subscribers — harmless, since the non-addressed one reads undefined and its
 * effect no-ops.
 */
export function usePendingMeetingId(target: PendingMeetingTarget = "live"): string | undefined {
  const { useSyncExternalStore } = require("react")
  return useSyncExternalStore(
    (cb: () => void) => {
      _meetingIdListeners.add(cb)
      return () => _meetingIdListeners.delete(cb)
    },
    () => peekPendingMeetingId(target),
  )
}

/**
 * use this to navigate without the navigation
 * prop. If you have access to the navigation prop, do not use this.
 * @see {@link https://reactnavigation.org/docs/navigating-without-navigation-prop/}
 * @param {unknown} name - The name of the route to navigate to.
 * @param {unknown} params - The params to pass to the route.
 */
export function navigate(name: unknown, params?: unknown) {
  if (navigationRef.isReady()) {
    // @ts-expect-error
    navigationRef.navigate(name as never, params as never)
  } else {
    // Queue for replay once NavigationContainer is ready
    pendingNavigation = { name, params }
  }
}

/**
 * Call from NavigationContainer's onReady to replay any navigation
 * that was attempted before the container mounted (e.g., notification cold-start).
 */
export function flushPendingNavigation() {
  if (pendingNavigation && navigationRef.isReady()) {
    const { name, params } = pendingNavigation
    pendingNavigation = null
    // @ts-expect-error
    navigationRef.navigate(name as never, params as never)
  }
}

/**
 * This function is used to go back in a navigation stack, if it's possible to go back.
 * If the navigation stack can't go back, nothing happens.
 * The navigationRef variable is a React ref that references a navigation object.
 * The navigationRef variable is set in the App component.
 */
export function goBack() {
  if (navigationRef.isReady() && navigationRef.canGoBack()) {
    navigationRef.goBack()
  }
}

/**
 * resetRoot will reset the root navigation state to the given params.
 * @param {Parameters<typeof navigationRef.resetRoot>[0]} state - The state to reset the root to.
 * @returns {void}
 */
export function resetRoot(
  state: Parameters<typeof navigationRef.resetRoot>[0] = { index: 0, routes: [] },
) {
  if (navigationRef.isReady()) {
    navigationRef.resetRoot(state)
  }
}
