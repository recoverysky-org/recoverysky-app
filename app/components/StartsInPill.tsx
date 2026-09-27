/**
 * Live's "Starts In" selector: Live · 15 · 30 · 45 · 60. ADDED 2026-09-26.
 *
 * A thin binding over SegmentedPill (like MapListToggle) so jest can mount it
 * without the screen. `disabled` greys the minute options while
 * maintenance/outage blocks fetching. SegmentedPill never disables the
 * active option, so Live stays reachable.
 *
 * CHANGED 2026-09-27 (Jenova): now reads `[Live Now]  Starts in [15m|30m|…]`
 * and shows only the minute chips in `available` — the screen prefetches all
 * four offsets and passes the ones with meetings (atNextLogic.availableStartsIn),
 * so a chip never opens onto an empty list. `disabled` is gone: while
 * maintenance/outage blocks fetching nothing is available, so the whole
 * control hides instead of showing greyed chips. Two pills rather than one so
 * the "Starts in" caption can sit between Live Now and the minutes; the
 * selection spans both (a pill whose `value` matches none of its options just
 * shows nothing filled). Renders nothing when no minute option is available —
 * a lone "Live Now" would be a control with only one choice.
 */
import { FC } from "react"
import { TextStyle, View, ViewStyle } from "react-native"
import { useTranslation } from "react-i18next"

import { SegmentedPill } from "@/components/SegmentedPill"
import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import type { StartsIn } from "@/utils/atNextLogic"

interface StartsInPillProps {
  value: StartsIn
  /** Minute options that have meetings, in order (never includes "live"). */
  available: readonly StartsIn[]
  onSelect: (value: StartsIn) => void
}

export const StartsInPill: FC<StartsInPillProps> = ({ value, available, onSelect }) => {
  const { t } = useTranslation()
  const { themed } = useAppTheme()

  if (available.length === 0) return null

  return (
    <View style={themed($row)}>
      <SegmentedPill<StartsIn>
        value={value}
        options={[{ value: "live", label: t("liveScreen:startsInLive") }]}
        onSelect={onSelect}
      />
      <Text style={themed($caption)}>{t("liveScreen:startsIn")}</Text>
      <SegmentedPill<StartsIn>
        value={value}
        accessibilityLabel={t("liveScreen:startsIn")}
        options={available.map((option) => ({
          value: option,
          label: t("liveScreen:startsInMinutes", { minutes: option }),
          accessibilityLabel: t("liveScreen:startsInMinutesA11y", { minutes: option }),
        }))}
        onSelect={onSelect}
      />
    </View>
  )
}

// Wraps on narrow phones rather than clipping the last chip: Live Now +
// caption + four chips is ~330dp at default text size.
const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: spacing.xs,
})

const $caption: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})
