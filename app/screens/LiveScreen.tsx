import { FC, useCallback, useState, useMemo } from "react"
import { ViewStyle, FlatList, RefreshControl, View, TextStyle } from "react-native"
import { observer } from "mobx-react-lite"

import { LiveMeetingRow } from "@/components/LiveMeetingRow"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useMeetings, type MeetingWithTrex } from "@/context/MeetingContext"
import { useLivePolling } from "@/hooks/useLivePolling"
import { useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

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

  // Filter meetings by user's selected fellowship
  // If no fellowship set (empty string), show all meetings
  const filteredMeetings = useMemo(() => {
    const userFellowship = profileStore.fellowship
    if (!userFellowship || userFellowship === "") return liveMeetings
    return liveMeetings.filter((m) => m.fellowship === userFellowship)
  }, [liveMeetings, profileStore.fellowship])

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
        {filteredMeetings.length > 0 && (
          <Text style={themed($countText)}>
            {filteredMeetings.length} {filteredMeetings.length === 1 ? "meeting" : "meetings"} live
            {lastRefresh && ` (${lastRefresh.toLocaleTimeString()})`}
          </Text>
        )}
        {filteredMeetings.length === 0 && lastRefresh && (
          <Text style={themed($countText)}>({lastRefresh.toLocaleTimeString()})</Text>
        )}
      </View>
    ),
    [themed, filteredMeetings.length, lastRefresh]
  )

  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={$styles.container}>
      <FlatList
        data={filteredMeetings}
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
