/**
 * ListingsScreen — the "Search" segment of the Meetings tab.
 *
 * Six filters over one day's meetings: fellowship, venue, day, language,
 * radius and time. Fellowship and day are fetch inputs; venue decides which
 * pools are fetched at all; radius (when set, and only for in-person) swaps
 * the in-person leg onto `/schedules/nearby`; language and time are pure
 * client-side passes over what came back.
 *
 * This is the only surface that can show either venue type, so rows and popups
 * are chosen per meeting rather than per screen — see `renderItem`.
 * CHANGED 2026-08-04: it no longer shows both at *once* — the Venue filter's
 * "All" choice was removed, so a given list is all-online or all-in-person.
 * The per-meeting dispatch stays: which kind a list holds is still a runtime
 * fact here, unlike on Live (always online) or In-Person (always a venue).
 *
 * PRIVACY: two things here touch location — the radius filter (coordinates go
 * to `/schedules/nearby`) and the distance badge (`measureDistance`, which
 * computes on-device and sends nothing). Neither puts a coordinate in this
 * file's state or logs; both read the ref at call time and drop it. The badge
 * path deliberately never prompts — it only uses a grant the user already
 * gave. Read `useDeviceLocation`'s header before changing either.
 */

import { FC, useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  FlatList,
  RefreshControl,
  ScrollView,
  View,
  ViewStyle,
  TextStyle,
  Pressable,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from "react-native"
import { getLocales } from "expo-localization"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { DaySelectorModal, ISO_DAYS } from "@/components/DaySelectorModal"
import { InPersonPopup } from "@/components/InPersonPopup"
import { MeetingRow } from "@/components/MeetingRow"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { MeetingWithTrex } from "@/context/MeetingContext"
import {
  inPersonPoolOf,
  isInPersonVenue,
  mergePools,
  type PoolOutcome,
} from "@/context/meetingPools"
import { feedbackCache, type FeedbackRecord } from "@/db"
import { useDeviceLocation } from "@/hooks/useDeviceLocation"
import { useLocationGate } from "@/hooks/useLocationGate"
import { useReminderLookup, meetingHasReminder } from "@/hooks/useReminders"
import { useConfigStore, useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { navigate } from "@/navigators/navigationUtilities"
import { api, LiveSchedule } from "@/services/api"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { sortByFeedback } from "@/utils/feedbackSort"
import { ACTIVE_FELLOWSHIPS } from "@/utils/fellowships"
import {
  coerceVenue,
  DEFAULT_SEARCH_TIME,
  DEFAULT_VENUE,
  matchesSearchTime,
  matchesVenue,
  poolsForVenue,
  radiusAppliesTo,
  SEARCH_TIME_OPTIONS,
  type SearchTime,
  venueOptionsFor,
  type VenueChoice,
} from "@/utils/filterLogic"
import { logger } from "@/utils/logger"
import {
  buildNearbyParams,
  DEFAULT_RADIUS_KM,
  distanceMeters,
  formatDistance,
  RADIUS_OPTIONS_KM,
} from "@/utils/nearbyLogic"

const log = logger.child({ module: "ListingsScreen" })

/**
 * Fellowships available for filtering — driven by EXPO_PUBLIC_FELLOWSHIPS
 * via ACTIVE_FELLOWSHIPS (single source of truth across all four pickers).
 * Label is the short code itself (e.g. "AA").
 */
const SELECTABLE_FELLOWSHIPS = ACTIVE_FELLOWSHIPS.map((value) => ({ value, label: value }))

/** Map of ISO 639-1 language codes (uppercase) to native display names */
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  EN: "English",
  ES: "Español",
  FR: "Français",
  PT: "Português",
  DE: "Deutsch",
  RU: "Русский",
  AR: "العربية",
  TH: "ไทย",
  IT: "Italiano",
  JA: "日本語",
  KO: "한국어",
  ZH: "中文",
  NL: "Nederlands",
  PL: "Polski",
  SV: "Svenska",
  HE: "עברית",
  HI: "हिन्दी",
  TR: "Türkçe",
  UK: "Українська",
  FA: "فارسی",
}

const getLanguageDisplayName = (code: string): string => LANGUAGE_DISPLAY_NAMES[code] ?? code

/** Amber accent — the same literal InPersonScreen uses for its banner, so the
 *  two segments' location banners are visually one thing. */
const BANNER_ACCENT = "#f59e0b"

/** Translation key per venue choice. A Record so a new choice without a label
 *  is a compile error rather than a `[missing key]` rendered on screen. */
const VENUE_TX: Record<VenueChoice, string> = {
  online: "listingsScreen:venueOnline",
  in_person: "listingsScreen:venueInPerson",
}

/**
 * Translation key per Search time choice. The four buckets deliberately reuse
 * the In-Person segment's strings — same boundaries, same words, and a user
 * moving between the two segments should not meet two vocabularies for one
 * concept. Only `custom` is Search's own.
 */
const SEARCH_TIME_TX: Record<SearchTime, string> = {
  all: "inPersonScreen:shortTimeAll",
  morning: "inPersonScreen:shortTimeMorning",
  afternoon: "inPersonScreen:shortTimeAfternoon",
  evening: "inPersonScreen:shortTimeEvening",
  overnight: "inPersonScreen:shortTimeOvernight",
  custom: "listingsScreen:timeCustom",
}

// Get current ISO day of week (1=Monday, 7=Sunday)
const getCurrentIsoDow = (): number => {
  const jsDay = new Date().getDay() // 0=Sun, 6=Sat
  return jsDay === 0 ? 7 : jsDay // Convert to ISO (1-7)
}

/**
 * ListingsContent - Core content for meeting listings display
 *
 * Extracted from ListingsScreen to allow composition in MeetingsScreen.
 * Contains all the logic for displaying scheduled meetings with filtering.
 */
interface ListingsContentProps {
  /**
   * True once the user has opened the Search segment. Stays true afterwards.
   * Location must not be touched before this flips — all three segments are
   * mounted from app start (see MeetingsScreen), so "mounted" is not "opened".
   */
  active?: boolean
}

export const ListingsContent: FC<ListingsContentProps> = observer(function ListingsContent({
  active = false,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const configStore = useConfigStore()
  const reminderLookup = useReminderLookup()

  // Refs
  const listRef = useRef<FlatList>(null)

  // State
  const [selectedDay, setSelectedDay] = useState(getCurrentIsoDow)
  const [dayModalVisible, setDayModalVisible] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null) // null = all
  const [languageModalVisible, setLanguageModalVisible] = useState(false)
  const [fellowshipModalVisible, setFellowshipModalVisible] = useState(false)
  const [startHour, setStartHour] = useState(0) // 0-23
  const [endHour, setEndHour] = useState(24) // 1-24 (24 = midnight end)
  const [timePickerVisible, setTimePickerVisible] = useState<"start" | "end" | null>(null)

  // ---------------------------------------------------------------------------
  // Venue / radius / time filters (2026-08-04)
  //
  // Every default is a value that needs no location, so a first visit still
  // asks the user for nothing: Venue defaults to Online, which skips the
  // in-person leg (and with it the GPS prompt) entirely.
  // CHANGED 2026-08-04: Venue's default used to be "All" — every meeting for
  // the day, both pools. That choice is gone; see `VenueChoice`.
  // ---------------------------------------------------------------------------
  const [venue, setVenue] = useState<VenueChoice>(DEFAULT_VENUE)
  const [venueModalVisible, setVenueModalVisible] = useState(false)
  // Always a real distance — same option list and same default as the
  // In-Person segment (there is no "Any"). It's only *applied* once we hold a
  // location fix; until then the in-person leg is skipped and the cell says so.
  // See `radiusApplied` and `needsLocation` below.
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM)
  const [radiusModalVisible, setRadiusModalVisible] = useState(false)
  const [searchTime, setSearchTime] = useState<SearchTime>(DEFAULT_SEARCH_TIME)
  const [searchTimeModalVisible, setSearchTimeModalVisible] = useState(false)

  const location = useDeviceLocation()
  // The app-level Location toggle's gate — the ONLY thing that can turn the
  // toggle back on. `location.acquire()` cannot: it short-circuits before any
  // `Location.*` call while the toggle is off (see useDeviceLocation's header).
  const { runGate } = useLocationGate()

  /**
   * Settings → Permissions → Location is off.
   *
   * ADDED 2026-08-12: in-person search is a distance search, so this kills it
   * outright — `useDeviceLocation` refuses to produce a fix, the in-person leg
   * is skipped, and the list comes back empty. Search used to offer the venue
   * choice anyway and explain itself only through a dimmed "Location off"
   * radius cell; the In-Person segment, on the same toggle, removes the
   * ambiguity with a banner. This is that banner's condition, and the reason
   * `venueOptionsFor` drops the In-Person option below.
   */
  const locationDisabled = !profileStore.locationEnabled

  /** Venue picker contents. In-Person is absent while location is off. */
  const venueOptions = useMemo(
    () => venueOptionsFor(profileStore.locationEnabled),
    [profileStore.locationEnabled],
  )

  /**
   * Snap the venue back to something the picker still offers.
   *
   * This is a live transition, not a cold-start case: all three Meetings
   * segments stay mounted behind the Settings tab, so a user can be sitting on
   * an In-Person search when the switch goes off. Without this the selector
   * would read "In-Person" over a list that can only be empty, and the picker
   * would no longer contain the value it claims is selected.
   *
   * Safe against the trap documented in CLAUDE.md ("Permissions & the Location
   * Gate"): this effect touches no location API and pops no dialog — it only
   * rewrites local filter state — so re-firing it on a `locationEnabled` change
   * is exactly what we want, unlike the In-Person gate.
   */
  useEffect(() => {
    setVenue((current) => coerceVenue(current, profileStore.locationEnabled))
  }, [profileStore.locationEnabled])

  // Pick up a location fix if — and only if — the user has already granted
  // permission somewhere else in the app (the In-Person segment is the usual
  // place). This never prompts, so it doesn't touch the lazy-permission rule;
  // it exists so the radius works, and distance badges appear, for someone who
  // has already said yes rather than making them say yes again on this tab. A
  // bumped `fixVersion` refetches, which is what turns both on.
  //
  // Gated on `active`, NOT on mount: MeetingsScreen mounts all three segments
  // at app start, so an unguarded version took a GPS fix at launch for a tab
  // the user might never open.
  useEffect(() => {
    if (!active) return
    void location.probeExisting()
    // Fires once per activation. Depending on `location` would re-probe (and
    // re-fix) on every status change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Merged venue pools (online + in_person) for the selected day.
  // CHANGED 2026-08-04: this used to be projected through `projectOnline` —
  // the hold-back that kept in-person meetings out of Search while the
  // in-person UI was being built. The Venue filter replaces it: the hold-back
  // was a temporary blanket, this is the user's choice. `matchesVenue` below
  // still self-verifies every row's venueType, so a server that ignores the
  // `venueType` param can't smuggle in-person rows into an online-only search.
  const [allMeetings, setAllMeetings] = useState<MeetingWithTrex[]>([])
  const meetings = useMemo(
    () => allMeetings.filter((m) => matchesVenue(m.venueType, venue)),
    [allMeetings, venue],
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithTrex | null>(null)

  // Live feedback state for display updates
  const [displayFeedback, setDisplayFeedback] = useState<Map<string, FeedbackRecord>>(() =>
    feedbackCache.getAll(),
  )

  // Subscribe to feedback changes for live UI updates
  useEffect(() => {
    const unsubscribe = feedbackCache.subscribe((mid, feedback) => {
      setDisplayFeedback((prev) => {
        const next = new Map(prev)
        next.set(mid, feedback)
        return next
      })
    })
    return unsubscribe
  }, [])

  // Get label for selected day (translated)
  const selectedDayLabel = ISO_DAYS.find((d) => d.iso === selectedDay)?.tx
    ? t(ISO_DAYS.find((d) => d.iso === selectedDay)!.tx)
    : ""

  // Device locale measurement system is fixed for the process lifetime.
  const useMiles = useMemo(() => getLocales()[0]?.measurementSystem === "us", [])

  const venueLabel = t(VENUE_TX[venue])
  const searchTimeLabel = t(SEARCH_TIME_TX[searchTime])
  // Radius is dead weight on an online-only search — online meetings have no
  // place, so a distance can't include or exclude them. Greyed rather than
  // hidden: a filter that vanishes and reappears as you change another filter
  // is harder to trust than one that visibly steps aside.
  const radiusActive = radiusAppliesTo(venue)
  const radiusLabel = formatDistance(radiusKm * 1000, useMiles)

  /**
   * Is the radius actually narrowing anything right now?
   *
   * A radius needs two things: a venue choice that can surface in-person
   * meetings, and a location fix. Without the fix the in-person leg is skipped
   * entirely — so the cell must not sit there reading "16 mi" as though it
   * were narrowing anything.
   *
   * This mattered less when the picker had an "Any" option, because "Any" was
   * an honest description of the un-located state. With the option gone
   * (2026-08-04), the display has to carry that meaning instead.
   * CHANGED 2026-08-04: the un-located case used to mean "distance filter
   * doesn't bite"; it now means "in-person results are absent", which is a
   * much bigger claim on the user's attention — hence `needsLocation` below,
   * which puts it in the cell's value column and in the empty state instead of
   * leaving it to a dimmed control nobody reads.
   */
  const radiusApplied = radiusActive && location.status === "ready"

  /**
   * The venue filter wants in-person meetings and we can't supply any, because
   * we have no position to search around. `acquiring` is deliberately excluded
   * — a fix in flight resolves in seconds and the list is showing a spinner
   * anyway, so announcing a problem there would be premature.
   */
  const needsLocation =
    radiusActive && (location.status === "idle" || location.status === "unavailable")

  /**
   * Opening the picker — not picking an option — is what prompts for location.
   *
   * Reaching for the radius control is the unambiguous "I care how far away
   * these are" signal, and asking here means the permission dialog is resolved
   * before the user chooses a distance, rather than ambushing them after. This
   * is the only thing on this tab that ever prompts; nothing happens on
   * arrival (lazy-permission rule — see `useDeviceLocation`'s header).
   */
  const handleOpenRadiusModal = useCallback(() => {
    setRadiusModalVisible(true)
    // `idle` means never asked. Re-prompting after a denial is the OS's call:
    // `acquire` resolves without a dialog when permission is permanently
    // denied, so this can't turn into a nag loop.
    // CHANGED 2026-08-04: `unavailable` retries too. That status covers a
    // granted user whose fix merely timed out (routine on Android from a cold
    // start), and the old `idle`-only check left them with a permanently dead
    // radius filter: opening the picker did nothing, and the only accidental
    // way out was re-selecting the distance they already had, because
    // `handleRadiusSelect` below acquires on any non-ready status.
    if (location.status === "idle" || location.status === "unavailable") {
      void location.acquire()
    }
  }, [location])

  const handleRadiusSelect = useCallback(
    async (km: number) => {
      setRadiusKm(km)
      // PRIVACY: a radius is a display preference, not a position.
      trackEvent("listings_radius_changed", { km })
      // Normally already resolved by handleOpenRadiusModal above. Still tried
      // here for the case where that prompt was dismissed without an answer
      // and the user picked anyway — two fetches can follow (day endpoint
      // first, then /schedules/nearby once the fix lands), which is the right
      // order: results appear while the GPS is still working, then narrow.
      if (location.status !== "ready") {
        await location.acquire()
      }
    },
    [location],
  )

  // Get unique languages from meetings
  const availableLanguages = useMemo(() => {
    const langs = new Set<string>()
    meetings.forEach((m) => {
      if (m.language) langs.add(m.language.toUpperCase())
    })
    return Array.from(langs).sort()
  }, [meetings])

  // Format hour for display (e.g., "6am", "12pm", "12am").
  // Pure (only depends on its arg) — memoized with [] so it stays referentially
  // stable and doesn't invalidate the ListHeader useCallback every render.
  const formatHour = useCallback((hour: number): string => {
    if (hour === 0 || hour === 24) return "12am"
    if (hour === 12) return "12pm"
    if (hour < 12) return `${hour}am`
    return `${hour - 12}pm`
  }, [])

  // Get current hour (top of hour)
  const getCurrentHour = (): number => new Date().getHours()

  // Handle time selection with auto-adjust for invalid ranges
  const handleTimeSelect = (hour: number) => {
    if (timePickerVisible === "start") {
      setStartHour(hour)
      // If start >= end, adjust end to start + 1 (wrap at 24)
      if (hour >= endHour) {
        setEndHour(Math.min(hour + 1, 24))
      }
    } else if (timePickerVisible === "end") {
      setEndHour(hour)
      // If end <= start, adjust start to end - 1 (min 0)
      if (hour <= startHour) {
        setStartHour(Math.max(hour - 1, 0))
      }
    }
    setTimePickerVisible(null)
    // Scroll list to top after time change
    listRef.current?.scrollToOffset({ offset: 0, animated: true })
  }

  // Generate hours for picker (0-23 for start, 1-24 for end)
  const getPickerHours = (): number[] => {
    if (timePickerVisible === "start") {
      return Array.from({ length: 24 }, (_, i) => i) // 0-23
    }
    return Array.from({ length: 24 }, (_, i) => i + 1) // 1-24
  }

  // Fetch daily schedules
  const fetchDailySchedules = useCallback(async () => {
    // Skip the API call entirely while server-side maintenance is on.
    // Pull-to-refresh from the Listings tab still hits this code path
    // directly (bypassing MeetingContext), so the gate has to live here
    // too. We just stop the spinner and leave the list as-is.
    if (configStore.maintenanceMode) {
      log.debug("Skipping daily schedules fetch — maintenance mode")
      setIsLoading(false)
      return
    }

    const fellowship = profileStore.fellowship
    if (!fellowship) {
      setAllMeetings([])
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Which pools this venue choice actually needs. Skipping one is the
      // point — an online-only search must not spend a request on venues, and
      // (with a radius set) must not spend a location fix on them either.
      const pools = poolsForVenue(venue)

      // The nearby endpoint is used for the in-person leg only when the user
      // has picked a real radius AND we hold a fix.
      // CHANGED 2026-08-04: without a fix the in-person leg is now SKIPPED
      // rather than sent to the plain day endpoint. That fallback returned
      // every in-person meeting on the server for the day — worldwide,
      // unbounded, silently — so an Android user whose fix timed out (the
      // common case before the cached-position seed in useDeviceLocation) got
      // rooms on other continents mixed into their search with nothing but a
      // dimmed radius cell to explain it. Online results are unaffected: a
      // meeting you join over video is genuinely location-independent.
      const coords = radiusKm !== null && pools.inPerson ? location.getCoords() : null
      // Built here rather than inline so TypeScript narrows `radiusKm` for
      // real — the inline form needed a non-null assertion, and an assertion
      // is the wrong tool anywhere near the coordinate path.
      const nearbyParams =
        coords && radiusKm !== null
          ? buildNearbyParams(coords.lat, coords.lon, radiusKm, selectedDay, fellowship)
          : null

      const [onlineResult, inPersonResult] = await Promise.all([
        pools.online ? api.getDailySchedules(selectedDay, fellowship, "online") : null,
        pools.inPerson && nearbyParams ? api.getNearbySchedules(nearbyParams) : null,
      ])

      // `distance_m` sits on the schedule row, not on the nested meeting the
      // spread copies, so it has to be carried across explicitly or the
      // distance badge sees undefined. Harmlessly undefined on daily rows.
      const toMeetings = (schedules: LiveSchedule[]): MeetingWithTrex[] =>
        schedules.map((s: LiveSchedule) => ({
          ...s.meeting,
          // CHANGED 2026-08-04: was hard-coded `null`, which left the Search
          // list with nothing to order favourites by. Read once, here, at fetch
          // time — this is the SNAPSHOT the sort uses, and it must not be live
          // cache state or a row would jump out from under the finger that just
          // tapped its heart. `displayFeedback` (subscribed above) is the live
          // one, and it drives the rendered heart/star only.
          feedback: feedbackCache.get(s.meeting.id),
          sid: s.sid,
          millis: s.millis,
          duration_ms: s.duration_ms ?? 0,
          scheduleData: s.data,
          distance_m: s.distance_m,
        }))

      // A skipped pool is `ok: true` with no items, NOT a failure — otherwise
      // an online-only search would report the (never-attempted) in-person leg
      // as failed and, worse, a venue choice that skips both would look like a
      // total outage. `poolsForVenue` guarantees at least one leg runs.
      const toPool = (
        result: Awaited<ReturnType<typeof api.getDailySchedules>> | null,
      ): PoolOutcome<MeetingWithTrex> => {
        if (result === null) return { ok: true, items: [] }
        return result.kind === "ok"
          ? { ok: true, items: toMeetings(result.schedules) }
          : { ok: false, items: [] }
      }

      const onlinePool = toPool(onlineResult)
      // In-person pool is self-verified, not trusted — a server that ignores
      // venueType (production, as of this fix wave) answers with the same
      // rows as the online call. inPersonPoolOf filters toPool()'s items down
      // to genuine in_person rows so an unaware server yields an empty pool
      // instead of duplicating every online meeting. See meetingPools.ts.
      const inPersonRaw = toPool(inPersonResult)
      const inPersonPool = inPersonPoolOf(inPersonRaw.ok, inPersonRaw.items)

      const merged = mergePools(onlinePool, inPersonPool)

      // A skipped leg is null, so "kind" is only meaningful for legs that ran.
      // Reported as "skipped" rather than omitted: a log line that just lacks
      // the field is indistinguishable from one where the field was dropped.
      const onlineKind = onlineResult ? onlineResult.kind : "skipped"
      const inPersonKind = inPersonResult ? inPersonResult.kind : "skipped"

      // Only a total failure is an error; one pool failing degrades to the
      // other (spec decision 4). `bothFailed` can no longer fire when a leg
      // was skipped — a skipped pool reports ok — so this means both actually
      // ran and both actually failed.
      if (merged.bothFailed) {
        // Logging both kinds is the primary production signal for whether the
        // in-person pool works at all (booleans can't distinguish "server
        // rejects/strips the param" from "flaky network").
        log.error("API schedule fetch failed for both venue pools", {
          onlineKind,
          inPersonKind,
          venue,
        })
        setError(`Error: ${onlineKind}`)
        setAllMeetings([])
        return
      }
      if (merged.onlineFailed || merged.inPersonFailed) {
        log.warn("One venue pool failed for daily schedules; serving partial data", {
          onlineFailed: merged.onlineFailed,
          inPersonFailed: merged.inPersonFailed,
          onlineKind: merged.onlineFailed ? onlineKind : undefined,
          inPersonKind: merged.inPersonFailed ? inPersonKind : undefined,
        })
      }

      // Sort the merged pool once by local time (hour:minute), not UTC millis,
      // so the future in-person UI inherits correct ordering.
      // CHANGED 2026-08-12 (Jenova): sort on `millis` ascending instead. The
      // minutes-since-local-midnight key discarded the date, so any row whose
      // instant landed on an adjacent calendar day — a venue far enough east or
      // west of the device for the same weekday slot to fall outside the
      // device's day — was interleaved by clock face rather than by when it
      // actually happens. It also split the Overnight bucket across both ends
      // of the list (01:00 keyed 60, 22:00 keyed 1320) when that filter was
      // applied. Raw millis is the true chronological order and collapses to
      // the same result as the old key for the ordinary same-day case.
      const byTime = [...merged.items].sort((a, b) => a.millis - b.millis)

      // ADDED 2026-08-04: favourites float to the top, the same three tiers the
      // Live segment has always used. Layered OVER the time sort rather than
      // replacing it — `sortByFeedback` is stable, so untouched meetings keep
      // their chronological order and favourites are chronological among
      // themselves. Ordering happens once per fetch, on the feedback snapshot
      // stamped in `toMeetings`, so the list never reshuffles mid-scroll.
      const sorted = sortByFeedback(byTime)

      setAllMeetings(sorted)
      // PRIVACY: scalars only. Never log the nearby params object — it carries
      // lat/lon. `usedNearby` records which endpoint answered without saying
      // anything about where the device is.
      log.debug("Loaded schedules", {
        total: sorted.length,
        day: selectedDay,
        venue,
        usedNearby: coords !== null,
        radiusKm: radiusKm ?? undefined,
      })
    } catch (err) {
      log.error("Exception fetching daily schedules", { error: String(err) })
      setError("Failed to load schedules")
      setAllMeetings([])
    } finally {
      setIsLoading(false)
    }
    // `location` is the hook's result object; only `fixVersion` can change what
    // this fetch produces (a new fix means new coordinates behind getCoords),
    // so that primitive is the honest dependency. Depending on `location`
    // itself would refetch on every unrelated status flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, profileStore.fellowship, configStore, venue, radiusKm, location.fixVersion])

  // Fetch when day, fellowship, venue, radius or the location fix changes
  useEffect(() => {
    fetchDailySchedules()
  }, [fetchDailySchedules])

  // Filter by language and time. Venue is applied upstream (in `meetings`),
  // and radius is applied server-side by the nearby endpoint — neither belongs
  // here.
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      const inTimeRange = matchesSearchTime(m.millis, searchTime, startHour, endHour)
      const matchesLanguage = !selectedLanguage || m.language?.toUpperCase() === selectedLanguage
      return inTimeRange && matchesLanguage
    })
  }, [meetings, searchTime, startHour, endHour, selectedLanguage])

  /**
   * Distance from the device to a meeting's venue, measured on-device.
   *
   * PRIVACY: this is the *more* private of the two paths — the coordinates
   * never leave the device at all, unlike the nearby query. Coords are read
   * from the hook's ref at call time and dropped; nothing here holds them.
   *
   * Keyed on `fixVersion` rather than on the coordinates, so the memo
   * invalidates when a new fix lands without a position ever becoming a
   * dependency (or entering the render tree).
   */
  const measureDistance = useCallback(
    (meeting: MeetingWithTrex): number | undefined => {
      // In-person only. A pure online meeting has no venue to be near, so any
      // coordinates on one are stale or placeholder data — measuring them
      // would put a confident "12 mi" on a row that is nowhere, and would beat
      // the "Online" tag to the badge slot.
      if (!isInPersonVenue(meeting.venueType)) return undefined
      const coords = location.getCoords()
      return coords ? distanceMeters(coords, meeting) : undefined
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.getCoords, location.fixVersion],
  )

  /**
   * Banner tap — one route only, unlike In-Person's five.
   *
   * The banner shows for exactly one reason here (the app-level toggle is
   * off), because every other location failure on this tab is reachable only
   * with the toggle ON, and those states already have their own copy: the
   * radius cell reads "Location off" and the empty state is tappable. Only
   * `runGate()` can flip the toggle back — `location.acquire()` short-circuits
   * while it's off, which is the silent-dead-end shape the In-Person banner
   * fix (2026-08-08) closed on that segment.
   */
  const handleBannerPress = useCallback(() => {
    void runGate()
  }, [runGate])

  // Meeting popup handlers
  const handleMeetingPress = useCallback((meeting: MeetingWithTrex) => {
    setSelectedMeeting(meeting)
  }, [])

  const handleClosePopup = useCallback(() => {
    setSelectedMeeting(null)
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: MeetingWithTrex }) => {
      // One row for both venues (2026-08-04) — it adapts to the meeting it's
      // given, so this list no longer branches. Feedback still applies to
      // in-person meetings, so `displayFeedback` is read for every row, not
      // just online ones.
      const feedback = displayFeedback.get(item.id)
      // REMOVED 2026-08-04: the per-row "Online" tag. It existed because Search
      // was the app's only mixed list and a row had to say which kind it was.
      // Dropping the "All" venue choice (see `VenueChoice`) made every list on
      // this screen single-venue, so the tag restated the filter the user just
      // set on every row. If "All" ever returns, so must the tag.
      return (
        <MeetingRow
          meeting={item}
          rating={feedback?.rates ?? 0}
          isFavorite={feedback?.loves ?? false}
          hasReminder={meetingHasReminder(item, reminderLookup)}
          // Prefer the server's `distance_m` (only present when the nearby
          // endpoint answered), then fall back to measuring it here.
          // CHANGED 2026-08-04: used to be `distance_m` alone, which meant the
          // badge vanished whenever Radius was "Any" — the default — even
          // though we knew both positions. Nothing on screen explained why the
          // same meeting showed a distance under one radius and not another.
          // formatDistance returns "" for undefined, and `|| undefined` keeps
          // the row from rendering an empty badge.
          distanceLabel={
            formatDistance(item.distance_m ?? measureDistance(item), useMiles) || undefined
          }
          onPress={handleMeetingPress}
        />
      )
    },
    [handleMeetingPress, displayFeedback, reminderLookup, useMiles, measureDistance],
  )

  const keyExtractor = useCallback((item: MeetingWithTrex) => item.id, [])

  const ItemSeparatorComponent = useCallback(() => <View style={themed($separator)} />, [themed])

  const ListEmptyComponent = useCallback(
    () =>
      // The location branch is tappable, so it can't live inside the shared
      // View below. Added 2026-08-04: with the in-person leg skipped when we
      // hold no position, an In-Person search with location off empties the
      // list entirely — and "No meetings for AA" would blame the fellowship
      // for it. Tapping opens the radius picker, which is what prompts.
      needsLocation && !error && profileStore.fellowship ? (
        <Pressable
          style={themed($emptyContainer)}
          onPress={handleOpenRadiusModal}
          accessibilityRole="button"
          accessibilityHint={t("accessibility:doubleTapToAllowLocation")}
        >
          <Text style={themed($emptyText)}>{t("listingsScreen:emptyNoLocation")}</Text>
        </Pressable>
      ) : (
        <View style={themed($emptyContainer)}>
          {!profileStore.fellowship ? (
            <Text style={themed($emptyText)}>{t("listingsScreen:selectFellowship")}</Text>
          ) : error ? (
            <Text style={themed($errorText)}>{error}</Text>
          ) : (
            <Text style={themed($emptyText)}>
              {t("listingsScreen:emptyStateFiltered", { fellowship: profileStore.fellowship })}
            </Text>
          )}
        </View>
      ),
    [themed, t, profileStore.fellowship, error, needsLocation, handleOpenRadiusModal],
  )

  const ListHeaderComponent = useCallback(
    () => (
      <View>
        {/* Header */}
        <View style={themed($header)}>
          <Text preset="heading" style={themed($title)}>
            {t("listingsScreen:title")}
          </Text>
          <TouchableOpacity
            onPress={() => navigate("Settings" as never, { section: "profile" } as never)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("mainNavigator:settingsTab")}
          >
            <Ionicons name="settings-outline" size={22} color={theme.colors.textDim} />
          </TouchableOpacity>
        </View>

        {/* Six filters in a 2×3 grid (Jenova, 2026-08-04), matching the
            In-Person segment's grid so the two tabs read the same. Fellowship
            used to own a full-width row of its own; its value is a two-letter
            code, so that row was almost entirely empty space.

            Every value is short enough for a half-width cell — which is why
            the Language label is "Lang" here: at ~160dp, "Language" plus a
            native language name ("Português", "Українська") collided. All
            values carry `numberOfLines={1}`; the labels are left free to wrap,
            since $selectorRow stretches and a taller row beats a truncated
            one.

            Cell order is Fellowship / Venue, Lang / Radius, Day / Time
            (Jenova, 2026-08-04, revising the 2026-08-03 order of Fellowship /
            Venue, Day / Time, Radius / Lang). The three rows now read as three
            questions: what kind of meeting, in what language and how far, and
            when. Day and Time keep sharing a row — they're the pair a user
            almost always sets together — and moving them to the bottom puts
            them directly above the Custom start/end row that the Time cell
            reveals, which the previous order had one row removed. */}
        <View style={themed($selectorRow)}>
          <TouchableOpacity
            style={themed($selectorButton)}
            onPress={() => setFellowshipModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`${t("inPersonScreen:fellowshipLabel")}, ${profileStore.fellowship || "AA"}`}
          >
            <Text style={themed($selectorLabel)}>{t("inPersonScreen:fellowshipLabel")}</Text>
            <View style={$selectorValueRow}>
              <Text style={themed($selectorValue)} numberOfLines={1}>
                {profileStore.fellowship || "AA"}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={themed($selectorButton)}
            onPress={() => setVenueModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`${t("listingsScreen:venueLabel")}, ${venueLabel}`}
          >
            <Text style={themed($selectorLabel)}>{t("listingsScreen:venueLabel")}</Text>
            <View style={$selectorValueRow}>
              <Text style={themed($selectorValue)} numberOfLines={1}>
                {venueLabel}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={themed($selectorRow)}>
          <TouchableOpacity
            style={themed($selectorButton)}
            onPress={() => setLanguageModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`${t("listingsScreen:languageLabel")}, ${selectedLanguage ? getLanguageDisplayName(selectedLanguage) : t("listingsScreen:allLanguages")}`}
          >
            <Text style={themed($selectorLabel)}>{t("listingsScreen:langLabel")}</Text>
            <View style={$selectorValueRow}>
              <Text style={themed($selectorValue)} numberOfLines={1}>
                {selectedLanguage
                  ? getLanguageDisplayName(selectedLanguage)
                  : t("listingsScreen:allLanguages")}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
            </View>
          </TouchableOpacity>

          {/* Radius: disabled — not hidden — when Venue is Online. `disabled`
              also removes it from the accessibility focus order's tap targets,
              and the label says why rather than leaving a dead control. */}
          <TouchableOpacity
            style={[themed($selectorButton), !radiusApplied && themed($selectorButtonDisabled)]}
            onPress={handleOpenRadiusModal}
            // Disabled ONLY for an online-only search, where the filter is
            // meaningless. Having no location fix also dims the cell, but it
            // stays tappable — that's precisely the state where the user needs
            // to reach the picker to grant permission and make it work.
            disabled={!radiusActive}
            accessibilityRole="button"
            accessibilityState={{ disabled: !radiusActive }}
            accessibilityLabel={`${t("inPersonScreen:selectRadius")}, ${
              !radiusActive
                ? t("listingsScreen:radiusOnlineNote")
                : radiusApplied
                  ? radiusLabel
                  : `${radiusLabel}, ${t("listingsScreen:radiusNoLocation")}`
            }`}
          >
            <Text style={themed($selectorLabel)}>{t("inPersonScreen:selectRadius")}</Text>
            <View style={$selectorValueRow}>
              {/* Shows "Location off" rather than a distance we aren't
                  applying. Added 2026-08-04 with the skipped in-person leg:
                  a dimmed "16 mi" reads as an active filter, and it is now the
                  only on-screen sign that in-person results are missing
                  altogether. Tapping still routes to the picker, which
                  re-prompts. */}
              <Text
                style={[themed($selectorValue), !radiusApplied && themed($selectorValueDisabled)]}
                numberOfLines={1}
              >
                {needsLocation ? t("listingsScreen:radiusOff") : radiusLabel}
              </Text>
              <Ionicons
                name="chevron-down"
                size={16}
                color={radiusApplied ? theme.colors.tint : theme.colors.textDim}
              />
            </View>
          </TouchableOpacity>
        </View>

        <View style={themed($selectorRow)}>
          <TouchableOpacity
            style={themed($selectorButton)}
            onPress={() => setDayModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`${t("listingsScreen:dayLabel")}, ${selectedDayLabel}`}
          >
            <Text style={themed($selectorLabel)}>{t("listingsScreen:dayLabel")}</Text>
            <View style={$selectorValueRow}>
              <Text style={themed($selectorValue)} numberOfLines={1}>
                {selectedDayLabel}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={themed($selectorButton)}
            onPress={() => setSearchTimeModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`${t("inPersonScreen:shortTimeLabel")}, ${searchTimeLabel}`}
          >
            <Text style={themed($selectorLabel)}>{t("inPersonScreen:shortTimeLabel")}</Text>
            <View style={$selectorValueRow}>
              <Text style={themed($selectorValue)} numberOfLines={1}>
                {searchTimeLabel}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Start/End only exist under the Custom time choice. They used to be a
            permanent row; folding them behind Custom is what freed the space
            the four new cells needed, and a range nobody set is a row nobody
            reads. Picking Custom in the Time modal is what reveals them. */}
        {searchTime === "custom" && (
          <View style={themed($timeRangeRow)}>
            <TouchableOpacity
              style={themed($timeButton)}
              onPress={() => setTimePickerVisible("start")}
              accessibilityRole="button"
              accessibilityLabel={`${t("listingsScreen:startLabel")}, ${formatHour(startHour)}`}
            >
              <Text style={themed($timeButtonLabel)}>{t("listingsScreen:startLabel")}</Text>
              <Text style={themed($timeButtonValue)}>{formatHour(startHour)}</Text>
            </TouchableOpacity>
            <Text style={themed($timeSeparator)}>{t("listingsScreen:toSeparator")}</Text>
            <TouchableOpacity
              style={themed($timeButton)}
              onPress={() => setTimePickerVisible("end")}
              accessibilityRole="button"
              accessibilityLabel={`${t("listingsScreen:endLabel")}, ${formatHour(endHour)}`}
            >
              <Text style={themed($timeButtonLabel)}>{t("listingsScreen:endLabel")}</Text>
              <Text style={themed($timeButtonValue)}>{formatHour(endHour)}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Location banner — same slim, tappable strip the In-Person segment
            uses, in the same place (below the filters, above the count) and
            with the same copy, because it reports the same fact about the same
            toggle. ADDED 2026-08-12: without it, turning location off silently
            dropped the In-Person venue option and left the user with no
            explanation and no route back — the option just wasn't there any
            more. Shown whenever the toggle is off, not only right after the
            coercion above: by then the venue reads "Online" and nothing else
            on screen says why in-person is unavailable. */}
        {locationDisabled && (
          <TouchableOpacity
            style={themed($banner)}
            onPress={handleBannerPress}
            accessibilityRole="button"
            accessibilityLabel={t("location:emptyNeedsLocation")}
            accessibilityHint={t("accessibility:doubleTapToAllowLocation")}
          >
            <Ionicons name="location-outline" size={14} color={BANNER_ACCENT} />
            <Text style={themed($bannerText)}>{t("location:emptyNeedsLocation")}</Text>
          </TouchableOpacity>
        )}

        {/* Meeting Count */}
        {filteredMeetings.length > 0 && (
          <View style={themed($countContainer)}>
            <Text style={themed($countText)}>
              {t("listingsScreen:meetingCount", { count: filteredMeetings.length })}
            </Text>
          </View>
        )}

        {/* Loading Indicator */}
        {isLoading && meetings.length === 0 && (
          <View style={themed($loadingContainer)}>
            <ActivityIndicator size="large" color={theme.colors.tint} />
          </View>
        )}
      </View>
    ),
    [
      themed,
      t,
      theme.colors.tint,
      theme.colors.textDim,
      profileStore.fellowship,
      selectedDayLabel,
      selectedLanguage,
      startHour,
      endHour,
      formatHour,
      filteredMeetings.length,
      isLoading,
      meetings.length,
      venueLabel,
      searchTime,
      searchTimeLabel,
      radiusActive,
      // Load-bearing: without it the radius cell keeps its dimmed "no location"
      // styling after a fix lands, because the header wouldn't re-render.
      radiusApplied,
      // Same reason, for the cell's value column: it reads "Location off" until
      // a fix lands and must switch back to the distance when one does.
      needsLocation,
      radiusLabel,
      handleOpenRadiusModal,
      // Load-bearing for the same reason as `needsLocation` above: the banner
      // has to appear and disappear as the Settings toggle changes, and the
      // header is memoized.
      locationDisabled,
      handleBannerPress,
    ],
  )

  return (
    <View style={$screenContainer}>
      {/* Meetings List - full page scroll with filters in header */}
      <FlatList
        ref={listRef}
        data={filteredMeetings}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeaderComponent}
        ItemSeparatorComponent={ItemSeparatorComponent}
        ListEmptyComponent={!isLoading ? ListEmptyComponent : null}
        contentContainerStyle={themed($listContent)}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && filteredMeetings.length > 0}
            onRefresh={fetchDailySchedules}
            tintColor={theme.colors.tint}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Day Selector Modal */}
      <DaySelectorModal
        visible={dayModalVisible}
        selectedDay={selectedDay}
        onSelect={(day) => {
          setSelectedDay(day)
          trackEvent("listings_day_changed", { day })
        }}
        onClose={() => setDayModalVisible(false)}
      />

      {/* Language Selector Modal */}
      <Modal
        visible={languageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLanguageModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setLanguageModalVisible(false)}>
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>{t("listingsScreen:selectLanguage")}</Text>
            <ScrollView bounces={false}>
              {/* All option */}
              <TouchableOpacity
                style={[themed($modalOption), !selectedLanguage && themed($modalOptionSelected)]}
                onPress={() => {
                  setSelectedLanguage(null)
                  trackEvent("listings_language_changed", { language: "all" })
                  setLanguageModalVisible(false)
                  listRef.current?.scrollToOffset({ offset: 0, animated: true })
                }}
              >
                <Text
                  style={[
                    themed($modalOptionText),
                    !selectedLanguage && themed($modalOptionTextSelected),
                  ]}
                >
                  {t("listingsScreen:allLanguages")}
                </Text>
                {!selectedLanguage && (
                  <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                )}
              </TouchableOpacity>
              {/* Language options */}
              {availableLanguages.map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[
                    themed($modalOption),
                    selectedLanguage === lang && themed($modalOptionSelected),
                  ]}
                  onPress={() => {
                    setSelectedLanguage(lang)
                    trackEvent("listings_language_changed", { language: lang })
                    setLanguageModalVisible(false)
                    listRef.current?.scrollToOffset({ offset: 0, animated: true })
                  }}
                >
                  <Text
                    style={[
                      themed($modalOptionText),
                      selectedLanguage === lang && themed($modalOptionTextSelected),
                    ]}
                  >
                    {getLanguageDisplayName(lang)}
                  </Text>
                  {selectedLanguage === lang && (
                    <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Fellowship Selector Modal */}
      <Modal
        visible={fellowshipModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFellowshipModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setFellowshipModalVisible(false)}>
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>{t("settingsScreen:selectFellowship")}</Text>
            <ScrollView bounces={false}>
              {SELECTABLE_FELLOWSHIPS.map((f) => (
                <TouchableOpacity
                  key={f.value}
                  style={[
                    themed($modalOption),
                    profileStore.fellowship === f.value && themed($modalOptionSelected),
                  ]}
                  onPress={() => {
                    profileStore.setFellowship(f.value)
                    trackEvent("listings_fellowship_changed", { fellowship: f.value })
                    setFellowshipModalVisible(false)
                  }}
                >
                  <Text
                    style={[
                      themed($modalOptionText),
                      profileStore.fellowship === f.value && themed($modalOptionTextSelected),
                    ]}
                  >
                    {f.label}
                  </Text>
                  {profileStore.fellowship === f.value && (
                    <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Venue Selector Modal */}
      <Modal
        visible={venueModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVenueModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setVenueModalVisible(false)}>
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>{t("listingsScreen:venueLabel")}</Text>
            {/* `venueOptions`, not VENUE_OPTIONS: In-Person is off the menu
                while the Location toggle is off — see `locationDisabled`. */}
            {venueOptions.map((option) => {
              const isSelected = option === venue
              return (
                <TouchableOpacity
                  key={option}
                  style={[themed($modalOption), isSelected && themed($modalOptionSelected)]}
                  onPress={() => {
                    setVenue(option)
                    trackEvent("listings_venue_changed", { venue: option })
                    setVenueModalVisible(false)
                    listRef.current?.scrollToOffset({ offset: 0, animated: true })
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      themed($modalOptionText),
                      isSelected && themed($modalOptionTextSelected),
                    ]}
                  >
                    {t(VENUE_TX[option])}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={18} color={theme.colors.tint} />}
                </TouchableOpacity>
              )
            })}
          </View>
        </Pressable>
      </Modal>

      {/* Radius Selector Modal — exactly the In-Person segment's options, with
          no "Any": an unbounded distance search isn't a meaningful ask, and two
          pickers for one concept shouldn't offer different things. */}
      <Modal
        visible={radiusModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRadiusModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setRadiusModalVisible(false)}>
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>{t("inPersonScreen:selectRadius")}</Text>
            {/* Shown only while the radius can't actually bite. Without it a
                user who declined location picks distance after distance and
                watches the same list come back, with nothing explaining why. */}
            {!radiusApplied && (
              <Text style={themed($modalNote)}>{t("listingsScreen:radiusNoLocation")}</Text>
            )}
            {RADIUS_OPTIONS_KM.map((km) => {
              const isSelected = km === radiusKm
              // formatDistance takes meters; RADIUS_OPTIONS_KM is kilometers.
              const label = formatDistance(km * 1000, useMiles)
              return (
                <TouchableOpacity
                  key={km}
                  style={[themed($modalOption), isSelected && themed($modalOptionSelected)]}
                  onPress={() => {
                    void handleRadiusSelect(km)
                    setRadiusModalVisible(false)
                    listRef.current?.scrollToOffset({ offset: 0, animated: true })
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      themed($modalOptionText),
                      isSelected && themed($modalOptionTextSelected),
                    ]}
                  >
                    {label}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={18} color={theme.colors.tint} />}
                </TouchableOpacity>
              )
            })}
          </View>
        </Pressable>
      </Modal>

      {/* Time Selector Modal — the four In-Person buckets plus Custom, which
          reveals the Start/End row in the header rather than opening anything
          itself. */}
      <Modal
        visible={searchTimeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSearchTimeModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setSearchTimeModalVisible(false)}>
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>{t("inPersonScreen:shortTimeLabel")}</Text>
            {SEARCH_TIME_OPTIONS.map((option) => {
              const isSelected = option === searchTime
              return (
                <TouchableOpacity
                  key={option}
                  style={[themed($modalOption), isSelected && themed($modalOptionSelected)]}
                  onPress={() => {
                    setSearchTime(option)
                    trackEvent("listings_time_changed", { time: option })
                    setSearchTimeModalVisible(false)
                    listRef.current?.scrollToOffset({ offset: 0, animated: true })
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      themed($modalOptionText),
                      isSelected && themed($modalOptionTextSelected),
                    ]}
                  >
                    {t(SEARCH_TIME_TX[option])}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={18} color={theme.colors.tint} />}
                </TouchableOpacity>
              )
            })}
          </View>
        </Pressable>
      </Modal>

      {/* Time Picker Modal */}
      <Modal
        visible={timePickerVisible !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setTimePickerVisible(null)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setTimePickerVisible(null)}>
          <View style={themed($timePickerContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>
              {timePickerVisible === "start"
                ? t("listingsScreen:startTime")
                : t("listingsScreen:endTime")}
            </Text>
            <FlatList
              data={getPickerHours()}
              keyExtractor={(item) => item.toString()}
              initialScrollIndex={Math.max(0, getCurrentHour() - 2)}
              getItemLayout={(_, index) => ({ length: 44, offset: 44 * index, index })}
              renderItem={({ item: hour }) => {
                const isSelected =
                  timePickerVisible === "start" ? hour === startHour : hour === endHour
                return (
                  <TouchableOpacity
                    style={[themed($modalOption), isSelected && themed($modalOptionSelected)]}
                    onPress={() => handleTimeSelect(hour)}
                  >
                    <Text
                      style={[
                        themed($modalOptionText),
                        isSelected && themed($modalOptionTextSelected),
                      ]}
                    >
                      {formatHour(hour)}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                    )}
                  </TouchableOpacity>
                )
              }}
              style={$timePickerList}
            />
          </View>
        </Pressable>
      </Modal>

      {/* Popup follows the venue, same reasoning as the row above. SchedulePopup
          is built around joining online — its primary action is a Zoom link an
          in-person meeting doesn't have. Both are rendered rather than one
          switched, so `visible` stays a pure function of the selection and
          neither popup animates out through the other's chrome. */}
      <SchedulePopup
        visible={selectedMeeting !== null && !isInPersonVenue(selectedMeeting.venueType)}
        meeting={selectedMeeting}
        onClose={handleClosePopup}
      />

      <InPersonPopup
        visible={selectedMeeting !== null && isInPersonVenue(selectedMeeting.venueType)}
        meeting={selectedMeeting}
        onClose={handleClosePopup}
      />
    </View>
  )
})

