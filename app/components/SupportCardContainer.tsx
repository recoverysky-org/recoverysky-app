import { FC } from "react"
import { useNavigation } from "@react-navigation/native"
import { observer } from "mobx-react-lite"

import { OptionSheet } from "@/components/OptionSheet"
import { SupportCard } from "@/components/SupportCard"
import { useToast } from "@/components/Toast"
import { useAddSupportContact } from "@/hooks/useAddSupportContact"
import { useSupportStore } from "@/models"
import { openDial } from "@/services/support/dial"
import { isPhoneContactPickerAvailable } from "@/services/support/phoneContactPicker"
import { SUPPORT_ROLE_TX, type DialKind } from "@/services/support/supportContactsLogic"
import { trackEvent } from "@/services/tracking"

/**
 * The Home Support card wired to the store, the picker and the dialer.
 * ADDED 2026-11-06 (Support Contacts, spec D8).
 *
 * The only one of the card, the hook and this container that touches the store
 * or `openDial`. NAMES ONLY (spec D1): the card gets `{ roleTx, name }`; the
 * number stays in this file's callbacks and goes to `openDial` and nowhere else.
 *
 * Returns null when the picker is unavailable (web, or a binary built before the
 * module existed): without it nobody can add a contact, so the card would be a
 * dead end (spec D2).
 */

// `Support` joins AppStackParamList in Task 7. Until then this narrow adapter
// types the one call, so the container compiles without editing the route types
// from this task. Home sits inside the Main tabs; navigate() bubbles to the stack.
type SupportNavigation = { navigate: (route: "Support") => void }

export const SupportCardContainer: FC = observer(function SupportCardContainer() {
  const store = useSupportStore()
  const navigation = useNavigation<SupportNavigation>()
  const { showToast } = useToast()
  const { choose, roleSheet } = useAddSupportContact()

  if (!isPhoneContactPickerAvailable()) return null

  const primary = store.primary

  const dial = async (kind: DialKind) => {
    if (primary === null) return
    const ok = await openDial(kind, primary.number)
    if (ok) {
      trackEvent(kind === "call" ? "support_call" : "support_text")
    } else {
      showToast({ tx: "support:couldntOpenPhone", type: "error" })
    }
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
