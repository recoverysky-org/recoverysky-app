/**
 * ListingsScreen
 *
 * Displays meetings for a selected day of week using the daily schedules API.
 * Users can select a day and see all meetings for their fellowship on that day.
 */

import { FC, useState, useEffect, useCallback } from "react"
import {
  FlatList,
  RefreshControl,
  View,
  ViewStyle,
  TextStyle,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { LiveMeetingRow } from "@/components/LiveMeetingRow"
import { MeetingWithTrex } from "@/context/MeetingContext"
import { useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { api, LiveSchedule } from "@/services/api"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ListingsScreen" })

// ISO day of week: 1=Monday, 7=Sunday
const ISO_DAYS = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
]

// Get current ISO day of week (1=Monday, 7=Sunday)
const getCurrentIsoDow = (): number => {
  const jsDay = new Date().getDay() // 0=Sun, 6=Sat
  return jsDay === 0 ? 7 : jsDay // Convert to ISO (1-7)
}

export const ListingsScreen: FC<MainTabScreenProps<"Listings">> = observer(
  function ListingsScreen(_props) {
    const { t } = useTranslation()
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()

    // State
    const [selectedDay, setSelectedDay] = useState(getCurrentIsoDow)
    const [meetings, setMeetings] = useState<MeetingWithTrex[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Fetch daily schedules
    const fetchDailySchedules = useCallback(async () => {
      const fellowship = profileStore.fellowship
      if (!fellowship) {
        setMeetings([])
        setError(null)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const result = await api.getDailySchedules(selectedDay, fellowship)

        if (result.kind !== "ok") {
          log.error("API getDailySchedules failed", { kind: result.kind })
          setError(`Error: ${result.kind}`)
          setMeetings([])
          return
        }

        // Convert LiveSchedule to MeetingWithTrex
        const newMeetings: MeetingWithTrex[] = result.schedules.map((s: LiveSchedule) => ({
          ...s.meeting,
          feedback: null,
          millis: s.millis,
          scheduleData: s.data,
        }))

        // Sort by time
        newMeetings.sort((a, b) => a.millis - b.millis)

        setMeetings(newMeetings)
        log.debug("Loaded daily schedules", { count: newMeetings.length, day: selectedDay })
      } catch (err) {
        log.error("Exception fetching daily schedules", { error: String(err) })
        setError("Failed to load schedules")
        setMeetings([])
      } finally {
        setIsLoading(false)
      }
    }, [selectedDay, profileStore.fellowship])

    // Fetch when day or fellowship changes
    useEffect(() => {
      fetchDailySchedules()
    }, [fetchDailySchedules])

    const renderItem = useCallback(
      ({ item }: { item: MeetingWithTrex }) => (
        <LiveMeetingRow
          meeting={item}
          rating={item.feedback?.rates ?? 0}
          isFavorite={item.feedback?.loves ?? false}
        />
      ),
      [],
    )

    const keyExtractor = useCallback((item: MeetingWithTrex) => item.id, [])

    const ItemSeparatorComponent = useCallback(
      () => <View style={themed($separator)} />,
      [themed],
    )

    const ListEmptyComponent = useCallback(
      () => (
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
      [themed, t, profileStore.fellowship, error],
    )

    return (
      <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={$screenContainer}>
        {/* Header */}
        <View style={themed($header)}>
          <Text preset="heading" style={themed($title)}>
            {t("listingsScreen:title")}
          </Text>
          {profileStore.fellowship && (
            <Text style={themed($subtitle)}>{profileStore.fellowship}</Text>
          )}
        </View>

        {/* Day Selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={themed($daySelectorContent)}
          style={$daySelector}
        >
          {ISO_DAYS.map((day) => (
            <Pressable
              key={day.iso}
              style={[
                themed($dayPill),
                selectedDay === day.iso && themed($dayPillSelected),
              ]}
              onPress={() => setSelectedDay(day.iso)}
            >
              <Text
                style={[
                  themed($dayPillText),
                  selectedDay === day.iso && themed($dayPillTextSelected),
                ]}
              >
                {day.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Meeting Count */}
        {meetings.length > 0 && (
          <View style={themed($countContainer)}>
            <Text style={themed($countText)}>
              {t("listingsScreen:meetingCount", { count: meetings.length })}
            </Text>
          </View>
        )}

        {/* Loading Indicator */}
        {isLoading && meetings.length === 0 && (
          <View style={themed($loadingContainer)}>
            <ActivityIndicator size="large" color={theme.colors.tint} />
          </View>
        )}

        {/* Meetings List */}
        <FlatList
          data={meetings}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={ItemSeparatorComponent}
          ListEmptyComponent={!isLoading ? ListEmptyComponent : null}
          contentContainerStyle={themed($listContent)}
          refreshControl={
            <RefreshControl
              refreshing={isLoading && meetings.length > 0}
              onRefresh={fetchDailySchedules}
              tintColor={theme.colors.tint}
            />
          }
          showsVerticalScrollIndicator={false}
        />
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
  paddingHorizontal: spacing.md,
  paddingTop: spacing.md,
  paddingBottom: spacing.sm,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.tint,
  fontSize: 14,
  fontWeight: "600",
  marginTop: spacing.xs,
})

const $daySelector: ViewStyle = {
  flexGrow: 0,
}

const $daySelectorContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  gap: spacing.sm,
})

const $dayPill: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderRadius: 20,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: colors.border,
})

const $dayPillSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint,
  borderColor: colors.tint,
})

const $dayPillText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  fontWeight: "600",
  color: colors.text,
})

const $dayPillTextSelected: ThemedStyle<TextStyle> = () => ({
  color: "#FFFFFF",
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
