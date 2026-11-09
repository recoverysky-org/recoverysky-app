/**
 * Keychain storage for the support contacts. ADDED 2026-11-06 (support contacts
 * spec D1, D4).
 *
 * ONE SecureStore key holds a JSON array of `{ role, name, number }`.
 * CHANGED 2026-11-08: no longer at most 3; the list has no cap (see
 * parseStoredContacts for why one key still holds it).
 * It is never an MST prop, MMKV value, SQLite row, cloud-backup field, log
 * attribute or analytics event: a contact is a person in recovery's sponsor, and
 * the number is theirs to keep on this phone alone.
 *
 * Logging rule (D1): a failure logs the step and `e.name` only, never
 * `e.message` or the error object, because either can echo the stored value.
 *
 * None of these functions throws. The store above them stays simple and a
 * locked keychain (background launch) degrades to "no contacts yet".
 * CHANGED 2026-11-06 (final review I-3): a locked keychain now degrades to
 * "unknown", not "no contacts yet". Hydrating an unreadable list as empty showed
 * "Add your sponsor" to someone who has one, and the next edit overwrote the real
 * list for good. `loadSupportContacts` reports null and the store refuses edits
 * until a read succeeds. Still nothing here throws.
 */
import { deleteItemAsync, getItemAsync, setItemAsync } from "@/services/auth/secureStorage"
import { logger } from "@/utils/logger"

import { parseStoredContacts, serializeContacts, type SupportContact } from "./supportContactsLogic"

const log = logger.child({ module: "SupportContacts" })

export const SUPPORT_CONTACTS_KEY = "support_contacts_v1"

/**
 * The stored contacts, or null when the read itself failed. A missing item and corrupt JSON are
 * both `[]`, because nothing recoverable exists: SecureStore resolves null for a missing key and
 * throws for a keychain it cannot read (iOS errSecInteractionNotAllowed while locked).
 */
export async function loadSupportContacts(): Promise<SupportContact[] | null> {
  try {
    return parseStoredContacts(await getItemAsync(SUPPORT_CONTACTS_KEY))
  } catch (e) {
    log.warn("Support contacts load failed", { step: "load", error: errorName(e) })
    return null
  }
}

export async function saveSupportContacts(contacts: readonly SupportContact[]): Promise<boolean> {
  try {
    await setItemAsync(SUPPORT_CONTACTS_KEY, serializeContacts(contacts))
    return true
  } catch (e) {
    log.warn("Support contacts save failed", { step: "save", error: errorName(e) })
    return false
  }
}

/**
 * True once the item is confirmed gone.
 * CHANGED 2026-11-06 (final review M-6): returns whether it worked, so the fresh-install clear can
 * refuse to read a previous installer's contacts after a failed delete. It reads back because
 * expo-secure-store's iOS delete ignores SecItemDelete's status and resolves whatever happened, so
 * the delete resolving says nothing on the platform this clear exists for.
 */
export async function clearSupportContacts(): Promise<boolean> {
  try {
    await deleteItemAsync(SUPPORT_CONTACTS_KEY)
    if ((await getItemAsync(SUPPORT_CONTACTS_KEY)) === null) return true
    log.warn("Support contacts clear failed", { step: "clear", error: "still_present" })
    return false
  } catch (e) {
    log.warn("Support contacts clear failed", { step: "clear", error: errorName(e) })
    return false
  }
}

// `e.name` only: see the logging rule in the header.
function errorName(e: unknown): string {
  return e instanceof Error ? e.name : "unknown"
}
