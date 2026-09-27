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
import { useMeetingFilters } from "@/context/MeetingFiltersContext"
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
import type { StartsIn } from "@/utils/atNextLogic"
import { sortByFeedback } from "@/utils/feedbackSort"
import { logger } from "@/utils/logger"
import { matchesLanguage } from "@/utils/meetingFiltersLogic"

const log = logger.child({ module: "LiveScreen" })

/**
 * Starts In ships dark until GET /schedules/at_next is deployed (api repo).
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

  const [startsIn, setStartsIn] = useState<StartsIn>("live")
  // Destructured (not held as one `atNext` object) so every effect/callback
  // below can list exactly the fields it reads — the hook returns a new
  // object identity every render, so depending on the whole thing would
  // recreate those callbacks (and trip react-hooks/exhaustive-deps) for no
  // reason. FIXED 2026-09-26 (review round 1, MINOR fold-in).
  const {
    meetings: atNextMeetings,
    isLoading: atNextLoading,
    failed: atNextFailed,
    unavailable: atNextUnavailable,
    blocked: atNextBlocked,
    refresh: refreshAtNext,
  } = useAtNextSchedules(startsInVisible ? startsIn : "live", visible)
  const showStartsIn = startsInVisible && !atNextUnavailable

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
  const prevVisibleRef = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (prevVisibleRef.current === true && !visible) setStartsIn("live")
    prevVisibleRef.current = visible
  }, [visible])

  // Fall back to Live when the endpoint is missing or fetching is blocked.
  useEffect(() => {
    if (atNextUnavailable || atNextBlocked) setStartsIn("live")
  }, [atNextUnavailable, atNextBlocked])

  const handleStartsInSelect = useCallback((value: StartsIn) => {
    setStartsIn(value)
    trackEvent("live_starts_in_changed", { offset: value })
  }, [])

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
  const source = startsIn === "live" ? liveMeetings : atNextMeetings
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
  const sortedMeetings = useMemo(
    () => (startsIn === "live" ? sortByFeedback(filteredMeetings) : filteredMeetings),
    [filteredMeetings, startsIn],
  )

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

  // CHANGED 2026-09-26: the at_next branches come first — a failed minute
  // fetch or an empty countdown window need their own copy, ahead of the
  // language-empty-state and plain-empty fallbacks below.
  // CHANGED 2026-09-26 (review round 1, MINOR fold-in): added the loading
  // branch — without it, the first fetch for a freshly-selected minute option
  // rendered "No meetings starting in the next N minutes" for a beat before
  // any response landed, which reads as a real (if surprising) answer rather
  // than "still checking". A bare spinner, same pattern as ListingsScreen's
  // `isLoading && meetings.length === 0` branch, needs no new i18n string.
  const ListEmptyComponent = useCallback(() => {
    if (startsIn !== "live" && atNextLoading) {
      return (
        <View style={themed($loadingContainer)}>
          <ActivityIndicator size="large" color={theme.colors.tint} />
        </View>
      )
    }
    if (startsIn !== "live" && atNextFailed) {
      return (
        <Pressable
          style={themed($emptyContainer)}
          onPress={() => void refreshAtNext()}
          disabled={atNextLoading}
          accessibilityRole="button"
          accessibilityState={{ disabled: atNextLoading }}
        >
          <Text style={themed($emptyText)}>{t("liveScreen:atNextError")}</Text>
        </Pressable>
      )
    }
    // ADDED 2026-09-26: the list has meetings, just none in the selected
    // language. Say that and offer the clear.
    if (language && fellowshipMeetings.length > 0) {
      return <LanguageEmptyState language={language} onShowAll={() => setLanguage(null)} />
    }
    return (
      <View style={themed($emptyContainer)}>
        <Text preset="subheading" style={themed($emptyText)}>
          {startsIn === "live"
            ? t("liveScreen:noMeetings")
            : t("liveScreen:atNextEmpty", { minutes: startsIn })}
        </Text>
      </View>
    )
  }, [
    themed,
    theme.colors.tint,
    t,
    startsIn,
    atNextLoading,
    atNextFailed,
    refreshAtNext,
    language,
    fellowshipMeetings.length,
    setLanguage,
  ])

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
        <Text preset="heading" tx="liveScreen:title" />
      </View>

      {/* Starts In selector (ADDED 2026-09-26, dev builds only — see
          startsInVisible above). Sits where the old fellowship row used to,
          just below the title header. */}
      {showStartsIn && (
        <View style={themed($startsInRow)}>
          <StartsInPill value={startsIn} disabled={atNextBlocked} onSelect={handleStartsInSelect} />
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
                exposed last-fetch time worth surfacing). Only show it in Live. */}
            {lastRefresh && startsIn === "live" && ` (${lastRefresh.toLocaleTimeString()})`}
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
            refreshing={startsIn === "live" ? isLoading : atNextLoading}
            onRefresh={startsIn === "live" ? refresh : refreshAtNext}
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
          whenever it's mounted — so `true` is the correct constant. */}
      <LiveContent visible />
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

const $emptyContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})

// Same shape as ListingsScreen's loading indicator (its `isLoading &&
// meetings.length === 0` branch) — reused rather than inventing a second
// "still loading" idiom for the same tab group.
const $loadingContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})

const $emptyText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  textAlign: "center",
})
