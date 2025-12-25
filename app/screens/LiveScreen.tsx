import { FC, useCallback } from "react"
import { ViewStyle, FlatList, RefreshControl, View, TextStyle } from "react-native"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { MeetingCard } from "@/components/MeetingCard"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import { useMeetings, type MeetingWithTrex } from "@/context/MeetingContext"
import { useLivePolling } from "@/hooks/useLivePolling"

/**
 * LiveScreen - Shows currently live meetings
 *
 * Displays meetings that are currently in progress, with auto-refresh
 * every 30 seconds and pull-to-refresh support.
 */
export const LiveScreen: FC<MainTabScreenProps<"Live">> = function LiveScreen(_props) {
  const { themed, theme } = useAppTheme()
  const { liveMeetings, isLoading, lastRefresh, refresh } = useMeetings()

  // Auto-poll every 30 seconds
  useLivePolling({
    interval: 30000,
    enabled: true,
    onRefresh: refresh,
  })

  const renderItem = useCallback(
    ({ item }: { item: MeetingWithTrex }) => <MeetingCard meeting={item} />,
    []
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

  const ListHeaderComponent = useCallback(
    () => (
      <View style={themed($header)}>
        <Text preset="heading" tx="liveScreen:title" />
        {liveMeetings.length > 0 && (
          <Text style={themed($countText)}>
            {liveMeetings.length} {liveMeetings.length === 1 ? "meeting" : "meetings"} live
          </Text>
        )}
        {lastRefresh && (
          <Text style={themed($refreshText)}>
            Last checked: {lastRefresh.toLocaleTimeString()}
          </Text>
        )}
      </View>
    ),
    [themed, liveMeetings.length, lastRefresh]
  )

  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={$styles.container}>
      <FlatList
        data={liveMeetings}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListEmptyComponent={ListEmptyComponent}
        ListHeaderComponent={ListHeaderComponent}
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

const $refreshText: ThemedStyle<TextStyle> = ({ spacing, colors }) => ({
  marginTop: spacing.xxs,
  fontSize: 12,
  color: colors.textDim,
})

const $listContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.xxl,
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
