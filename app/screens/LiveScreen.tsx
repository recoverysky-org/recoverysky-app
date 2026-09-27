import { FC, useCallback, useState, useMemo, useEffect, useRef } from "react"
import {
  ActivityIndicator,
  Pressable,
  ViewStyle,
  FlatList,
  RefreshControl,
  View,
  TextStyle,
} from "react-native"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { LanguageEmptyState } from "@/components/LanguageEmptyState"
import { MeetingRow } from "@/components/MeetingRow"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { StartsInPill } from "@/components/StartsInPill"
import { Text } from "@/components/Text"
import { useMeetings, toMeetingWithTrex, type MeetingWithTrex } from "@/context/MeetingContext"
import { MeetingFiltersProvider, useMeetingFilters } from "@/context/MeetingFiltersContext"
import { isInPersonVenue } from "@/context/meetingPools"
import { feedbackCache, liveEvents, type FeedbackRecord } from "@/db"
import { useAtNextSchedules } from "@/hooks/useAtNextSchedules"
import { useLivePolling } from "@/hooks/useLivePolling"
import { useReminderLookup, meetingHasReminder } from "@/hooks/useReminders"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import {
  peekPendingMeetingId,
  consumePendingMeetingId,
  usePendingMeetingId,
} from "@/navigators/navigationUtilities"
import { api } from "@/services/api"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import {
  AT_NEXT_OFFSETS,
  availableStartsIn,
  followStartsIn,
  offsetOf,
  type AtNextOffset,
  type StartsIn,
} from "@/utils/atNextLogic"
import { sortByFeedback } from "@/utils/feedbackSort"
import { formatMillisToLocalTime } from "@/utils/formatTime"
import { logger } from "@/utils/logger"
import { matchesLanguage } from "@/utils/meetingFiltersLogic"

const log = logger.child({ module: "LiveScreen" })

/**
 * Starts In ships dark until GET /schedules/at-next is deployed (api repo).
 * CHANGED 2026-09-27: the route exists in the api repo (583b2fa, v1.16.0) and
 * the client now matches its contract; flip once that build is in production.
 * Flip to `true` after the deploy: a JS-only OTA, no runtimeVersion bump.
 * If flipped too early, a 404 hides the selector for the session
 * (useAtNextSchedules → `unavailable`).
 */
const startsInVisible = __DEV__

/**
 * LiveContent - Core content for live meetings display
 *
 * Extracted from LiveScreen to allow composition in MeetingsScreen.
 * Contains all the logic for displaying live meetings with filtering,
 * sorting, and feedback integration.
 */
interface LiveContentProps {
  meetingId?: string
  /** True only while Live is on screen (segment AND Meetings tab focused). Drives the Starts In reset. */
  visible: boolean
}

