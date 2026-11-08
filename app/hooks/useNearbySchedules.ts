/**
 * useNearbySchedules — data engine for the In-Person segment of the Meetings tab.
 *
 * Three modes (resolved by the pure `resolveMode` in `@/utils/nearbyLogic`):
 * `locating` while permission/fix is in flight, `nearby` once we have coords,
 * `fallback` (empty list + explanatory banner) whenever location is unavailable
 * or the nearby endpoint failed after its retry. The segment always renders
 * something actionable — every fallback state names its remedy and is tappable.
 * CHANGED 2026-09-09: `fallback` used to mean "plain day-browse + banner" for
 * the nearby-failed case. That day-browse request is gone — see the note in
 * `fetchMeetings` for the production incident that removed it.
 *
 * PRIVACY (non-negotiable, see the 2026-08-03 in-person-ui design doc):
 * - Raw coordinates live in `coordsRef` and nowhere else. Not React state
 *   (state is serialized into devtools/Reactotron snapshots), not MMKV, not
 *   SQLite. They leave the device only as `/schedules/nearby` query params —
 *   and that required a second fix to be true: apisauce → axios → XHR means
 *   Sentry's default XHR breadcrumb integration captures the request URL, so
 *   `lat`/`lon` are in `SENSITIVE_QUERY_KEYS` in `app/utils/scrubQuery.ts`.
 *   Without that scrub, every nearby request rode along with the next uploaded
 *   error event. "We never log it" and "it never leaves the device" are
 *   different claims; the second one has to account for every transport, not
 *   every log site.
 *   CHANGED 2026-08-03: the paragraph above used to end by claiming the
 *   accounting was complete — that every transport had been covered. It was
 *   not. Final review found a fifth vector, now fixed: on iOS, sentry-cocoa
 *   swizzles NSURLSession and builds its own `http` breadcrumb natively with
 *   the raw query in `http.query`, and `@sentry/react-native` overwrites the
 *   native `beforeBreadcrumb`, so our JS hook never saw it. Closed in
 *   `beforeSend` (`scrubEventBreadcrumbs` in
 *   `app/services/crashReporting/sentry.ts`).
 *   Treat "every transport" as a standing obligation to re-audit, not a
 *   finished result — this list has been wrong in every review round it has
 *   survived. Re-audit against the runtime the app actually assembles, too:
 *   a sixth "vector" was reported in the same round and turned out to be a
 *   false alarm, because it was verified against React Native's `URL`
 *   polyfill rather than the spec-compliant one Expo's winter runtime
 *   installs over it. Reading the wrong layer is as misleading as not reading.
 * - Nothing here logs lat/lon. Our logs ship to Loki, so every log call below
 *   is limited to scalars we deliberately chose (radius, iso_dow, counts,
 *   API problem kinds). Never log the `params` object — it carries coords.
 * - The permission prompt is lazy: it fires on the first activation of the
 *   segment, never at app launch. A user who never opens In-Person is never
 *   asked for location.
 *
 * AMENDED 2026-08-05: the rule above still governs THIS hook and the whole
 * /schedules/nearby browse path — coordinates here still live only in
 * `coordsRef` and are still scrubbed from every transport. It no longer
 * describes the app as a whole. GPS-verified in-person attendance deliberately
 * persists the user's fix: to encrypted SQLite (the attendance record's
 * events[].json), to the server when cloud backup is on (events is part of
 * ServerAttendanceRecord and is sent verbatim), to MMKV for the lifetime
 * of a running timer session, and — CORRECTED 2026-08-06 — to POST /reports
 * whenever the user sends an attendance report. That fourth destination was
 * missing from this list until a whole-branch review caught it, and the
 * omission mattered: the list reads as exhaustive, and the report path is
 * NOT gated on the cloud-backup opt-in the way the second one is. It is
 * intended, not incidental — the fix is what authenticates the attendance
 * claim to whoever receives the report (a sponsor, an employer, a court).
 * Treat any NEW egress as needing this list updated in the same commit.
 * A verified attendance record is the product and
 * the proof has to be durable. The unchanged parts — nothing logged, lazy
 * foreground-only permission, browse coordinates ref-only — are unchanged
 * deliberately, not by omission. See
 * docs/superpowers/specs/2026-08-05-gps-in-person-attendance-design.md.
 *
 * AMENDED 2026-08-07 (map view): `coordsRef` gained one new ON-DEVICE
 * consumer — `getCoords()`, read by InPersonMapView for its one-shot camera
 * fit (on the first render where a fix exists, then never again for that
 * mount) and converted immediately into a bounding box handed to the native
 * `Camera` component; the fix still never enters JS state, MMKV, or logs.
 * CORRECTED 2026-08-08: this paragraph used to say the fix was "read once for
 * the mount-time camera fit and handed to the native Camera/UserLocation
 * components". Both halves were wrong and the second one dangerously so. The
 * map's blue-dot puck is `NativeUserLocation`, which we render with NO props
 * at all — it receives no coordinate from us and holds none in JS, sourcing
 * its own position natively. `UserLocation` is the sibling component the map
 * deliberately does NOT use, precisely because its JS location hook
 * round-trips every fix through React state; naming it here as a recipient of
 * the coordinate described the exact thing this file forbids.
 * NEW third-party egress:
 * while the map view is open, the tile provider (MapTiler) necessarily
 * receives viewport tile requests (approximate browsed area + IP, keyed to
 * our style URL). Accepted explicitly in the 2026-08-07 map-view spec's
 * privacy section; the browse-path scrubbing above is unchanged.
 *
 * AMENDED 2026-11-07 (ZIP search, spec
 * docs/superpowers/specs/2026-11-07-in-person-zip-search-design.md "Privacy"):
 * the hook now takes a search mode. In ZIP mode it reads NO position at all:
 * `acquireLocation` returns before `requestForegroundPermissionsAsync`,
 * `getLastKnownPositionAsync` or `getCurrentPositionAsync`, a fix that lands
 * after a switch to ZIP writes nothing (no `coordsRef` write, no fetch, no
 * state change), and the switch itself clears `coordsRef`. ZIP mode has no
 * fix. Its center, `search.zipCenter`, is a postal code's centroid read from
 * MMKV (`inperson.zip`, owned by useInPersonSearchMode) — a place the person
 * typed, not the person's position — and it goes out on the same
 * `/schedules/nearby` `lat`/`lon` params, scrubbed by the same rules above.
 * It is still never logged. `getCoords()` is renamed `getSearchCenter()`
 * and returns whichever center applies: the fix in GPS mode, the ZIP point
 * in ZIP mode.
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
import { Platform } from "react-native"
import { getLocales } from "expo-localization"
import * as Location from "expo-location"

import { MeetingWithTrex } from "@/context/MeetingContext"
import { inPersonPoolOf } from "@/context/meetingPools"
import { feedbackCache } from "@/db"
import { useConfigStore, useProfileStore } from "@/models"
import { api, LiveSchedule } from "@/services/api"
import { isRetryableProblem } from "@/services/api/contentRetryLogic"
import { sortByFeedback } from "@/utils/feedbackSort"
import type { InPersonSearchMode } from "@/utils/inPersonSearchLogic"
import { shouldRevokeLocationFlag } from "@/utils/locationGateLogic"
import { logger } from "@/utils/logger"
import {
  buildNearbyParams,
  DEFAULT_RADIUS_KM,
  NearbyBannerReason,
  NearbyMode,
  resolveBannerReason,
  resolveMode,
  sortByDistance,
} from "@/utils/nearbyLogic"
import { loadString, saveString } from "@/utils/storage"

const log = logger.child({ module: "useNearbySchedules" })

/** MMKV key for the persisted radius preference (a preference, NOT location data). */
const RADIUS_STORAGE_KEY = "inperson.radius"
/**
 * Budget for a *fresh* fix before we give up on it.
 *
 * CHANGED 2026-08-04: was a flat 10 s. Android's fused provider routinely
 * needs longer than that for its first fresh fix on a cold process indoors
 * (CoreLocation, by contrast, answers from its own cache almost immediately —
 * which is why this only ever bit Android). Every miss flipped `fix` to
 * "failed" and showed the "Enable location" banner to users who had already
 * granted permission; tapping it worked only because the first attempt had
 * warmed the provider. The cached seed below is the real fix; the longer
 * budget just stops us abandoning a fix that was nearly there.
 */
