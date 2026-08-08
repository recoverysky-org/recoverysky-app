import { FC } from "react"
import { TouchableOpacity } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { useAppTheme } from "@/theme/context"

export type InPersonViewMode = "list" | "map"

interface MapListToggleProps {
  viewMode: InPersonViewMode
  /** Offline → disabled (spec Error handling #3: blank tiles beat nobody) */
  disabled?: boolean
  onToggle: () => void
}

/**
 * The In-Person segment's list/map switch. Lives in the segment header's
 * title row next to the settings gear (Task 8). Standalone (not inlined in
 * the header) so jest can exercise it without mocking the MapLibre native
 * module the map side of the toggle implies.
 */
export const MapListToggle: FC<MapListToggleProps> = ({ viewMode, disabled, onToggle }) => {
  const { t } = useTranslation()
  const { theme } = useAppTheme()

  // The label names the DESTINATION, not the current state — "Show map" while
  // the list is up — matching how the icon reads (you tap the thing you want).
  const label = viewMode === "list" ? t("inPersonScreen:showMap") : t("inPersonScreen:showList")

  return (
    <TouchableOpacity
      onPress={onToggle}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={disabled ? t("inPersonScreen:mapOffline") : undefined}
    >
      <Ionicons
        name={viewMode === "list" ? "map-outline" : "list-outline"}
        size={22}
        color={disabled ? theme.colors.textDim : theme.colors.tint}
      />
    </TouchableOpacity>
  )
}
