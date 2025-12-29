/**
 * ListingsScreen
 *
 * Displays meetings for a selected day of week using the daily schedules API.
 * Users can select a day and see all meetings for their fellowship on that day.
 */

import { FC, useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  FlatList,
  RefreshControl,
  View,
  ViewStyle,
  TextStyle,
  Pressable,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
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
import { DateTime } from "@common"

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

    // Refs
    const listRef = useRef<FlatList>(null)

    // State
    const [selectedDay, setSelectedDay] = useState(getCurrentIsoDow)
    const [dayModalVisible, setDayModalVisible] = useState(false)
    const [startHour, setStartHour] = useState(0) // 0-23
    const [endHour, setEndHour] = useState(24) // 1-24 (24 = midnight end)
    const [timePickerVisible, setTimePickerVisible] = useState<"start" | "end" | null>(null)
    const [meetings, setMeetings] = useState<MeetingWithTrex[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Get label for selected day
    const selectedDayLabel = ISO_DAYS.find((d) => d.iso === selectedDay)?.label || ""

    // Format hour for display (e.g., "6am", "12pm", "12am")
    const formatHour = (hour: number): string => {
      if (hour === 0 || hour === 24) return "12am"
      if (hour === 12) return "12pm"
      if (hour < 12) return `${hour}am`
      return `${hour - 12}pm`
    }

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

        // Sort by local time (hour:minute), not UTC millis
        newMeetings.sort((a, b) => {
          const aLocal = DateTime.fromMillis(a.millis).toLocal()
          const bLocal = DateTime.fromMillis(b.millis).toLocal()
          // Compare by hour then minute
          const aMinutes = aLocal.hour * 60 + aLocal.minute
          const bMinutes = bLocal.hour * 60 + bLocal.minute
          return aMinutes - bMinutes
        })

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

    // Filter meetings by time range
    const filteredMeetings = useMemo(() => {
      return meetings.filter((m) => {
        const localHour = DateTime.fromMillis(m.millis).toLocal().hour
        return localHour >= startHour && localHour < endHour
      })
    }, [meetings, startHour, endHour])

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

        {/* Day Selector Button */}
        <TouchableOpacity
          style={themed($daySelectorButton)}
          onPress={() => setDayModalVisible(true)}
        >
          <Text style={themed($daySelectorButtonText)}>{selectedDayLabel}</Text>
          <Ionicons name="chevron-down" size={18} color={theme.colors.tint} />
        </TouchableOpacity>

        {/* Day Selector Modal */}
        <Modal
          visible={dayModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setDayModalVisible(false)}
        >
          <Pressable style={themed($modalOverlay)} onPress={() => setDayModalVisible(false)}>
            <View style={themed($modalContent)}>
              <Text style={themed($modalTitle)}>Select Day</Text>
              {ISO_DAYS.map((day) => (
                <TouchableOpacity
                  key={day.iso}
                  style={[
                    themed($modalOption),
                    selectedDay === day.iso && themed($modalOptionSelected),
                  ]}
                  onPress={() => {
                    setSelectedDay(day.iso)
                    setDayModalVisible(false)
                  }}
                >
                  <Text
                    style={[
                      themed($modalOptionText),
                      selectedDay === day.iso && themed($modalOptionTextSelected),
                    ]}
                  >
                    {day.label}
                  </Text>
                  {selectedDay === day.iso && (
                    <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>

        {/* Time Range Buttons */}
        <View style={themed($timeRangeRow)}>
          <TouchableOpacity
            style={themed($timeButton)}
            onPress={() => setTimePickerVisible("start")}
          >
            <Text style={themed($timeButtonLabel)}>Start</Text>
            <Text style={themed($timeButtonValue)}>{formatHour(startHour)}</Text>
          </TouchableOpacity>
          <Text style={themed($timeSeparator)}>to</Text>
          <TouchableOpacity
            style={themed($timeButton)}
            onPress={() => setTimePickerVisible("end")}
          >
            <Text style={themed($timeButtonLabel)}>End</Text>
            <Text style={themed($timeButtonValue)}>{formatHour(endHour)}</Text>
          </TouchableOpacity>
        </View>

        {/* Time Picker Modal */}
        <Modal
          visible={timePickerVisible !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setTimePickerVisible(null)}
        >
          <Pressable style={themed($modalOverlay)} onPress={() => setTimePickerVisible(null)}>
            <View style={themed($timePickerContent)}>
              <Text style={themed($modalTitle)}>
                {timePickerVisible === "start" ? "Start Time" : "End Time"}
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

        {/* Meetings List */}
        <FlatList
          ref={listRef}
          data={filteredMeetings}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
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

const $daySelectorButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
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

const $daySelectorButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.text,
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
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 18,
  fontWeight: "700",
  color: colors.text,
  marginBottom: spacing.md,
  textAlign: "center",
})

const $modalOption: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
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
