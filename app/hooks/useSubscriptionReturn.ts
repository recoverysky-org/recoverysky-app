/**
 * useSubscriptionReturn — owns the lifecycle of the paywall's `returnTo`
 * destination for SettingsScreen.
 *
 * When a premium gate interrupts the user, the interrupting screen navigates to
 * Settings with a `returnTo` route param describing where to put them back
 * after they buy (grammar and parsing live in `@/utils/returnToLogic`). This
 * hook is the storage half of that round-trip: it accepts the param, persists
 * it, and hands it back exactly once when the purchase succeeds.
 *
 * Two properties are load-bearing:
 *
 * 1. IT TRACKS PARAM UPDATES, NOT JUST THE MOUNT VALUE. SettingsScreen is a
 *    bottom-tab screen, so it stays mounted after its first focus — every
 *    "Subscribe" tap from another tab after that arrives as a param update on
 *    an already-mounted screen. This previously lived inline as
 *    `useRef(route.params?.returnTo ?? loadString(...))`, whose initializer
 *    runs once and never again; the destination was persisted but never
 *    readable, so a user who tapped Subscribe on the Attendance tab bought
 *    premium and was left sitting on Settings. Because the Attendance tab only
 *    exists once it's been enabled *in Settings*, that screen was essentially
 *    always already mounted and the return trip essentially never happened.
 *
 * 2. IT PERSISTS TO MMKV. An anonymous user tapping Subscribe is sent through
 *    Auth0 first, which restarts the navigator and remounts this screen with no
 *    route params. `SUBSCRIPTION_RETURN` is what carries the destination across
 *    that gap — which also means a string written by a PREVIOUS app version can
 *    be read by this one (see the legacy-grammar note in returnToLogic.ts).
 *
 * A ref rather than state on purpose: nothing renders from this value, and a
 * re-render mid-paywall is exactly what we don't want.
 */
import { useCallback, useEffect, useRef } from "react"

import { loadString, remove, saveString } from "@/utils/storage"

export const SUBSCRIPTION_RETURN_KEY = "SUBSCRIPTION_RETURN"

export interface SubscriptionReturn {
  /**
   * Read the pending destination and clear it (both ref and MMKV) so a later
   * unrelated upgrade doesn't re-navigate somewhere stale. Returns null when
   * there is nowhere to return to.
   */
  consume: () => string | null
}

export function useSubscriptionReturn(
  paramReturnTo: string | undefined,
  /** Clears `returnTo` off the route once we've taken ownership of it. */
  onClaimParam: () => void,
): SubscriptionReturn {
  const returnToRef = useRef<string | null>(paramReturnTo ?? loadString(SUBSCRIPTION_RETURN_KEY))

  // Latest-callback ref so the effect below depends only on the param. Taking
  // `onClaimParam` as a dependency instead would re-run the effect (and
  // re-clear the route param) on every render where the caller didn't memoize.
  const onClaimParamRef = useRef(onClaimParam)
  onClaimParamRef.current = onClaimParam

  useEffect(() => {
    if (!paramReturnTo) return
    // Assigning the ref here is the whole point of the hook — see (1) above.
    // The mount-time initializer covers the first-focus case; this covers every
    // later navigation into an already-mounted Settings tab.
    returnToRef.current = paramReturnTo
    saveString(SUBSCRIPTION_RETURN_KEY, paramReturnTo)
    onClaimParamRef.current()
  }, [paramReturnTo])

  const consume = useCallback(() => {
    const returnTo = returnToRef.current
    if (!returnTo) return null
    returnToRef.current = null
    remove(SUBSCRIPTION_RETURN_KEY)
    return returnTo
  }, [])

  return { consume }
}
