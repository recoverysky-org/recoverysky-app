import { FC, useCallback, useState, useMemo, useEffect, useRef } from "react"
import {
  ViewStyle,
  FlatList,
  RefreshControl,
  View,
  TextStyle,
  TouchableOpacity,
  Modal,
  Pressable,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { MeetingRow } from "@/components/MeetingRow"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useMeetings, toMeetingWithTrex, type MeetingWithTrex } from "@/context/MeetingContext"
import { isInPersonVenue } from "@/context/meetingPools"
import { feedbackCache, liveEvents, type FeedbackRecord } from "@/db"
import { useLivePolling } from "@/hooks/useLivePolling"
import { useReminderLookup, meetingHasReminder } from "@/hooks/useReminders"
import { useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import {
  peekPendingMeetingId,
  consumePendingMeetingId,
  usePendingMeetingId,
} from "@/navigators/navigationUtilities"
import { api } from "@/services/api"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import { sortByFeedback } from "@/utils/feedbackSort"
import { ACTIVE_FELLOWSHIPS } from "@/utils/fellowships"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "LiveScreen" })

/**
 * Fellowships available for filtering — driven by EXPO_PUBLIC_FELLOWSHIPS
 * via ACTIVE_FELLOWSHIPS (single source of truth across all four pickers).
 * Label is the short code itself (e.g. "AA").
 */
const SELECTABLE_FELLOWSHIPS = ACTIVE_FELLOWSHIPS.map((value) => ({ value, label: value }))

/**
 * LiveContent - Core content for live meetings display
 *
 * Extracted from LiveScreen to allow composition in MeetingsScreen.
 * Contains all the logic for displaying live meetings with filtering,
 * sorting, and feedback integration.
 */
interface LiveContentProps {
  meetingId?: string
}

// `meetingId` is still passed by MeetingsScreen but is no longer read here —
// deep-link target now flows through a module-level var (see app.tsx). Kept on
// the props for call-site compatibility; prefixed `_` to mark it unused.
export const LiveContent: FC<LiveContentProps> = observer(function LiveContent({
  meetingId: _meetingId,
}) {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const { liveMeetings, isLoading, lastRefresh, refresh } = useMeetings()
  const profileStore = useProfileStore()
  const reminderLookup = useReminderLookup()

  // Log mount/unmount
  useEffect(() => {
    log.info("LiveContent mounted", {
      liveMeetingsCount: liveMeetings.length,
      fellowship: profileStore.fellowship || "all",
    })
    return () => log.debug("LiveContent unmounted")
    // Mount-only logger — deps intentionally empty so it fires once on mount,
    // not on every fellowship/liveMeetings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fellowship filter — local state, defaults from saved preference but doesn't write back
  const [filterFellowship, setFilterFellowship] = useState(profileStore.fellowship)
  const [fellowshipModalVisible, setFellowshipModalVisible] = useState(false)

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
  useEffect(() => {
    const unsubscribe = liveEvents.subscribe((event) => {
      if (event.type === "preferences_changed") {
        setFilterFellowship(profileStore.fellowship)
        refresh()
      } else if (event.type === "refresh_requested") {
        refresh()
      }
    })
    return unsubscribe
  }, [refresh, profileStore.fellowship])

  // Filter meetings by local fellowship filter (not the saved preference)
  const filteredMeetings = useMemo(() => {
    if (!filterFellowship || filterFellowship === "") return liveMeetings
    return liveMeetings.filter((m) => m.fellowship === filterFellowship)
  }, [liveMeetings, filterFellowship])

  // Sort meetings: 1) favorites by stars, 2) rated non-favorites, 3) rest
  // Uses meeting.feedback which is a snapshot from when meetings were loaded,
  // so sorting only changes on refresh, not when user interacts
  // CHANGED 2026-08-04: the comparator moved to the pure `sortByFeedback` and
  // this screen now calls it. Behavior is identical — it was lifted verbatim —
  // but the In-Person and Search segments needed the same ordering, and three
  // hand-written copies of a three-tier comparator would have drifted on the
  // first edit. The tier semantics are documented (and vitest-covered) there.
  const sortedMeetings = useMemo(() => sortByFeedback(filteredMeetings), [filteredMeetings])

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

  const ListEmptyComponent = useCallback(
    () => (
      <View style={themed($emptyContainer)}>
        <Text preset="subheading" tx="liveScreen:noMeetings" style={themed($emptyText)} />
      </View>
    ),
    [themed],
  )

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

      {/* Fellowship Selector - single line */}
      <TouchableOpacity
        style={themed($selectorButton)}
        onPress={() => setFellowshipModalVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t("settingsScreen:recoveryFellowship")}, ${filterFellowship || t("liveScreen:defaultFellowship")}`}
      >
        <Text style={themed($selectorLabel)}>{t("settingsScreen:recoveryFellowship")}</Text>
        <View style={$selectorValueRow}>
          <Text style={themed($selectorValue)}>
            {filterFellowship || t("liveScreen:defaultFellowship")}
          </Text>
          <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
        </View>
      </TouchableOpacity>

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
            {SELECTABLE_FELLOWSHIPS.map((f) => (
              <TouchableOpacity
                key={f.value}
                style={[
                  themed($modalOption),
                  filterFellowship === f.value && themed($modalOptionSelected),
                ]}
                onPress={() => {
                  log.info("Fellowship filter changed", {
                    from: filterFellowship,
                    to: f.value,
                  })
                  setFilterFellowship(f.value)
                  setFellowshipModalVisible(false)
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: filterFellowship === f.value }}
                accessibilityLabel={f.label}
              >
                <Text
                  style={[
                    themed($modalOptionText),
                    filterFellowship === f.value && themed($modalOptionTextSelected),
                  ]}
                >
                  {f.label}
                </Text>
                {filterFellowship === f.value && (
                  <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Meeting Count - matches Listings style */}
      {sortedMeetings.length > 0 && (
        <View style={themed($countContainer)}>
          <Text style={themed($countText)}>
            {t("liveScreen:meetingCount", { count: sortedMeetings.length })}
            {lastRefresh && ` (${lastRefresh.toLocaleTimeString()})`}
          </Text>
        </View>
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
            refreshing={isLoading}
            onRefresh={refresh}
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
      <LiveContent />
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

// Fellowship selector - single line
const $selectorButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginHorizontal: spacing.md,
  marginVertical: spacing.sm,
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
}

const $selectorValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.tint,
})

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
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xxl,
})

const $emptyText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  textAlign: "center",
})