/**
 * ListingsScreen - Shows meeting listings for selected day (standalone screen)
 *
 * Wraps ListingsContent with Screen component for use as a standalone tab.
 * Kept for backwards compatibility and potential deep linking.
 */
export const ListingsScreen: FC<MainTabScreenProps<"Listings">> = observer(
  function ListingsScreen(_props) {
    return (
      <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={$screenContainer}>
        <ListingsContent />
      </Screen>
    )
  },
)

// ============================================================================
// Styles
// ============================================================================

const $screenContainer: ViewStyle = {
  flex: 1,
}

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: spacing.md,
  paddingTop: spacing.md,
  paddingBottom: spacing.sm,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
})

// REMOVED 2026-08-04: $fellowshipSelector / $fellowshipLabel. Fellowship had
// its own full-width row; it's a half-width grid cell now and reuses
// $selectorButton / $selectorLabel, which were already identical apart from
// the missing `flex: 1`.

const $selectorRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "stretch",
  marginHorizontal: spacing.md,
  marginVertical: spacing.sm,
  gap: spacing.sm,
})

const $selectorButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderRadius: 8,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
})

const $selectorLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})

const $selectorValueRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  // Lets a long value ellipsize inside its cell instead of pushing the
  // chevron off the edge. Needed since these went half-width (2026-08-04).
  flexShrink: 1,
}

