/**
 * useDeviceLocation — permission + a single coarse position fix, nothing else.
 *
 * Written for the Search segment's Radius filter, which needs coordinates to
 * call `/schedules/nearby` but has none of the In-Person segment's mode
 * machinery (locating / nearby / fallback banner). `useNearbySchedules` keeps
 * its own copy of this logic on purpose: extracting it from there would mean
 * refactoring the file that owns the whole in-person data path, and its
 * acquire is entangled with the fetch chain that follows it. This hook is
 * deliberately the smaller, dumber one — it acquires and reports, and the
 * caller decides what to fetch.
 *
 * PRIVACY (same non-negotiable rules as `useNearbySchedules`; read its header
 * for the full accounting, this is the short version):
 * - Raw coordinates live in `coordsRef` and nowhere else. Not React state
 *   (state is serialized into devtools/Reactotron snapshots), not MMKV, not
 *   SQLite. `fixVersion` exists precisely so a consumer can react to a new fix
 *   *without* the coordinates ever entering the render tree.
 * - Nothing here logs lat/lon. `String(err)` is name + message only, which is
 *   why errors are logged that way and never as the error object (an axios
 *   error carries the request config, and with it the query string).
 * - The prompt is lazy and caller-driven: this hook never acquires on mount.
 *   Search only calls `acquire()` when the user picks a real radius, so a user
 *   who never touches that filter is never asked for location.
 * - Coordinates leave the device only as `/schedules/nearby` query params, and
 *   `lat`/`lon` are already in `SENSITIVE_QUERY_KEYS` (`app/utils/scrubQuery.ts`)
 *   so Sentry's XHR breadcrumbs scrub them. Adding a second caller of that
 *   endpoint does not add a transport — but if you add one, re-audit.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import * as Location from "expo-location"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "useDeviceLocation" })

/** Give the GPS 10 s before giving up — matches useNearbySchedules. */
const FIX_TIMEOUT_MS = 10_000

export type LocationStatus =
  /** Never asked. No prompt has been shown. */
  | "idle"
  /** Prompt open, or a fix in flight. */
  | "acquiring"
  /** We hold usable coordinates. */
  | "ready"
  /** Permission denied, or the fix failed. Caller must degrade. */
  | "unavailable"

export interface UseDeviceLocationResult {
  status: LocationStatus
  /** OS will still show a prompt — false means "send them to Settings". */
  canAskAgain: boolean
  /**
   * Bumped once per successful fix. Put this in a fetch's dependency array to
   * refetch when a position lands, instead of depending on the coordinates
   * themselves (which must never be state).
   */
  fixVersion: number
  /**
   * Read the current coordinates for immediate use in a request. Returns null
   * when we hold none.
   *
   * PRIVACY: use the result and drop it. Do not lift it into state, a store,
   * or a log — the whole point of the ref is that no other layer ever holds a
   * position.
   */
  getCoords: () => { lat: number; lon: number } | null
  /**
   * Prompt if needed, then take one balanced-accuracy fix. Never rejects —
   * resolves true only when coordinates are now available.
   */
  acquire: () => Promise<boolean>
}

export function useDeviceLocation(): UseDeviceLocationResult {
  const [status, setStatus] = useState<LocationStatus>("idle")
  const [canAskAgain, setCanAskAgain] = useState(true)
  const [fixVersion, setFixVersion] = useState(0)

  // PRIVACY: the only place a coordinate is ever held. See the header.
  const coordsRef = useRef<{ lat: number; lon: number } | null>(null)

  /**
   * False after unmount. The OS permission dialog has no timeout, so "the
   * component is gone by the time we resume" is a normal outcome here, not an
   * edge case — every post-await write is gated on this.
   */
  const mountedRef = useRef(true)
  /** Monotonic id so a superseded acquire can never commit its result. */
  const seqRef = useRef(0)

  useEffect(() => {
    // Re-arm on mount: React 18 StrictMode mounts, unmounts, then remounts in
    // dev, so a plain `useRef(true)` alone would leave this false forever.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const getCoords = useCallback(() => coordsRef.current, [])

  const acquire = useCallback(async (): Promise<boolean> => {
    const seq = ++seqRef.current
    const isCurrent = () => mountedRef.current && seqRef.current === seq

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    // Only announce "acquiring" when we have nothing to show for. Re-fixing
    // while already holding a position would otherwise blank a working radius
    // filter for up to 10 s — holding a valid position is not "acquiring".
    if (!coordsRef.current) setStatus("acquiring")

    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (!isCurrent()) return false
      setCanAskAgain(perm.canAskAgain)

      if (!perm.granted) {
        // Drop coordinates from any earlier grant: we hold no position we're
        // not currently allowed to use, and a stale one would keep producing
        // distance-filtered results under a UI that says location is off.
        coordsRef.current = null
        setStatus("unavailable")
        return false
      }

      // Race the fix against a timeout — a cold GPS indoors can hang far
      // longer than a user will wait for a filter to apply. The handle is
      // cleared in `finally` on BOTH outcomes; leaving it dangling would keep
      // a timer (and this closure) alive after a fast fix and fire a rejection
      // nobody is listening to. A position that resolves after the timeout won
      // is simply dropped — it is never awaited again, so it cannot write
      // stale coordinates.
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error("location fix timeout")),
            FIX_TIMEOUT_MS,
          )
        }),
      ])
      if (!isCurrent()) return false

      coordsRef.current = { lat: position.coords.latitude, lon: position.coords.longitude }
      setStatus("ready")
      // Bump last: consumers keyed on this will refetch, and the coordinates
      // have to be in place before that happens.
      setFixVersion((v) => v + 1)
      return true
    } catch (err) {
      if (!isCurrent()) return false
      // PRIVACY: `String(err)` yields "Name: message" only — an Error's
      // toString never includes a request config or URL, so this cannot leak
      // the coordinates we just asked for. Do not log the error object.
      log.warn("Location unavailable (permission or fix failed)", { error: String(err) })
      coordsRef.current = null
      setStatus("unavailable")
      return false
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }, [])

  return { status, canAskAgain, fixVersion, getCoords, acquire }
}
