import { FC } from "react"
import { useNavigation, type NavigationProp } from "@react-navigation/native"
import { observer } from "mobx-react-lite"

import { OptionSheet } from "@/components/OptionSheet"
import { SupportCard } from "@/components/SupportCard"
import { useAddSupportContact } from "@/hooks/useAddSupportContact"
import { useRemoveSupportContact } from "@/hooks/useRemoveSupportContact"
import { useSupportDial } from "@/hooks/useSupportDial"
import { useSupportStore } from "@/models"
import type { AppStackParamList } from "@/navigators/navigationTypes"
import { isPhoneContactPickerAvailable } from "@/services/support/phoneContactPicker"
import { SUPPORT_ROLE_TX, type DialKind } from "@/services/support/supportContactsLogic"

/**
 * The Home Support card wired to the store, the picker and the dialer.
 * ADDED 2026-11-06 (Support Contacts, spec D8).
 *
 * The only one of the card, the hook and this container that touches the store
 * or `openDial`. NAMES ONLY (spec D1): the card gets `{ roleTx, name }`; the
 * number stays in this file's callbacks and goes to `openDial` and nowhere else.
 *
 * CHANGED 2026-11-06: the temporary narrow navigation adapter is gone now that
 * `Support` is in AppStackParamList; the dial handler is the shared useSupportDial.
 *
 * Returns null when the picker is unavailable (web, or a binary built before the
 * module existed): without it nobody can add a contact, so the card would be a
 * dead end (spec D2).
 *
 * CHANGED 2026-11-06 (final review I-3): also returns null while the store is not
 * hydrated, which on a running app means the keychain could not be read. "Add your
 * sponsor" there would be untrue for someone who has one, and it renders again by
 * itself (observer) when a later read succeeds.
 *
 * CHANGED 2026-11-08: the card lists every contact, so the container hands it the
 * whole list (names only) and dials by index, reading the number from the store
 * inside the press handler as before. Edit mode's trash goes through
 * useRemoveSupportContact, the same confirm the Support screen's Remove uses.
 */

export const SupportCardContainer: FC = observer(function SupportCardContainer() {
  const store = useSupportStore()
  const navigation = useNavigation<NavigationProp<AppStackParamList>>()
  const dialNumber = useSupportDial()
  const { choose, roleSheet } = useAddSupportContact()
  const confirmRemove = useRemoveSupportContact()

  if (!isPhoneContactPickerAvailable() || !store.hydrated) return null

  // The number is read here, at press time, and goes to the dialer alone.
  const dial = async (kind: DialKind, index: number) => {
    const contact = store.contacts[index]
    if (!contact) return
    await dialNumber(kind, contact.number, kind === "call" ? "support_call" : "support_text")
  }

  return (
    <>
      <SupportCard
        contacts={store.contacts.map((c) => ({ roleTx: SUPPORT_ROLE_TX[c.role], name: c.name }))}
        onAdd={() => void choose()}
        onCall={(index) => void dial("call", index)}
        onText={(index) => void dial("text", index)}
        onRemove={confirmRemove}
        onOpenSupport={() => navigation.navigate("Support")}
      />
      <OptionSheet titleTx="support:roleSheetTitle" {...roleSheet} />
    </>
  )
})
