import { FC, useCallback, useState, useMemo, useEffect } from "react"
import { ViewStyle, FlatList, RefreshControl, View, TextStyle } from "react-native"
import { observer } from "mobx-react-lite"

import { LiveMeetingRow } from "@/components/LiveMeetingRow"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useMeetings, type MeetingWithTrex } from "@/context/MeetingContext"
import { feedbackRepo, useDatabaseReady, type FeedbackRecord } from "@/db"
import { useLivePolling } from "@/hooks/useLivePolling"
import { useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * Get sort priority based on rating
 * 4-5 stars = 1 (top), 3 stars = 2 (middle), 0-2 stars = 3 (bottom)
 */
function getRatingPriority(rating: number): number {
  if (rating >= 4) return 1
  if (rating === 3) return 2
  return 3
}

/**
 * LiveScreen - Shows currently live meetings
 *
 * Displays meetings that are currently in progress, filtered by the user's
 * selected fellowship. Includes auto-refresh and pull-to-refresh support.
 */
export const LiveScreen: FC<MainTabScreenProps<"Live">> = observer(function LiveScreen(_props) {
  const { themed, theme } = useAppTheme()
  const { liveMeetings, isLoading, lastRefresh, refresh } = useMeetings()
  const profileStore = useProfileStore()
  const isDbReady = useDatabaseReady()

  // State for feedback data (keyed by meeting ID)
  const [feedbackMap, setFeedbackMap] = useState<Map<string, FeedbackRecord>>(new Map())

  // Load feedback for all live meetings
  useEffect(() => {
    if (!isDbReady || liveMeetings.length === 0) return

    const loadFeedback = async () => {
      const mids = liveMeetings.map((m) => m.id)
      const result = await feedbackRepo.findByMids(mids)
      if (result.ok && result.value) {
        const map = new Map<string, FeedbackRecord>()
        for (const fb of result.value) {
          map.set(fb.mid, fb)
        }
        setFeedbackMap(map)
      }
    }

    void loadFeedback()
  }, [isDbReady, liveMeetings])

  // Filter meetings by user's selected fellowship
  // If no fellowship set (empty string), show all meetings
  const filteredMeetings = useMemo(() => {
    const userFellowship = profileStore.fellowship
    if (!userFellowship || userFellowship === "") return liveMeetings
    return liveMeetings.filter((m) => m.fellowship === userFellowship)
  }, [liveMeetings, profileStore.fellowship])

  // Sort meetings: favorites first, then by rating (4-5 top, 3 middle, 0-2 bottom)
  const sortedMeetings = useMemo(() => {
    return [...filteredMeetings].sort((a, b) => {
      const fbA = feedbackMap.get(a.id)
      const fbB = feedbackMap.get(b.id)

      // Favorites (loved) always come first
      const lovedA = fbA?.loves ? 1 : 0
      const lovedB = fbB?.loves ? 1 : 0
      if (lovedA !== lovedB) return lovedB - lovedA // Loved first

      // Then sort by rating priority (lower priority number = higher in list)
      const ratingA = fbA?.rates ?? 0
      const ratingB = fbB?.rates ?? 0
      const priorityA = getRatingPriority(ratingA)
      const priorityB = getRatingPriority(ratingB)
      if (priorityA !== priorityB) return priorityA - priorityB

      // If same priority, sort by actual rating (higher first)
      return ratingB - ratingA
    })
  }, [filteredMeetings, feedbackMap])

  // State for schedule popup
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithTrex | null>(null)

  // Auto-refresh at 15-minute marks (:00, :15, :30, :45)
  useLivePolling({
    enabled: true,
    onRefresh: refresh,
  })

  const handleMeetingPress = useCallback((meeting: MeetingWithTrex) => {
    setSelectedMeeting(meeting)
    // TODO: Open SchedulePopup
  }, [])

  const handleClosePopup = useCallback(() => {
    setSelectedMeeting(null)
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: MeetingWithTrex }) => (
      <LiveMeetingRow meeting={item} onPress={() => handleMeetingPress(item)} />
    ),
    [handleMeetingPress]
  )

  const keyExtractor = useCallback((item: MeetingWithTrex) => item.id, [])

  const ListEmptyComponent = useCallback(
    () => (
      <View style={themed($emptyContainer)}>
        <Text preset="subheading" tx="liveScreen:noMeetings" style={themed($emptyText)} />
      </View>
    ),
    [themed]
  )

  const ItemSeparatorComponent = useCallback(
    () => <View style={themed($separator)} />,
    [themed]
  )

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
    [themed, sortedMeetings.length, lastRefresh]
  )

  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={$styles.container}>
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
    </Screen>
  )
})

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
