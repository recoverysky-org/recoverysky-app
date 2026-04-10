/**
 * RecoveryChartCard Component
 *
 * Home screen card showing a bar chart of daily meeting minutes
 * over a selectable time range. Uses a modal dropdown for range
 * selection following the LiveScreen fellowship selector pattern.
 */

import { useCallback, useState } from "react"
import {
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
  ViewStyle,
  TextStyle,
} from "react-native"
import * as Crypto from "expo-crypto"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/Button"
import { Text } from "@/components/Text"
import { useToast } from "@/components/Toast"
import { attendanceRepo } from "@/db"
import { useRecoveryChart, type ChartRange, type ChartDay } from "@/hooks/useRecoveryChart"
import { useAuthenticationStore } from "@/models"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const CHART_HEIGHT = 120
const BAR_MIN_HEIGHT = 2
const TRANSPARENT = "transparent"

interface RangeOption {
  value: ChartRange
  labelKey: string
}

const RANGE_OPTIONS: RangeOption[] = [
  { value: 7, labelKey: "recoveryChart:days7" },
  { value: 30, labelKey: "recoveryChart:days30" },
  { value: 60, labelKey: "recoveryChart:days60" },
  { value: 90, labelKey: "recoveryChart:days90" },
  { value: "all", labelKey: "recoveryChart:allTime" },
]

/**
 * Compute label spacing based on number of data points
 */
function getLabelInterval(count: number): number {
  if (count <= 7) return 1
  if (count <= 30) return 5
  if (count <= 60) return 10
  if (count <= 90) return 15
  return 30
}

/**
 * Compute nice Y-axis tick values
 */
function getYTicks(maxValue: number): number[] {
  if (maxValue === 0) return [60, 30, 0]
  const ceiling = Math.ceil(maxValue / 50) * 50 || maxValue + 10
  return [ceiling, Math.round(ceiling / 2), 0]
}

// ============================================================================
// Chart sub-component
// ============================================================================

