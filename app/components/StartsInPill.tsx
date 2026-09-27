/**
 * Live's "Starts In" selector: Live · 15 · 30 · 45 · 60. ADDED 2026-09-26.
 *
 * A thin binding over SegmentedPill (like MapListToggle) so jest can mount it
 * without the screen. `disabled` greys the minute options while
 * maintenance/outage blocks fetching. SegmentedPill never disables the
 * active option, so Live stays reachable.
 */
import { FC } from "react"
import { useTranslation } from "react-i18next"

import { SegmentedPill } from "@/components/SegmentedPill"
import { STARTS_IN_OPTIONS, type StartsIn } from "@/utils/atNextLogic"

interface StartsInPillProps {
  value: StartsIn
  disabled?: boolean
  onSelect: (value: StartsIn) => void
}

export const StartsInPill: FC<StartsInPillProps> = ({ value, disabled, onSelect }) => {
  const { t } = useTranslation()

  return (
    <SegmentedPill<StartsIn>
      value={value}
      accessibilityLabel={t("liveScreen:startsIn")}
      options={STARTS_IN_OPTIONS.map((option) => ({
        value: option,
        label:
          option === "live"
            ? t("liveScreen:startsInLive")
            : t("liveScreen:startsInMinutes", { minutes: option }),
        disabled: option !== "live" && disabled,
      }))}
      onSelect={onSelect}
    />
  )
}
