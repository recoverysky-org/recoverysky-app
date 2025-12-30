import { FC, useCallback, useState, useMemo, useEffect } from "react"
import { ViewStyle, FlatList, RefreshControl, View, TextStyle } from "react-native"

import { LiveMeetingRow } from "@/components/LiveMeetingRow"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useMeetings, type MeetingWithTrex } from "@/context/MeetingContext"
import { feedbackCache, liveEvents, type FeedbackRecord } from "@/db"
import { useLivePolling } from "@/hooks/useLivePolling"
import { useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * LiveContent - Core content for live meetings display
 *
 * Extracted from LiveScreen to allow composition in MeetingsScreen.
 * Contains all the logic for displaying live meetings with filtering,
 * sorting, and feedback integration.
 */
export const LiveContent: FC = function LiveContent() {
  const { themed, theme } = useAppTheme()
  const { liveMeetings, isLoading, lastRefresh, refresh } = useMeetings()
  const profileStore = useProfileStore()

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

  // Subscribe to live events (e.g., fellowship preference changed)
  useEffect(() => {
    const unsubscribe = liveEvents.subscribe((event) => {
      if (event.type === "preferences_changed" || event.type === "refresh_requested") {
        refresh()
      }
    })
    return unsubscribe
  }, [refresh])

  // Filter meetings by user's selected fellowship
  // If no fellowship set (empty string), show all meetings
  const filteredMeetings = useMemo(() => {
    const userFellowship = profileStore.fellowship
    if (!userFellowship || userFellowship === "") return liveMeetings
    return liveMeetings.filter((m) => m.fellowship === userFellowship)
  }, [liveMeetings, profileStore.fellowship])

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

  // Auto-refresh at 15-minute marks (:00, :15, :30, :45)
  useLivePolling({
    enabled: true,
    onRefresh: refresh,
  })

  const handleMeetingPress = useCallback((meeting: MeetingWithTrex) => {
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
          onPress={() => handleMeetingPress(item)}
        />
      )
    },
    [handleMeetingPress, displayFeedback],
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

  const ListHeaderComponent = useCallback(
    () => (
      <View style={themed($header)}>
        <Text preset="heading" tx="liveScreen:title" />
        {sortedMeetings.length > 0 && (
          <Text style={themed($countText)}>
            {sortedMeetings.length} {sortedMeetings.length === 1 ? "meeting" : "meetings"} live
            {lastRefresh && ` (${lastRefresh.toLocaleTimeString()})`}
          </Text>
        )}
        {sortedMeetings.length === 0 && lastRefresh && (
          <Text style={themed($countText)}>({lastRefresh.toLocaleTimeString()})</Text>
        )}
      </View>
    ),
    [themed, sortedMeetings.length, lastRefresh],
  )

  return (
    <View style={$styles.container}>
      <FlatList
        data={sortedMeetings}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListEmptyComponent={ListEmptyComponent}
        ListHeaderComponent={ListHeaderComponent}
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
}

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
  paddingBottom: spacing.md,
})

const $countText: ThemedStyle<TextStyle> = ({ spacing, colors }) => ({
  marginTop: spacing.xs,
  color: colors.textDim,
})

const $listContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $separator: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 1,
  backgroundColor: colors.border,
  marginLeft: 40, // Align with text, after the badge
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