// `meetingId` is still passed by MeetingsScreen but is no longer read here —
// deep-link target now flows through a module-level var (see app.tsx). Kept on
// the props for call-site compatibility; prefixed `_` to mark it unused.
export const LiveContent: FC<LiveContentProps> = observer(function LiveContent({
  meetingId: _meetingId,
  visible,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const { liveMeetings, isLoading, lastRefresh, refresh } = useMeetings()
  const reminderLookup = useReminderLookup()
  const { fellowship, language, setLanguage, reportMeetings } = useMeetingFilters()

  // CHANGED 2026-09-27: the user's pick is `selectedStartsIn`; `startsIn`
  // (below) is what renders — the pick, unless its chip has emptied.
  const [selectedStartsIn, setSelectedStartsIn] = useState<StartsIn>("live")
  // The quarter-hour mark the minute pick was made for (ADDED 2026-09-27):
  // lets followStartsIn tell "same chip, same meetings" from "the mark moved
  // under the user" after a boundary refetch or a return from background.
  const [pickedAtMs, setPickedAtMs] = useState<number | null>(null)
  // Destructured (not held as one `atNext` object) so every effect/callback
  // below can list exactly the fields it reads — the hook returns a new
  // object identity every render, so depending on the whole thing would
  // recreate those callbacks (and trip react-hooks/exhaustive-deps) for no
  // reason. FIXED 2026-09-26 (review round 1, MINOR fold-in).
  // CHANGED 2026-09-27 (Jenova): the hook prefetches all four offsets while
  // Live is on screen; picking a chip no longer fetches, it chooses a slot.
  const {
    slots: atNextSlots,
    isLoading: atNextLoading,
    failed: atNextFailed,
    unavailable: atNextUnavailable,
    blocked: atNextBlocked,
    refresh: refreshAtNext,
  } = useAtNextSchedules(startsInVisible && visible)

  // Chips only for offsets with meetings the user would actually see — after
  // the shared Fellowship + Lang filters, so a chip never opens onto an empty
  // list (ADDED 2026-09-27). Nothing while blocked or when the route is
  // missing, which hides the whole control.
  const availableStartsInOptions = useMemo(() => {
    if (!startsInVisible || atNextUnavailable || atNextBlocked) return []
    const counts: Partial<Record<AtNextOffset, number>> = {}
    for (const offset of AT_NEXT_OFFSETS) {
      counts[offset] = atNextSlots[offset].meetings.filter(
        (m) => (!fellowship || m.fellowship === fellowship) && matchesLanguage(m, language),
      ).length
    }
    return availableStartsIn(counts)
  }, [atNextSlots, atNextUnavailable, atNextBlocked, fellowship, language])
  const atNextAtByOffset = useMemo(
    () => ({
      15: atNextSlots[15].atMs,
      30: atNextSlots[30].atMs,
      45: atNextSlots[45].atMs,
      60: atNextSlots[60].atMs,
    }),
    [atNextSlots],
  )
  const followed = followStartsIn({
    selected: selectedStartsIn,
    pickedAtMs,
    atByOffset: atNextAtByOffset,
    available: availableStartsInOptions,
  })

  // While a batch is in flight (a return from background, the boundary
  // refetch, a pull-to-refresh) the slots are mid-refresh — possibly cleared
  // as stale — so the pick and the chips hold still and the list shows a
  // spinner, instead of flashing to Live Now and back. ADDED 2026-09-27.
  // State, not a ref read during render (CHANGED 2026-09-27, review): the
  // chips from the last settled render, shown while a batch is in flight.
  const [lastSettledChips, setLastSettledChips] = useState<StartsIn[]>([])
  useEffect(() => {
    if (!atNextLoading) setLastSettledChips(availableStartsInOptions)
  }, [atNextLoading, availableStartsInOptions])
  const chipsToShow = atNextLoading ? lastSettledChips : availableStartsInOptions
  const startsIn = atNextLoading ? selectedStartsIn : followed.startsIn
  const startsInOffset = offsetOf(startsIn)
  const showStartsIn = chipsToShow.length > 0

  // Commit where the pick went once the batch has landed: kept while its chip
  // still answers for the same mark, otherwise moved to the LOWEST visible
  // chip, and Live Now only when no chip is left (atNextLogic.followStartsIn).
  // CHANGED 2026-09-27 (Jenova, later): before the lowest chip it first
  // follows its meetings to the chip that now shows the same mark.
  // CHANGED 2026-09-27 (Jenova): used to drop straight to Live Now whenever
  // the picked chip vanished — including after every return from background,
  // since all slots go stale — and kept "30m" selected while it silently
  // switched from 12:30 to 12:45 at the boundary.
  useEffect(() => {
    if (atNextLoading) return
    if (followed.startsIn !== selectedStartsIn) setSelectedStartsIn(followed.startsIn)
    if (followed.pickedAtMs !== pickedAtMs) setPickedAtMs(followed.pickedAtMs)
  }, [atNextLoading, followed.startsIn, followed.pickedAtMs, selectedStartsIn, pickedAtMs])

  // Reset to Live when Live goes OFF screen, not when it comes back.
  // FIXED 2026-09-26 (review round 1, IMPORTANT): this used to fire on the
  // hidden→visible edge, which is one render too late. `useAtNextSchedules`
  // is called above this effect, and React runs a component's hooks (and the
  // effects that follow from them) top-to-bottom within the same commit — so
  // on a hidden→visible transition, the hook's OWN fetch effect already ran
  // `refresh()` for whatever `startsIn` was left over from the last visit
  // (seq++, isLoading true, a real request sent) before this effect had a
  // chance to reset `startsIn` back to "live". That painted one stale frame
  // (old selection, old rows, old RefreshControl state) and fired a wasted
  // request. Resetting on hide instead means `startsIn` is already "live" —
  // and nothing is fetching, since `visible` is false — for the entire time
  // Live is off screen, so the next show renders "live" from frame one with
  // no request in flight. Still keyed on the edge, never on a store value
  // (CLAUDE.md "The trap, hit twice") — just the other edge.
  // CHANGED 2026-09-27: the hook no longer fetches per selection, so the
  // wasted-request reason above is moot; the hide-edge reset stays because
  // "resets to Live Now on every visit" is still the rule.
  const prevVisibleRef = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (prevVisibleRef.current === true && !visible) {
      setSelectedStartsIn("live")
      setPickedAtMs(null)
    }
    prevVisibleRef.current = visible
  }, [visible])

  const handleStartsInSelect = useCallback(
    (value: StartsIn) => {
      setSelectedStartsIn(value)
      const offset = offsetOf(value)
      // A tap on a held chip mid-batch can't know its mark yet (the slot may
      // be cleared or about to move): null lets followStartsIn adopt the mark
      // the batch lands with instead of overriding the tap. (review, 2026-09-27)
      setPickedAtMs(offset === null || atNextLoading ? null : atNextSlots[offset].atMs)
      trackEvent("live_starts_in_changed", { offset: value })
    },
    [atNextSlots, atNextLoading],
  )

  // Log mount/unmount
  useEffect(() => {
    log.info("LiveContent mounted", {
      liveMeetingsCount: liveMeetings.length,
      fellowship: fellowship || "all",
    })
    return () => log.debug("LiveContent unmounted")
    // Mount-only logger — deps intentionally empty so it fires once on mount,
    // not on every fellowship/liveMeetings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live feedback state for DISPLAY only (not sorting)
  // This updates immediately when user interacts, but doesn't affect sort order
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

  // Subscribe to live events — reset local filter when Settings preference changes
  // CHANGED 2026-09-26: the fellowship reset moved to MeetingFiltersContext,
  // which owns the shared filter for all three segments. This keeps only the
  // refresh.
  useEffect(() => {
    const unsubscribe = liveEvents.subscribe((event) => {
      if (event.type === "preferences_changed" || event.type === "refresh_requested") {
        refresh()
      }
    })
    return unsubscribe
  }, [refresh])

  // Filter meetings by local fellowship filter (not the saved preference)
  // CHANGED 2026-09-26: fellowship and language come from the shared Meetings
  // filter bar (MeetingFiltersContext). Two stages so the bar's language
  // options reflect this fellowship's meetings, not every fellowship's.
  // CHANGED 2026-09-26: source switches to the at_next window's rows when a
  // minute option is selected, so fellowship/language filtering (and the
  // filter bar's language options via reportMeetings) apply to whichever list
  // is actually on screen.
  const source = startsInOffset === null ? liveMeetings : atNextSlots[startsInOffset].meetings
  const fellowshipMeetings = useMemo(
    () => (fellowship ? source.filter((m) => m.fellowship === fellowship) : source),
    [source, fellowship],
  )
  const filteredMeetings = useMemo(
    () => fellowshipMeetings.filter((m) => matchesLanguage(m, language)),
    [fellowshipMeetings, language],
  )

  useEffect(() => {
    reportMeetings("live", fellowshipMeetings)
  }, [reportMeetings, fellowshipMeetings])

  // Sort meetings: 1) favorites by stars, 2) rated non-favorites, 3) rest
  // Uses meeting.feedback which is a snapshot from when meetings were loaded,
  // so sorting only changes on refresh, not when user interacts
  // CHANGED 2026-08-04: the comparator moved to the pure `sortByFeedback` and
  // this screen now calls it. Behavior is identical — it was lifted verbatim —
  // but the In-Person and Search segments needed the same ordering, and three
  // hand-written copies of a three-tier comparator would have drifted on the
  // first edit. The tier semantics are documented (and vitest-covered) there.
  // CHANGED 2026-09-26: at_next rows are already in start order, and feedback
  // ranking would scramble the countdown — only the Live tier applies it.
  // CHANGED 2026-09-27: the deployed at-next returns only meetings starting
  // exactly at one quarter-hour mark (`starts_at=true`), so there is no
  // countdown to preserve — every row shares a start. Feedback ranking applies
  // in both modes again, so favourites lead the Starts In list like Live.
  const sortedMeetings = useMemo(() => sortByFeedback(filteredMeetings), [filteredMeetings])

  // "7:30p" for the mark the at-next answer is for (ADDED 2026-09-27). Null in
  // Live mode and before the first answer, when there is no mark to name.
  const atNextAtMs = startsInOffset === null ? null : atNextSlots[startsInOffset].atMs
  const atNextTimeLabel = atNextAtMs !== null ? formatMillisToLocalTime(atNextAtMs) : null

  // State for schedule popup
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithTrex | null>(null)

  // ---------------------------------------------------------------------------
  // Notification → SchedulePopup auto-open
  //
  // When a push notification carries a meetingId, open the SchedulePopup for
  // that meeting. We read from the module-level pending meetingId store
  // (see navigationUtilities.ts for the full explanation of why route params
  // can't be used here — they race with MeetingsScreen's param-clearing and
  // are lost across the cold-start AppNavigator remount).
  //
  // usePendingMeetingId() subscribes to the store so the effect re-fires on
  // both cold start (mount) and warm start (notification tap while mounted).
  // We peek (not consume) until the popup is actually shown, so a remount
  // mid-API-fetch doesn't lose the meetingId.
  // ---------------------------------------------------------------------------
  // CHANGED 2026-08-03: "live" is now passed explicitly. It is also the
  // default, so behavior is unchanged — but InPersonContent shares this store
  // and is mounted at the same time, so an id addressed to the in-person popup
  // must not be swallowed here. Naming the target at the call site is what
  // makes that guarantee visible.
  const pendingMeetingId = usePendingMeetingId("live")
  const consumedMeetingIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const targetId = peekPendingMeetingId("live")
    if (!targetId || targetId === consumedMeetingIdRef.current) return

    log.debug("Opening schedule popup for meetingId", { meetingId: targetId })

    // Fast path: meeting already in the live meetings context
    const found = liveMeetings.find((m) => m.id === targetId)
    if (found) {
      consumedMeetingIdRef.current = targetId
      consumePendingMeetingId()
      setSelectedMeeting(found)
      return
    }

    // Slow path: fetch schedule data from API (meeting may not be live).
    // CHANGED 2026-08-02: any-venue lookup — the server's venueType param
    // defaults to online and cross-pool lookups 404, but a notification mid
    // may reference an in-person meeting; the wrapper retries in_person on a
    // not-found/bad-data miss.
    api
      .getScheduleByMeetingIdAnyVenue(targetId)
      .then((result) => {
        if (result.kind === "ok") {
          const s = result.schedule
          // CHANGED 2026-08-02 (fix wave, review finding IMPORTANT 3): the
          // any-venue lookup above can resolve to an in_person record, but
          // SchedulePopup has no join URL, no address, and no contacts for
          // one — a dead-end popup. Spec §4 mandates the cross-pool lookup
          // succeed; it does not mandate displaying what it finds. The
          // hold-back (no in-person record visible in any existing UI
          // surface) wins this conflict deliberately — drop the record here
          // rather than show a broken popup, and leave display to the
          // in-person UI piece. Do not "fix" this by removing the guard.
          if (isInPersonVenue(s.meeting.venueType)) {
            log.info("Deep-link meeting resolved to in-person venue; dropping (hold-back)", {
              meetingId: targetId,
            })
            consumedMeetingIdRef.current = targetId
            consumePendingMeetingId()
            return
          }
          const meetingWithTrex = toMeetingWithTrex(s)
          consumedMeetingIdRef.current = targetId
          consumePendingMeetingId()
          setSelectedMeeting(meetingWithTrex)
        } else {
          log.warn("Failed to fetch schedule for meetingId", {
            meetingId: targetId,
            kind: result.kind,
          })
          consumedMeetingIdRef.current = targetId
          consumePendingMeetingId()
        }
      })
      .catch((err) => {
        log.error("Error fetching schedule for meetingId", {
          meetingId: targetId,
          error: String(err),
        })
        consumedMeetingIdRef.current = targetId
        consumePendingMeetingId()
      })
  }, [pendingMeetingId, liveMeetings])

  // Auto-refresh at 15-minute marks (:00, :15, :30, :45)
  useLivePolling({
    enabled: true,
    onRefresh: refresh,
  })

  const handleMeetingPress = useCallback((meeting: MeetingWithTrex) => {
    log.debug("Meeting pressed", { meetingId: meeting.id, name: meeting.name })
    setSelectedMeeting(meeting)
  }, [])

  const handleClosePopup = useCallback(() => {
    setSelectedMeeting(null)
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: MeetingWithTrex }) => {
      // Use displayFeedback for live UI updates (doesn't affect sort order)
      const feedback = displayFeedback.get(item.id)
      return (
        <MeetingRow
          meeting={item}
          rating={feedback?.rates ?? 0}
          isFavorite={feedback?.loves ?? false}
          hasReminder={meetingHasReminder(item, reminderLookup)}
          onPress={() => handleMeetingPress(item)}
        />
      )
    },
    [handleMeetingPress, displayFeedback, reminderLookup],
  )

  const keyExtractor = useCallback((item: MeetingWithTrex) => item.id, [])

  // CHANGED 2026-09-26: the at_next branches came first — a failed minute
  // fetch or an empty countdown window needed their own copy.
  // CHANGED 2026-09-27 (review): those minute-mode branches (spinner, retry,
  // "No meetings starting at …") are gone. A Starts In chip now exists only
  // while its filtered list is non-empty and the pick falls back to Live Now
  // in the same render that list empties, so they could never render. A
  // failure over kept rows still gets the inline retry banner below the count.
  // CHANGED 2026-09-27 (later): one minute-mode branch is back — the spinner.
  // The pick now holds through a batch (see followStartsIn above), and after
  // a return from background its slot can be empty until the batch lands.
  const ListEmptyComponent = useCallback(() => {
    if (startsIn !== "live" && atNextLoading) {
      return (
        <View style={themed($loadingContainer)}>
          <ActivityIndicator size="large" color={theme.colors.tint} />
        </View>
      )
    }
    // ADDED 2026-09-26: the list has meetings, just none in the selected
    // language. Say that and offer the clear.
    if (language && fellowshipMeetings.length > 0) {
      return <LanguageEmptyState language={language} onShowAll={() => setLanguage(null)} />
    }
    return (
      <View style={themed($emptyContainer)}>
        <Text preset="subheading" style={themed($emptyText)} tx="liveScreen:noMeetings" />
      </View>
    )
  }, [
    themed,
    theme.colors.tint,
    startsIn,
    atNextLoading,
    language,
    fellowshipMeetings.length,
    setLanguage,
  ])

  // Pull-to-refresh (ADDED 2026-09-27, review): in Live Now it also refreshes
  // the Starts In batch, so a gesture recovers chips that vanished after a
  // failed batch instead of waiting for the next quarter hour.
  // The pull spinner in minute mode tracks the user's own pull only (CHANGED
  // 2026-09-27, review): driving it from atNextLoading also spun it for every
  // background/boundary batch, on top of the list's own spinner.
  const [atNextPulling, setAtNextPulling] = useState(false)
  useEffect(() => {
    if (!atNextLoading) setAtNextPulling(false)
  }, [atNextLoading])
  const handleRefresh = useCallback(() => {
    if (startsIn === "live") {
      refresh()
      if (startsInVisible) void refreshAtNext()
    } else {
      setAtNextPulling(true)
      // `finally` too: refreshAtNext returns early when blocked/unavailable,
      // and then atNextLoading never flips to clear the spinner above.
      void refreshAtNext().finally(() => setAtNextPulling(false))
    }
  }, [startsIn, refresh, refreshAtNext])

  const ItemSeparatorComponent = useCallback(() => <View style={themed($separator)} />, [themed])

  return (
    <View style={$screenContainer}>
      {/* Header - outside FlatList to match Listings layout */}
      {/* CHANGED 2026-08-12: the settings gear that used to sit at the end of
          this row is gone from all three Meetings segments. It duplicated the
          Settings tab one thumb-width away in the tab bar, and it was spending
          the most valuable real estate on the screen — the end of the title
          row, the only place a segment-specific control can live — on a
          shortcut nobody needed. $header keeps `space-between` so a segment
          that does put a control there (In-Person's map/list toggle) still
          pins it to the right edge. */}
      <View style={themed($header)}>
        {/* CHANGED 2026-09-27 (Jenova): the title follows the Starts In pick —
            "Live Online" for Live Now, "Live in 30m" for a minute chip — now
            that the segment tab itself just says "Online".
            CHANGED 2026-09-27 (Jenova, later): the wording is now "Live Now" /
            "Starts in 30m", matching the chips. */}
        <Text
          preset="heading"
          text={
            startsInOffset === null
              ? t("liveScreen:title")
              : t("liveScreen:titleStartsIn", { minutes: startsInOffset })
          }
        />
      </View>

      {/* Starts In selector (ADDED 2026-09-26, dev builds only — see
          startsInVisible above). Sits where the old fellowship row used to,
          just below the title header.
          CHANGED 2026-09-27: "[Live Now] Starts in [15m|30m|…]", showing only
          the minute chips with meetings; hidden entirely when none have any. */}
      {showStartsIn && (
        <View style={themed($startsInRow)}>
          <StartsInPill value={startsIn} available={chipsToShow} onSelect={handleStartsInSelect} />
        </View>
      )}

      {/* Meeting Count - matches Listings style */}
      {sortedMeetings.length > 0 && (
        <View style={themed($countContainer)}>
          <Text style={themed($countText)}>
            {t("liveScreen:meetingCount", { count: sortedMeetings.length })}
            {/* CHANGED 2026-09-26 (review round 1, MINOR fold-in): `lastRefresh`
                is MeetingContext's Live-pipeline timestamp — showing it next to
                at_next rows implied those rows were as fresh as the last Live
                poll, which isn't true (at_next has its own 5-min cadence and no
                exposed last-fetch time worth surfacing). Only show it in Live.
                CHANGED 2026-09-27: at-next's cadence is now one fetch just
                after each quarter-hour `at`; minute mode shows that mark
                ("starting at 7:30p") on this line instead, below. */}
            {lastRefresh && startsIn === "live" && ` (${lastRefresh.toLocaleTimeString()})`}
            {/* ADDED 2026-09-27: in Starts In mode, name the quarter-hour mark
                the list is for — "30 min" means "starting at the mark after
                next", which the chip alone doesn't say. */}
            {atNextTimeLabel && ` · ${t("liveScreen:startingAt", { time: atNextTimeLabel })}`}
          </Text>
        </View>
      )}

      {/* Inline retry banner (ADDED 2026-09-26, review round 1, IMPORTANT —
          plan-mandated spec: "A failed fetch keeps the last list and surfaces
          an inline 'Couldn't load — tap to retry'"). Only for the non-empty
          case: an empty list gets its own retry copy via ListEmptyComponent
          above, so the two never render at once. */}
      {startsIn !== "live" && atNextFailed && sortedMeetings.length > 0 && (
        <Pressable
          style={themed($retryBanner)}
          onPress={() => void refreshAtNext()}
          disabled={atNextLoading}
          accessibilityRole="button"
          accessibilityLabel={t("liveScreen:atNextError")}
          accessibilityState={{ disabled: atNextLoading }}
        >
          <Text style={themed($retryBannerText)}>{t("liveScreen:atNextError")}</Text>
        </Pressable>
      )}

      <FlatList
        data={sortedMeetings}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListEmptyComponent={ListEmptyComponent}
        ItemSeparatorComponent={ItemSeparatorComponent}
        contentContainerStyle={themed($listContent)}
        refreshControl={
          <RefreshControl
            refreshing={startsIn === "live" ? isLoading : atNextPulling}
            onRefresh={handleRefresh}
            tintColor={theme.colors.text}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      <SchedulePopup
        visible={selectedMeeting !== null}
        meeting={selectedMeeting}
        onClose={handleClosePopup}
      />
    </View>
  )
})

