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
import {
  ViewStyle,
  FlatList,
  RefreshControl,
  View,
  TextStyle,
  Alert,
  Pressable,
  TouchableOpacity,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { AttendanceRow } from "@/components/AttendanceRow"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { attendanceRepo, attendanceEvents, type AttendanceRecord } from "@/db"
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

/**
 * AttendanceScreen displays unproduced attendance records
 */
export const AttendanceScreen: FC<MainTabScreenProps<"Attendance">> = observer(
  function AttendanceScreen({ navigation }) {
    const { themed, theme } = useAppTheme()
    const profileStore = useProfileStore()
    const [records, setRecords] = useState<AttendanceRecord[]>([])
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [isLoading, setIsLoading] = useState(true)

    const loadRecords = useCallback(async () => {
      setIsLoading(true)
      try {
        const result = await attendanceRepo.findUnproduced()
        if (result.ok) {
          // Only show valid records (meetings long enough for credit)
          const validRecords = result.value.filter((r) => r.valid)

          setRecords(
            validRecords.map((r) => ({
              ...r,
              meetingName: r.meetingName || "Unknown Meeting",
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

    const handleToggleSelect = useCallback((id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
    }, [])

    const handleDelete = useCallback((record: AttendanceRecord) => {
      Alert.alert("Remove Attendance", "This will mark this attendance as invalid. Continue?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await attendanceRepo.update(record.id, { valid: false })
              // Remove from local state immediately
              setRecords((prev) => prev.filter((r) => r.id !== record.id))
              logger.info("Attendance marked invalid", { id: record.id })
            } catch (error) {
              logger.error("Failed to delete attendance", { error: String(error) })
              Alert.alert("Error", "Failed to remove attendance record.")
            }
          },
        },
      ])
    }, [])

    const renderItem = useCallback(
      ({ item }: { item: AttendanceRecord }) => (
        <AttendanceRow
          record={item}
          isSelected={selectedIds.has(item.id)}
          onToggleSelect={() => handleToggleSelect(item.id)}
          onDelete={() => handleDelete(item)}
        />
      ),
      [selectedIds, handleToggleSelect, handleDelete],
    )

    const keyExtractor = useCallback((item: AttendanceRecord) => item.id, [])

    const ListEmptyComponent = useCallback(
      () => (
        <View style={themed($emptyContainer)}>
          <Text preset="subheading" tx="attendanceScreen:noRecords" style={themed($emptyText)} />
          <Text style={themed($emptySubtext)} tx="attendanceScreen:noRecordsSubtext" />
        </View>
      ),
      [themed],
    )

    const ItemSeparatorComponent = useCallback(() => <View style={themed($separator)} />, [themed])

    // Simple email validation
    const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    const canSendReport = selectedIds.size > 0 && isValidEmail(profileStore.reportEmail)

    const handleSendReport = useCallback(() => {
      Alert.alert("Coming Soon", "Send report functionality will be available in a future update.")
    }, [])

    const ListHeaderComponent = useCallback(
      () => (
        <View style={themed($header)}>
          <View style={$headerRow}>
            <Text preset="heading" tx="attendanceScreen:title" />
            <Pressable
              style={({ pressed }) => [$reportsLink, pressed && $pressed]}
              onPress={() => navigation.navigate("AttendanceReports")}
            >
              <Text style={{ color: theme.colors.tint }}>Reports</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.tint} />
            </Pressable>
          </View>
          {records.length > 0 && (
            <Text style={themed($countText)}>
              {records.length} {records.length === 1 ? "record" : "records"}
            </Text>
          )}

          {/* Email Input */}
          <View style={themed($emailSection)}>
            <Text style={themed($emailLabel)} text="Report Email" />
            <TextField
              value={profileStore.reportEmail}
              onChangeText={profileStore.setReportEmail}
              placeholder={translate("settingsScreen:exportEmailPlaceholder")}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              inputWrapperStyle={themed($emailInputWrapper)}
            />
          </View>

          {/* Send Report Button */}
          <TouchableOpacity
            style={[themed($sendButton), !canSendReport && themed($sendButtonDisabled)]}
            onPress={handleSendReport}
            disabled={!canSendReport}
            accessibilityRole="button"
          >
            <Ionicons
              name="send"
              size={18}
              color={canSendReport ? theme.colors.tint : theme.colors.textDim}
            />
            <Text
              style={themed(canSendReport ? $sendButtonText : $sendButtonTextDisabled)}
              text="Send Report"
            />
          </TouchableOpacity>

          {/* Help Text */}
          <Text
            style={themed($helpText)}
            text="Enter a valid email and select one or more attendance records to send a report."
          />
        </View>
      ),
      [
        themed,
        theme.colors.tint,
        records.length,
        navigation,
        profileStore.reportEmail,
        profileStore.setReportEmail,
        handleSendReport,
        canSendReport,
      ],
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
            <RefreshControl
              refreshing={isLoading}
              onRefresh={loadRecords}
              tintColor={theme.colors.text}
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

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.md,
})

const $headerRow: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
}

const $reportsLink: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 2,
}

const $pressed: ViewStyle = {
  opacity: 0.7,
}

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

const $emailSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.md,
})

const $emailLabel: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  color: colors.textDim,
  marginBottom: spacing.xs,
})

const $emailInputWrapper: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.card,
  borderColor: colors.border,
  borderRadius: 8,
})

const $sendButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#000",
  borderWidth: 1.5,
  borderColor: colors.tint,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  borderRadius: 10,
  marginTop: spacing.sm,
  gap: spacing.xs,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $sendButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 16,
  fontWeight: "600",
})

const $sendButtonDisabled: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderColor: colors.border,
  shadowOpacity: 0,
  elevation: 0,
})

const $sendButtonTextDisabled: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 16,
  fontWeight: "600",
})

const $helpText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 13,
  color: colors.textDim,
  textAlign: "center",
  marginTop: spacing.sm,
})
