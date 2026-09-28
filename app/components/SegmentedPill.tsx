import { ComponentProps } from "react"
import { TouchableOpacity, View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

type IoniconName = ComponentProps<typeof Ionicons>["name"]

export interface SegmentedPillOption<T extends string> {
  value: T
  /** Already-translated noun for the half ("Map", "Distance"). Doubles as its a11y label. */
  label: string
  /** Optional: text-only pills (e.g. Starts In's "15 min") omit it. ADDED 2026-09-26. */
  icon?: IoniconName
  /** Greys this half out and blocks its press. The ACTIVE half ignores it — see below. */
  disabled?: boolean
  /** Read after the label while the half is disabled, to say why. */
  disabledHint?: string
  /**
   * Overrides `label` for screen readers when the visible text is an
   * abbreviation ("15m" → "Starts in 15 minutes"). ADDED 2026-09-27.
   */
  accessibilityLabel?: string
}

interface SegmentedPillProps<T extends string> {
  options: SegmentedPillOption<T>[]
  value: T
  /** Fires only for a half that is NOT already active — see the note on the active half. */
  onSelect: (value: T) => void
  /** Announced for the whole control ("Sort by"), so a screen reader hears what the halves choose between. */
  accessibilityLabel?: string
}

/**
 * A two-(or-more-)segment pill showing every choice at once with the active
 * one filled. EXTRACTED 2026-09-06 from `MapListToggle` when the In-Person
 * list grew a second one (sort order); the visual and a11y reasoning below
 * came with it verbatim and is the contract for every consumer.
 *
 * WHY EVERY OPTION IS ALWAYS ON SCREEN: the original list/map control was a
 * single bare glyph naming only the destination, and users were not finding
 * it — a lone unlabeled icon never announces that a map exists at all. A pill
 * puts the word on screen before any interaction, so the feature is
 * discoverable rather than merely reachable. The cost is width (~140dp for
 * two halves), so keep labels to one short noun each.
 *
 * Tapping the ALREADY-ACTIVE half is a no-op, not a re-select: `onSelect`
 * never fires for it. Consumers can therefore treat every call as a change.
 *
 * Disabling: `disabled` on an option is honoured only while that option is
 * inactive — the active half is never disabled, so leaving the current state
 * must always be possible (offline on the map still needs a way back to the
 * list).
 */
export function SegmentedPill<T extends string>({
  options,
  value,
  onSelect,
  accessibilityLabel,
}: SegmentedPillProps<T>) {
  const { themed, theme } = useAppTheme()

  return (
    <View
      style={themed($track)}
      // The pill is one control made of two halves, so it announces as a
      // tablist and each half as a tab — that gives VoiceOver/TalkBack the
      // "selected" state a pair of plain buttons cannot express, which is
      // exactly the information a sighted user gets from the fill.
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = value === option.value
        // Only an inactive half is ever disabled — see the doc comment.
        const isDisabled = !!option.disabled && !selected
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
            key={option.value}
            style={[themed($segment), selected && themed($segmentActive)]}
            // Tapping the active half does nothing. Firing onSelect here would
            // report a change the user did not make.
            onPress={selected ? undefined : () => onSelect(option.value)}
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
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected, disabled: isDisabled }}
            accessibilityHint={isDisabled ? option.disabledHint : undefined}
          >
            {option.icon && <Ionicons name={option.icon} size={15} color={contentColor} />}
            <Text style={[themed($segmentLabel), { color: contentColor }]} numberOfLines={1}>
              {option.label}
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
  // and only here: the halves are adjacent, so the pill as a whole is a
  // ~140×30 target with no dead space between the taps, and there is no
  // neighbouring control to mis-hit. Do not shrink it further.
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
