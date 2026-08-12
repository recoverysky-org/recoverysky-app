import { FC } from "react"
import { TouchableOpacity, View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export type InPersonViewMode = "list" | "map"

interface MapListToggleProps {
  viewMode: InPersonViewMode
  /** Offline → disabled (spec Error handling #3: blank tiles beat nobody) */
  disabled?: boolean
  onToggle: () => void
}

const MODES: InPersonViewMode[] = ["list", "map"]

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
 * `onToggle` deliberately keeps its no-argument signature — tapping the
 * ALREADY-ACTIVE half is a no-op rather than a flip, so the caller can go on
 * owning "which mode is next" without this component learning about modes it
 * doesn't render. Do not "fix" this into `onSelect(mode)` without checking
 * InPersonScreen's `handleToggleView`, which is written as a flip.
 */
export const MapListToggle: FC<MapListToggleProps> = ({ viewMode, disabled, onToggle }) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  return (
    <View
      style={themed($track)}
      // The pill is one control made of two halves, so it announces as a
      // tablist and each half as a tab — that gives VoiceOver/TalkBack the
      // "selected" state a pair of plain buttons cannot express, which is
      // exactly the information a sighted user now gets from the fill.
      accessibilityRole="tablist"
    >
      {MODES.map((mode) => {
        const selected = viewMode === mode
        // Only the inactive half is ever disabled by `disabled`: it is set
        // only while the list is up and we're offline (see mapToggleDisabled
        // in InPersonScreen), and leaving map mode must always be possible.
        const isDisabled = !!disabled && !selected
        const label = mode === "list" ? t("inPersonScreen:viewList") : t("inPersonScreen:viewMap")
        // Active half sits on the tint fill, so its content has to be the
        // on-tint color rather than any theme text token — neutral100 is white
        // in both themes and tint is the same Electric Pink in both, so this
        // pair is stable. Not a hardcoded hex: the palette owns the value.
        const contentColor = selected
          ? theme.colors.palette.neutral100
          : isDisabled
            ? theme.colors.textDim
            : theme.colors.tint

        return (
          <TouchableOpacity
            key={mode}
            style={[themed($segment), selected && themed($segmentActive)]}
            // Tapping the active half does nothing. Calling onToggle here
            // would flip us AWAY from the mode the user just asked for.
            onPress={selected ? undefined : onToggle}
            // ONLY `isDisabled` — never `selected`. TouchableOpacity's
            // `disabled` prop overwrites whatever `accessibilityState` we pass,
            // so disabling the active half to make it inert made VoiceOver
            // announce the view you are CURRENTLY IN as unavailable. Inertness
            // comes from the undefined onPress above and activeOpacity below
            // instead, which leaves the a11y state saying the true thing:
            // selected, not disabled. Caught by MapListToggle.test.tsx.
            disabled={isDisabled}
            // No press flash on the active half — with onPress undefined the
            // dimming would be feedback for something that isn't going to
            // happen.
            activeOpacity={selected ? 1 : 0.2}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected, disabled: isDisabled }}
            accessibilityHint={isDisabled ? t("inPersonScreen:mapOffline") : undefined}
          >
            <Ionicons
              name={mode === "list" ? "list-outline" : "map-outline"}
              size={15}
              color={contentColor}
            />
            <Text style={[themed($segmentLabel), { color: contentColor }]} numberOfLines={1}>
              {label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

// Hairline-bordered track rather than a filled one: the header sits directly
// on `background` with no card behind it, and a filled track at this size
// competes with the heading next to it.
const $track: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flexDirection: "row",
  alignItems: "center",
  borderRadius: 16,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.card,
  // Clips the active half's square corners to the track's radius, which is
  // what lets $segmentActive stay a plain background fill with no per-corner
  // radius maths of its own.
  overflow: "hidden",
})

const $segment: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xxs,
  paddingHorizontal: spacing.sm,
  // 30dp tall. Below Apple's 44dp target on its own, which is acceptable here
  // and only here: the two halves are adjacent, so the pill as a whole is a
  // ~140×30 target with no dead space between the taps, and there is no
  // neighbouring control to mis-hit — the gear that used to sit beside it is
  // gone. Do not shrink it further.
  paddingVertical: 6,
})

const $segmentActive: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint,
})

const $segmentLabel: ThemedStyle<TextStyle> = () => ({
  fontSize: 13,
  fontWeight: "600",
  // Text's default lineHeight leaves the label sitting low against a 15px
  // icon; matching them centres the pair inside the fill.
  lineHeight: 16,
})
