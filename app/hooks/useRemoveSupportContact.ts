import { useCallback } from "react"
import { Alert } from "react-native"

import { translate } from "@/i18n"
import { useSupportStore } from "@/models"
import { SUPPORT_ROLE_TX } from "@/services/support/supportContactsLogic"
import { trackEvent } from "@/services/tracking"

/**
 * Asks "Remove {name} from your support contacts?" and removes the contact at
 * `index` on confirm. ADDED 2026-11-08: lifted out of SupportScreen so the Home
 * card's edit mode (its trash buttons) and the Support screen's "Remove" ask the
 * same question the same way.
 *
 * NAMES ONLY (spec D1): the dialog shows the name, or the role's word for a
 * contact stored without one (an Android contact with no name), never a number.
 * Analytics carry the event name alone.
 *
 * `Alert.alert` is a no-op on react-native-web, so on web this asks nothing and
 * removes nothing. Both callers render no contacts on web (the picker is
 * unavailable there), so no web path reaches it.
 */
export function useRemoveSupportContact(): (index: number) => void {
  const store = useSupportStore()

  return useCallback(
    (index: number) => {
      const contact = store.contacts[index]
      if (!contact) return
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
              // The list can change while the dialog is up (a second remove, a reset). Remove
              // only if the same person is still at this index, so a confirm never deletes
              // whoever slid into the slot.
              if (store.contacts[index] !== contact) return
              store.remove(index)
              trackEvent("support_contact_removed")
            },
          },
        ],
      )
    },
    [store],
  )
}