const $selectorValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.tint,
  flexShrink: 1,
})

// Radius when Venue is Online: dimmed rather than removed, so the filter's
// existence (and the reason it can't apply) stays visible. Opacity alone would
// also fade the label; recolouring only the value keeps the label legible.
const $selectorButtonDisabled: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.background,
  borderColor: colors.border,
})

const $selectorValueDisabled: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontWeight: "400",
})

// Time range styles
const $timeRangeRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
  gap: spacing.sm,
})

const $timeButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  alignItems: "center",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.xs,
  borderRadius: 8,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
  minWidth: 80,
})

const $timeButtonLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 11,
  color: colors.textDim,
  marginBottom: 2,
})

const $timeButtonValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.tint,
})

const $timeSeparator: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})

const $timePickerContent: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 12,
  padding: spacing.md,
  minWidth: 200,
  maxHeight: 400,
})

const $timePickerList: ViewStyle = {
  maxHeight: 300,
}

// Modal styles
const $modalOverlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.5)",
  justifyContent: "center",
  alignItems: "center",
})

const $modalContent: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 12,
  padding: spacing.md,
  minWidth: 200,
  maxWidth: "80%",
  maxHeight: "70%",
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 18,
  fontWeight: "700",
  color: colors.text,
  marginBottom: spacing.md,
  textAlign: "center",
})

