import { FC, useEffect, useState } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useTranslation } from "react-i18next"

import { SupportContactRow } from "@/components/SupportContactRow"
import { Text } from "@/components/Text"
import type { TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/** One contact as the card sees it: a role key and a display name, never a number. */
export interface SupportCardContact {
  roleTx: TxKeyPath
  name: string
}

interface SupportCardProps {
  /** Every contact, in the person's order. Empty shows the intro. */
  contacts: SupportCardContact[]
  onAdd: () => void
  onCall: (index: number) => void
  onText: (index: number) => void
  /** Asked from edit mode's trash button. The container confirms before it removes anyone. */
  onRemove: (index: number) => void
  onOpenSupport: () => void
}

/**
 * Home's Support card: the person's support contacts, each with Call and Text.
 * ADDED 2026-11-06 (Support Contacts, spec D8).
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
 *
 * CHANGED 2026-11-08 (Jenova): the card showed only the first contact, with big
 * Call and Text buttons, or "Add your sponsor or support person" and Choose. It
 * now lists every contact (there is no cap any more), and the header carries
 * + (add, the same picker flow) and a pencil (edit). Edit mode puts a trash
 * button on each row in place of Call and Text, and the header shows Done. With
 * nobody added, the card explains what it is for and that the app sees only the
 * people picked, instead of a bare call to action.
 *
 * Edit mode is local UI state, not the store's: it is nobody's business but this
 * card's, and it ends by itself when the last contact is removed, so the next add
 * does not land in edit mode.
 */
export const SupportCard: FC<SupportCardProps> = ({
  contacts,
  onAdd,
  onCall,
  onText,
  onRemove,
  onOpenSupport,
}) => {
  const { t } = useTranslation()
  const { themed, theme } = useAppTheme()
  const [editing, setEditing] = useState(false)

  const hasContacts = contacts.length > 0
  // Derived as well as reset below, so the render that removes the last contact is
  // already out of edit mode (no frame with Done over an empty card).
  const isEditing = editing && hasContacts

  useEffect(() => {
    if (!hasContacts) setEditing(false)
  }, [hasContacts])

  return (
    <View style={themed($card)}>
      <View style={$header}>
        <Pressable
          onPress={onOpenSupport}
          accessibilityRole="button"
          accessibilityLabel={t("support:openSupportA11y")}
          style={$titleTarget}
        >
          <Text style={themed($title)} tx="support:cardTitle" />
        </Pressable>

        {isEditing ? (
          <Pressable
            onPress={() => setEditing(false)}
            accessibilityRole="button"
            accessibilityLabel={t("support:done")}
            style={$doneButton}
          >
            <Text style={themed($doneText)} tx="support:done" />
          </Pressable>
        ) : (
          <>
            <Pressable
              onPress={onAdd}
              accessibilityRole="button"
              accessibilityLabel={t("support:addContact")}
              style={$iconButton}
            >
              <Ionicons name="add" size={26} color={theme.colors.tint} />
            </Pressable>
            {/* Nothing to edit until someone is added. */}
            {hasContacts && (
              <Pressable
                onPress={() => setEditing(true)}
                accessibilityRole="button"
                accessibilityLabel={t("support:editA11y")}
                style={$iconButton}
              >
                <Ionicons name="pencil" size={20} color={theme.colors.tint} />
              </Pressable>
            )}
          </>
        )}
      </View>

      {hasContacts ? (
        contacts.map((contact, index) => (
          <SupportContactRow
            key={`${contact.roleTx}-${index}`}
            testID={`support-card-contact-${index}`}
            roleTx={contact.roleTx}
            name={contact.name}
            onCall={() => onCall(index)}
            onText={() => onText(index)}
            onRemove={isEditing ? () => onRemove(index) : undefined}
            style={$cardRow}
          />
        ))
      ) : (
        <>
          <Text style={themed($intro)} tx="support:emptyIntro" />
          <Text style={themed($privacy)} tx="support:emptyPrivacy" />
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

const $header: ViewStyle = { flexDirection: "row", alignItems: "center" }

// 48 dp minimum touch target (repo a11y standard). It takes the rest of the header row, as the
// title did when it was the card's whole first line.
const $titleTarget: ViewStyle = { flex: 1, minHeight: 48, justifyContent: "center" }

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  fontWeight: "600",
  color: colors.textDim,
  textTransform: "uppercase",
})

const $iconButton: ViewStyle = {
  width: 48,
  height: 48,
  alignItems: "center",
  justifyContent: "center",
}

const $doneButton: ViewStyle = {
  minWidth: 48,
  minHeight: 48,
  paddingHorizontal: 8,
  alignItems: "center",
  justifyContent: "center",
}

const $doneText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.tint,
})

// The row draws its own card-coloured box for the Support screen; inside this card it only needs
// its content, flush with the card's padding.
const $cardRow: ViewStyle = {
  backgroundColor: "transparent",
  paddingLeft: 0,
  paddingRight: 0,
}

const $intro: ThemedStyle<TextStyle> = ({ spacing }) => ({
  marginBottom: spacing.sm,
})

const $privacy: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  lineHeight: 20,
  color: colors.textDim,
})
