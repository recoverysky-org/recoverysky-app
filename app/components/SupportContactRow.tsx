import { FC } from "react"
import { Pressable, StyleProp, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { Text } from "@/components/Text"
import type { TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface SupportContactRowProps {
  roleTx: TxKeyPath
  name: string
  onCall: () => void
  onText: () => void
  /** The Support screen's More menu. The Home card passes none and shows no More button. */
  onMore?: () => void
  /**
   * Edit mode (the Home card's pencil): when set, the row shows one trash button in place of
   * Call, Text and More, so a tap while editing can only ever remove, never dial.
   */
  onRemove?: () => void
  /** Overrides the row's own box, for the Home card where the row sits inside a card. */
  style?: StyleProp<ViewStyle>
  testID?: string
}

/**
 * One support contact: "Sponsor · Julie J." with Call, Text and More buttons.
 * ADDED 2026-11-06 (Support Contacts).
 *
 * NAMES ONLY (spec D1): the props carry no phone number, by design. The row
 * takes a role key and a display name, never a `SupportContact`, so there is no
 * path by which a number could reach its text, its accessibility labels or a
 * log. The parent owns the number and dials it from the callbacks.
 *
 * An empty or blank name (the contact was picked without one) shows the role
 * alone rather than "Sponsor · ". The buttons' labels then read "Call " plus an
 * empty name, so they fall back to the role text for the name slot.
 *
 * Accessibility: each of the three buttons has a role, a translated label and
 * a 48 dp target, so a screen reader reaches Call, Text and More directly.
 *
 * CHANGED 2026-11-08: the Home card now lists every contact with this row, so
 * More is optional (the card has its own edit mode instead) and `onRemove`
 * switches the row to its edit look: the name and a trash button.
 */
export const SupportContactRow: FC<SupportContactRowProps> = ({
  roleTx,
  name,
  onCall,
  onText,
  onMore,
  onRemove,
  style,
  testID,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()

  const role = t(roleTx)
  const trimmed = name.trim()
  // Labels name the person when there is a name, else the role ("Call Sponsor").
  const labelName = trimmed || role

  return (
    <View style={[themed($row), style]} testID={testID}>
      <View style={$textColumn}>
        {trimmed ? (
          <Text tx="support:roleAndName" txOptions={{ role, name: trimmed }} numberOfLines={1} />
        ) : (
          <Text tx={roleTx} numberOfLines={1} />
        )}
      </View>
      {onRemove ? (
        <Pressable
          style={themed($button)}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={t("support:removeA11y", { name: labelName })}
        >
          <Ionicons name="trash-outline" size={22} color={theme.colors.error} />
        </Pressable>
      ) : (
        <>
          <Pressable
            style={themed($button)}
            onPress={onCall}
            accessibilityRole="button"
            accessibilityLabel={t("support:callA11y", { name: labelName })}
          >
            <Ionicons name="call" size={22} color={theme.colors.tint} />
          </Pressable>
          <Pressable
            style={themed($button)}
            onPress={onText}
            accessibilityRole="button"
            accessibilityLabel={t("support:textA11y", { name: labelName })}
          >
            <Ionicons name="chatbubble" size={22} color={theme.colors.tint} />
          </Pressable>
          {onMore && (
            <Pressable
              style={themed($button)}
              onPress={onMore}
              accessibilityRole="button"
              accessibilityLabel={t("support:moreA11y", { name: labelName })}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
            </Pressable>
          )}
        </>
      )}
    </View>
  )
}

const $textColumn: ViewStyle = { flex: 1 }

const $row: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  backgroundColor: colors.card,
  borderRadius: 12,
  paddingLeft: spacing.md,
  paddingRight: spacing.xs,
  minHeight: 56,
})

// 48 dp minimum touch target (repo a11y standard).
const $button: ThemedStyle<ViewStyle> = () => ({
  width: 48,
  height: 48,
  alignItems: "center",
  justifyContent: "center",
})