const $modalOption: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.sm,
  borderRadius: 8,
})

// Explanatory line under a modal title (the radius picker's "we don't know
// where you are yet" note). Sits above the options, not inside one.
const $modalNote: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 12,
  color: colors.textDim,
  textAlign: "center",
  marginTop: -spacing.sm,
  marginBottom: spacing.sm,
})

const $modalOptionSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
})

const $modalOptionText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})

const $modalOptionTextSelected: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontWeight: "600",
})

/* Location banner — deliberately a copy of the In-Person segment's $banner /
   $bannerText (same accent, same metrics, same marginHorizontal as
   $selectorRow above so it lines up with the filter cells). Not imported:
   InPersonScreen doesn't export its styles, and the two screens' style blocks
   are independent by convention. If you restyle one banner, restyle both. */
const $banner: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xs,
  borderRadius: 8,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: BANNER_ACCENT,
})

const $bannerText: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 12,
  color: colors.textDim,
})

const $countContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.sm,
})

const $countText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $listContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.xl,
  flexGrow: 1,
})

const $separator: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 1,
  backgroundColor: colors.border,
  opacity: 0.5,
})

const $emptyContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})

const $emptyText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 16,
  textAlign: "center",
})

const $errorText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.error,
  fontSize: 16,
  textAlign: "center",
})

const $loadingContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})
