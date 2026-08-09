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
 *
 * ADDED 2026-08-09 (whole-branch review, C1): the lazy-permission rule above
 * describes when this hook prompts, but says nothing about the Settings →
 * Permissions Location toggle, which is a *coarser* kill switch than any of
 * this hook's own gating — it means "don't use the device position at all,"
 * not just "don't ask fresh." `profileStore.locationEnabled` is now read
 * before every `Location.*` call in `runAcquire` below, mirroring the
 * short-circuit `useNearbySchedules.acquireLocation` already applies. Without
 * it, a user who had granted the OS permission anywhere else in the app (an
 * app cannot revoke its own grant) got a silent, ungated fix here: activating
 * Search called `probeExisting()`, which ran straight through to
 * `getLastKnownPositionAsync` / `getCurrentPositionAsync`, and opening the
 * radius picker called `acquire()`, which could still show the OS prompt on a
 * first-ever grant — both while the in-app Location switch says off.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Platform } from "react-native"
import * as Location from "expo-location"

import { useProfileStore } from "@/models"
import { logger } from "@/utils/logger"
import { isNearlySamePosition } from "@/utils/nearbyLogic"

const log = logger.child({ module: "useDeviceLocation" })

/**
 * Budget for a *fresh* fix — matches useNearbySchedules.
 *
 * CHANGED 2026-08-04: was a flat 10 s, which Android's fused provider misses
 * routinely on a cold process indoors (it wants a new fix; CoreLocation hands
 * back a cached one almost immediately, which is why this only ever bit
 * Android). Every timeout demoted the Search tab to an unbounded in-person
 * search with a dimmed radius cell and no explanation. Now that the cached
 * position below covers the "show me something now" case, the fresh fix can
 * afford to wait longer on the platform that needs it.
 */
const FIX_TIMEOUT_MS = Platform.OS === "android" ? 20_000 : 10_000

/**
 * How stale the OS's cached position may be before we ignore it. Ten minutes
 * of travel cannot move you out of the smallest radius option (10 km) at any
 * speed a meeting-goer is likely to be doing, and the fresh fix that follows
 * corrects it either way.
 */
const LAST_KNOWN_MAX_AGE_MS = 10 * 60_000

/**
 * Budget for the fresh fix when a cached position is ALREADY in hand — matches
 * useNearbySchedules. Short on purpose: at that point the fix is a refinement
 * of a search that has already run, so a long one only costs battery.
 */
const REFINE_TIMEOUT_MS = 5_000

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
   * Prompt if needed, then seed from the OS's cached position and take one
   * balanced-accuracy fix. Never rejects — resolves true only when coordinates
   * are now available, which now includes "the fresh fix timed out but the
   * cached position stands".
   */
  acquire: () => Promise<boolean>
  /**
   * Take a fix ONLY if permission was already granted. Never prompts, never
   * changes status when it declines to act.
   *
   * This is what lets a screen show distances to a user who has already said
   * yes elsewhere in the app, without that screen having to ask again — a
   * second dialog for consent already given reads as the app losing track of
   * its own permissions. Safe to call on mount; `acquire` is not.
   */
  probeExisting: () => Promise<boolean>
}

