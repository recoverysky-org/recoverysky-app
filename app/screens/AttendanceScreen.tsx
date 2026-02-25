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
  Modal,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useRoute, type RouteProp } from "@react-navigation/native"
import { DateTime } from "@recoverysky-org/common/browser"
import { observer } from "mobx-react-lite"
import { WebView } from "react-native-webview"

import { AttendanceRow } from "@/components/AttendanceRow"
import { Screen } from "@/components/Screen"
import { SegmentedControl } from "@/components/SegmentedControl"
import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { useToast } from "@/components/Toast"
import { useSubscription } from "@/context/SubscriptionContext"
import {
  attendanceRepo,
  attendanceReportRepo,
  attendanceEvents,
  type AttendanceRecord,
  type AttendanceReportRecord,
} from "@/db"
import { useReportSender } from "@/hooks/useReportSender"
import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import {
  MainTabScreenProps,
  type MainTabParamList,
  type AttendanceSection,
} from "@/navigators/navigationTypes"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

// ============================================================================
// Section definitions
// ============================================================================

/** Validate email format */
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

const SECTIONS = [
  { key: "new", label: translate("attendanceScreen:sectionNew") },
  { key: "archive", label: translate("attendanceScreen:sectionArchive") },
  { key: "reports", label: translate("attendanceScreen:sectionReports") },
]

// ============================================================================
// NewListHeader - Extracted so FlatList gets a stable reference
// ============================================================================

interface NewListHeaderProps {
  recordCount: number
  hasAttendance: boolean
  selectedCount: number
  onNavigateSettings: () => void
  onSendReport: () => void
}

