import { FC } from "react"
import { useNavigation, type NavigationProp } from "@react-navigation/native"
import { observer } from "mobx-react-lite"

import { OptionSheet } from "@/components/OptionSheet"
import { SupportCard } from "@/components/SupportCard"
import { useAddSupportContact } from "@/hooks/useAddSupportContact"
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
 */

export const SupportCardContainer: FC = observer(function SupportCardContainer() {
  const store = useSupportStore()
  const navigation = useNavigation<NavigationProp<AppStackParamList>>()
  const dialNumber = useSupportDial()
  const { choose, roleSheet } = useAddSupportContact()

  if (!isPhoneContactPickerAvailable()) return null

  const primary = store.primary

  const dial = async (kind: DialKind) => {
    if (primary === null) return
    await dialNumber(kind, primary.number, kind === "call" ? "support_call" : "support_text")
  }

  return (
    <>
      <SupportCard
        primary={primary ? { roleTx: SUPPORT_ROLE_TX[primary.role], name: primary.name } : null}
        onChoose={() => void choose()}
        onCall={() => void dial("call")}
        onText={() => void dial("text")}
        onOpenSupport={() => navigation.navigate("Support")}
      />
      <OptionSheet titleTx="support:roleSheetTitle" {...roleSheet} />
    </>
  )
})