export function useDeviceLocation(): UseDeviceLocationResult {
  const profileStore = useProfileStore()

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

  /**
   * The shared body of `acquire` / `probeExisting`. `prompt` decides which
   * expo-location call runs — the requesting one, which may show a dialog, or
   * the getter, which never does.
   */
  const runAcquire = useCallback(
    async (prompt: boolean): Promise<boolean> => {
      // ADDED 2026-08-09 (C1 fix): the Settings → Permissions toggle is the
      // outer gate — mirrors the short-circuit at the top of
      // useNearbySchedules.acquireLocation (see that file for the twin
      // comment). Bail BEFORE any `Location.*` call, for both the prompting
      // and non-prompting paths: `probeExisting()` never shows a dialog but it
      // does fetch a real fix once permission is granted, and a granted user
      // is exactly the case that used to leak here. `unavailable` (not `idle`)
      // is the bail status so ListingsScreen's `needsLocation` — which treats
      // `idle`/`unavailable` alike — surfaces the existing in-app "location is
      // off" copy instead of a silently unasked-looking filter.
      if (!profileStore.locationEnabled) {
        coordsRef.current = null
        setStatus("unavailable")
        return false
      }

      const seq = ++seqRef.current
      const isCurrent = () => mountedRef.current && seqRef.current === seq

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      /**
       * Set once the cached position below has been committed, so the catch
       * block knows a failed *fresh* fix still leaves us with usable
       * coordinates — without it, the timeout would throw away the position we
       * just successfully showed the user.
       */
      let seededFromCache = false

      // Only announce "acquiring" when we have nothing to show for. Re-fixing
      // while already holding a position would otherwise blank a working radius
      // filter for up to 10 s — holding a valid position is not "acquiring".
      if (prompt && !coordsRef.current) setStatus("acquiring")

      try {
        const perm = prompt
          ? await Location.requestForegroundPermissionsAsync()
          : await Location.getForegroundPermissionsAsync()
        if (!isCurrent()) return false
        setCanAskAgain(perm.canAskAgain)

        if (!perm.granted) {
          // A probe that finds no existing grant is a non-event: the user was
          // never asked, so leave `status` alone. Flipping it to "unavailable"
          // would make a screen that merely *checked* look like one that asked
          // and was refused.
          if (!prompt) return false
          // Drop coordinates from any earlier grant: we hold no position we're
          // not currently allowed to use, and a stale one would keep producing
          // distance-filtered results under a UI that says location is off.
          coordsRef.current = null
          setStatus("unavailable")
          return false
        }

        // Seed from whatever position the OS already has before asking for a new
        // one. This is the fix for "the radius filter is dead on every cold
        // start": Android's fused provider regularly needs longer than the
        // timeout below to produce a *fresh* fix, and until 2026-08-04 that meant
        // a granted user got no coordinates at all. The cached position costs
        // nothing (no hardware wakeup, no wait) and is accurate to far better
        // than the 10 km smallest radius. `maxAge` is enforced by expo-location;
        // a null result just means we fall through to the fresh fix as before.
        // PRIVACY: same handling as any other fix — straight into the ref,
        // nowhere else, and the error path logs no coordinates.
        const cached = await Location.getLastKnownPositionAsync({
          maxAge: LAST_KNOWN_MAX_AGE_MS,
        }).catch(() => null)
        if (!isCurrent()) return false
        if (cached) {
          coordsRef.current = { lat: cached.coords.latitude, lon: cached.coords.longitude }
          seededFromCache = true
          setStatus("ready")
          setFixVersion((v) => v + 1)
        }

        // Race the fix against a timeout — a cold GPS indoors can hang far
        // longer than a user will wait for a filter to apply. The handle is
        // cleared in `finally` on BOTH outcomes; leaving it dangling would keep
        // a timer (and this closure) alive after a fast fix and fire a rejection
        // nobody is listening to. A position that resolves after the timeout won
        // is simply dropped — it is never awaited again, so it cannot write
        // stale coordinates.
        // With a cached seed in hand this is only a refinement, and the search it
        // would improve has already run — so it gets a much shorter budget rather
        // than holding the GPS awake for twenty seconds to move a result by a
        // block.
        const position = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error("location fix timeout")),
              seededFromCache ? REFINE_TIMEOUT_MS : FIX_TIMEOUT_MS,
            )
          }),
        ])
        if (!isCurrent()) return false

        const fresh = { lat: position.coords.latitude, lon: position.coords.longitude }
        // A fresh fix that lands within a couple of city blocks of what we
        // already hold (usually the cached seed above) would return an identical
        // list, so take the coordinates but skip the version bump — consumers key
        // their refetch on `fixVersion`, and a second request for the same rows
        // is the one cost the cached-seed change could otherwise have added.
        const redundant = isNearlySamePosition(fresh, coordsRef.current)
        coordsRef.current = fresh
        setStatus("ready")
        // Bump last: consumers keyed on this will refetch, and the coordinates
        // have to be in place before that happens.
        if (!redundant) setFixVersion((v) => v + 1)
        return true
      } catch (err) {
        if (!isCurrent()) return false
        // PRIVACY: `String(err)` yields "Name: message" only — an Error's
        // toString never includes a request config or URL, so this cannot leak
        // the coordinates we just asked for. Do not log the error object.
        log.warn("Location unavailable (permission or fix failed)", { error: String(err) })
        // A cached position already committed this call is still a valid one —
        // the fresh fix timing out does not make it wrong. Reporting
        // "unavailable" here would blank a radius filter that is working.
        if (seededFromCache) return true
        coordsRef.current = null
        // A failed probe still means we genuinely can't locate the device (we
        // had permission and the fix failed), so this one does flip the status.
        setStatus("unavailable")
        return false
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    },
    [profileStore],
  )

  const acquire = useCallback(() => runAcquire(true), [runAcquire])
  const probeExisting = useCallback(() => runAcquire(false), [runAcquire])

  return { status, canAskAgain, fixVersion, getCoords, acquire, probeExisting }
}
