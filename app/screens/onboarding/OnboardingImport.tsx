/**
 * OnboardingImport - Import data from old app
 *
 * Used in two contexts:
 * 1. Onboarding flow — navigates to OnboardingProfile after import/skip
 * 2. Settings modal — dismisses itself when done
 */
import { FC, useState } from "react"
import { View, ViewStyle, TextStyle, Pressable, ActivityIndicator } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation, useRoute } from "@react-navigation/native"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { attendanceRepo, attendanceReportRepo } from "@/db"
import { useJournalExport } from "@/hooks/useJournalExport"
import { useProfileStore } from "@/models"
import {
  api,
  type FirebaseUserData,
  type FirebaseAttendanceRecord,
  type FirebaseReportRecord,
} from "@/services/api"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "OnboardingImport" })

/** Map Firebase fellowship full names to local enum values */
const FELLOWSHIP_MAP: Record<string, string> = {
  "Alcoholics Anonymous": "AA",
  "Narcotics Anonymous": "NA",
  "Crystal Meth Anonymous": "CMA",
  "Marijuana Anonymous": "MA",
  "Recovery Dharma": "RD",
  // Pass through already-short values
  "AA": "AA",
  "NA": "NA",
  "CMA": "CMA",
  "MA": "MA",
  "RD": "RD",
}

/** Normalize Firebase pronouns (e.g. "She/Her") to local lowercase format */
function normalizePronouns(
  value: string,
): "none" | "he/him" | "she/her" | "they/them" | "em/ers" | null {
  switch (value.toLowerCase()) {
    case "he/him":
      return "he/him"
    case "she/her":
      return "she/her"
    case "they/them":
      return "they/them"
    case "em/ers":
      return "em/ers"
    case "none":
      return "none"
    default:
      return null
  }
}

async function importUserProfile(
  profileStore: ReturnType<typeof useProfileStore>,
  data: FirebaseUserData,
): Promise<string | undefined> {
  const { profile, preferences } = data

  // Batch all secure fields into a single SQLite write via setSecureProfile
  const secureData: Record<string, string | null> = {}

  if (profile.shortName) secureData.shortName = profile.shortName
  if (profile.pronouns) secureData.pronouns = normalizePronouns(profile.pronouns)
  if (profile.recoveryDate) secureData.recoveryDate = profile.recoveryDate
  if (profile.fellowship) {
    const mapped = FELLOWSHIP_MAP[profile.fellowship] ?? ""
    if (mapped) secureData.fellowship = mapped
  }

  // Single volatile update + single SQLite upsert
  profileStore.setSecureProfile(secureData)

  // MMKV props (auto-persisted via snapshots)
  profileStore.setShowCleanDate(preferences.showCleanDate)
  profileStore.setShowCleanDays(preferences.showCleanDays)
  profileStore.setShowPronouns(preferences.showPronouns)

  log.info("User profile imported", { shortName: profile.shortName })
  return profile.shortName
}

async function importAttendance(records: FirebaseAttendanceRecord[]): Promise<number> {
  let imported = 0
  for (const r of records) {
    const result = await attendanceRepo.create({
      id: r.id,
      iid: r.iid || r.id,
      uid: r.uid,
      mid: r.mid,
      zid: r.zid,
      created: r.created,
      valid: r.valid,
      uzid: r.uzid,
      zpid: r.zpid,
      zuid: r.zuid,
      meetingHost: r.meetingHost,
      meetingName: r.meetingName,
      archived: r.archived,
      processed: r.processed,
      start: r.start,
      end: r.end,
      credit: r.credit,
      produced: r.produced,
      arid: r.arid,
    })
    if (result.ok) imported++
  }
  log.info("Attendance imported", { total: records.length, imported })
  return imported
}

async function importReports(records: FirebaseReportRecord[]): Promise<number> {
  let imported = 0
  for (const r of records) {
    const result = await attendanceReportRepo.create({
      id: r.id,
      iid: r.iid || r.id,
      uid: r.uid,
      fid: r.fid,
      name: r.name,
      userEmail: r.userEmail,
      email: r.email,
      error: r.error,
      messageId: r.messageId,
      generated: r.generated,
      confirmed: Date.now(),
      confirmation: "IMPORTED from AA/NA Live!",
      html: r.html,
      text: r.text,
      credit: r.credit,
    })
    if (result.ok) imported++
  }
  log.info("Reports imported", { total: records.length, imported })
  return imported
}

interface ImportResults {
  profileName: string | undefined
  attendanceCount: number
  reportsCount: number
}

