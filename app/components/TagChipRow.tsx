import { FC } from "react"
import { ScrollView, TouchableOpacity, ViewStyle, TextStyle } from "react-native"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface TagChipRowProps {
  /** Vocabulary to offer — see `availableTags()` in filterLogic.ts for the order. */
  tags: readonly string[]
  /** Tags currently filtering the list. Selected chips AND together. */
  selected: readonly string[]
  onToggle: (tag: string) => void
  /** Screen-reader name for the row as a whole (e.g. "Tags"). */
  accessibilityLabel?: string
}

/**
 * The Search segment's tag facet: a horizontally scrolling row of toggle
 * chips built from the tags present in the current result pool.
 *
 * Presentational only — no store reads, no i18n beyond the label prop — so
 * jest can mount it without the MST tree (same reason `PermissionsSection`
 * and `MapListToggle` are standalone). Tags are shown verbatim: they are
 * free-form strings from meeting sources (`beginner-friendly`, `step-work`)
 * with no label map, and the popups already render them raw.
 *
 * Deliberately NOT inside the FlatList's `ListHeaderComponent`. That header
 * is an inline `useCallback` that re-renders whenever the result count
 * changes, which is every keystroke in the search box above this row — a
 * remounting header would also drop the box's keyboard focus (the FlatList
 * trap noted in CLAUDE.md). ListingsScreen renders both as siblings above
 * the list instead.
 */
export const TagChipRow: FC<TagChipRowProps> = ({
  tags,
  selected,
  onToggle,
  accessibilityLabel,
}) => {
  const { themed, theme } = useAppTheme()

  // Nothing to offer → no row at all, so the list doesn't gain an empty strip
  // of padding on pools that carry no tags (most in-person sources).
  if (tags.length === 0) return null

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={themed($row)}
      contentContainerStyle={themed($rowContent)}
      keyboardShouldPersistTaps="handled"
      accessibilityLabel={accessibilityLabel}
    >
      {tags.map((tag) => {
        const isSelected = selected.includes(tag)
        return (
          <TouchableOpacity
            key={tag}
            style={[themed($chip), isSelected && themed($chipSelected)]}
            onPress={() => onToggle(tag)}
            accessibilityRole="button"
            accessibilityLabel={tag}
            accessibilityState={{ selected: isSelected }}
          >
            <Text
              style={[
                themed($chipText),
                // Selected chip sits on the tint fill, so its text has to be the
                // on-tint colour rather than a theme text token — neutral100 is
                // white in both themes and tint is the same in both.
                isSelected && { color: theme.colors.palette.neutral100 },
              ]}
              numberOfLines={1}
            >
              {tag}
            </Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const $row: ThemedStyle<ViewStyle> = () => ({
  flexGrow: 0,
})

const $rowContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.md,
  paddingBottom: spacing.xs,
  gap: spacing.xs,
})

const $chip: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingHorizontal: spacing.sm,
  // 32dp tall — a touch under the 44dp guideline, accepted because chips are
  // laterally adjacent with no dead space and sit in their own strip with no
  // vertical neighbour to mis-hit.
  paddingVertical: 6,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.card,
})

const $chipSelected: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tint,
  borderColor: colors.tint,
})

const $chipText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontWeight: "600",
  lineHeight: 16,
  color: colors.tint,
})
