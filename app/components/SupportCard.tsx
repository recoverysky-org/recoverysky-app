import { FC } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/Button"
import { Text } from "@/components/Text"
import type { TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface SupportCardProps {
  /** The first contact, by role key and display name. Null when the list is empty. */
  primary: { roleTx: TxKeyPath; name: string } | null
  onChoose: () => void
  onCall: () => void
  onText: () => void
  onOpenSupport: () => void
}

/**
 * Home's Support card: the primary contact with Call and Text, or a Choose
 * button when there is none. ADDED 2026-11-06 (Support Contacts, spec D8).
 *
 * NAMES ONLY (spec D1): takes `{ roleTx, name }`, never a `SupportContact`, so
 * no number can reach its text, its accessibility labels or a log. Presentational
 * on purpose: the container owns the store, the picker and the dialer.
 *
 * Uses `useTranslation()` (not the non-reactive `translate()`): Home stays
 * mounted behind Settings, so a language switch must reach the labels and the
 * pre-translated role below.
 *
 * A blank name (a contact stored with only digits as its name) shows the role
 * alone, and the buttons' labels use the role text in the name slot, the same
 * fallback as SupportContactRow ("Call Sponsor").
 */
export const SupportCard: FC<SupportCardProps> = ({
  primary,
  onChoose,
  onCall,
  onText,
  onOpenSupport,
}) => {
  const { t } = useTranslation()
  const { themed } = useAppTheme()

  const role = primary ? t(primary.roleTx) : ""
  const trimmed = primary ? primary.name.trim() : ""
  const labelName = trimmed || role

  return (
    <View style={themed($card)}>
      <Pressable
        onPress={onOpenSupport}
        accessibilityRole="button"
        accessibilityLabel={t("support:openSupportA11y")}
        style={$titleTarget}
      >
        <Text style={themed($title)} tx="support:cardTitle" />
      </Pressable>

      {primary === null ? (
        <>
          <Text style={themed($line)} tx="support:emptyTitle" />
          <Button
            tx="support:choose"
            preset="filled"
            onPress={onChoose}
            accessibilityRole="button"
            accessibilityLabel={t("support:choose")}
          />
        </>
      ) : (
        <>
          {trimmed ? (
            <Text
              style={themed($line)}
              tx="support:roleAndName"
              txOptions={{ role, name: trimmed }}
              numberOfLines={1}
            />
          ) : (
            <Text style={themed($line)} tx={primary.roleTx} numberOfLines={1} />
          )}
          <View style={themed($buttons)}>
            <Button
              tx="support:call"
              preset="filled"
              style={$buttonFlex}
              onPress={onCall}
              accessibilityRole="button"
              accessibilityLabel={t("support:callA11y", { name: labelName })}
            />
            <Button
              tx="support:text"
              preset="default"
              style={$buttonFlex}
              onPress={onText}
              accessibilityRole="button"
              accessibilityLabel={t("support:textA11y", { name: labelName })}
            />
          </View>
        </>
      )}
    </View>
  )
}

// Matches CleanTimeCard's card so the two sit together on Home.
const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 20,
  padding: spacing.lg,
  marginTop: spacing.lg,
  borderWidth: 1,
  borderColor: colors.tint,
})

// 48 dp minimum touch target (repo a11y standard).
const $titleTarget: ViewStyle = { minHeight: 48, justifyContent: "center" }

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontWeight: "600",
  color: colors.textDim,
  textTransform: "uppercase",
})

const $line: ThemedStyle<TextStyle> = ({ spacing }) => ({
  marginBottom: spacing.sm,
})

const $buttons: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  gap: spacing.sm,
})

const $buttonFlex: ViewStyle = { flex: 1 }
