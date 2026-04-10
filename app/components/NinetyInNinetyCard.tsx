/**
 * NinetyInNinetyCard Component
 *
 * Home screen card tracking the "90 meetings in 90 days" challenge.
 * Shows progress, strict-mode compliance, and generates a PDF
 * certificate on successful completion.
 */

import { useCallback, useMemo, useState } from "react"
import { Alert, Pressable, ScrollView, View, ViewStyle, TextStyle } from "react-native"
import * as Crypto from "expo-crypto"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/Button"
import { Text } from "@/components/Text"
import { useToast } from "@/components/Toast"
import { attendanceRepo } from "@/db"
import { useNinetyInNinety, type DailyMinutes } from "@/hooks/useNinetyInNinety"
import { useAuthenticationStore, useProfileStore } from "@/models"
import {
  generateAndStoreCertificate,
  shareNinetyCertificate,
} from "@/services/ninety/ninetyCertificateService"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "NinetyInNinetyCard" })

const CHART_HEIGHT = 100
const BAR_MIN_HEIGHT = 2
const TRANSPARENT = "transparent"

/**
 * Pure RN bar chart — no SVG library needed.
 * X = day number, Y = total minutes in meetings that day.
 * Horizontally scrollable for many days.
 */
function DailyBarChart({
  data,
  tintColor,
  dimColor,
  borderColor,
}: {
  data: DailyMinutes[]
  tintColor: string
  dimColor: string
  borderColor: string
}) {
  if (data.length === 0) return null

  const maxMinutes = Math.max(...data.map((d) => d.minutes), 60) // floor at 60 for scale

  return (
    <View style={$chartContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={$chartInner}>
          {/* Y-axis labels */}
          <View style={$yAxis}>
            <Text style={[$axisLabel, { color: dimColor }]}>{maxMinutes}m</Text>
            <Text style={[$axisLabel, { color: dimColor }]}>0</Text>
          </View>
          {/* Bars */}
          <View style={$barsRow}>
            {data.map((d) => {
              const barHeight =
                d.minutes > 0
                  ? Math.max((d.minutes / maxMinutes) * CHART_HEIGHT, BAR_MIN_HEIGHT)
                  : 0
              const showLabel = d.day === 1 || d.day % 10 === 0 || d.day === data.length
              const labelColor = showLabel ? dimColor : TRANSPARENT
              return (
                <View key={d.day} style={$barColumn}>
                  <View style={[$barTrack, { borderColor }]}>
                    <View style={[$bar, { height: barHeight, backgroundColor: tintColor }]} />
                  </View>
                  <Text style={[$axisLabel, { color: labelColor }]}>{d.day}</Text>
                </View>
              )
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

export const NinetyInNinetyCard = observer(function NinetyInNinetyCard() {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const authStore = useAuthenticationStore()
  const stats = useNinetyInNinety()
  const toast = useToast()
  const [isGenerating, setIsGenerating] = useState(false)

  const isStarted = profileStore.ninetyStartDate !== ""
  const hasCertificate = profileStore.ninetyCertificatePath !== ""

  const progressWidth = useMemo<ViewStyle>(
    () => ({
      width: `${Math.round(stats.progress * 100)}%`,
      backgroundColor: theme.colors.tint,
    }),
    [stats.progress, theme.colors.tint],
  )

  const cardGlowStyle = useMemo<ViewStyle>(
    () => ({
      borderColor: stats.isComplete ? theme.colors.tint : theme.colors.border,
      shadowColor: theme.colors.tint,
      shadowOpacity: stats.isComplete ? 0.9 : 0,
      shadowRadius: stats.isComplete ? 12 : 0,
    }),
    [stats.isComplete, theme.colors.tint, theme.colors.border],
  )

  const handleStart = useCallback(() => {
    const today = new Date().toISOString().split("T")[0]
    profileStore.setNinetyStartDate(today)
    log.info("90/90 challenge started", { startDate: today })
  }, [profileStore])

  const handleReset = useCallback(() => {
    Alert.alert(t("ninetyInNinety:resetTitle"), t("ninetyInNinety:resetMessage"), [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: t("ninetyInNinety:resetButton"),
        style: "destructive",
        onPress: () => {
          profileStore.resetNinetyChallenge()
          log.info("90/90 challenge reset")
        },
      },
    ])
  }, [profileStore, t])

  // const handleToggleStrict = useCallback(
  //   (value: boolean) => {
  //     profileStore.setNinetyStrictMode(value)
  //     log.info("Strict mode toggled", { strictMode: value })
  //   },
  //   [profileStore],
  // )

  const handleDebugInsert = useCallback(async () => {
    if (!__DEV__) return
    const uid = authStore.userId
    if (!uid || !profileStore.ninetyStartDate) return
    const dayOffset = profileStore.ninetyDebugDay
    const startDate = new Date(profileStore.ninetyStartDate + "T00:00:00")
    const meetingDate = new Date(startDate)
    meetingDate.setDate(meetingDate.getDate() + dayOffset)
    const creditMinutes = 60 + Math.floor(Math.random() * 61)
    const creditMs = creditMinutes * 60_000
    const startMs = meetingDate.getTime() + 10 * 3_600_000
    const endMs = startMs + creditMs
    try {
      await attendanceRepo.create({
        id: Crypto.randomUUID(),
        uid,
        mid: `debug-ninety-${dayOffset}`,
        zid: `debug-zid-${dayOffset}`,
        created: Date.now(),
        valid: true,
        processed: Date.now(),
        start: startMs,
        end: endMs,
        credit: creditMs,
        meetingName: `Debug Meeting Day ${dayOffset + 1}`,
        meetingHost: "Debug",
      })
      profileStore.setNinetyDebugDay(dayOffset + 1)
      toast.showToast({
        message: `Day ${dayOffset + 1}: ${creditMinutes}min added`,
        type: "success",
      })
      log.info("Debug attendance inserted", { day: dayOffset + 1, creditMinutes })
      await stats.refresh()
    } catch (error) {
      log.error("Debug insert failed", { error: String(error) })
      toast.showToast({ message: "Debug insert failed", type: "error" })
    }
  }, [authStore.userId, profileStore, stats, toast])

  const handleDebugDeleteAll = useCallback(async () => {
    if (!__DEV__) return
    try {
      const result = await attendanceRepo.findAll()
      if (result.ok) {
        for (const r of result.value) {
          await attendanceRepo.delete(r.id)
        }
        profileStore.setNinetyDebugDay(0)
        toast.showToast({ message: `Deleted ${result.value.length} records`, type: "info" })
        await stats.refresh()
      }
    } catch (error) {
      log.error("Debug delete failed", { error: String(error) })
    }
  }, [profileStore, stats, toast])

  const handleGetCertificate = useCallback(async () => {
    setIsGenerating(true)
    try {
      const path = await generateAndStoreCertificate({
        name: profileStore.shortName,
        startDate: profileStore.ninetyStartDate,
        completionDate: new Date().toISOString().split("T")[0],
        meetingsAttended: stats.meetingsAttended,
        totalCreditMs: stats.totalCreditMs,
        strictMode: profileStore.ninetyStrictMode,
      })
      profileStore.setNinetyCertificatePath(path)
      toast.showToast({ tx: "ninetyInNinety:certificateReady", type: "success" })
      log.info("Certificate generated", { path })
    } catch (error) {
      log.error("Certificate generation failed", { error: String(error) })
      toast.showToast({ tx: "ninetyInNinety:certificateError", type: "error" })
    } finally {
      setIsGenerating(false)
    }
  }, [profileStore, stats.meetingsAttended, stats.totalCreditMs, toast])

  const handleViewCertificate = useCallback(async () => {
    if (!profileStore.ninetyCertificatePath) return
    try {
      await shareNinetyCertificate(profileStore.ninetyCertificatePath)
    } catch (error) {
      log.error("Certificate view failed", { error: String(error) })
      toast.showToast({ tx: "ninetyInNinety:certificateError", type: "error" })
    }
  }, [profileStore.ninetyCertificatePath, toast])

  // ======== NOT STARTED STATE ========
  if (!isStarted) {
    return (
      <View style={[themed($card), { borderColor: theme.colors.border }]}>
        <Text style={themed($title)}>{t("ninetyInNinety:title")}</Text>
        <Text style={themed($description)}>{t("ninetyInNinety:description")}</Text>
        <Button
          tx="ninetyInNinety:startChallenge"
          preset="filled"
          onPress={handleStart}
          style={themed($startButton)}
        />
      </View>
    )
  }

  // ======== EXPIRED STATE ========
  if (stats.isExpired) {
    return (
      <View style={[themed($card), { borderColor: theme.colors.border }]}>
        <Text style={themed($title)}>{t("ninetyInNinety:challengeExpired")}</Text>
        <Text style={themed($heroText)}>
          {t("ninetyInNinety:meetingsCount", { count: stats.meetingsAttended })}
        </Text>
        <Text style={themed($statsText)}>
          {t("ninetyInNinety:expiredMessage", { count: stats.meetingsAttended })}
        </Text>
        <Text style={themed($statsText)}>
          {t("ninetyInNinety:totalTime", { time: stats.totalTimeFormatted })}
        </Text>
        <Button
          tx="ninetyInNinety:startNew"
          preset="default"
          onPress={handleReset}
          style={themed($startButton)}
        />
      </View>
    )
  }

  // ======== COMPLETE STATE ========
  if (stats.isComplete) {
    return (
      <View style={[themed($card), cardGlowStyle]}>
        <Text style={themed($title)}>{t("ninetyInNinety:titleComplete")}</Text>
        <Ionicons name="trophy" size={48} color={theme.colors.tint} style={$trophyIcon} />
        <Text style={themed($congratsText)}>{t("ninetyInNinety:congratulations")}</Text>
        <Text style={themed($statsText)}>{t("ninetyInNinety:challengeComplete")}</Text>
        <Text style={themed($statsText)}>
          {t("ninetyInNinety:totalTime", { time: stats.totalTimeFormatted })}
        </Text>

        {/* Certificate buttons */}
        <View style={themed($certificateSection)}>
          {!hasCertificate ? (
            <Button
              tx="ninetyInNinety:getCertificate"
              preset="filled"
              onPress={handleGetCertificate}
              disabled={isGenerating}
              style={themed($certificateButton)}
            />
          ) : (
            <View style={$certificateRow}>
              <Button
                tx="ninetyInNinety:viewCertificate"
                preset="filled"
                onPress={handleViewCertificate}
                style={[$certificateRowButton, { marginRight: theme.spacing.sm }]}
              />
              <Button
                tx="ninetyInNinety:shareCertificate"
                preset="default"
                onPress={handleViewCertificate}
                style={$certificateRowButton}
              />
            </View>
          )}
        </View>

        <Pressable
          onPress={handleReset}
          style={themed($resetPressable)}
          accessibilityRole="button"
          accessibilityLabel={t("ninetyInNinety:startNew")}
        >
          <Text style={themed($resetText)}>{t("ninetyInNinety:startNew")}</Text>
        </Pressable>
      </View>
    )
  }

  // ======== IN PROGRESS STATE ========
  return (
    <View style={[themed($card), { borderColor: theme.colors.border }]}>
      {/* Title */}
      <Text style={themed($title)}>{t("ninetyInNinety:title")}</Text>

      {/* Hero stat */}
      <Text style={themed($heroText)}>
        {t("ninetyInNinety:meetingsCount", { count: stats.meetingsAttended })}
      </Text>
      <Text style={themed($statsLabel)}>{t("ninetyInNinety:meetingsLabel")}</Text>

      {/* Hours attended */}
      <Text style={themed($statsText)}>
        {t("ninetyInNinety:hoursAttended", { hours: stats.totalHours })}
      </Text>

      {/* Progress bar */}
      <View style={themed($progressTrack)}>
        <View style={[$progressFill, progressWidth]} />
      </View>

      {/* Day counter */}
      <View style={$dayRow}>
        <Text style={themed($dayText)}>
          {t("ninetyInNinety:dayProgress", { current: stats.daysElapsed })}
        </Text>
        <Text style={themed($dayText)}>
          {t("ninetyInNinety:daysRemaining", { count: stats.daysRemaining })}
        </Text>
      </View>

      {/* Daily attendance bar chart */}
      {stats.dailyMinutes.length > 0 && (
        <View style={themed($chartSection)}>
          <DailyBarChart
            data={stats.dailyMinutes}
            tintColor={theme.colors.tint}
            dimColor={theme.colors.textDim}
            borderColor={theme.colors.border}
          />
        </View>
      )}

      {/* Strict mode section — disabled for now, may come back later
      <View style={themed($strictSection)}>
        <View style={$strictHeader}>
          <View style={$strictLabelColumn}>
            <Text style={themed($strictLabel)}>{t("ninetyInNinety:strictMode")}</Text>
            <Text style={themed($strictDescription)}>{t("ninetyInNinety:strictDescription")}</Text>
          </View>
          <Switch value={profileStore.ninetyStrictMode} onValueChange={handleToggleStrict} />
        </View>

        {profileStore.ninetyStrictMode && (
          <Text
            style={[
              themed($strictCompliance),
              { color: stats.strictSatisfied ? theme.colors.tint : theme.colors.textDim },
            ]}
          >
            {t("ninetyInNinety:strictCompliant", {
              compliant: stats.strictCompliantDays,
              total: stats.daysElapsed,
            })}
          </Text>
        )}

        {stats.strictFailed && profileStore.ninetyStrictMode && (
          <View style={themed($warningBanner)}>
            <Ionicons name="warning" size={16} color={theme.colors.error} />
            <Text style={[themed($warningText), { color: theme.colors.error }]}>
              {t("ninetyInNinety:strictFailed")}
            </Text>
          </View>
        )}
      </View>
      */}

      {/* Debug buttons — DEV only */}
      {__DEV__ && (
        <>
          <Button
            text={`Debug: Add Day ${profileStore.ninetyDebugDay + 1}`}
            preset="default"
            onPress={handleDebugInsert}
            style={themed($startButton)}
          />
          <Button
            text="Debug: Delete All Attendance"
            preset="default"
            onPress={handleDebugDeleteAll}
            style={themed($startButton)}
          />
        </>
      )}

      {/* Reset */}
      <Pressable onPress={handleReset} style={themed($resetPressable)}>
        <Text style={themed($resetText)}>{t("ninetyInNinety:resetButton")}</Text>
      </Pressable>
    </View>
  )
})

// ============================================================================
// Styles
// ============================================================================

const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 20,
  padding: spacing.lg,
  marginTop: spacing.lg,
  borderWidth: 1,
  shadowOffset: { width: 0, height: 0 },
  elevation: 8,
  overflow: "hidden",
})

const $title: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 13,
  fontWeight: "600",
  color: colors.textDim,
  marginBottom: spacing.sm,
  textTransform: "uppercase",
  letterSpacing: 1,
  textAlign: "center",
})

const $description: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  color: colors.textDim,
  textAlign: "center",
  marginBottom: spacing.md,
  lineHeight: 20,
})

