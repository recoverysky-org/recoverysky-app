import { FC } from "react"
import { useTranslation } from "react-i18next"

import { SegmentedPill } from "@/components/SegmentedPill"

export type InPersonViewMode = "list" | "map"

interface MapListToggleProps {
  viewMode: InPersonViewMode
  /** Offline → disabled (spec Error handling #3: blank tiles beat nobody) */
  disabled?: boolean
  onToggle: () => void
}

/**
 * The In-Person segment's list/map switch. Lives at the end of the segment
 * header's title row. Standalone (not inlined in the header) so jest can
 * exercise it without mocking the MapLibre native module the map side of the
 * toggle implies.
 *
 * CHANGED 2026-08-12 (Jenova): was a single bare 22px glyph showing only the
 * destination — tap the map icon to get a map. Users were not finding it. Two
 * problems compounded: it sat beside an identical-weight settings gear, so the
 * pair read as decoration rather than as one live control (that gear is now
 * gone from all three segment headers), and a lone unlabeled icon never
 * announces that a map exists at all — you had to already know.
 *
 * It is now a two-segment pill showing BOTH destinations at once, with the
 * active one filled. That is the whole point of the redesign: the word "Map"
 * is on screen before any interaction, so the feature is discoverable rather
 * than merely reachable. The cost is width (~140dp vs 22dp), which the freed
 * gear slot pays for.
 *
 * CHANGED 2026-09-06: the pill itself moved to `SegmentedPill` so the new
 * sort-order control could share it; this file is now just the list/map
 * binding. The a11y and disabling rules live there.
 *
 * `onToggle` deliberately keeps its no-argument signature — tapping the
 * ALREADY-ACTIVE half is a no-op rather than a flip, so the caller can go on
 * owning "which mode is next" without this component learning about modes it
 * doesn't render. Do not "fix" this into `onSelect(mode)` without checking
 * InPersonScreen's `handleToggleView`, which is written as a flip.
 */
export const MapListToggle: FC<MapListToggleProps> = ({ viewMode, disabled, onToggle }) => {
  const { t } = useTranslation()

  return (
    <SegmentedPill<InPersonViewMode>
      value={viewMode}
      // `disabled` is set only while the list is up and we're offline (see
      // mapToggleDisabled in InPersonScreen), so flagging both halves is safe:
      // SegmentedPill never disables the active one, and leaving map mode
      // must always be possible.
      options={[
        {
          value: "list",
          label: t("inPersonScreen:viewList"),
          icon: "list-outline",
          disabled,
          disabledHint: t("inPersonScreen:mapOffline"),
        },
        {
          value: "map",
          label: t("inPersonScreen:viewMap"),
          icon: "map-outline",
          disabled,
          disabledHint: t("inPersonScreen:mapOffline"),
        },
      ]}
      // SegmentedPill only fires for the inactive half, so every call is a flip.
      onSelect={onToggle}
    />
  )
}
