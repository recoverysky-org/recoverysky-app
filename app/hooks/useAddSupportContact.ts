import { useCallback, useRef, useState } from "react"

import { useToast } from "@/components/Toast"
import type { TxKeyPath } from "@/i18n"
import { useSupportStore } from "@/models"
import { pickPhoneContact } from "@/services/support/phoneContactPicker"
import {
  SUPPORT_ROLE_TX,
  SUPPORT_ROLES,
  defaultRoleFor,
  type PickedPhoneContact,
  type SupportRole,
} from "@/services/support/supportContactsLogic"
import { trackEvent } from "@/services/tracking"

/**
 * The pick-then-role add flow for support contacts: open the phone's contact
 * picker, hold the pick, ask "Who is this?" in a role sheet, then add.
 * ADDED 2026-11-06 (Support Contacts, spec D8).
 *
 * NAMES ONLY (spec D1): the held pick carries a number, so it lives in hook
 * state only and goes nowhere but `store.add`. Toasts use translation keys,
 * analytics carry the event name alone, and nothing is logged here.
 *
 * Imports the picker and the logic from their own modules rather than the
 * `@/services/support` barrel, so a component test mocks one native-facing file
 * and never loads the keychain storage module.
 *
 * Single-flight: the picker is a native screen, and a double tap on Choose would
 * start a second one ("in_progress" from the native side). A ref, not state,
 * because two taps can land before React re-renders.
 */
export interface RoleSheetOption {
  key: SupportRole
  tx: TxKeyPath
}

export interface AddSupportContactRoleSheet {
  visible: boolean
  options: RoleSheetOption[]
  onSelect: (key: string) => void
  onClose: () => void
}

function isSupportRole(key: string): key is SupportRole {
  return (SUPPORT_ROLES as readonly string[]).includes(key)
}

export function useAddSupportContact(): {
  choose: () => Promise<void>
  roleSheet: AddSupportContactRoleSheet
} {
  const store = useSupportStore()
  const { showToast } = useToast()
  const pickingRef = useRef(false)
  const [picked, setPicked] = useState<PickedPhoneContact | null>(null)

  const choose = useCallback(async () => {
    if (pickingRef.current) return
    pickingRef.current = true
    try {
      const result = await pickPhoneContact()
      // null is a cancel: silent, nothing held.
      if (result === null) return
      setPicked(result)
    } catch {
      // Any failure (in practice a PhoneContactPickerError, which carries a code
      // only) is the same toast. We deliberately neither log nor show the error.
      showToast({ tx: "support:couldntOpenPicker", type: "error" })
    } finally {
      pickingRef.current = false
    }
  }, [showToast])

  const onClose = useCallback(() => setPicked(null), [])

  const onSelect = useCallback(
    (key: string) => {
      // The caller (OptionSheet) does not close itself, so every path below
      // drops the held pick, which is what hides the sheet.
      const held = picked
      setPicked(null)
      if (held === null || !isSupportRole(key)) return
      const result = store.add(held, key)
      if (result === "ok") {
        trackEvent("support_contact_added")
      } else if (result === "duplicate") {
        showToast({ tx: "support:duplicate", type: "error" })
      } else {
        // "full" or "invalid": the Choose button is hidden when full, so these
        // are races or odd picks; the picker toast is the closest honest words.
        showToast({ tx: "support:couldntOpenPicker", type: "error" })
      }
    },
    [picked, store, showToast],
  )

  // The row for the role the store would pick by default goes first.
  const first = defaultRoleFor(store.contacts)
  const options: RoleSheetOption[] = [first, ...SUPPORT_ROLES.filter((r) => r !== first)].map(
    (role) => ({ key: role, tx: SUPPORT_ROLE_TX[role] }),
  )

  return {
    choose,
    roleSheet: { visible: picked !== null, options, onSelect, onClose },
  }
}