const $heroText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 28,
  fontWeight: "700",
  lineHeight: 36,
  color: colors.tint,
  textAlign: "center",
  marginBottom: 4,
})

const $statsLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontWeight: "500",
  color: colors.textDim,
  textAlign: "center",
  marginBottom: 4,
})

const $statsText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
  textAlign: "center",
  marginBottom: 4,
})

const $congratsText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 20,
  fontWeight: "700",
  color: colors.tint,
  textAlign: "center",
  marginBottom: spacing.xs,
})

const $trophyIcon: ViewStyle = {
  alignSelf: "center",
  marginBottom: 8,
}

const $progressTrack: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  height: 6,
  backgroundColor: colors.border,
  borderRadius: 3,
  overflow: "hidden",
  marginTop: spacing.sm,
  marginBottom: spacing.xs,
})

const $progressFill: ViewStyle = {
  height: "100%",
  borderRadius: 3,
}

const $dayRow: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  marginBottom: 4,
}

const $dayText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
})

const $chartSection: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  borderTopWidth: 1,
  borderTopColor: colors.border,
  paddingTop: spacing.sm,
  marginTop: spacing.sm,
})

const $chartContainer: ViewStyle = {
  height: CHART_HEIGHT + 24, // chart + x-axis labels
}

const $chartInner: ViewStyle = {
  flexDirection: "row",
  alignItems: "flex-end",
  height: CHART_HEIGHT + 24,
}

