/**
 * AttendanceScreen - Attendance management with section selector
 *
 * Tab 3: Between Live and Settings
 *
 * Three sections:
 * - New: Unproduced attendance records for report generation
 * - Archive: (placeholder) Same as New for now
 * - Reports: View and manage sent attendance reports
 */

import { FC, useCallback, useState, useEffect } from "react"
import {
  ViewStyle,
  FlatList,
  RefreshControl,
  View,
  TextStyle,
  Alert,
  TouchableOpacity,
  ScrollView,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { AttendanceRow } from "@/components/AttendanceRow"
import { Screen } from "@/components/Screen"
import { SegmentedControl } from "@/components/SegmentedControl"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { attendanceRepo, attendanceEvents, type AttendanceRecord } from "@/db"
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

// ============================================================================
// Section definitions
// ============================================================================

type AttendanceSection = "new" | "archive" | "reports"

const SECTIONS = [
  { key: "new", label: "New" },
  { key: "archive", label: "Archive" },
  { key: "reports", label: "Reports" },
]

// ============================================================================
// NewContent - Unproduced attendance records
// ============================================================================

const NewContent: FC = observer(function NewContent() {
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

  useEffect(() => {
    void loadRecords()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return attendanceEvents.subscribe((event) => {
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

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const canSendReport = selectedIds.size > 0 && isValidEmail(profileStore.reportEmail)

  const handleSendReport = useCallback(() => {
    Alert.alert("Coming Soon", "Send report functionality will be available in a future update.")
  }, [])

  const ListHeaderComponent = useCallback(
    () => (
      <View style={themed($sectionHeader)}>
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
      theme.colors.textDim,
      records.length,
      profileStore.reportEmail,
      profileStore.setReportEmail,
      handleSendReport,
      canSendReport,
    ],
  )

  return (
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
  )
})

// ============================================================================
// ArchiveContent - Placeholder (same as New for now)
// ============================================================================

const ArchiveContent: FC = observer(function ArchiveContent() {
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
        const validRecords = result.value.filter((r) => r.valid)
        setRecords(
          validRecords.map((r) => ({
            ...r,
            meetingName: r.meetingName || "Unknown Meeting",
          })),
        )
      } else {
        logger.error("Failed to load archive attendance", { error: String(result.error) })
      }
    } catch (error) {
      logger.error("Error loading archive attendance", { error: String(error) })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRecords()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return attendanceEvents.subscribe((event) => {
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

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const canSendReport = selectedIds.size > 0 && isValidEmail(profileStore.reportEmail)

  const handleSendReport = useCallback(() => {
    Alert.alert("Coming Soon", "Send report functionality will be available in a future update.")
  }, [])

  const ListHeaderComponent = useCallback(
    () => (
      <View style={themed($sectionHeader)}>
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
      theme.colors.textDim,
      records.length,
      profileStore.reportEmail,
      profileStore.setReportEmail,
      handleSendReport,
      canSendReport,
    ],
  )

  return (
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
  )
})

// ============================================================================
// ReportsContent - View and manage attendance reports
// ============================================================================

const ReportsContent: FC = observer(function ReportsContent() {
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()

  const handleSendReport = () => {
    if (!profileStore.reportEmail) {
      Alert.alert("Email Required", "Please enter an email address to send the report.")
      return
    }
    Alert.alert("Coming Soon", "Send report functionality will be available in a future update.")
  }

  return (
    <ScrollView
      contentContainerStyle={themed($reportsContent)}
      showsVerticalScrollIndicator={false}
    >
      {/* Email Input */}
      <View style={themed($emailSection)}>
        <Text style={themed($emailLabel)} tx="settingsScreen:exportEmail" />
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
        style={themed($sendButton)}
        onPress={handleSendReport}
        accessibilityRole="button"
      >
        <Ionicons name="send" size={18} color={theme.colors.tint} />
        <Text style={themed($sendButtonText)} text="Resend Report" />
      </TouchableOpacity>

      {/* Empty State */}
      <View style={themed($emptyContainer)}>
        <Text preset="subheading" style={themed($emptyText)} text="No reports yet" />
        <Text
          style={themed($emptySubtext)}
          text="Select attendance records and generate a report"
        />
      </View>
    </ScrollView>
  )
})

// ============================================================================
// AttendanceScreen - Main screen with section selector
// ============================================================================

export const AttendanceScreen: FC<MainTabScreenProps<"Attendance">> = observer(
  function AttendanceScreen(_props) {
    const { themed } = useAppTheme()
    const [activeSection, setActiveSection] = useState<AttendanceSection>("new")

    const handleSectionChange = useCallback((index: number) => {
      const keys: AttendanceSection[] = ["new", "archive", "reports"]
      setActiveSection(keys[index])
    }, [])

    const selectedIndex = SECTIONS.findIndex((s) => s.key === activeSection)

    return (
      <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($container)}>
        {/* Header */}
        <View style={themed($screenHeader)}>
          <Text preset="heading" tx="attendanceScreen:title" />
        </View>

        {/* Section Selector */}
        <View style={themed($segmentWrapper)}>
          <SegmentedControl
            segments={SECTIONS}
            selectedIndex={selectedIndex}
            onChange={handleSectionChange}
          />
        </View>

        {/* Content Views - all mounted, inactive ones hidden */}
        <View style={[$content, activeSection === "new" ? $contentVisible : $contentHidden]}>
          <NewContent />
        </View>
        <View style={[$content, activeSection === "archive" ? $contentVisible : $contentHidden]}>
          <ArchiveContent />
        </View>
        <View style={[$content, activeSection === "reports" ? $contentVisible : $contentHidden]}>
          <ReportsContent />
        </View>
      </Screen>
    )
  },
)

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
})

const $screenHeader: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xs,
  paddingBottom: spacing.sm,
})

const $segmentWrapper: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.sm,
})

const $content: ViewStyle = {
  flex: 1,
}

const $contentVisible: ViewStyle = {
  display: "flex",
}

const $contentHidden: ViewStyle = {
  display: "none",
}

const $sectionHeader: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.lg,
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

const $reportsContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.lg,
  paddingBottom: spacing.xxl,
})
