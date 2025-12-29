/**
 * AttendanceScreen - Shows unproduced attendance records
 *
 * Tab 3: Between Live and Settings
 *
 * Displays attendance records that have not yet been included in a report
 * (produced === 0). Users can view their attendance history and mark
 * records for inclusion in reports.
 */

import { FC, useCallback, useState, useEffect } from "react"
import { ViewStyle, FlatList, RefreshControl, View, TextStyle, Alert } from "react-native"

import { AttendanceRow, type AttendanceWithMeeting } from "@/components/AttendanceRow"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { attendanceRepo, meetingRepo, attendanceEvents, type AttendanceRecord } from "@/db"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

/**
 * AttendanceScreen displays unproduced attendance records
 */
export const AttendanceScreen: FC<MainTabScreenProps<"Attendance">> = function AttendanceScreen(
  _props,
) {
  const { themed, theme } = useAppTheme()
  const [records, setRecords] = useState<AttendanceWithMeeting[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadRecords = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await attendanceRepo.findUnproduced()
      if (result.ok) {
        // Join with meeting names
        const mids = [...new Set(result.value.map((r) => r.mid))]
        const meetingsResult = await meetingRepo.findByIds(mids)
        const meetingMap = new Map(
          meetingsResult.ok ? meetingsResult.value.map((m) => [m.meeting.id, m.meeting.name]) : [],
        )

        // Only show valid records (meetings long enough for credit)
        const validRecords = result.value.filter((r) => r.valid)

        setRecords(
          validRecords.map((r) => ({
            ...r,
            meetingName: meetingMap.get(r.mid) ?? "Unknown Meeting",
          })),
        )
      } else {
        logger.error("Failed to load unproduced attendance", { error: String(result.error) })
      }
    } catch (error) {
      logger.error("Error loading attendance", { error: String(error) })
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Load records on mount (database is guaranteed ready by DatabaseProvider)
  useEffect(() => {
    void loadRecords()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to attendance changes for real-time updates
  useEffect(() => {
    return attendanceEvents.subscribe((event) => {
      // Refresh when attendance is processed (has valid flag set)
      if (event.type === "processed") {
        void loadRecords()
      }
    })
  }, [loadRecords])

  const handleAddToReport = useCallback((_record: AttendanceRecord) => {
    // Placeholder - show "Coming soon" toast
    Alert.alert("Coming Soon", "The Add to Report feature will be available in a future update.")
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: AttendanceWithMeeting }) => (
      <AttendanceRow record={item} onAddToReport={() => handleAddToReport(item)} />
    ),
    [handleAddToReport],
  )

  const keyExtractor = useCallback((item: AttendanceWithMeeting) => item.id, [])

  const ListEmptyComponent = useCallback(
    () => (
      <View style={themed($emptyContainer)}>
        <Text preset="subheading" tx="attendanceScreen:noRecords" style={themed($emptyText)} />
        <Text style={themed($emptySubtext)} tx="attendanceScreen:noRecordsSubtext" />
      </View>
    ),
    [themed],
  )

  const ItemSeparatorComponent = useCallback(
    () => <View style={themed($separator)} />,
    [themed],
  )

  const ListHeaderComponent = useCallback(
    () => (
      <View style={themed($header)}>
        <Text preset="heading" tx="attendanceScreen:title" />
        {records.length > 0 && (
          <Text style={themed($countText)}>
            {records.length} {records.length === 1 ? "record" : "records"}
          </Text>
        )}
      </View>
    ),
    [themed, records.length],
  )

  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={$styles.container}>
      <FlatList
        data={records}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListEmptyComponent={ListEmptyComponent}
        ListHeaderComponent={ListHeaderComponent}
        ItemSeparatorComponent={ItemSeparatorComponent}
        contentContainerStyle={themed($listContent)}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={loadRecords} tintColor={theme.colors.text} />
        }
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  )
}

// ============================================================================
// Styles
// ============================================================================

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

const $separator: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  height: spacing.xs,
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

const $emptySubtext: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  textAlign: "center",
  marginTop: spacing.sm,
  fontSize: 14,
})
