/**
 * SupportScreen - the user's support contacts, a way to a live meeting, and the
 * 988 crisis line where it applies.
 * ADDED 2026-11-06 (Support Contacts, spec D6). Opened from the Home Support card
 * and from My Day's crisis path.
 * CHANGED 2026-11-06 (final review I-1): an app-stack card, no longer a native modal,
 * because a modal covers the root view and hid this screen's toasts on iOS (see
 * AppNavigator.tsx). The header and close button are still this screen's own.
 *
 * NAMES ONLY (spec D1): contacts reach the rows as `{ roleTx, name }`. A number
 * is read from the store only inside press handlers, to `openDial`. The one number
 * on screen is 988, a public crisis line.
 */
import { FC, useState } from "react"
import { Alert, Pressable, ScrollView, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { useNavigation, type NavigationProp } from "@react-navigation/native"
import { observer } from "mobx-react-lite"
import { useTranslation } from "react-i18next"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { OptionSheet, type OptionSheetOption } from "@/components/OptionSheet"
import { SupportContactRow } from "@/components/SupportContactRow"
import { Text } from "@/components/Text"
import { useAddSupportContact } from "@/hooks/useAddSupportContact"
import { useSupportDial } from "@/hooks/useSupportDial"
import { translate } from "@/i18n"
import { useSupportStore } from "@/models"
import type { AppStackParamList } from "@/navigators/navigationTypes"
import { getDeviceRegion } from "@/services/support/deviceRegion"
import { isPhoneContactPickerAvailable } from "@/services/support/phoneContactPicker"
import {
  SUPPORT_ROLES,
  SUPPORT_ROLE_TX,
  decideCrisisLine,
  type SupportRole,
} from "@/services/support/supportContactsLogic"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

type SheetState = { kind: "more" | "role"; index: number } | null

const MORE_OPTIONS: OptionSheetOption[] = [
  { key: "moveUp", tx: "support:moveUp" },
  { key: "changeRole", tx: "support:changeRole" },
  { key: "remove", tx: "support:remove", destructive: true },
]

const ROLE_OPTIONS: OptionSheetOption[] = SUPPORT_ROLES.map((role) => ({
  key: role,
  tx: SUPPORT_ROLE_TX[role],
}))

function isSupportRole(key: string): key is SupportRole {
  return (SUPPORT_ROLES as readonly string[]).includes(key)
}

export const SupportScreen: FC = observer(function SupportScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>()
  const { themed, theme } = useAppTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const store = useSupportStore()
  const dial = useSupportDial()
  const { choose, roleSheet } = useAddSupportContact()
  const [sheet, setSheet] = useState<SheetState>(null)

  const pickerAvailable = isPhoneContactPickerAvailable()
  // Read at render so it follows the device's current region setting (spec D5).
  const crisis = decideCrisisLine(getDeviceRegion())

  const contacts = store.contacts
  // The sheet remembers an index; a contact list that shrank under an open sheet
  // must not make a choice land on a different person.
  const sheetContact = sheet !== null ? (contacts[sheet.index] ?? null) : null

  const confirmRemove = (index: number) => {
    const contact = contacts[index]
    if (!contact) return
    // A blank name (an Android contact with no name) falls back to the role's word.
    const name =
      contact.name.trim() !== "" ? contact.name : translate(SUPPORT_ROLE_TX[contact.role])
    Alert.alert(
      translate("support:removeConfirmTitle"),
      translate("support:removeConfirmMessage", { name }),
      [
        { text: translate("common:cancel"), style: "cancel" },
        {
          text: translate("support:remove"),
          style: "destructive",
          onPress: () => {
            store.remove(index)
            trackEvent("support_contact_removed")
          },
        },
      ],
    )
  }

  const onMoreSelect = (key: string) => {
    if (sheet === null) return
    const index = sheet.index
    setSheet(null)
    if (contacts[index] === undefined) return
    if (key === "moveUp") store.moveUp(index)
    else if (key === "changeRole") setSheet({ kind: "role", index })
    else if (key === "remove") confirmRemove(index)
  }

  const onRoleSelect = (key: string) => {
    if (sheet === null) return
    const index = sheet.index
    setSheet(null)
    if (contacts[index] === undefined || !isSupportRole(key)) return
    store.setRole(index, key)
  }

  return (
    <View style={[themed($container), { paddingTop: insets.top }]}>
      <View style={themed($header)}>
        <Text style={themed($title)} tx="support:screenTitle" accessibilityRole="header" />
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t("common:close")}
        >
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* CHANGED 2026-11-06 (final review I-3): hidden while the keychain could not be read, so
            nobody edits a list we do not have. The meeting and crisis rows below never depend on
            it. The screen is an observer, so this returns by itself when a later read succeeds. */}
        {pickerAvailable && store.hydrated && (
          <View style={themed($section)}>
            {contacts.map((contact, index) => (
              <SupportContactRow
                key={`${contact.role}-${index}`}
                testID={`support-contact-${index}`}
                roleTx={SUPPORT_ROLE_TX[contact.role]}
                name={contact.name}
                onCall={() => void dial("call", contact.number, "support_call")}
                onText={() => void dial("text", contact.number, "support_text")}
                onMore={() => setSheet({ kind: "more", index })}
              />
            ))}
            {store.canAdd && (
              <Pressable
                onPress={() => void choose()}
                accessibilityRole="button"
                accessibilityLabel={t("support:addContact")}
                style={themed($rowButton)}
              >
                <Ionicons name="add-circle-outline" size={24} color={theme.colors.tint} />
                <Text style={themed($rowText)} tx="support:addContact" />
              </Pressable>
            )}
          </View>
        )}
        <View style={themed($section)}>
          <Pressable
            onPress={() =>
              navigation.navigate("Main", {
                screen: "Meetings",
                params: { segment: "live" },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={t("support:findLiveMeeting")}
            style={themed($rowButton)}
          >
            <Ionicons name="videocam-outline" size={24} color={theme.colors.tint} />
            <Text style={themed($rowText)} tx="support:findLiveMeeting" />
          </Pressable>
          {crisis !== null && (
            <View style={themed($rowButton)}>
              <Text style={[themed($rowText), $grow]} tx="support:crisisLine" />
              <Pressable
                onPress={() => void dial("call", crisis.number, "support_crisis_call")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("support:crisisCallA11y")}
                style={$iconButton}
              >
                <Ionicons name="call-outline" size={24} color={theme.colors.tint} />
              </Pressable>
              <Pressable
                onPress={() => void dial("text", crisis.number, "support_crisis_text")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("support:crisisTextA11y")}
                style={$iconButton}
              >
                <Ionicons name="chatbubble-outline" size={24} color={theme.colors.tint} />
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
      <OptionSheet
        visible={sheet?.kind === "more" && sheetContact !== null}
        options={MORE_OPTIONS}
        onSelect={onMoreSelect}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet?.kind === "role" && sheetContact !== null}
        titleTx="support:roleSheetTitle"
        options={ROLE_OPTIONS}
        onSelect={onRoleSelect}
        onClose={() => setSheet(null)}
      />
      {/* The add flow's "Who is this?" sheet (hook-owned). */}
      <OptionSheet titleTx="support:roleSheetTitle" {...roleSheet} />
    </View>
  )
})

const $container: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flex: 1,
  backgroundColor: colors.background,
})

const $header: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.sm,
  paddingBottom: spacing.sm,
  borderBottomWidth: 1,
  borderBottomColor: colors.separator,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.text,
})

const $section: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.md,
})

const $rowButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
  minHeight: 48,
  paddingHorizontal: spacing.md,
  marginBottom: spacing.sm,
  borderRadius: 12,
  backgroundColor: colors.card,
})

const $rowText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  color: colors.text,
})

const $grow: TextStyle = { flex: 1 }

const $iconButton: ViewStyle = {
  minWidth: 48,
  minHeight: 48,
  alignItems: "center",
  justifyContent: "center",
}
