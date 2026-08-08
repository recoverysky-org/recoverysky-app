/**
 * usePresenceCheck — the I/O half of GPS-verified in-person attendance.
 *
 * Requests foreground location permission, takes ONE fresh high-accuracy fix,
 * and hands it to the pure `verifyPresence`. Never throws: every failure is a
 * discriminated outcome the caller renders.
 *
 * PRIVACY: the fix lives in a local const for the duration of the call and
 * leaves this hook only inside a `verified` outcome. It never enters React
 * state, and NOTHING here logs the fix or the distance — "43 m from meeting X"
 * is a location disclosure, and our logs ship to Loki. Log outcomes only.
 *
 * Not unit-testable: it imports `@/`, which vitest cannot resolve (see
 * CLAUDE.md "Test Runner Split"). That is exactly why the decision lives in
 * the pure, vitest-covered presenceLogic.ts — do not re-derive any of it here.
 */

import { useCallback, useRef, useState } from "react"
import { Platform } from "react-native"
import * as Location from "expo-location"

import { useConfigStore } from "@/models"
import { logger } from "@/utils/logger"
import { verifyPresence, type PresenceFix, type PresenceVenue } from "@/utils/presenceLogic"

const log = logger.child({ module: "usePresenceCheck" })

/**
 * Budget for the fix. Same platform split, and the same reason, as
 * useNearbySchedules.FIX_TIMEOUT_MS: Android's fused provider routinely needs
 * far longer than iOS for a first fresh fix on a cold process indoors, and
 * every in-person meeting is indoors.
 */
const PRESENCE_FIX_TIMEOUT_MS = Platform.OS === "android" ? 20_000 : 10_000

export type PresenceCheckOutcome =
  | { status: "verified"; fix: PresenceFix; distanceM: number; radiusM: number }
  | { status: "out-of-range"; distanceM: number; radiusM: number }
  | { status: "no-venue-coords" }
  | { status: "denied"; canAskAgain: boolean }
  | { status: "fix-failed" }

export interface UsePresenceCheckResult {
  check: (venue: PresenceVenue) => Promise<PresenceCheckOutcome>
  isChecking: boolean
}

export function usePresenceCheck(): UsePresenceCheckResult {
  const configStore = useConfigStore()
  const [isChecking, setIsChecking] = useState(false)

  /**
   * Synchronous in-flight guard. `isChecking` is for the button's visuals;
   * React state is not synchronous, so two taps in the same tick would both
   * read `isChecking === false` and start two permission prompts. Same
   * pattern, same reason, as the save lock in useAttendanceTimer.
   */
  const checkingRef = useRef(false)

  // NOT `presenceRadiusM` — the view picks the wide dev radius in `__DEV__`
  // builds so a simulator's fixed location still lands inside a venue, and the
  // real server value everywhere else. Reading the raw field here would make
  // the local simulator untestable again.
  // CHANGED 2026-08-08: the dev radius now applies only when the server
  // actually sends `DEV_PRESENCE_RADIUS_M`; omit it and a dev build enforces
  // the production radius. Still read through the view, not either field.
  const radiusM = configStore.effectivePresenceRadiusM

  const check = useCallback(
    async (venue: PresenceVenue): Promise<PresenceCheckOutcome> => {
      if (checkingRef.current) return { status: "fix-failed" }
      checkingRef.current = true
      setIsChecking(true)

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined

      try {
        // Lazy permission: this runs on the "I'm Here" tap and nowhere else.
        // A user who never marks themselves present is never asked.
        const perm = await Location.requestForegroundPermissionsAsync()
        if (!perm.granted) {
          log.info("Presence check denied", { canAskAgain: perm.canAskAgain })
          return { status: "denied", canAskAgain: perm.canAskAgain }
        }

        // ONE fresh fix. Deliberately NOT seeded from
        // getLastKnownPositionAsync, which useNearbySchedules does use and is
        // right to — a stale position cannot change which meetings fall inside
        // a 10 km radius. Here a cached position is a verification hole: it
        // could be the user's living room from twenty minutes ago. A presence
        // gate must use a position taken now.
        //
        // Accuracy.Highest, not Balanced: Balanced was chosen in
        // useNearbySchedules for a 10 km filter. 150 m is two orders of
        // magnitude tighter and needs the better fix.
        const position = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error("presence fix timeout")),
              PRESENCE_FIX_TIMEOUT_MS,
            )
          }),
        ])

        const fix: PresenceFix = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          // Nullable on some Android providers; undefined is correct and the
          // record simply omits it.
          accuracyM: position.coords.accuracy ?? undefined,
        }

        const result = verifyPresence({ fix, venue, radiusM })

        // PRIVACY: reason only. Never the distance, never the fix.
        log.info("Presence check complete", { reason: result.reason })

        if (result.reason === "no-venue-coords") return { status: "no-venue-coords" }
        if (!result.inRange) {
          return { status: "out-of-range", distanceM: result.distanceM!, radiusM }
        }
        return { status: "verified", fix, distanceM: result.distanceM!, radiusM }
      } catch (err) {
        // PRIVACY: String(err) yields "Name: message" only, and that is safe
        // here because of WHAT CAN REACH THIS CATCH — not because of any
        // general property of Error. Only two things throw inside this try:
        // expo-location, whose rejections carry static or status-only messages
        // on every platform (iOS LocationExceptions.swift, Android
        // LocationExceptions.kt, web GeolocationPositionError — audited
        // 2026-08-05), and our own timeout above. An arbitrary throw could put
        // anything in .message, including a position.
        //
        // So: if you widen this try block to cover another call, re-audit that
        // call's rejection messages before assuming this still holds. Never
        // log the error object itself.
        log.warn("Presence fix failed", { error: String(err) })
        return { status: "fix-failed" }
      } finally {
        // Cleared on BOTH outcomes of the race. A dangling handle keeps a
        // timer (and this closure) alive after a fast fix and later fires a
        // rejection nobody is listening to.
        if (timeoutHandle) clearTimeout(timeoutHandle)
        checkingRef.current = false
        setIsChecking(false)
      }
    },
    [radiusM],
  )

  return { check, isChecking }
}
