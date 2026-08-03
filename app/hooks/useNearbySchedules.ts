/**
 * useNearbySchedules — data engine for the In-Person segment of the Meetings tab.
 *
 * Three modes (resolved by the pure `resolveMode` in `@/utils/nearbyLogic`):
 * `locating` while permission/fix is in flight, `nearby` once we have coords,
 * `fallback` (plain day-browse + banner) whenever location is unavailable or
 * the nearby endpoint failed after its retry. The segment always renders
 * something useful — there is no dead-end state.
 *
 * PRIVACY (non-negotiable, see the 2026-08-03 in-person-ui design doc):
 * - Raw coordinates live in `coordsRef` and nowhere else. Not React state
 *   (state is serialized into devtools/Reactotron snapshots), not MMKV, not
 *   SQLite. They leave the device only as `/schedules/nearby` query params.
 * - Nothing here logs lat/lon. Our logs ship to Loki, so every log call below
 *   is limited to scalars we deliberately chose (radius, iso_dow, counts,
 *   API problem kinds). Never log the `params` object — it carries coords.
 * - The permission prompt is lazy: it fires on the first activation of the
 *   segment, never at app launch. A user who never opens In-Person is never
 *   asked for location.
 *
 * The persisted radius (MMKV) is a display *preference*, not location data —
 * persisting it is correct and carries no positional information.
 *
 * Not unit-testable: this file imports `@/`, which vitest cannot resolve in
 * this repo (see CLAUDE.md "Test Runner Split"). That is exactly why the
 * decision logic lives in the pure, vitest-covered `nearbyLogic.ts` — do not
 * re-derive any of it here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getLocales } from "expo-localization"
import * as Location from "expo-location"

import { MeetingWithTrex } from "@/context/MeetingContext"
import { inPersonPoolOf } from "@/context/meetingPools"
import { useConfigStore, useProfileStore } from "@/models"
import { api, LiveSchedule } from "@/services/api"
import { logger } from "@/utils/logger"
import {
  buildNearbyParams,
  DEFAULT_RADIUS_KM,
  NearbyMode,
  resolveMode,
  sortByDistance,
  sortByLocalTime,
} from "@/utils/nearbyLogic"
import { loadString, saveString } from "@/utils/storage"

const log = logger.child({ module: "useNearbySchedules" })

/** MMKV key for the persisted radius preference (a preference, NOT location data). */
const RADIUS_STORAGE_KEY = "inperson.radius"
/** Give the GPS 10 s before degrading to day-browse. */
const FIX_TIMEOUT_MS = 10_000

const getCurrentIsoDow = (): number => {
  const jsDay = new Date().getDay()
  return jsDay === 0 ? 7 : jsDay
}

const loadRadius = (): number => {
  const stored = Number(loadString(RADIUS_STORAGE_KEY))
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_RADIUS_KM
}

// Same wire→app mapping ListingsScreen uses for the daily endpoints. The
// nearby response is daily-shaped with `distance_m` added — but that field
// sits on the schedule row, not on the nested meeting the spread copies, so
// it has to be carried across explicitly or the distance badge and the
// distance sort both silently see `undefined`.
const toMeetings = (schedules: LiveSchedule[]): MeetingWithTrex[] =>
  schedules.map((s) => ({
    ...s.meeting,
    feedback: null,
    sid: s.sid,
    millis: s.millis,
    duration_ms: s.duration_ms ?? 0,
    scheduleData: s.data,
    distance_m: s.distance_m,
  }))

export interface UseNearbySchedulesResult {
  mode: NearbyMode
  meetings: MeetingWithTrex[]
  isLoading: boolean
  /** Set only when the ACTIVE path's fetch failed (fallback fetch failing, or total dead-end) */
  error: string | null
  /** Why the fallback banner is showing (null in nearby/locating modes) */
  bannerReason: "location" | "nearbyFailed" | null
  selectedDay: number
  setSelectedDay: (isoDow: number) => void
  radiusKm: number
  setRadiusKm: (km: number) => void
  useMiles: boolean
  /** Pull-to-refresh: re-fix location (if permitted) then refetch */
  refresh: () => Promise<void>
  /** Banner tap: re-request permission (no-op → Settings when !canAskAgain) */
  requestLocation: () => Promise<void>
  canAskAgain: boolean
}

