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
import { Fellowship } from "@recoverysky-org/common/browser"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { LiveMeetingRow } from "@/components/LiveMeetingRow"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useMeetings, type MeetingWithTrex } from "@/context/MeetingContext"
import { feedbackCache, liveEvents, type FeedbackRecord } from "@/db"
import { useLivePolling } from "@/hooks/useLivePolling"
import { useReminderLookup, meetingHasReminder } from "@/hooks/useReminders"
import { useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import {
  navigate,
  peekPendingMeetingId,
  consumePendingMeetingId,
  usePendingMeetingId,
} from "@/navigators/navigationUtilities"
import { api } from "@/services/api"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "LiveScreen" })

/** Fellowships available for filtering */
const SELECTABLE_FELLOWSHIPS = [
  { value: Fellowship.AA, label: "AA" },
  { value: Fellowship.NA, label: "NA" },
  { value: Fellowship.RD, label: "RD" },
] as const

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

export const LiveContent: FC<LiveContentProps> = observer(function LiveContent({ meetingId }) {
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
  const sortedMeetings = useMemo(() => {
    return [...filteredMeetings].sort((a, b) => {
      const fbA = a.feedback
      const fbB = b.feedback

      const lovedA = fbA?.loves ?? false
      const lovedB = fbB?.loves ?? false
      const ratingA = fbA?.rates ?? 0
      const ratingB = fbB?.rates ?? 0
      const hasFeedbackA = fbA !== null
      const hasFeedbackB = fbB !== null

      // 1) Favorites first, sorted by stars descending
      if (lovedA && !lovedB) return -1
      if (!lovedA && lovedB) return 1
      if (lovedA && lovedB) return ratingB - ratingA

      // 2) Non-favorites with feedback, sorted by stars descending
      if (hasFeedbackA && !hasFeedbackB) return -1
      if (!hasFeedbackA && hasFeedbackB) return 1
      if (hasFeedbackA && hasFeedbackB) return ratingB - ratingA

      // 3) Rest (no feedback) - maintain original order
      return 0
    })
  }, [filteredMeetings])

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
  const pendingMeetingId = usePendingMeetingId()
  const consumedMeetingIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const targetId = peekPendingMeetingId()
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

    // Slow path: fetch schedule data from API (meeting may not be live)
    api
      .getScheduleByMeetingId(targetId)
      .then((result) => {
        if (result.kind === "ok") {
          const s = result.schedule
          const meetingWithTrex: MeetingWithTrex = {
            ...s.meeting,
            password: s.password || s.meeting.password || "",
            passwordEnc: s.passwordEnc || s.meeting.passwordEnc || "",
            feedback: feedbackCache.get(s.meeting.id),
            sid: s.sid,
            millis: s.millis,
            duration_ms: s.duration_ms ?? 0,
            scheduleData: s.data,
          }
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
        <LiveMeetingRow
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
      <View style={themed($header)}>
        <Text preset="heading" tx="liveScreen:title" />
        <TouchableOpacity
          onPress={() => navigate("Settings" as never, { section: "profile" } as never)}
          hitSlop={8}
        >
          <Ionicons name="settings-outline" size={22} color={theme.colors.textDim} />
        </TouchableOpacity>
      </View>

      {/* Fellowship Selector - single line */}
      <TouchableOpacity
        style={themed($selectorButton)}
        onPress={() => setFellowshipModalVisible(true)}
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
          <View style={themed($modalContent)}>
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
