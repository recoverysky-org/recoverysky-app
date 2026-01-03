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
import { DateTime, Fellowship } from "@recoverysky-org/common/browser"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { LiveMeetingRow } from "@/components/LiveMeetingRow"
import { SchedulePopup } from "@/components/SchedulePopup"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { MeetingWithTrex } from "@/context/MeetingContext"
import { feedbackCache, type FeedbackRecord } from "@/db"
import { useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { api, LiveSchedule } from "@/services/api"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ListingsScreen" })

// ISO day of week: 1=Monday, 7=Sunday (with translation keys)
const ISO_DAYS = [
  { iso: 1, tx: "listingsScreen:monday" as const },
  { iso: 2, tx: "listingsScreen:tuesday" as const },
  { iso: 3, tx: "listingsScreen:wednesday" as const },
  { iso: 4, tx: "listingsScreen:thursday" as const },
  { iso: 5, tx: "listingsScreen:friday" as const },
  { iso: 6, tx: "listingsScreen:saturday" as const },
  { iso: 7, tx: "listingsScreen:sunday" as const },
]

/** Fellowships available for filtering */
const SELECTABLE_FELLOWSHIPS = [
  { value: Fellowship.AA, label: "AA" },
  { value: Fellowship.NA, label: "NA" },
  { value: Fellowship.CMA, label: "CMA" },
  { value: Fellowship.MA, label: "MA" },
  { value: Fellowship.RD, label: "RD" },
] as const

// Get current ISO day of week (1=Monday, 7=Sunday)
const getCurrentIsoDow = (): number => {
  const jsDay = new Date().getDay() // 0=Sun, 6=Sat
  return jsDay === 0 ? 7 : jsDay // Convert to ISO (1-7)
}

/**
 * ListingsContent - Core content for meeting listings display
 *
 * Extracted from ListingsScreen to allow composition in MeetingsScreen.
 * Contains all the logic for displaying scheduled meetings with filtering.
 */
export const ListingsContent: FC = observer(function ListingsContent() {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()

  // Refs
  const listRef = useRef<FlatList>(null)

  // State
  const [selectedDay, setSelectedDay] = useState(getCurrentIsoDow)
  const [dayModalVisible, setDayModalVisible] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null) // null = all
  const [languageModalVisible, setLanguageModalVisible] = useState(false)
  const [fellowshipModalVisible, setFellowshipModalVisible] = useState(false)
  const [startHour, setStartHour] = useState(0) // 0-23
  const [endHour, setEndHour] = useState(24) // 1-24 (24 = midnight end)
  const [timePickerVisible, setTimePickerVisible] = useState<"start" | "end" | null>(null)
  const [meetings, setMeetings] = useState<MeetingWithTrex[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingWithTrex | null>(null)

  // Live feedback state for display updates
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

  // Get label for selected day (translated)
  const selectedDayLabel = ISO_DAYS.find((d) => d.iso === selectedDay)?.tx
    ? t(ISO_DAYS.find((d) => d.iso === selectedDay)!.tx)
    : ""

  // Get unique languages from meetings
  const availableLanguages = useMemo(() => {
    const langs = new Set<string>()
    meetings.forEach((m) => {
      if (m.language) langs.add(m.language.toUpperCase())
    })
    return Array.from(langs).sort()
  }, [meetings])

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
        duration_ms: s.duration_ms ?? 0,
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

  // Filter meetings by time range and language
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      const localHour = DateTime.fromMillis(m.millis).toLocal().hour
      const inTimeRange = localHour >= startHour && localHour < endHour
      const matchesLanguage = !selectedLanguage || m.language?.toUpperCase() === selectedLanguage
      return inTimeRange && matchesLanguage
    })
  }, [meetings, startHour, endHour, selectedLanguage])

  // Meeting popup handlers
  const handleMeetingPress = useCallback((meeting: MeetingWithTrex) => {
    setSelectedMeeting(meeting)
  }, [])

  const handleClosePopup = useCallback(() => {
    setSelectedMeeting(null)
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: MeetingWithTrex }) => {
      // Use displayFeedback for live UI updates
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

  const ItemSeparatorComponent = useCallback(() => <View style={themed($separator)} />, [themed])

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
    <View style={$screenContainer}>
      {/* Header */}
      <View style={themed($header)}>
        <Text preset="heading" style={themed($title)}>
          {t("listingsScreen:title")}
        </Text>
      </View>

      {/* Fellowship Selector - single line */}
      <TouchableOpacity
        style={themed($fellowshipSelector)}
        onPress={() => setFellowshipModalVisible(true)}
      >
        <Text style={themed($fellowshipLabel)}>{t("settingsScreen:recoveryFellowship")}</Text>
        <View style={$selectorValueRow}>
          <Text style={themed($selectorValue)}>{profileStore.fellowship || "AA"}</Text>
          <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
        </View>
      </TouchableOpacity>

      {/* Day and Language Selector Row */}
      <View style={themed($selectorRow)}>
        {/* Day Selector Button */}
        <TouchableOpacity style={themed($selectorButton)} onPress={() => setDayModalVisible(true)}>
          <Text style={themed($selectorLabel)}>{t("listingsScreen:dayLabel")}</Text>
          <View style={$selectorValueRow}>
            <Text style={themed($selectorValue)}>{selectedDayLabel}</Text>
            <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
          </View>
        </TouchableOpacity>

        {/* Language Selector Button */}
        <TouchableOpacity
          style={themed($selectorButton)}
          onPress={() => setLanguageModalVisible(true)}
        >
          <Text style={themed($selectorLabel)}>{t("listingsScreen:languageLabel")}</Text>
          <View style={$selectorValueRow}>
            <Text style={themed($selectorValue)}>
              {selectedLanguage || t("listingsScreen:allLanguages")}
            </Text>
            <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Day Selector Modal */}
      <Modal
        visible={dayModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDayModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setDayModalVisible(false)}>
          <View style={themed($modalContent)}>
            <Text style={themed($modalTitle)}>{t("listingsScreen:selectDay")}</Text>
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
                  {t(day.tx)}
                </Text>
                {selectedDay === day.iso && (
                  <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Language Selector Modal */}
      <Modal
        visible={languageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLanguageModalVisible(false)}
      >
        <Pressable style={themed($modalOverlay)} onPress={() => setLanguageModalVisible(false)}>
          <View style={themed($modalContent)}>
            <Text style={themed($modalTitle)}>{t("listingsScreen:selectLanguage")}</Text>
            {/* All option */}
            <TouchableOpacity
              style={[themed($modalOption), !selectedLanguage && themed($modalOptionSelected)]}
              onPress={() => {
                setSelectedLanguage(null)
                setLanguageModalVisible(false)
                listRef.current?.scrollToOffset({ offset: 0, animated: true })
              }}
            >
              <Text
                style={[
                  themed($modalOptionText),
                  !selectedLanguage && themed($modalOptionTextSelected),
                ]}
              >
                {t("listingsScreen:allLanguages")}
              </Text>
              {!selectedLanguage && (
                <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
              )}
            </TouchableOpacity>
            {/* Language options */}
            {availableLanguages.map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[
                  themed($modalOption),
                  selectedLanguage === lang && themed($modalOptionSelected),
                ]}
                onPress={() => {
                  setSelectedLanguage(lang)
                  setLanguageModalVisible(false)
                  listRef.current?.scrollToOffset({ offset: 0, animated: true })
                }}
              >
                <Text
                  style={[
                    themed($modalOptionText),
                    selectedLanguage === lang && themed($modalOptionTextSelected),
                  ]}
                >
                  {lang}
                </Text>
                {selectedLanguage === lang && (
                  <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

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
                  profileStore.fellowship === f.value && themed($modalOptionSelected),
                ]}
                onPress={() => {
                  profileStore.setFellowship(f.value)
                  setFellowshipModalVisible(false)
                }}
              >
                <Text
                  style={[
                    themed($modalOptionText),
                    profileStore.fellowship === f.value && themed($modalOptionTextSelected),
                  ]}
                >
                  {f.label}
                </Text>
                {profileStore.fellowship === f.value && (
                  <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Time Range Buttons */}
      <View style={themed($timeRangeRow)}>
        <TouchableOpacity style={themed($timeButton)} onPress={() => setTimePickerVisible("start")}>
          <Text style={themed($timeButtonLabel)}>{t("listingsScreen:startLabel")}</Text>
          <Text style={themed($timeButtonValue)}>{formatHour(startHour)}</Text>
        </TouchableOpacity>
        <Text style={themed($timeSeparator)}>{t("listingsScreen:toSeparator")}</Text>
        <TouchableOpacity style={themed($timeButton)} onPress={() => setTimePickerVisible("end")}>
          <Text style={themed($timeButtonLabel)}>{t("listingsScreen:endLabel")}</Text>
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
              {timePickerVisible === "start"
                ? t("listingsScreen:startTime")
                : t("listingsScreen:endTime")}
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

      <SchedulePopup
        visible={selectedMeeting !== null}
        meeting={selectedMeeting}
        onClose={handleClosePopup}
      />
    </View>
  )
})

/**
 * ListingsScreen - Shows meeting listings for selected day (standalone screen)
 *
 * Wraps ListingsContent with Screen component for use as a standalone tab.
 * Kept for backwards compatibility and potential deep linking.
 */
export const ListingsScreen: FC<MainTabScreenProps<"Listings">> = observer(
  function ListingsScreen(_props) {
    return (
      <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={$screenContainer}>
        <ListingsContent />
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

// Fellowship selector - single line
const $fellowshipSelector: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
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

const $fellowshipLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})

const $selectorRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "stretch",
  marginHorizontal: spacing.md,
  marginVertical: spacing.sm,
  gap: spacing.sm,
})

const $selectorButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
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
