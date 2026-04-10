/**
 * MoneySavedCard Component
 *
 * Home screen card showing how much money the user has saved since
 * their recovery date. Supports a simple weekly total or detailed
 * per-day amounts with a daily tobacco add-on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, View, ViewStyle, TextStyle } from "react-native"
// eslint-disable-next-line no-restricted-imports
import { TextInput } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useProfileStore } from "@/models"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
const DAYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

// JS Date.getDay(): 0=Sun, 1=Mon, ... 6=Sat → map to our DayKey
const DOW_TO_KEY: DayKey[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/**
 * Count occurrences of each day-of-week from startIso to today (inclusive).
 */
function countDaysPerDow(startIso: string): Record<DayKey, number> {
  const counts: Record<DayKey, number> = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 }
  const start = new Date(startIso + "T12:00:00")
  const today = new Date()
  today.setHours(12, 0, 0, 0)

  const current = new Date(start)
  while (current <= today) {
    counts[DOW_TO_KEY[current.getDay()]]++
    current.setDate(current.getDate() + 1)
  }
  return counts
}

function formatMoney(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getDayAmount(profileStore: any, day: DayKey): number {
  return profileStore[`moneySaved${day}`] as number
}

// ============================================================================
// Inline input helper
// ============================================================================

function MoneyInput({
  value,
  onChange,
  onBlur,
  accessibilityLabel,
  textColor,
  dimColor,
  bgColor,
  borderColor,
}: {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  accessibilityLabel?: string
  textColor: string
  dimColor: string
  bgColor: string
  borderColor: string
}) {
  return (
    <View style={[$inputWrapper, { backgroundColor: bgColor, borderColor }]}>
      <Text style={[$currencySymbol, { color: dimColor }]} accessible={false}>$</Text>
      <TextInput
        style={[$input, { color: textColor }]}
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={dimColor}
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  )
}

// ============================================================================
// Main component
// ============================================================================

export const MoneySavedCard = observer(function MoneySavedCard() {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const profileStore = useProfileStore()
  const [expanded, setExpanded] = useState(false)

  // Weekly input (simple mode)
  const [weeklyInput, setWeeklyInput] = useState(
    profileStore.moneySavedWeekly > 0 ? String(profileStore.moneySavedWeekly) : "",
  )

  // Per-day inputs (detail mode)
  const [dayInputs, setDayInputs] = useState<Record<DayKey, string>>(() => {
    const init = {} as Record<DayKey, string>
    for (const d of DAYS) {
      const val = getDayAmount(profileStore, d)
      init[d] = val > 0 ? String(val) : ""
    }
    return init
  })

  // Tobacco input
  const [tobaccoInput, setTobaccoInput] = useState(
    profileStore.moneySavedTobacco > 0 ? String(profileStore.moneySavedTobacco) : "",
  )

  // Debounce weekly input — persist to store 2s after typing stops
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      const val = parseFloat(weeklyInput) || 0
      profileStore.setMoneySavedWeekly(val)
    }, 2000)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [weeklyInput, profileStore])

  // Also persist immediately on blur
  const handleWeeklyBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const val = parseFloat(weeklyInput) || 0
    profileStore.setMoneySavedWeekly(val)
    if (val === 0) setWeeklyInput("")
  }, [weeklyInput, profileStore])

  const handleDayBlur = useCallback(
    (day: DayKey) => {
      const val = parseFloat(dayInputs[day]) || 0
      profileStore.setMoneySavedDay(day, val)
      if (val === 0) setDayInputs((prev) => ({ ...prev, [day]: "" }))
    },
    [dayInputs, profileStore],
  )

  const handleTobaccoBlur = useCallback(() => {
    const val = parseFloat(tobaccoInput) || 0
    profileStore.setMoneySavedTobacco(val)
    if (val === 0) setTobaccoInput("")
  }, [tobaccoInput, profileStore])

  const updateDayInput = useCallback((day: DayKey, val: string) => {
    setDayInputs((prev) => ({ ...prev, [day]: val }))
  }, [])

  // Calculate savings — always based on the weekly total (detail inputs feed into it via Save)
  const savings = useMemo(() => {
    if (!profileStore.recoveryDate || profileStore.moneySavedWeekly <= 0) return null

    const counts = countDaysPerDow(profileStore.recoveryDate)
    const totalDays = Object.values(counts).reduce((a, b) => a + b, 0)
    const dailyAvg = profileStore.moneySavedWeekly / 7
    const total = totalDays * dailyAvg

    return { total, totalDays }
  }, [profileStore.recoveryDate, profileStore.moneySavedWeekly])

  return (
    <View style={themed($card)}>
      <Text style={themed($title)}>{t("moneySaved:title")}</Text>

      {/* Hero amount */}
      {savings && <Text style={themed($heroAmount)}>${formatMoney(savings.total)}</Text>}
      {savings && (
        <Text style={themed($subtitle)}>
          {t("moneySaved:totalDays", { count: savings.totalDays })}
        </Text>
      )}

      {/* Weekly spending input */}
      <View style={themed($inputSection)}>
        <View style={$inputRow}>
          <Text style={themed($inputLabel)}>{t("moneySaved:weeklySpending")}</Text>
          <MoneyInput
            value={weeklyInput}
            onChange={setWeeklyInput}
            onBlur={handleWeeklyBlur}
            accessibilityLabel={t("moneySaved:weeklySpending")}
            textColor={theme.colors.text}
            dimColor={theme.colors.textDim}
            bgColor={theme.colors.background}
            borderColor={theme.colors.border}
          />
        </View>
      </View>

      {/* Details expander */}
      <Pressable
        style={themed($expanderRow)}
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityLabel={t("moneySaved:details")}
        accessibilityState={{ expanded }}
      >
        <Text style={themed($expanderText)}>{t("moneySaved:details")}</Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={theme.colors.textDim}
        />
      </Pressable>

      {/* Expanded details */}
      {expanded && (
        <View style={themed($detailSection)}>
          {/* Per-day inputs */}
          {DAYS.map((day) => (
            <View key={day} style={$inputRow}>
              <Text style={themed($inputLabel)}>{t(`moneySaved:${day}` as any)}</Text>
              <MoneyInput
                value={dayInputs[day]}
                onChange={(v) => updateDayInput(day, v)}
                accessibilityLabel={t(`moneySaved:${day}` as any)}
                textColor={theme.colors.text}
                dimColor={theme.colors.textDim}
                bgColor={theme.colors.background}
                borderColor={theme.colors.border}
              />
            </View>
          ))}

          {/* Tobacco */}
          <View style={themed($tobaccoRow)}>
            <View style={$inputRow}>
              <Text style={themed($inputLabel)}>{t("moneySaved:tobacco")}</Text>
              <MoneyInput
                value={tobaccoInput}
                onChange={setTobaccoInput}
                accessibilityLabel={t("moneySaved:tobacco")}
                textColor={theme.colors.text}
                dimColor={theme.colors.textDim}
                bgColor={theme.colors.background}
                borderColor={theme.colors.border}
              />
            </View>
          </View>

          {/* Save button — persist per-day values, sum into weekly, close */}
          <Pressable
            style={themed($saveButton)}
            accessibilityRole="button"
            accessibilityLabel={t("moneySaved:save")}
            onPress={() => {
              DAYS.forEach((d) => handleDayBlur(d))
              handleTobaccoBlur()
              // Sum per-day + tobacco×7 into weekly input
              const dayTotal = DAYS.reduce((sum, d) => sum + (parseFloat(dayInputs[d]) || 0), 0)
              const tobaccoWeekly = (parseFloat(tobaccoInput) || 0) * 7
              const newWeekly = dayTotal + tobaccoWeekly
              profileStore.setMoneySavedWeekly(newWeekly)
              setWeeklyInput(newWeekly > 0 ? String(newWeekly) : "")
              setExpanded(false)
            }}
          >
            <Text style={themed($saveButtonText)}>{t("moneySaved:save")}</Text>
          </Pressable>
        </View>
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
  borderColor: colors.border,
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

const $heroAmount: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 32,
  fontWeight: "700",
  lineHeight: 40,
  color: colors.tint,
  textAlign: "center",
  marginBottom: 2,
})

const $subtitle: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 13,
  color: colors.textDim,
  textAlign: "center",
  marginBottom: spacing.md,
})

const $inputSection: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderTopWidth: 1,
  borderTopColor: colors.border,
  paddingTop: 12,
})

const $inputRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
}

const $inputLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.text,
  flex: 1,
})

const $inputWrapper: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  borderRadius: 8,
  borderWidth: 1,
  paddingHorizontal: 10,
  width: 100,
}

const $currencySymbol: TextStyle = {
  fontSize: 16,
  marginRight: 2,
}

const $input: TextStyle = {
  fontSize: 16,
  paddingVertical: 8,
  flex: 1,
}

const $expanderRow: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xs,
  marginTop: spacing.xs,
  gap: 4,
  borderTopWidth: 1,
  borderTopColor: colors.border,
})

const $expanderText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $detailSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.xs,
})

const $tobaccoRow: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  borderTopWidth: 1,
  borderTopColor: colors.border,
  paddingTop: spacing.sm,
  marginTop: spacing.xs,
})

const $saveButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  alignSelf: "center",
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.lg,
  borderRadius: 8,
  backgroundColor: colors.tint,
  marginTop: spacing.sm,
})

const $saveButtonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 14,
  fontWeight: "600",
  color: "#FFFFFF",
})