export const OnboardingImport: FC<any> = function OnboardingImport() {
  const navigation = useNavigation<any>()
  const route = useRoute()
  const isModal = route.name === "Import"
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<ImportResults | null>(null)
  const { exportPdf, isExporting } = useJournalExport()

  const dismiss = () => {
    if (isModal) {
      navigation.goBack()
    } else {
      // profileStore.setImported(true) // TODO: re-enable after dev
      navigation.replace("OnboardingProfile")
    }
  }

  const handleSkip = () => dismiss()

  const handleContinue = () => {
    setResults(null)
  }

  const handleImportCloudData = async () => {
    setImporting(true)
    try {
      // Fetch all three in parallel
      const [userResult, attendanceResult, reportsResult] = await Promise.all([
        api.getFirebaseUser(),
        api.getFirebaseAttendance(),
        api.getFirebaseReports(),
      ])

      let profileName: string | undefined
      let attendanceCount = 0
      let reportsCount = 0

      // Import user profile
      if (userResult.kind === "ok") {
        profileName = await importUserProfile(profileStore, userResult.data)
      } else {
        log.warn("Failed to fetch Firebase user", { kind: userResult.kind })
      }

      // Import attendance records
      if (attendanceResult.kind === "ok") {
        attendanceCount = await importAttendance(attendanceResult.data)
      } else {
        log.warn("Failed to fetch Firebase attendance", { kind: attendanceResult.kind })
      }

      // Import reports
      if (reportsResult.kind === "ok") {
        reportsCount = await importReports(reportsResult.data)
      } else {
        log.warn("Failed to fetch Firebase reports", { kind: reportsResult.kind })
      }

      log.info("Cloud data import complete")
      setResults({ profileName, attendanceCount, reportsCount })
    } catch (error) {
      log.error("Cloud data import failed", { error: String(error) })
      dismiss()
    } finally {
      setImporting(false)
    }
  }

  const handleExportJournal = () => {
    exportPdf()
  }

  // ── Results screen ──────────────────────────────────────────────────
  if (results) {
    return (
      <Screen
        preset="fixed"
        safeAreaEdges={["top", "bottom"]}
        contentContainerStyle={themed($container)}
      >
        <View style={$content}>
          <Ionicons name="checkmark-circle-outline" size={80} color={theme.colors.tint} />
          <Text
            style={themed($title)}
            tx={
              results.profileName
                ? "onboarding:importCompleteTitleName"
                : "onboarding:importCompleteTitle"
            }
            txOptions={{ name: results.profileName }}
          />

          <View style={$resultsList}>
            {results.profileName && (
              <View style={$resultRow}>
                <Ionicons name="checkmark-circle" size={22} color={theme.colors.tint} />
                <Text style={themed($resultText)} tx="onboarding:importProfileSuccess" />
              </View>
            )}
            {results.attendanceCount > 0 && (
              <View style={$resultRow}>
                <Ionicons name="checkmark-circle" size={22} color={theme.colors.tint} />
                <Text
                  style={themed($resultText)}
                  tx="onboarding:importAttendanceSuccess"
                  txOptions={{ count: results.attendanceCount }}
                />
              </View>
            )}
            {results.reportsCount > 0 && (
              <View style={$resultRow}>
                <Ionicons name="checkmark-circle" size={22} color={theme.colors.tint} />
                <Text
                  style={themed($resultText)}
                  tx="onboarding:importReportsSuccess"
                  txOptions={{ count: results.reportsCount }}
                />
              </View>
            )}
          </View>
        </View>

        <View style={themed($footer)}>
          <Pressable
            style={[
              themed($button),
              { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
            ]}
            onPress={handleContinue}
          >
            <Text
              style={[themed($buttonText), { color: theme.colors.tint }]}
              tx="onboarding:importContinue"
            />
          </Pressable>
        </View>
      </Screen>
    )
  }

  // ── Import options screen ───────────────────────────────────────────
  return (
    <Screen
      preset="fixed"
      safeAreaEdges={["top", "bottom"]}
      contentContainerStyle={themed($container)}
    >
      {/* Content */}
      <View style={$content}>
        <Ionicons name="cloud-download-outline" size={80} color={theme.colors.tint} />

        <Text style={themed($title)} tx="onboarding:importTitle" />
        <Text style={themed($subtitle)} tx="onboarding:importSubtitle" />
        <Text style={themed($subtitle)} tx="onboarding:importJournalHint" />
      </View>

      {/* Buttons */}
      <View style={themed($footer)}>
        <Pressable
          style={[
            themed($button),
            { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
          ]}
          onPress={handleImportCloudData}
          disabled={importing}
        >
          {importing ? (
            <ActivityIndicator color={theme.colors.tint} />
          ) : (
            <>
              <Ionicons name="cloud-download-outline" size={20} color={theme.colors.tint} />
              <Text
                style={[themed($buttonText), { color: theme.colors.tint }]}
                tx="onboarding:importCloudData"
              />
            </>
          )}
        </Pressable>

        <Pressable
          style={[
            themed($button),
            { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
          ]}
          onPress={handleExportJournal}
          disabled={importing || isExporting}
        >
          {isExporting ? (
            <ActivityIndicator color={theme.colors.tint} />
          ) : (
            <>
              <Ionicons name="document-outline" size={20} color={theme.colors.tint} />
              <Text
                style={[themed($buttonText), { color: theme.colors.tint }]}
                tx="onboarding:exportJournalPdf"
              />
            </>
          )}
        </Pressable>

        <Pressable onPress={handleSkip} style={$skipButton} disabled={importing}>
          <Text style={themed($skipText)} tx="onboarding:importSkip" />
        </Pressable>
      </View>
    </Screen>
  )
}

// ============================================================================
// Styles
// ============================================================================

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.xl,
})

const $content: ViewStyle = {
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
  paddingTop: 16,
  gap: 16,
}

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 28,
  fontWeight: "700",
  lineHeight: 38,
  color: colors.text,
  textAlign: "center",
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.textDim,
  textAlign: "center",
  lineHeight: 24,
  paddingHorizontal: 20,
})

const $footer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.lg,
  gap: spacing.md,
})

const $button: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  backgroundColor: colors.background,
  borderWidth: 1.5,
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  alignItems: "center",
  justifyContent: "center",
  gap: spacing.xs,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $buttonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 18,
  fontWeight: "600",
})

const $resultsList: ViewStyle = {
  alignItems: "flex-start",
  gap: 12,
  paddingTop: 8,
}

const $resultRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
}

const $resultText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})

const $skipButton: ViewStyle = {
  alignItems: "center",
  paddingVertical: 12,
}

const $skipText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})