const NewListHeader: FC<NewListHeaderProps> = observer(function NewListHeader({
  recordCount,
  hasAttendance,
  selectedCount,
  onNavigateSettings,
  onSendReport,
}) {
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const [emailValid, setEmailValid] = useState<boolean | null>(null)

  const canSendReport = selectedCount > 0 && isValidEmail(profileStore.reportEmail)

  // Debounced email validation indicator
  useEffect(() => {
    if (!profileStore.reportEmail) {
      setEmailValid(null)
      return
    }
    const timer = setTimeout(() => {
      setEmailValid(isValidEmail(profileStore.reportEmail))
    }, 500)
    return () => clearTimeout(timer)
  }, [profileStore.reportEmail])

  return (
    <View style={themed($sectionHeader)}>
      {recordCount > 0 && (
        <Text style={themed($countText)}>
          {recordCount} {translate(recordCount === 1 ? "attendanceScreen:record" : "attendanceScreen:records")}
        </Text>
      )}

      {hasAttendance ? (
        <>
          {/* Email Input */}
          <View style={themed($emailSection)}>
            <Text style={themed($emailLabel)} tx="attendanceScreen:reportEmail" />
            <View style={$emailRow}>
              <TextField
                value={profileStore.reportEmail}
                onChangeText={profileStore.setReportEmail}
                placeholder={translate("settingsScreen:exportEmailPlaceholder")}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                inputWrapperStyle={themed($emailInputWrapper)}
                containerStyle={$emailInputFlex}
              />
              {emailValid !== null && (
                <Ionicons
                  name={emailValid ? "checkmark-circle" : "close-circle"}
                  size={20}
                  color={emailValid ? theme.colors.palette.secondary500 : theme.colors.error}
                  style={$emailValidIcon}
                />
              )}
            </View>
          </View>

          {/* Send Report Button */}
          <TouchableOpacity
            style={[themed($sendButton), !canSendReport && themed($sendButtonDisabled)]}
            onPress={onSendReport}
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
              tx="attendanceScreen:sendReport"
            />
          </TouchableOpacity>

          {/* Help Text */}
          <Text
            style={themed($helpText)}
            tx="attendanceScreen:sendReportHint"
          />
        </>
      ) : (
        <View style={themed($subscribePrompt)}>
          <Text style={themed($subscribeText)} tx="attendanceScreen:subscribeRequired" />
          <TouchableOpacity onPress={onNavigateSettings}>
            <Text style={themed($subscribeLink)} tx="attendanceScreen:goToSettings" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
})

// ============================================================================
// NewContent - Unproduced attendance records
// ============================================================================

const NewContent: FC<{ onNavigateSettings: () => void }> = observer(function NewContent({
  onNavigateSettings,
}) {
  const { themed, theme } = useAppTheme()
  const { hasAttendance } = useSubscription()
  const profileStore = useProfileStore()
  const { send: sendReport } = useReportSender()
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
            meetingName: r.meetingName || translate("attendanceScreen:unknownMeeting"),
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
    Alert.alert(translate("attendanceScreen:removeTitle"), translate("attendanceScreen:removeMessage"), [
      { text: translate("attendanceScreen:cancel"), style: "cancel" },
      {
        text: translate("attendanceScreen:remove"),
        style: "destructive",
        onPress: async () => {
          try {
            await attendanceRepo.update(record.id, { valid: false })
            setRecords((prev) => prev.filter((r) => r.id !== record.id))
            logger.info("Attendance marked invalid", { id: record.id })
          } catch (error) {
            logger.error("Failed to delete attendance", { error: String(error) })
            Alert.alert(translate("attendanceScreen:errorTitle"), translate("attendanceScreen:removeError"))
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
        showReportSelect={hasAttendance}
        onToggleSelect={() => handleToggleSelect(item.id)}
        onDelete={() => handleDelete(item)}
      />
    ),
    [selectedIds, hasAttendance, handleToggleSelect, handleDelete],
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

  const handleSendReport = useCallback(async () => {
    if (selectedIds.size === 0) return
    const result = await sendReport({
      type: "initial",
      attendanceIds: Array.from(selectedIds),
      email: profileStore.reportEmail,
    })
    if (result?.success) {
      setRecords((prev) => prev.filter((r) => !selectedIds.has(r.id)))
      setSelectedIds(new Set())
    }
  }, [selectedIds, profileStore.reportEmail, sendReport])

  return (
    <FlatList
      data={records}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListEmptyComponent={ListEmptyComponent}
      ListHeaderComponent={
        <NewListHeader
          recordCount={records.length}
          hasAttendance={hasAttendance}
          selectedCount={selectedIds.size}
          onNavigateSettings={onNavigateSettings}
          onSendReport={handleSendReport}
        />
      }
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
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadRecords = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await attendanceRepo.findArchived()
      if (result.ok) {
        setRecords(
          result.value.map((r) => ({
            ...r,
            meetingName: r.meetingName || translate("attendanceScreen:unknownMeeting"),
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
      if (event.type === "archived") {
        void loadRecords()
      }
    })
  }, [loadRecords])

  const renderItem = useCallback(
    ({ item }: { item: AttendanceRecord }) => (
      <AttendanceRow record={item} />
    ),
    [],
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

  const ListHeaderComponent = useCallback(
    () => (
      <View style={themed($sectionHeader)}>
        {records.length > 0 && (
          <Text style={themed($countText)}>
            {records.length} {translate(records.length === 1 ? "attendanceScreen:record" : "attendanceScreen:records")}
          </Text>
        )}
      </View>
    ),
    [themed, records.length],
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
  const { send: sendReport, isSending } = useReportSender()
  const [reports, setReports] = useState<AttendanceReportRecord[]>([])
  const [recordCounts, setRecordCounts] = useState<Map<string, number>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [selectedReport, setSelectedReport] = useState<AttendanceReportRecord | null>(null)

  // Resend state
  const [resendReport, setResendReport] = useState<AttendanceReportRecord | null>(null)
  const [resendEmail, setResendEmail] = useState("")
  const [resendEmailValid, setResendEmailValid] = useState<boolean | null>(null)

  // Debounced resend email validation
  useEffect(() => {
    if (!resendEmail) {
      setResendEmailValid(null)
      return
    }
    const timer = setTimeout(() => {
      setResendEmailValid(isValidEmail(resendEmail))
    }, 500)
    return () => clearTimeout(timer)
  }, [resendEmail])

  const loadReports = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await attendanceReportRepo.findAll()
      if (result.ok) {
        // Sort newest first
        const sorted = result.value.sort((a, b) => b.generated - a.generated)
        setReports(sorted)

        // Fetch attendance counts per report
        const counts = new Map<string, number>()
        for (const report of sorted) {
          const attendanceResult = await attendanceRepo.findByReportId(report.id)
          if (attendanceResult.ok) {
            counts.set(report.id, attendanceResult.value.length)
          }
        }
        setRecordCounts(counts)
      } else {
        logger.error("Failed to load reports", { error: String(result.error) })
      }
    } catch (error) {
      logger.error("Error loading reports", { error: String(error) })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadReports()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return attendanceEvents.subscribe((event) => {
      if (event.type === "produced" || event.type === "delivery_resolved") {
        void loadReports()
      }
    })
  }, [loadReports])

  const getStatusIcon = useCallback(
    (report: AttendanceReportRecord) => {
      if (report.error) return { name: "warning" as const, color: theme.colors.error }
      if (report.confirmed > 0)
        return { name: "checkmark-circle" as const, color: theme.colors.palette.secondary500 }
      return { name: "time-outline" as const, color: theme.colors.textDim }
    },
    [theme],
  )

  const handleViewReport = useCallback((report: AttendanceReportRecord) => {
    if (!report.html) {
      Alert.alert(translate("attendanceScreen:notAvailableTitle"), translate("attendanceScreen:notAvailableMessage"))
      return
    }
    setSelectedReport(report)
  }, [])

  const handleResendTap = useCallback((report: AttendanceReportRecord) => {
    setResendReport(report)
    setResendEmail(report.email)
    setResendEmailValid(null)
  }, [])

  const handleCancelResend = useCallback(() => {
    setResendReport(null)
    setResendEmail("")
    setResendEmailValid(null)
  }, [])

  const handleResend = useCallback(async () => {
    if (!resendReport || !isValidEmail(resendEmail)) return
    const emailChanged = resendEmail !== resendReport.email

    if (!emailChanged) {
      await sendReport({ type: "resend", report: resendReport })
    } else if (resendReport.error) {
      await sendReport({ type: "replace", report: resendReport, email: resendEmail })
    } else {
      await sendReport({ type: "forward", report: resendReport, email: resendEmail })
    }

    handleCancelResend()
    void loadReports()
  }, [resendReport, resendEmail, sendReport, handleCancelResend, loadReports])

  const handleRowTap = useCallback((item: AttendanceReportRecord) => {
    const status = item.error
      ? translate("attendanceScreen:statusError")
      : item.confirmed > 0
        ? translate("attendanceScreen:statusDelivered")
        : translate("attendanceScreen:statusPending")
    const detail = item.confirmation || translate("attendanceScreen:noConfirmation")
    Alert.alert(status, detail)
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: AttendanceReportRecord }) => {
      const status = getStatusIcon(item)
      const count = recordCounts.get(item.id) ?? 0
      const dateStr =
        item.generated > 0
          ? DateTime.fromMillis(item.generated).toFormat("MMM d, yyyy h:mma").toLowerCase()
          : translate("attendanceScreen:unknownDate")

      return (
        <TouchableOpacity
          style={themed($reportRow)}
          onPress={() => handleRowTap(item)}
          activeOpacity={0.7}
        >
          <Ionicons name={status.name} size={22} color={status.color} />
          <View style={$reportContent}>
            <Text style={themed($reportDate)}>{dateStr}</Text>
            <Text style={themed($reportMeta)}>
              {item.email}
              {count > 0 && ` · ${count} ${translate(count === 1 ? "attendanceScreen:record" : "attendanceScreen:records")}`}
            </Text>
          </View>
          <TouchableOpacity onPress={() => handleResendTap(item)} style={$viewButton} hitSlop={8}>
            <Ionicons name="mail-outline" size={22} color={theme.colors.tint} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleViewReport(item)} style={$viewButton} hitSlop={8}>
            <Ionicons name="eye-outline" size={22} color={theme.colors.tint} />
          </TouchableOpacity>
        </TouchableOpacity>
      )
    },
    [themed, theme, getStatusIcon, recordCounts, handleViewReport, handleResendTap, handleRowTap],
  )

  const keyExtractor = useCallback((item: AttendanceReportRecord) => item.id, [])

  const ListEmptyComponent = useCallback(
    () => (
      <View style={themed($emptyContainer)}>
        <Text preset="subheading" style={themed($emptyText)} tx="attendanceScreen:noReports" />
        <Text style={themed($emptySubtext)} tx="attendanceScreen:noReportsSubtext" />
      </View>
    ),
    [themed],
  )

  const ItemSeparatorComponent = useCallback(() => <View style={themed($separator)} />, [themed])

  const modalDateStr = selectedReport?.generated
    ? DateTime.fromMillis(selectedReport.generated).toFormat("MMM d, yyyy h:mma").toLowerCase()
    : ""

  return (
    <>
      <FlatList
        data={reports}
        extraData={reports}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListEmptyComponent={ListEmptyComponent}
        ListHeaderComponent={
          <>
            {/* Resend email editor panel */}
            {resendReport && (
              <View style={themed($resendPanel)}>
                <Text
                  style={themed($emailLabel)}
                  text={resendEmail === resendReport.email ? translate("attendanceScreen:resendReport") : translate("attendanceScreen:forwardReport")}
                />
                <View style={$emailRow}>
                  <TextField
                    value={resendEmail}
                    onChangeText={setResendEmail}
                    placeholder={translate("attendanceScreen:recipientPlaceholder")}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    inputWrapperStyle={themed($emailInputWrapper)}
                    containerStyle={$emailInputFlex}
                  />
                  {resendEmailValid !== null && (
                    <Ionicons
                      name={resendEmailValid ? "checkmark-circle" : "close-circle"}
                      size={20}
                      color={
                        resendEmailValid ? theme.colors.palette.secondary500 : theme.colors.error
                      }
                      style={$emailValidIcon}
                    />
                  )}
                </View>
                <View style={$resendActions}>
                  <TouchableOpacity
                    style={[
                      themed($sendButton),
                      (!isValidEmail(resendEmail) || isSending) && themed($sendButtonDisabled),
                    ]}
                    onPress={handleResend}
                    disabled={!isValidEmail(resendEmail) || isSending}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="send"
                      size={18}
                      color={
                        isValidEmail(resendEmail) && !isSending
                          ? theme.colors.tint
                          : theme.colors.textDim
                      }
                    />
                    <Text
                      style={themed(
                        isValidEmail(resendEmail) && !isSending
                          ? $sendButtonText
                          : $sendButtonTextDisabled,
                      )}
                      text={isSending ? translate("attendanceScreen:sending") : translate("attendanceScreen:send")}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={themed($cancelButton)}
                    onPress={handleCancelResend}
                    accessibilityRole="button"
                  >
                    <Text style={themed($cancelButtonText)} tx="attendanceScreen:cancel" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Report count */}
            {reports.length > 0 && (
              <View style={themed($sectionHeader)}>
                <Text style={themed($countText)}>
                  {reports.length} {translate(reports.length === 1 ? "attendanceScreen:report" : "attendanceScreen:reports")}
                </Text>
              </View>
            )}
          </>
        }
        ItemSeparatorComponent={ItemSeparatorComponent}
        contentContainerStyle={themed($listContent)}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={loadReports}
            tintColor={theme.colors.text}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      <Modal
        visible={selectedReport !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedReport(null)}
      >
        <View style={themed($modalContainer)}>
          <View style={themed($modalHeader)}>
            <Text style={themed($modalTitle)}>{modalDateStr}</Text>
            <TouchableOpacity
              onPress={() => setSelectedReport(null)}
              style={$modalCloseButton}
              hitSlop={8}
            >
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>
          {selectedReport?.html ? (
            <WebView
              source={{ html: selectedReport.html }}
              originWhitelist={["*"]}
              style={$webView}
            />
          ) : null}
        </View>
      </Modal>
    </>
  )
})

// ============================================================================
// AttendanceScreen - Main screen with section selector
// ============================================================================

export const AttendanceScreen: FC<MainTabScreenProps<"Attendance">> = observer(
  function AttendanceScreen({ navigation }) {
    const { themed } = useAppTheme()
    const toast = useToast()
    const route = useRoute<RouteProp<MainTabParamList, "Attendance">>()

    // Initialize section from route params or default to "new"
    const [activeSection, setActiveSection] = useState<AttendanceSection>(
      route.params?.section ?? "new",
    )

    // Sync section when tab is focused via navigation (e.g. banner tap, toast tap).
    // Using the focus event ensures we apply params even when the value hasn't
    // changed (navigate with same section while user is on a different sub-tab).
    useEffect(() => {
      const unsubscribe = navigation.addListener("focus", () => {
        const section = route.params?.section
        if (section) {
          setActiveSection(section)
        }
      })
      return unsubscribe
    }, [navigation, route.params?.section])

    // Subscribe to delivery resolution events from polling
    useEffect(() => {
      return attendanceEvents.subscribe((event) => {
        if (event.type === "delivery_resolved") {
          toast.showToast({
            message: event.deliveryError
              ? translate("attendanceScreen:deliveryFailed")
              : translate("attendanceScreen:deliverySuccess"),
            type: event.deliveryError ? "error" : "success",
            duration: 10000,
            onPress: () => {
              navigation.navigate("Attendance", { section: "reports" })
            },
          })
        }
      })
    }, [toast, navigation])

    const handleNavigateSettings = useCallback(() => {
      navigation.navigate("Settings")
    }, [navigation])

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
          <NewContent onNavigateSettings={handleNavigateSettings} />
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

const $subscribePrompt: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  paddingVertical: spacing.lg,
})

const $subscribeText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  textAlign: "center",
  fontSize: 15,
  lineHeight: 22,
  marginBottom: spacing.sm,
})

const $subscribeLink: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 15,
  fontWeight: "600",
})

const $reportRow: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  gap: spacing.sm,
  backgroundColor: colors.card,
  borderRadius: 8,
})

const $reportContent: ViewStyle = {
  flex: 1,
  minWidth: 0,
}

const $reportDate: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  fontWeight: "500",
  color: colors.text,
})

const $reportMeta: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
  marginTop: 2,
})

const $viewButton: ViewStyle = {
  padding: 4,
}

const $modalContainer: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flex: 1,
  backgroundColor: colors.background,
})

const $modalHeader: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  backgroundColor: colors.card,
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.text,
})

const $modalCloseButton: ViewStyle = {
  padding: 4,
}

const $webView: ViewStyle = {
  flex: 1,
}

const $emailRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
}

const $emailInputFlex: ViewStyle = {
  flex: 1,
}

const $emailValidIcon: ViewStyle = {
  marginLeft: 8,
}

const $resendPanel: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.md,
  marginBottom: spacing.sm,
  backgroundColor: colors.card,
  borderRadius: 8,
  marginHorizontal: spacing.lg,
})

const $resendActions: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
}

const $cancelButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  marginTop: spacing.sm,
})

const $cancelButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 16,
  fontWeight: "500",
})
