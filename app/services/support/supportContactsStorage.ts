/**
 * Keychain storage for the support contacts. ADDED 2026-11-06 (support contacts
 * spec D1, D4).
 *
 * ONE SecureStore key holds a JSON array of at most 3 `{ role, name, number }`.
 * It is never an MST prop, MMKV value, SQLite row, cloud-backup field, log
 * attribute or analytics event: a contact is a person in recovery's sponsor, and
 * the number is theirs to keep on this phone alone.
 *
 * Logging rule (D1): a failure logs the step and `e.name` only, never
 * `e.message` or the error object, because either can echo the stored value.
 *
 * None of these functions throws. The store above them stays simple and a
 * locked keychain (background launch) degrades to "no contacts yet".
 */
import { deleteItemAsync, getItemAsync, setItemAsync } from "@/services/auth/secureStorage"
import { logger } from "@/utils/logger"

import { parseStoredContacts, serializeContacts, type SupportContact } from "./supportContactsLogic"

const log = logger.child({ module: "SupportContacts" })

export const SUPPORT_CONTACTS_KEY = "support_contacts_v1"

export async function loadSupportContacts(): Promise<SupportContact[]> {
  try {
    return parseStoredContacts(await getItemAsync(SUPPORT_CONTACTS_KEY))
  } catch (e) {
    log.warn("Support contacts load failed", { step: "load", error: errorName(e) })
    return []
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

export async function clearSupportContacts(): Promise<void> {
  try {
    await deleteItemAsync(SUPPORT_CONTACTS_KEY)
  } catch (e) {
    log.warn("Support contacts clear failed", { step: "clear", error: errorName(e) })
  }
}

// `e.name` only: see the logging rule in the header.
function errorName(e: unknown): string {
  return e instanceof Error ? e.name : "unknown"
}