/**
 * LiveScreen - Shows currently live meetings (standalone screen)
 *
 * Wraps LiveContent with Screen component for use as a standalone tab.
 * Kept for backwards compatibility and potential deep linking.
 */
export const LiveScreen: FC<MainTabScreenProps<"Live">> = function LiveScreen(_props) {
  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={$styles.container}>
      {/* CHANGED 2026-09-26: `visible` became required on LiveContentProps
          (drives the Starts In reset). This standalone wrapper has no
          segment/tab-focus concept of its own — it IS the whole screen
          whenever it's mounted — so `true` is the correct constant.
          CHANGED 2026-09-26 (review round 1): LiveContent calls
          useMeetingFilters(), which throws without a MeetingFiltersProvider
          ancestor — MeetingsScreen supplies one, but this standalone wrapper
          didn't. Nothing currently navigates to "Live" (grepped — no
          navigator/barrel reference), so this was a latent crash rather than
          a live one, but wrap it anyway so it isn't a trap for whoever wires
          up a route or deep link to it later. */}
      <MeetingFiltersProvider>
        <LiveContent visible />
      </MeetingFiltersProvider>
    </Screen>
  )
}

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: spacing.md,
  paddingTop: spacing.md,
  paddingBottom: spacing.sm,
})

const $screenContainer: ViewStyle = {
  flex: 1,
}

const $startsInRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.sm,
  alignItems: "flex-start",
})

const $countContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.sm,
})

const $countText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $retryBanner: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  borderRadius: 8,
  backgroundColor: colors.errorBackground,
})

const $retryBannerText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.error,
  fontSize: 13,
  textAlign: "center",
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

// Same shape as ListingsScreen's loading indicator. Re-added 2026-09-27 for
// the minute-mode spinner above.
const $loadingContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})

const $emptyContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})

const $emptyText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  textAlign: "center",
})