const $yAxis: ViewStyle = {
  justifyContent: "space-between",
  height: CHART_HEIGHT,
  marginRight: 4,
  paddingBottom: 0,
}

const $barsRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "flex-end",
  height: CHART_HEIGHT + 16, // room for x-axis label
}

const $barColumn: ViewStyle = {
  alignItems: "center",
  width: 10,
  marginHorizontal: 1,
  overflow: "visible",
}

const $barTrack: ViewStyle = {
  width: 6,
  height: CHART_HEIGHT,
  justifyContent: "flex-end",
  borderBottomWidth: 1,
}

const $bar: ViewStyle = {
  width: "100%",
  borderRadius: 2,
}

const $axisLabel: TextStyle = {
  fontSize: 9,
  textAlign: "center",
  minWidth: 18,
}

// Strict mode styles — kept for when strict mode UI is re-enabled
// const $strictSection: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
//   borderTopWidth: 1,
//   borderTopColor: colors.border,
//   paddingTop: spacing.sm,
//   marginTop: spacing.sm,
// })
//
// const $strictHeader: ViewStyle = {
//   flexDirection: "row",
//   justifyContent: "space-between",
//   alignItems: "center",
// }
//
// const $strictLabelColumn: ViewStyle = {
//   flex: 1,
//   marginRight: 12,
// }
//
// const $strictLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
//   fontSize: 14,
//   fontWeight: "600",
//   color: colors.text,
// })
//
// const $strictDescription: ThemedStyle<TextStyle> = ({ colors }) => ({
//   fontSize: 12,
//   color: colors.textDim,
//   marginTop: 2,
// })
//
// const $strictCompliance: ThemedStyle<TextStyle> = ({ spacing }) => ({
//   fontSize: 13,
//   fontWeight: "500",
//   marginTop: spacing.xs,
// })
//
// const $warningBanner: ThemedStyle<ViewStyle> = ({ spacing }) => ({
//   flexDirection: "row",
//   alignItems: "center",
//   marginTop: spacing.xs,
//   gap: 6,
// })
//
// const $warningText: ThemedStyle<TextStyle> = () => ({
//   fontSize: 12,
//   fontWeight: "500",
//   flex: 1,
// })

const $startButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.sm,
})

const $certificateSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.md,
})

const $certificateButton: ThemedStyle<ViewStyle> = () => ({})

const $certificateRow: ViewStyle = {
  flexDirection: "row",
}

const $certificateRowButton: ViewStyle = {
  flex: 1,
}

const $resetPressable: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.md,
  alignSelf: "center",
  padding: spacing.xs,
})

const $resetText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
  textDecorationLine: "underline",
})