/**
 * @param active - true once the user has opened the In-Person segment. Stays
 *   true afterwards. Nothing (permission prompt, GPS fix, network call) may
 *   happen before this flips.
 */
export function useNearbySchedules(active: boolean): UseNearbySchedulesResult {
  const configStore = useConfigStore()
  const profileStore = useProfileStore()

  // Read both observables during render so MobX tracks them for the consuming
  // `observer()` component — that is what makes the maintenance-exit refetch
  // and the fellowship-change refetch fire at all. (ListingsScreen instead
  // deps its fetch callback on the `configStore` object, whose identity never
  // changes; depending on the primitive here is the honest version.)
  // INTEGRATION REQUIREMENT: the component calling this hook MUST be wrapped
  // in `observer()`, or neither reaction happens.
  const maintenanceMode = configStore.maintenanceMode
  const fellowship = profileStore.fellowship

  const [permission, setPermission] = useState<"undetermined" | "granted" | "denied">(
    "undetermined",
  )
  const [canAskAgain, setCanAskAgain] = useState(true)
  const [fix, setFix] = useState<"pending" | "acquired" | "failed">("pending")
  const [nearbyFetchFailed, setNearbyFetchFailed] = useState(false)
  const [meetings, setMeetings] = useState<MeetingWithTrex[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState(getCurrentIsoDow)
  const [radiusKm, setRadiusKmState] = useState(loadRadius)

  // PRIVACY: coordinates live in this ref only — never state (avoids
  // accidental serialization in devtools snapshots), never MMKV/SQLite,
  // sent nowhere but the /schedules/nearby query.
  const coordsRef = useRef<{ lat: number; lon: number } | null>(null)

  /** False after unmount — every post-await setState is gated on it. */
  const mountedRef = useRef(true)
  /** True after the first activation, so input changes can't fetch too early. */
  const startedRef = useRef(false)
  /** True while a location fix is in flight (see the driver effect). */
  const acquiringRef = useRef(false)
  /** Monotonic ids so a superseded fetch / fix can never commit its result. */
  const fetchSeqRef = useRef(0)
  const fixSeqRef = useRef(0)

  useEffect(() => {
    // Re-arm on mount: React 18 StrictMode mounts, unmounts, then remounts in
    // dev, so a plain `useRef(true)` alone would leave this false forever.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Locale measurement system is fixed for the process lifetime; resolve once.
  const useMiles = useMemo(() => getLocales()[0]?.measurementSystem === "us", [])

  /**
   * Request permission (prompting on first call) and take one balanced-accuracy
   * fix. Never rejects — callers get a boolean and the state reflects the rest.
   */
  const acquireLocation = useCallback(async (): Promise<boolean> => {
    const seq = ++fixSeqRef.current
    // A superseded acquire (user hit refresh again) must not write coords or
    // flip state, and neither may any acquire that outlives the component.
    const isCurrent = () => mountedRef.current && fixSeqRef.current === seq

    acquiringRef.current = true
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (!isCurrent()) return false
      setCanAskAgain(perm.canAskAgain)

      if (!perm.granted) {
        setPermission("denied")
        // Drop coordinates from any earlier grant. Two reasons: privacy (we
        // hold no position we're not allowed to use), and consistency — the
        // fetch path is chosen by `coordsRef`, so stale coords would produce a
        // distance-sorted list underneath a banner saying we have no location.
        coordsRef.current = null
        // The nearby path isn't even attempted now, so its old failure must
        // not steal the banner from the real reason.
        setNearbyFetchFailed(false)
        return false
      }

      setPermission("granted")
      setFix("pending")

      // Race the fix against a 10 s timeout — a cold GPS indoors can hang
      // far longer, and the fallback list is more useful than a spinner.
      // The handle is cleared in `finally` on BOTH outcomes; leaving it
      // dangling would keep a timer (and this closure) alive for 10 s after
      // a fast fix, and fire a rejection nobody is listening to. A position
      // that resolves after the timeout won is simply dropped by the race —
      // it is never awaited again, so it cannot write stale coordinates.
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
      setFix("acquired")
      return true
    } catch (err) {
      if (!isCurrent()) return false
      // PRIVACY: `String(err)` yields "Name: message" only — an Error's
      // toString never includes a request config or URL, so this cannot leak
      // the coordinates we just asked for. Do not log the error object.
      log.warn("Location unavailable (permission or fix failed)", { error: String(err) })
      coordsRef.current = null
      setNearbyFetchFailed(false)
      setFix("failed")
      return false
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      // A newer acquire owns the flag once it starts; don't clear it for them.
      if (isCurrent()) acquiringRef.current = false
    }
  }, [])

  /**
   * One fetch function; the path is decided by whether we hold coordinates.
   * Mirrors ListingsScreen's maintenance gate and venue self-verification.
   */
  const fetchMeetings = useCallback(async () => {
    // Skip the API call entirely while server-side maintenance is on, exactly
    // as ListingsScreen.fetchDailySchedules does — the segment has its own
    // pull-to-refresh, so the gate has to live on this path too. Bumping the
    // sequence invalidates anything already in flight, so the list stays as-is
    // rather than being overwritten by a request that predates maintenance.
    if (maintenanceMode) {
      log.debug("Skipping nearby fetch — maintenance mode")
      fetchSeqRef.current++
      setIsLoading(false)
      return
    }

    // No fellowship chosen yet is a legitimate state, not an error: show an
    // empty list and let the user pick one. (Same sequence bump rationale.)
    if (!fellowship) {
      fetchSeqRef.current++
      setMeetings([])
      setError(null)
      setIsLoading(false)
      return
    }

    const seq = ++fetchSeqRef.current
    // Stale-response guard: changing day or radius mid-flight starts a newer
    // fetch, and the older one must not land on top of it — including its
    // `isLoading(false)`, which would otherwise stop the newer spinner early.
    const isCurrent = () => mountedRef.current && fetchSeqRef.current === seq

    setIsLoading(true)
    setError(null)

    try {
      const coords = coordsRef.current
      if (coords) {
        const params = buildNearbyParams(coords.lat, coords.lon, radiusKm, selectedDay, fellowship)
        // Spec §4: degrade only "after the standard retry" — one immediate
        // retry on a non-ok result before falling back to day-browse, so a
        // single dropped packet doesn't demote a user with a good GPS fix.
        let result = await api.getNearbySchedules(params)
        if (result.kind !== "ok") {
          // PRIVACY: log the scalars individually — never spread `params`,
          // which carries lat/lon.
          log.warn("Nearby fetch failed; retrying once", {
            kind: result.kind,
            radius: params.radius,
            iso_dow: params.iso_dow,
          })
          result = await api.getNearbySchedules(params)
        }
        if (!isCurrent()) return

        if (result.kind === "ok") {
          // Self-verify venue like the daily path (2026-08-02 fix wave):
          // a proxy/older server answering with online rows yields an
          // empty pool rather than mislabeled meetings.
          const pool = inPersonPoolOf(true, toMeetings(result.schedules))
          setMeetings(sortByDistance(pool.items))
          setNearbyFetchFailed(false)
          log.debug("Loaded nearby schedules", {
            count: pool.items.length,
            iso_dow: selectedDay,
            radiusKm,
          })
          return
        }

        log.warn("Nearby fetch failed after retry; degrading to day-browse", { kind: result.kind })
        setNearbyFetchFailed(true)
        // fall through to the fallback fetch below
      }

      const fallback = await api.getDailySchedules(selectedDay, fellowship, "in_person")
      if (!isCurrent()) return

      if (fallback.kind === "ok") {
        const pool = inPersonPoolOf(true, toMeetings(fallback.schedules))
        setMeetings(sortByLocalTime(pool.items))
        log.debug("Loaded in-person day-browse schedules", {
          count: pool.items.length,
          iso_dow: selectedDay,
        })
      } else {
        // Only the ACTIVE path failing is an error: a failed nearby fetch that
        // the day-browse fallback rescued shows a banner, not an error state.
        log.error("In-person fallback fetch failed", { kind: fallback.kind })
        setError(`Error: ${fallback.kind}`)
        setMeetings([])
      }
    } catch (err) {
      if (!isCurrent()) return
      // PRIVACY: see the note in acquireLocation — `String(err)` is name +
      // message only, so a thrown network error cannot carry the query URL
      // (and therefore the coordinates) into Loki.
      log.error("Exception fetching in-person schedules", { error: String(err) })
      setError("Failed to load meetings")
      setMeetings([])
    } finally {
      if (isCurrent()) setIsLoading(false)
    }
  }, [maintenanceMode, fellowship, radiusKm, selectedDay])

  // Keep the newest fetch closure reachable from async callbacks that were
  // created earlier (the initial acquire chain, refresh, requestLocation).
  // Without this, a day change made while the GPS was still resolving would
  // be fetched with the stale day captured at call time.
  // Declared BEFORE the driver effect below so the ref is already up to date
  // when that effect runs in the same commit.
  const fetchLatestRef = useRef(fetchMeetings)
  useEffect(() => {
    fetchLatestRef.current = fetchMeetings
  }, [fetchMeetings])

  /** First activation: prompt + fix, then fetch whichever path that produced. */
  const startInitialLoad = useCallback(async () => {
    await acquireLocation()
    await fetchLatestRef.current()
  }, [acquireLocation])

  // The single driver: first activation kicks the location chain, and every
  // later change to day / radius / fellowship / maintenance refetches (each
  // one changes `fetchMeetings`'s identity). Nothing runs before `active`.
  useEffect(() => {
    if (!active) return

    if (!startedRef.current) {
      startedRef.current = true
      void startInitialLoad()
      return
    }

    // An acquire in flight will fetch itself when it settles, using the latest
    // inputs via fetchLatestRef. Firing here too would spend a request on the
    // day-browse path (coords aren't in yet) that the stale-guard then throws
    // away, while the UI shows a "locating" spinner either way.
    if (acquiringRef.current) return

    void fetchMeetings()
  }, [active, fetchMeetings, startInitialLoad])

  const setRadiusKm = useCallback((km: number) => {
    // Persist first so a crash between the two still leaves the preference
    // the user just picked; the refetch follows from the state change.
    saveString(RADIUS_STORAGE_KEY, String(km))
    setRadiusKmState(km)
  }, [])

  /** Pull-to-refresh: re-fix location when we're allowed to, then refetch. */
  const refresh = useCallback(async () => {
    if (permission === "granted") await acquireLocation()
    await fetchLatestRef.current()
  }, [permission, acquireLocation])

  /**
   * Banner tap. Re-requests permission; when the OS has permanently denied it
   * this resolves without a prompt, which is why the caller checks
   * `canAskAgain` and routes to `Linking.openSettings()` itself.
   */
  const requestLocation = useCallback(async () => {
    await acquireLocation()
    await fetchLatestRef.current()
  }, [acquireLocation])

  const mode = resolveMode({ active, permission, fix, nearbyFetchFailed })
  // Only fallback mode shows a banner, and a nearby fetch failure is the more
  // specific reason — we only reach it with location working.
  const bannerReason: "location" | "nearbyFailed" | null =
    mode !== "fallback" ? null : nearbyFetchFailed ? "nearbyFailed" : "location"

  return {
    mode,
    meetings,
    isLoading,
    error,
    bannerReason,
    selectedDay,
    setSelectedDay,
    radiusKm,
    setRadiusKm,
    useMiles,
    refresh,
    requestLocation,
    canAskAgain,
  }
}