const FIX_TIMEOUT_MS = Platform.OS === "android" ? 20_000 : 10_000

/**
 * How stale the OS's cached position may be before we ignore it. Ten minutes
 * of travel cannot move you out of the smallest radius option (10 km), and the
 * fresh fix that follows corrects it anyway.
 */
const LAST_KNOWN_MAX_AGE_MS = 10 * 60_000

/**
 * Budget for the fresh fix when a cached position is ALREADY in hand. Short on
 * purpose: the fresh fix is a refinement at that point, and the caller blocks
 * on it before fetching, so a long wait here would trade a list the user could
 * be reading for a slightly better sort order.
 */
const REFINE_TIMEOUT_MS = 5_000

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
    // CHANGED 2026-08-04: was hard-coded `null`, which left the In-Person list
    // with nothing to order favourites by. Read once, here, at fetch time —
    // this is the SNAPSHOT `sortByFeedback` uses. It must not be live cache
    // state, or a row would jump out from under the finger that just tapped its
    // heart; InPersonScreen keeps a separate live map for the rendered glyphs.
    feedback: feedbackCache.get(s.meeting.id),
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
  /**
   * Set only when the fetch THREW (network exception, not an API problem). A
   * non-ok `/schedules/nearby` result is reported through `bannerReason ===
   * "nearbyFailed"` instead, which is tappable and retries; `error` renders a
   * dead, untranslated string and is the path of last resort.
   * CHANGED 2026-09-09: used to also cover "the day-browse fallback failed";
   * there is no fallback fetch any more.
   */
  error: string | null
  /** Why the fallback banner is showing (null in nearby/locating modes) */
  bannerReason: NearbyBannerReason | null
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
  /**
   * Read the current fix. Null until one is acquired, and null again after a
   * denial (see acquireLocation). Deliberately a function rather than a value:
   * see the PRIVACY note on the implementation.
   * CHANGED 2026-11-07 (ZIP search): renamed from `getCoords`, because it now
   * returns the search CENTER — the fix in GPS mode, the looked-up ZIP point
   * in ZIP mode (null until one exists), and null while the mode is unknown.
   */
  getSearchCenter: () => { lat: number; lon: number } | null
  /**
   * ADDED 2026-11-07 (ZIP search): GPS mode holds a usable fix. Derived from
   * state only (mode, permission, fix status), never from the coordinate, so
   * a consumer can gate on "this mode has a center" without reading one.
   * False in ZIP mode and while the mode is null.
   */
  hasFix: boolean
}

