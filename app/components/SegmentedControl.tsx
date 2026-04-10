import { FC } from "react"
import { Pressable, StyleProp, TextStyle, View, ViewStyle } from "react-native"
import { TOptions } from "i18next"

import { translate, TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { Text } from "./Text"

export interface Segment {
  /** Unique key for the segment */
  key: string
  /** i18n translation key */
  tx?: TxKeyPath
  /** Direct label text (used if tx not provided) */
  label?: string
  /** Optional i18n interpolation options */
  txOptions?: TOptions
}

export interface SegmentedControlProps {
  /** Array of segment definitions */
  segments: Segment[]
  /** Currently selected segment index (0-based) */
  selectedIndex: number
  /** Callback when segment is selected */
  onChange: (index: number) => void
  /** Optional style override for the container */
  style?: StyleProp<ViewStyle>
}

/**
 * iOS-style segmented control with rounded pill design.
 * Supports i18n via tx prop on segments.
 */
export const SegmentedControl: FC<SegmentedControlProps> = function SegmentedControl({
  segments,
  selectedIndex,
  onChange,
  style: $styleOverride,
}) {
  const { themed } = useAppTheme()

  return (
    <View style={[themed($container), $styleOverride]} accessibilityRole="tablist">
      {segments.map((segment, index) => {
        const isSelected = index === selectedIndex

        return (
          <Pressable
            key={segment.key}
            style={[themed($segment), isSelected && themed($segmentSelected)]}
            onPress={() => onChange(index)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={segment.label || (segment.tx ? translate(segment.tx, segment.txOptions) : undefined)}
          >
            <Text
              tx={segment.tx}
              txOptions={segment.txOptions}
              text={segment.label}
              style={[themed($segmentText), isSelected && themed($segmentTextSelected)]}
            />
          </Pressable>
        )
      })}
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  backgroundColor: colors.card,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: colors.border,
  padding: 2,
  marginHorizontal: spacing.md,
})

const $segment: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.sm,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 6,
})

const $segmentSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint,
})

const $segmentText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  fontWeight: "600",
  color: colors.text,
})

const $segmentTextSelected: ThemedStyle<TextStyle> = () => ({
  color: "#FFFFFF",
})