function RecoveryBarChart({
  data,
  maxMinutes,
  tintColor,
  dimColor,
  borderColor,
}: {
  data: ChartDay[]
  maxMinutes: number
  tintColor: string
  dimColor: string
  borderColor: string
}) {
  const yMax = maxMinutes > 0 ? Math.ceil(maxMinutes / 50) * 50 || maxMinutes + 10 : 60
  const yTicks = getYTicks(maxMinutes)
  const labelInterval = getLabelInterval(data.length)

  // Wider bars when fewer data points
  const colWidth = data.length <= 7 ? 36 : data.length <= 14 ? 20 : 10
  const barWidth = data.length <= 7 ? 16 : data.length <= 14 ? 12 : 7

  return (
    <View style={$chartWrapper}>
      {/* Y-axis ticks */}
      <View style={$yAxis}>
        {yTicks.map((tick, i) => (
          <Text key={i} style={[$yLabel, { color: dimColor }]}>
            {tick}
          </Text>
        ))}
      </View>

      {/* Chart area */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={$scrollArea}>
        <View>
          {/* Bar tracks — fixed height, labels cannot affect alignment */}
          <View style={$barsContainer}>
            {data.map((d) => {
              const barHeight =
                d.minutes > 0 ? Math.max((d.minutes / yMax) * CHART_HEIGHT, BAR_MIN_HEIGHT) : 0
              return (
                <View key={d.date} style={[$barCol, { width: colWidth }]}>
                  <View style={[$barTrack, { borderColor, width: barWidth }]}>
                    <View style={[$bar, { height: barHeight, backgroundColor: tintColor }]} />
                  </View>
                </View>
              )
            })}
          </View>
          {/* X-axis labels — separate row so sizing can't push bars */}
          <View style={$labelsRow}>
            {data.map((d, i) => {
              const isEdge = i === 0 || i === data.length - 1
              const showLabel = isEdge || (i + 1) % labelInterval === 0
              const labelColor = showLabel ? dimColor : TRANSPARENT
              return (
                <View key={d.date} style={[$labelCol, { width: colWidth }]}>
                  <Text style={[$xLabel, { color: labelColor }]}>{d.label}</Text>
                </View>
              )
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

// ============================================================================
// Main component
// ============================================================================

const log = logger.child({ module: "RecoveryChartCard" })

export const RecoveryChartCard = observer(function RecoveryChartCard() {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const authStore = useAuthenticationStore()
  const toast = useToast()
  const [range, setRange] = useState<ChartRange>(30)
  const [modalVisible, setModalVisible] = useState(false)
  const chart = useRecoveryChart(range)

  const selectedLabel = RANGE_OPTIONS.find((o) => o.value === range)?.labelKey ?? ""

  const handleDebugPopulate = useCallback(async () => {
    if (!__DEV__) return
    const uid = authStore.userId
    if (!uid) return

    try {
      const today = new Date()
      for (let i = 0; i < 365; i++) {
        const day = new Date(today)
        day.setDate(day.getDate() - i)
        const creditMinutes = 20 + Math.floor(Math.random() * 101)
        const creditMs = creditMinutes * 60_000
        const startMs = day.setHours(10, 0, 0, 0)
        const endMs = startMs + creditMs
        await attendanceRepo.create({
          id: Crypto.randomUUID(),
          uid,
          mid: `debug-chart-${i}`,
          zid: `debug-chart-zid-${i}`,
          created: Date.now(),
          valid: true,
          processed: Date.now(),
          start: startMs,
          end: endMs,
          credit: creditMs,
          meetingName: `Debug Chart Day ${i}`,
          meetingHost: "Debug",
        })
      }
      toast.showToast({ message: "365 days of attendance added", type: "success" })
      log.info("Debug chart data populated", { days: 365 })
      await chart.refresh()
    } catch (error) {
      log.error("Debug populate failed", { error: String(error) })
      toast.showToast({ message: "Debug populate failed", type: "error" })
    }
  }, [authStore.userId, chart, toast])

  return (
    <View style={themed($card)}>
      {/* Range selector */}
      <TouchableOpacity
        style={themed($selectorButton)}
        onPress={() => setModalVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t("recoveryChart:selectRange")}, ${t(selectedLabel)}`}
      >
        <Text style={themed($selectorValue)}>{t(selectedLabel)}</Text>
        <Ionicons name="chevron-down" size={16} color={theme.colors.tint} />
      </TouchableOpacity>

      {/* Range selection modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={themed($modalOverlay)}
          onPress={() => setModalVisible(false)}
          accessibilityLabel={t("common:close")}
        >
          <View style={themed($modalContent)} accessibilityViewIsModal>
            <Text style={themed($modalTitle)}>{t("recoveryChart:selectRange")}</Text>
            {RANGE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={String(opt.value)}
                style={[themed($modalOption), range === opt.value && themed($modalOptionSelected)]}
                onPress={() => {
                  setRange(opt.value)
                  setModalVisible(false)
                }}
                accessibilityRole="radio"
                accessibilityLabel={t(opt.labelKey)}
                accessibilityState={{ selected: range === opt.value }}
              >
                <Text
                  style={[
                    themed($modalOptionText),
                    range === opt.value && themed($modalOptionTextSelected),
                  ]}
                >
                  {t(opt.labelKey)}
                </Text>
                {range === opt.value && (
                  <Ionicons name="checkmark" size={18} color={theme.colors.tint} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Legend */}
      <View style={$legendRow}>
        <View style={[$legendSwatch, { backgroundColor: theme.colors.tint }]} />
        <Text style={themed($legendText)}>{t("recoveryChart:legend")}</Text>
      </View>

      {/* Chart */}
      {chart.days.length > 0 ? (
        <RecoveryBarChart
          data={chart.days}
          maxMinutes={chart.maxMinutes}
          tintColor={theme.colors.tint}
          dimColor={theme.colors.textDim}
          borderColor={theme.colors.border}
        />
      ) : (
        <Text style={themed($noData)}>{t("recoveryChart:noData")}</Text>
      )}

      {/* Debug button — DEV only */}
      {__DEV__ && (
        <Button
          text="Debug: Populate 365 Days"
          preset="default"
          onPress={handleDebugPopulate}
          style={themed($debugButton)}
        />
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

// Selector (from LiveScreen pattern)
const $selectorButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  borderRadius: 8,
  backgroundColor: colors.background,
  borderWidth: 1,
  borderColor: colors.border,
  marginBottom: spacing.md,
})

const $selectorValue: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.text,
})

// Modal (from LiveScreen pattern)
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

// Legend
const $legendRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 12,
  gap: 6,
}

const $legendSwatch: ViewStyle = {
  width: 12,
  height: 12,
  borderRadius: 2,
}

const $legendText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
})

// Chart
const $chartWrapper: ViewStyle = {
  flexDirection: "row",
}

const $yAxis: ViewStyle = {
  justifyContent: "space-between",
  height: CHART_HEIGHT,
  marginRight: 6,
  marginBottom: 20, // match x-label space so 0 aligns with bar baseline
  alignItems: "flex-end",
}

const $yLabel: TextStyle = {
  fontSize: 10,
}

const $scrollArea: ViewStyle = {
  flex: 1,
}

const $barsContainer: ViewStyle = {
  flexDirection: "row",
  alignItems: "flex-end",
  height: CHART_HEIGHT,
}

const $barCol: ViewStyle = {
  alignItems: "center",
  marginHorizontal: 1,
}

const $labelsRow: ViewStyle = {
  flexDirection: "row",
  height: 16,
}

const $labelCol: ViewStyle = {
  alignItems: "center",
  marginHorizontal: 1,
}

const $barTrack: ViewStyle = {
  height: CHART_HEIGHT,
  justifyContent: "flex-end",
  borderBottomWidth: 1,
}

const $bar: ViewStyle = {
  width: "100%",
  borderRadius: 2,
}

const $xLabel: TextStyle = {
  fontSize: 9,
  textAlign: "center",
  minWidth: 28,
}

const $debugButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.md,
})

const $noData: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  fontSize: 14,
  color: colors.textDim,
  textAlign: "center",
  paddingVertical: spacing.xl,
})