/**
 * @param active - true once the user has opened the In-Person segment. Stays
 *   true afterwards. Nothing (permission prompt, GPS fix, network call) may
 *   happen before this flips.
 * @param fellowship - The Meetings filter bar's fellowship (MeetingFiltersContext).
 *   A fetch param for /schedules/nearby. Changing it refetches.
 * @param search - ADDED 2026-11-07 (ZIP search): `mode` is the GPS/ZIP choice
 *   (null until useInPersonSearchMode decides it on first activation; nothing
 *   runs while it is null), `zipCenter` the looked-up point ZIP mode searches
 *   from. Only primitives are read from it (`mode`, `zipCenter.lat/lon`), so a
 *   caller may pass a fresh object every render.
 */
export function useNearbySchedules(
  active: boolean,
  fellowship: string,
  search: { mode: InPersonSearchMode | null; zipCenter: { lat: number; lon: number } | null },
): UseNearbySchedulesResult {
  const configStore = useConfigStore()
  const profileStore = useProfileStore()

  // Read during render so MobX tracks it for the consuming `observer()`
  // component — that is what makes the maintenance-exit refetch fire at all.
  // (ListingsScreen used to dep its fetch callback on the `configStore`
  // object, whose identity never changes, so its maintenance-exit refetch
  // never fired; since 2026-09-09 it reads the primitive the same way.)
  // INTEGRATION REQUIREMENT: the component calling this hook MUST be wrapped
  // in `observer()`, or the reaction doesn't happen.
  // CHANGED 2026-09-26: `savedFellowship` (profileStore.fellowship) used to be
  // read here too, for the same MobX-tracking reason — `fellowship` is now a
  // parameter, supplied by the caller from MeetingFiltersContext instead.
  const maintenanceMode = configStore.maintenanceMode

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

  // REMOVED 2026-09-26: the local fellowship override (and its reset on a
  // Settings change) moved to MeetingFiltersContext, shared by all three
  // Meetings segments. `fellowship` is now a parameter.

  // PRIVACY: coordinates live in this ref only — never state (avoids
  // accidental serialization in devtools snapshots), never MMKV/SQLite,
  // sent nowhere but the /schedules/nearby query.
  const coordsRef = useRef<{ lat: number; lon: number } | null>(null)

  /**
   * False after unmount. Gates every post-await setState *and* the follow-on
   * fetch in the acquire→fetch chains (see `fetchIfMounted`) — the OS
   * permission dialog can stay open indefinitely, so "the component is gone by
   * the time we resume" is a normal outcome here, not an edge case.
   */
  const mountedRef = useRef(true)
  /** True after the first activation, so input changes can't fetch too early. */
  const startedRef = useRef(false)
  /** True while a location fix is in flight (see the driver effect). */
  const acquiringRef = useRef(false)
  /** Monotonic ids so a superseded fetch / fix can never commit its result. */
  const fetchSeqRef = useRef(0)
  const fixSeqRef = useRef(0)

  // ADDED 2026-11-07 (ZIP search). Primitives, so the caller's per-render
  // `search` object never changes a callback's identity by itself.
  const searchMode = search.mode
  const zipLat = search.zipCenter?.lat ?? null
  const zipLon = search.zipCenter?.lon ?? null
  const hasZipCenter = zipLat !== null && zipLon !== null
  /**
   * Mirrors `search.mode` for async code. `acquireLocation`'s `isCurrent()`
   * reads it after every await, which is what makes a fix that lands after a
   * switch to ZIP write nothing. Updated by the mode effect below.
   */
  const modeRef = useRef<InPersonSearchMode | null>(searchMode)
  /**
   * Mirrors the ZIP point for `getSearchCenter`, which must keep one identity
   * (InPersonMapView keeps the accessor out of its dep lists on purpose).
   * PRIVACY: the code's centroid, not the person's position; ref-only here
   * for the same reasons as `coordsRef`, and never logged.
   */
  const zipCenterRef = useRef<{ lat: number; lon: number } | null>(null)
  /**
   * Bumped on every real mode switch. An acquire→fetch chain started under one
   * mode skips its fetch once this has moved, because the new mode's driver
   * run already owns the fetch (see `fetchIfMounted`).
   */
  const modeGenRef = useRef(0)
  /** The mode the driver effect last acted on, to spot a zip → gps switch. */
  const drivenModeRef = useRef<InPersonSearchMode | null>(null)

  useEffect(() => {
    // Re-arm on mount: React 18 StrictMode mounts, unmounts, then remounts in
    // dev, so a plain `useRef(true)` alone would leave this false forever.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // ADDED 2026-11-07 (ZIP search): keep the refs in step with the inputs and
  // make a mode switch stop using the old center at once. Declared BEFORE the
  // driver effect so the refs are current when it runs in the same commit.
  useEffect(() => {
    zipCenterRef.current = zipLat !== null && zipLon !== null ? { lat: zipLat, lon: zipLon } : null
  }, [zipLat, zipLon])

  useEffect(() => {
    const previous = modeRef.current
    modeRef.current = searchMode
    // null → mode is the first decision, not a switch: nothing to undo.
    if (previous === null || previous === searchMode) return

    modeGenRef.current++
    // Supersede any fix in flight. `isCurrent()` also requires GPS mode, so
    // this is belt and braces for gps → zip, and on a fast zip → gps it keeps
    // the OLD acquire from committing over the one the driver starts now.
    fixSeqRef.current++
    // The superseded acquire's `finally` will not clear this (it is no longer
    // current), and a stuck flag would make the driver skip every ZIP fetch.
    acquiringRef.current = false
    // Ignore any fetch in flight from the old center (a GPS-center list must
    // not land after the switch to ZIP, nor a ZIP-center one after the switch
    // back). Its `finally` will not clear the spinner, so clear it here.
    fetchSeqRef.current++
    setIsLoading(false)
    // Rows and a failure from the old center describe a search that is no
    // longer the one on screen (every `distance_m` is relative to it).
    setMeetings([])
    setNearbyFetchFailed(false)
    if (searchMode === "zip") {
      // PRIVACY: ZIP mode holds no fix. `fix` goes back to "pending" so a
      // later switch to GPS starts from "locating" rather than claiming a fix
      // whose coordinate is gone.
      coordsRef.current = null
      setFix("pending")
    } else {
      // zip → gps: the permission state is from the last GPS visit, which may
      // be long gone. Left as "denied" it would flash the denied banner until
      // the acquire the driver starts now settles; "undetermined" reads as
      // `locating` instead, and that acquire writes the real answer.
      setPermission("undetermined")
    }
  }, [searchMode])

  // Locale measurement system is fixed for the process lifetime; resolve once.
  const useMiles = useMemo(() => getLocales()[0]?.measurementSystem === "us", [])

  /**
   * Request permission (prompting on first call) and take one balanced-accuracy
   * fix. Never rejects — callers get a boolean and the state reflects the rest.
   */
  const acquireLocation = useCallback(async (): Promise<boolean> => {
    // ADDED 2026-11-07 (ZIP search): the privacy invariant. Outside GPS mode
    // (ZIP, or the mode not decided yet) this touches no location API and no
    // state, and does not even claim the fix sequence.
    if (modeRef.current !== "gps") return false
    const seq = ++fixSeqRef.current
    // A superseded acquire (user hit refresh again) must not write coords or
    // flip state, and neither may any acquire that outlives the component.
    // CHANGED 2026-11-07 (ZIP search): nor one that outlives GPS mode — a fix
    // landing after a switch to ZIP must write nothing.
    const isCurrent = () =>
      mountedRef.current && fixSeqRef.current === seq && modeRef.current === "gps"

    acquiringRef.current = true
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    /**
     * Set once the cached position below has been committed, so the catch
     * block knows a failed *fresh* fix still leaves us located — without it the
     * timeout would drop a position we had already used to render the list.
     */
    let seededFromCache = false

    try {
      // ADDED 2026-08-08: the Settings → Permissions toggle is the outer gate.
      // When it is off the app must not so much as ASK the OS — the In-Person
      // segment's own gate (useLocationGate) owns every prompt now, and a
      // second request from here would double-prompt on first launch.
      //
      // Mirrors the denial path below exactly: coordinates are dropped, and
      // the stale nearby-failure is cleared so it can't steal the banner from
      // the real reason.
      if (!profileStore.locationEnabled) {
        setPermission("denied")
        coordsRef.current = null
        setNearbyFetchFailed(false)
        return false
      }

      const perm = await Location.requestForegroundPermissionsAsync()
      if (!isCurrent()) return false
      setCanAskAgain(perm.canAskAgain)

      if (!perm.granted) {
        setPermission("denied")
        // ADDED 2026-08-12: reconcile the in-app toggle with the refusal we
        // just received. We only reach this line when `locationEnabled` was
        // true (the short circuit above returns otherwise), so a denial here
        // means the flag is claiming a grant we do not have — the "Allow Once"
        // / "Only this time" case, whose grant usually dies with the process
        // and so never reaches app.tsx's `background → active` resume sync.
        //
        // Costs no extra OS call: `perm` is a response we already have and
        // used to throw away. Doing it here also fixes `effectiveViewMode`
        // (InPersonScreen), which gates the map on the flag and would
        // otherwise mount a MapLibre surface with nothing to centre on.
        //
        // Cannot loop: `acquireLocation` early-returns while the flag is
        // false, the segment's `visible` effect is keyed on a per-visit ref,
        // and `wasLocationEnabledRef` fires only on the false→true edge.
        if (
          shouldRevokeLocationFlag({
            osGranted: perm.granted,
            locationEnabled: profileStore.locationEnabled,
          })
        ) {
          profileStore.setLocationEnabled(false)
        }
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
      // Only announce "locating" when we have nothing to show for. A
      // pull-to-refresh while holding usable coordinates would otherwise flip
      // the mode to `locating` for up to 10 s, blanking the loaded list behind
      // a second spinner while RefreshControl is already showing one. Holding a
      // valid position is not "locating" — and a re-fix that *fails* still
      // degrades correctly via the catch block below (coords dropped, fix
      // "failed", mode "fallback").
      if (!coordsRef.current) setFix("pending")

      // Seed from whatever position the OS already holds before asking for a
      // new one. This is the fix for "I granted location but every restart
      // shows the Enable-location banner until I tap it": the fresh fix below
      // regularly misses its budget on Android, and until 2026-08-04 that was
      // the *only* way this hook could ever obtain coordinates. The cached
      // position needs no hardware wakeup and no wait, and is accurate to far
      // better than the 10 km smallest radius.
      // PRIVACY: handled exactly like any other fix — into the ref, nowhere
      // else, and never logged.
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_MAX_AGE_MS,
      }).catch(() => null)
      if (!isCurrent()) return false
      if (cached) {
        coordsRef.current = { lat: cached.coords.latitude, lon: cached.coords.longitude }
        seededFromCache = true
        setFix("acquired")
      }

      // Race the fix against its timeout — a cold GPS indoors can hang far
      // longer than any budget we'd want to impose on the UI. The handle is
      // cleared in `finally` on BOTH outcomes; leaving it dangling would keep
      // a timer (and this closure) alive after a fast fix, and fire a
      // rejection nobody is listening to. A position that resolves after the
      // timeout won is simply dropped by the race — it is never awaited again,
      // so it cannot write stale coordinates.
      // The budget depends on whether the seed above gave us anything: with a
      // position in hand this is a refinement the user is waiting on, without
      // one it's the difference between a located segment and an empty one.
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

      coordsRef.current = { lat: position.coords.latitude, lon: position.coords.longitude }
      setFix("acquired")
      return true
    } catch (err) {
      if (!isCurrent()) return false
      // PRIVACY: `String(err)` yields "Name: message" only — an Error's
      // toString never includes a request config or URL, so this cannot leak
      // the coordinates we just asked for. Do not log the error object.
      //
      // A cached position committed earlier in this call is still valid — the
      // fresh fix timing out doesn't make it wrong. Degrading here would throw
      // away the position the list is already sorted by, which is the exact
      // failure this change exists to remove.
      // CHANGED 2026-09-19 (RS-016): that case logs at INFO, not WARN. The
      // list is rendered and sorted; nothing is "unavailable", the 5 s
      // refinement just missed its budget. Both outcomes used to share one
      // WARN line, so the tracker's location fingerprint counted a working
      // segment as a failure and could not tell the two apart.
      if (seededFromCache) {
        log.info("Fresh fix missed its budget; keeping the cached position", {
          error: String(err),
        })
        return true
      }
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
  }, [profileStore])

  /**
   * One fetch function; the path is decided by whether we hold coordinates.
   * Mirrors ListingsScreen's maintenance gate and venue self-verification.
   * CHANGED 2026-11-07 (ZIP search): "coordinates" now means the search
   * center of the current mode — the fix in GPS mode, the ZIP point in ZIP
   * mode. The mode and the ZIP point are deps, so a new point refetches.
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
      // Clear any earlier failure too: while maintenance is on, the
      // MaintenanceBanner is the correct explanation, and a stale `error` would
      // make the consumer render an error state on top of it.
      setError(null)
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
      // ADDED 2026-11-07 (ZIP search): ZIP mode searches from the looked-up
      // point and never from `coordsRef` (cleared on the switch anyway). A
      // null mode has no center; the driver never calls this then.
      const currentMode = modeRef.current
      const coords =
        currentMode === "zip"
          ? zipLat !== null && zipLon !== null
            ? { lat: zipLat, lon: zipLon }
            : null
          : currentMode === "gps"
            ? coordsRef.current
            : null
      // CHANGED 2026-08-04: no position now means no request at all. This
      // used to fall through to the day-browse fetch below, which returns
      // every in-person meeting on the server for the day — a list of rooms
      // the user cannot get to, presented underneath a banner blaming their
      // permissions. The empty state in InPersonScreen names the real problem
      // and offers the action that fixes it.
      // CHANGED 2026-09-09: this used to be documented as asymmetric with the
      // `nearbyFetchFailed` path below, which still fell back to a day list.
      // It no longer does (see there) — both "no position" and "nearby
      // failed" now end in an empty list with a tappable remedy.
      if (!coords) {
        setMeetings([])
        // CHANGED 2026-11-07 (ZIP search): carries `mode` too, so "no center"
        // in ZIP mode (no code entered yet) reads apart from a missing fix.
        log.debug("No position — skipping in-person fetch", {
          iso_dow: selectedDay,
          mode: currentMode ?? "unset",
        })
        return
      }

      const params = buildNearbyParams(coords.lat, coords.lon, radiusKm, selectedDay, fellowship)
      // Spec §4: report failure only "after the standard retry" — one
      // immediate retry on a non-ok result before giving up, so a single
      // dropped packet doesn't demote a user with a good GPS fix.
      let result = await api.getNearbySchedules(params)
      // CHANGED 2026-09-14: `result.kind !== "ok"` → retryable kinds only. A
      // 401/403/429 answered the same way the second time; re-sending it
      // doubled every rejection during the 401 storms that got devices
      // banned at the edge.
      if (result.kind !== "ok" && isRetryableProblem(result.kind)) {
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
        // Legacy per-meeting hearts/stars → schedule-wide, before toMeetings
        // snapshots `feedback` (ADDED 2026-09-14; see feedbackCache).
        feedbackCache.reconcileSchedules(result.schedules)
        // Self-verify venue like the daily path (2026-08-02 fix wave):
        // a proxy/older server answering with online rows yields an
        // empty pool rather than mislabeled meetings.
        const pool = inPersonPoolOf(true, toMeetings(result.schedules))
        // Favourites first, nearest-first within each tier. `sortByFeedback` is
        // stable, so it layers over the distance sort rather than replacing it
        // — the nearby list stays nearest-first for everything the user hasn't
        // touched, which is nearly all of it. ADDED 2026-08-04 to match Live.
        setMeetings(sortByFeedback(sortByDistance(pool.items)))
        setNearbyFetchFailed(false)
        log.debug("Loaded nearby schedules", {
          count: pool.items.length,
          iso_dow: selectedDay,
          radiusKm,
        })
        return
      }

      // CHANGED 2026-09-09: there is NO day-browse fallback any more. Until
      // today this branch degraded to `getDailySchedules(day, fellowship,
      // "in_person")` — every in-person meeting in the country for that day,
      // a ~28 MB response — and that request was what kept OOM-killing the
      // 384 MB API container. Loki showed the loop: an API brownout (a
      // restart's 4-minute prefetch, or one in-person day being built) pushes
      // nearby from ~1 s to 15–30 s, the client timeout trips, the retry above
      // trips too, this branch fired the 28 MB request, the container died,
      // and its restart's prefetch browned out nearby for the next client.
      // One user paging through days fired it five times in 12 s. The
      // fallback was the amplifier; the nearby route is fine. A failed nearby
      // now leaves an EMPTY list under the "Couldn't load nearby results — tap
      // to retry" banner (plus the matching tappable empty state in
      // InPersonScreen), and `refresh()` re-runs this same path only. Do not
      // reintroduce any bulk fetch here — a bounded client must never request
      // a whole-country day.
      //
      // Deliberately not `setError`: `error` renders a dead, untranslated
      // string, whereas `nearbyFetchFailed` drives a banner and an empty state
      // that both name the remedy and retry on tap.
      log.warn("Nearby fetch failed after retry; showing retry state", { kind: result.kind })
      setNearbyFetchFailed(true)
      setMeetings([])
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
    // `searchMode` is read through `modeRef` (async-safe) but listed so a
    // switch changes this callback's identity and the driver refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maintenanceMode, fellowship, radiusKm, selectedDay, searchMode, zipLat, zipLon])

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

  /**
   * The shared tail of all three acquire→fetch chains, and the invariant the
   * driver effect below depends on: **every** `acquireLocation()` caller must
   * follow with a fetch, because the driver deliberately skips refetching while
   * an acquire is in flight.
   *
   * The mounted check is the reason this is a function and not a bare call: an
   * acquire can be parked on the OS permission dialog (no timeout) or on a 10 s
   * fix, and `acquireLocation` self-guards only its own state writes. Without
   * this, a segment the user navigated away from would still fire a real
   * network request whose result nobody can read.
   *
   * CHANGED 2026-11-07 (ZIP search): takes the mode generation its chain
   * started under and skips the fetch once a mode switch has moved it. The
   * invariant above still holds: the switch clears `acquiringRef`, so the
   * driver fetches for the new mode itself. Without this, a GPS fix landing
   * after a switch to ZIP would still trigger a fetch.
   */
  const fetchIfMounted = useCallback(async (gen: number) => {
    if (!mountedRef.current) return
    if (modeGenRef.current !== gen) return
    await fetchLatestRef.current()
  }, [])

  /** First activation: prompt + fix, then fetch whichever path that produced. */
  // CHANGED 2026-11-07 (ZIP search): the prompt + fix runs only in GPS mode.
  // ZIP mode goes straight to the fetch from its point. Also re-run by the
  // driver on a zip → gps switch.
  const startInitialLoad = useCallback(async () => {
    const gen = modeGenRef.current
    if (modeRef.current === "gps") await acquireLocation()
    await fetchIfMounted(gen)
  }, [acquireLocation, fetchIfMounted])

  // The single driver: first activation kicks the location chain, and every
  // later change to day / radius / fellowship / maintenance refetches (each
  // one changes `fetchMeetings`'s identity). Nothing runs before `active`.
  // CHANGED 2026-11-07 (ZIP search): also waits while the mode is null, and
  // treats a zip → gps switch like a first activation, so the GPS chain (gate
  // short-circuit, prompt, fix) runs again from scratch. gps → zip needs no
  // special case: `fetchMeetings` changed identity with the mode, and the
  // mode effect cleared `acquiringRef`, so the plain refetch below runs.
  useEffect(() => {
    if (!active) return
    if (searchMode === null) return

    const switchedToGps = searchMode === "gps" && drivenModeRef.current === "zip"
    drivenModeRef.current = searchMode

    if (!startedRef.current || switchedToGps) {
      startedRef.current = true
      void startInitialLoad()
      return
    }

    // An acquire in flight will fetch itself when it settles, using the latest
    // inputs via fetchLatestRef. Firing here too would run a no-position fetch
    // (coords aren't in yet) that the stale-guard then throws away, while the
    // UI shows a "locating" spinner either way. This skip is
    // only safe because every acquire caller goes through `fetchIfMounted` —
    // an acquire that returned without fetching would strand these inputs.
    if (acquiringRef.current) return

    void fetchMeetings()
  }, [active, searchMode, fetchMeetings, startInitialLoad])

  const setRadiusKm = useCallback((km: number) => {
    // Persist first so a crash between the two still leaves the preference
    // the user just picked; the refetch follows from the state change.
    saveString(RADIUS_STORAGE_KEY, String(km))
    setRadiusKmState(km)
  }, [])

  /** Pull-to-refresh: re-fix location when we're allowed to, then refetch. */
  // CHANGED 2026-11-07 (ZIP search): re-fixes only in GPS mode. In ZIP mode a
  // pull refetches from the same point and reads no position.
  const refresh = useCallback(async () => {
    const gen = modeGenRef.current
    if (modeRef.current === "gps" && permission === "granted") await acquireLocation()
    await fetchIfMounted(gen)
  }, [permission, acquireLocation, fetchIfMounted])

  /**
   * Banner tap. Re-requests permission; when the OS has permanently denied it
   * this resolves without a prompt, which is why the caller checks
   * `canAskAgain` and routes to `Linking.openSettings()` itself.
   */
  // CHANGED 2026-11-07 (ZIP search): in ZIP mode `acquireLocation` returns at
  // once, so this only refetches; the mode-gen check drops the fetch if the
  // mode switched while the permission dialog was open.
  const requestLocation = useCallback(async () => {
    const gen = modeGenRef.current
    await acquireLocation()
    await fetchIfMounted(gen)
  }, [acquireLocation, fetchIfMounted])

  /**
   * Accessor for the current fix, for the map view's mount-time camera. A
   * function returning the ref's current value — deliberately not state and
   * not the raw ref — so coordinates still never appear in a serializable
   * snapshot and no consumer can subscribe to position changes.
   * CHANGED 2026-11-07 (ZIP search): renamed from `getCoords`; returns the
   * current mode's center (the fix in GPS mode, the ZIP point in ZIP mode).
   * Still a stable, ref-backed function for the same reasons.
   */
  const getSearchCenter = useCallback(() => {
    if (modeRef.current === "zip") return zipCenterRef.current
    if (modeRef.current === "gps") return coordsRef.current
    return null
  }, [])

  // ADDED 2026-11-07 (ZIP search): state-only on purpose (see the result
  // type). In GPS mode, coordsRef is non-null exactly when permission is
  // granted and fix is "acquired": every path that clears the ref (denial,
  // the Settings toggle short circuit, a failed fix, the switch to ZIP) also
  // moves one of those two states off.
  const hasFix = searchMode === "gps" && permission === "granted" && fix === "acquired"

  // CHANGED 2026-11-07 (ZIP search): carries the mode and whether ZIP mode
  // has a point, so resolveMode ignores GPS state in ZIP mode.
  const modeInput = { active, permission, fix, nearbyFetchFailed, searchMode, hasZipCenter }
  const mode = resolveMode(modeInput)
  // Only fallback mode shows a banner. Which reason it carries is a pure
  // decision, so it lives in nearbyLogic where vitest can reach it.
  const bannerReason = resolveBannerReason(modeInput)

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
    getSearchCenter,
    hasFix,
  }
}
