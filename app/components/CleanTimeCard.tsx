/**
 * CleanTimeCard Component
 *
 * Hero card displaying the user's recovery time breakdown,
 * total days, clean date, and progress toward the next milestone.
 */

import { useMemo } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { DateTime, FELLOWSHIP_COLORS, Fellowship } from "@recoverysky-org/common/browser"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useProfileStore } from "@/models"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

// ============================================================================
// Milestones — standard 12-step recovery medallions/keytags
// ============================================================================

interface Milestone {
  days: number
  labelKey: string
}

const MILESTONES: Milestone[] = [
  { days: 1, labelKey: "cleanTime:milestone24Hours" },
  { days: 7, labelKey: "cleanTime:milestone1Week" },
  { days: 30, labelKey: "cleanTime:milestone30Days" },
  { days: 60, labelKey: "cleanTime:milestone60Days" },
  { days: 90, labelKey: "cleanTime:milestone90Days" },
  { days: 180, labelKey: "cleanTime:milestone6Months" },
  { days: 270, labelKey: "cleanTime:milestone9Months" },
  { days: 365, labelKey: "cleanTime:milestone1Year" },
  { days: 548, labelKey: "cleanTime:milestone18Months" },
  { days: 730, labelKey: "cleanTime:milestone2Years" },
  { days: 1095, labelKey: "cleanTime:milestone3Years" },
  { days: 1825, labelKey: "cleanTime:milestone5Years" },
  { days: 3650, labelKey: "cleanTime:milestone10Years" },
  { days: 5475, labelKey: "cleanTime:milestone15Years" },
  { days: 7300, labelKey: "cleanTime:milestone20Years" },
  { days: 9125, labelKey: "cleanTime:milestone25Years" },
  { days: 10950, labelKey: "cleanTime:milestone30Years" },
]

// ============================================================================
// Date math helpers
// ============================================================================

function computeBreakdown(recoveryDate: string) {
  const start = DateTime.fromISO(recoveryDate)
  const now = DateTime.now()
  const diff = now.diff(start, ["years", "months", "days"]).toObject()

  return {
    years: Math.floor(diff.years ?? 0),
    months: Math.floor(diff.months ?? 0),
    days: Math.floor(diff.days ?? 0),
    totalDays: Math.floor(now.diff(start, "days").days),
  }
}

function computeMilestoneProgress(totalDays: number) {
  const next = MILESTONES.find((m) => m.days > totalDays) ?? null
  const prev = [...MILESTONES].reverse().find((m) => m.days <= totalDays) ?? null
  const isOnMilestone = MILESTONES.some((m) => m.days === totalDays)

  const prevDays = prev?.days ?? 0
  const nextDays = next?.days ?? prevDays
  const span = nextDays - prevDays
  const progress = span > 0 ? Math.min((totalDays - prevDays) / span, 1) : 1

  return {
    next,
    progress,
    daysUntilNext: next ? next.days - totalDays : 0,
    isOnMilestone,
  }
}

// ============================================================================
// Component
// ============================================================================

export const CleanTimeCard = observer(function CleanTimeCard() {
  const { t, i18n } = useTranslation()
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()

  const breakdown = useMemo(
    () => computeBreakdown(profileStore.recoveryDate),
    [profileStore.recoveryDate],
  )

  const milestone = useMemo(
    () => computeMilestoneProgress(breakdown.totalDays),
    [breakdown.totalDays],
  )

  const fellowshipColor =
    FELLOWSHIP_COLORS[profileStore.fellowship as Fellowship] || FELLOWSHIP_COLORS[Fellowship.NONE]

  const formattedDate = useMemo(() => {
    return DateTime.fromISO(profileStore.recoveryDate)
      .setLocale(i18n.language)
      .toLocaleString(DateTime.DATE_FULL)
  }, [profileStore.recoveryDate, i18n.language])

  // Fellowship-aware "since" key: AA = sober, NA/RD = clean, others = recovering
  const sinceKey = useMemo(() => {
    const f = profileStore.fellowship
    if (f === Fellowship.AA) return "cleanTime:soberSince"
    if (f === Fellowship.NA || f === Fellowship.RD) return "cleanTime:cleanSince"
    return "cleanTime:recoveringSince"
  }, [profileStore.fellowship])

  // Build hero text: "2 Years, 3 Months, 14 Days" — skip zero units
  const heroText = useMemo(() => {
    const parts: string[] = []
    if (breakdown.years > 0) {
      parts.push(t("cleanTime:year", { count: breakdown.years }))
    }
    if (breakdown.months > 0) {
      parts.push(t("cleanTime:month", { count: breakdown.months }))
    }
    // Always show days (even if 0, when years and months are also 0)
    if (breakdown.days > 0 || parts.length === 0) {
      parts.push(t("cleanTime:day", { count: breakdown.days }))
    }
    return parts.join(", ")
  }, [breakdown, t])

  // Dynamic card glow style — enhanced on milestone days
  const cardGlowStyle = useMemo<ViewStyle>(
    () => ({
      borderColor: theme.colors.tint,
      shadowColor: theme.colors.tint,
      shadowOpacity: milestone.isOnMilestone ? 0.9 : 0.6,
      shadowRadius: milestone.isOnMilestone ? 12 : 6,
    }),
    [theme.colors.tint, milestone.isOnMilestone],
  )

  const progressWidth = useMemo<ViewStyle>(
    () => ({
      width: `${Math.round(milestone.progress * 100)}%`,
      backgroundColor: theme.colors.tint,
    }),
    [milestone.progress, theme.colors.tint],
  )

  if (!profileStore.isHydrated) return null

  return (
    <View style={[themed($card), cardGlowStyle]}>
      {/* Fellowship accent bar */}
      <View style={[$accentBar, { backgroundColor: fellowshipColor }]} />

      {/* Title */}
      <Text style={themed($title)}>{t("cleanTime:yourRecovery")}</Text>

      {/* Hero breakdown */}
      <Text style={themed($heroText)}>{heroText}</Text>

      {/* Total days */}
      <Text style={themed($totalDays)}>
        {t("cleanTime:totalDays", { count: breakdown.totalDays })}
      </Text>

      {/* Since date — fellowship-aware wording */}
      <Text style={themed($cleanSince)}>{t(sinceKey, { date: formattedDate })}</Text>

      {/* Milestone progress */}
      {milestone.next && (
        <View style={themed($milestoneSection)}>
          <Text style={themed($milestoneLabel)}>
            {t("cleanTime:nextMilestone", { milestone: t(milestone.next.labelKey) })}
          </Text>
          <View style={themed($progressTrack)}>
            <View style={[$progressFill, progressWidth]} />
          </View>
          <Text style={themed($daysToGo)}>
            {t("cleanTime:daysToGo", { count: milestone.daysUntilNext })}
          </Text>
        </View>
      )}

      {/* Milestone celebration */}
      {milestone.isOnMilestone && (
        <Text style={themed($congratulations)}>{t("cleanTime:congratulations")}</Text>
      )}
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
  borderColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  elevation: 8,
  overflow: "hidden",
})

const $accentBar: ViewStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 3,
}

const $title: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 13,
  fontWeight: "600",
  color: colors.textDim,
  marginBottom: spacing.sm,
  textTransform: "uppercase",
  letterSpacing: 1,
  textAlign: "center",
})

const $heroText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 28,
  fontWeight: "700",
  color: colors.tint,
  textAlign: "center",
  marginBottom: 4,
})

const $totalDays: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  fontWeight: "500",
  color: colors.textDim,
  textAlign: "center",
  marginBottom: 2,
})

const $cleanSince: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  color: colors.textDim,
  textAlign: "center",
  marginBottom: spacing.md,
})

const $milestoneSection: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderTopWidth: 1,
  borderTopColor: colors.border,
  paddingTop: 12,
})

const $milestoneLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontWeight: "600",
  color: colors.text,
  marginBottom: 6,
})

const $progressTrack: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: 6,
  backgroundColor: colors.border,
  borderRadius: 3,
  overflow: "hidden",
  marginBottom: 6,
})

const $progressFill: ViewStyle = {
  height: "100%",
  borderRadius: 3,
}

const $daysToGo: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
})

const $congratulations: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 16,
  fontWeight: "700",
  color: colors.tint,
  textAlign: "center",
  marginTop: spacing.sm,
})
