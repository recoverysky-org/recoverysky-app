// Pure decisions for Support Contacts (spec D1/D3/D4/D5): up to three people
// (sponsor first) the user can call or text from the Home card and Support
// screen.
//
// ADDED 2026-11-06: this module is pure on purpose. Vitest cannot resolve the
// `@/` alias, so it keeps ZERO runtime `@/` imports (type-only imports are
// erased and fine). The picker, storage and Linking I/O live in separate
// orchestrators that the tests never import.
//
// ADDED 2026-11-06: names only. Nothing here logs or formats a phone number
// for display; there is deliberately no logger import. A support contact's
// number is personal data.

import type { TxKeyPath } from "@/i18n"

/** Spec D1: the list never holds more than three people. */
export const MAX_SUPPORT_CONTACTS = 3

export const SUPPORT_ROLES = ["sponsor", "support", "friend", "family"] as const
export type SupportRole = (typeof SUPPORT_ROLES)[number]

export interface SupportContact {
  role: SupportRole
  name: string
  /** Stored verbatim as the picker gave it (trimmed); normalized only to dial. */
  number: string
}

export interface PickedPhoneContact {
  name: string
  number: string
}

export type AddResult =
  | { kind: "ok"; contacts: SupportContact[] }
  | { kind: "full" }
  | { kind: "duplicate" }
  | { kind: "invalid" }

/**
 * Every non-digit removed. This is the duplicate key: "1-555-010-0001" and
 * "+1 (555) 010-0001" are the same person however the address book formats them.
 */
export function digitsOf(number: string): string {
  return number.replace(/\D/g, "")
}

/** A leading "+" if present, then digits only: what `tel:` / `sms:` receive. */
export function normalizeNumber(number: string): string {
  const trimmed = number.trim()
  return (trimmed.startsWith("+") ? "+" : "") + digitsOf(trimmed)
}

/** The first contact is the sponsor; everyone after defaults to "support". */
export function defaultRoleFor(contacts: readonly SupportContact[]): SupportRole {
  return contacts.length === 0 ? "sponsor" : "support"
}

export function canAddContact(contacts: readonly SupportContact[]): boolean {
  return contacts.length < MAX_SUPPORT_CONTACTS
}

/**
 * Adds a picked phone contact. The number is stored trimmed but otherwise
 * verbatim (the user sees what their address book holds); the duplicate check
 * compares digits only. An empty display name is kept as "" for the UI to fill.
 */
export function addContact(
  contacts: readonly SupportContact[],
  picked: PickedPhoneContact,
  role: SupportRole,
): AddResult {
  // ADDED 2026-11-06 (spec D1, names only): a contact saved without a name has
  // its number in the name field on Android (Phone.DISPLAY_NAME falls back to
  // the number). Stored as-is, the row would render the number. A name made
  // only of digits and phone punctuation is therefore stored as "" so the row
  // shows the role alone. An explicit class, not \p{L}: any other character
  // ("12 Step Dave") marks a real name and keeps it.
  const trimmedName = picked.name.trim()
  const name = /^[0-9\s+().#*,;/-]*$/.test(trimmedName) ? "" : trimmedName
  const number = picked.number.trim()
  const key = digitsOf(number)
  if (key === "") return { kind: "invalid" }
  if (!canAddContact(contacts)) return { kind: "full" }
  if (contacts.some((c) => digitsOf(c.number) === key)) return { kind: "duplicate" }
  return { kind: "ok", contacts: [...contacts, { role, name, number }] }
}

// The three editors below always return a new array, and an out-of-range index
// returns an unchanged copy, so a stale tap can never throw or mutate state.
const inRange = (contacts: readonly SupportContact[], index: number) =>
  Number.isInteger(index) && index >= 0 && index < contacts.length

export function removeContact(
  contacts: readonly SupportContact[],
  index: number,
): SupportContact[] {
  if (!inRange(contacts, index)) return [...contacts]
  return contacts.filter((_, i) => i !== index)
}

export function moveUp(contacts: readonly SupportContact[], index: number): SupportContact[] {
  const next = [...contacts]
  if (!inRange(contacts, index) || index === 0) return next
  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
  return next
}

export function setRole(
  contacts: readonly SupportContact[],
  index: number,
  role: SupportRole,
): SupportContact[] {
  if (!inRange(contacts, index)) return [...contacts]
  return contacts.map((c, i) => (i === index ? { ...c, role } : c))
}

export function serializeContacts(contacts: readonly SupportContact[]): string {
  return JSON.stringify(contacts)
}

function isStoredContact(value: unknown): value is SupportContact {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === "string" &&
    typeof v.number === "string" &&
    typeof v.role === "string" &&
    (SUPPORT_ROLES as readonly string[]).includes(v.role)
  )
}

/**
 * Fails closed: anything malformed (null, bad JSON, a non-array, any element
 * with a missing field or unknown role) yields []. One bad row discards the
 * lot rather than showing a half-trusted list on a crisis surface. At most
 * three are kept. Elements are rebuilt so stray extra fields never survive.
 */
export function parseStoredContacts(json: string | null): SupportContact[] {
  if (json === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed) || !parsed.every(isStoredContact)) return []
  return parsed
    .slice(0, MAX_SUPPORT_CONTACTS)
    .map(({ role, name, number }) => ({ role, name, number }))
}

/**
 * Spec D5: the 988 Suicide & Crisis Lifeline exists for the US and Canada only.
 * Any other or unknown region gets no crisis row rather than a wrong number.
 */
export function decideCrisisLine(regionCode: string | null | undefined): { number: string } | null {
  const region = regionCode?.toUpperCase()
  return region === "US" || region === "CA" ? { number: "988" } : null
}

export type DialKind = "call" | "text"

export function dialUrl(kind: DialKind, number: string): string {
  return `${kind === "call" ? "tel:" : "sms:"}${normalizeNumber(number)}`
}

export type PhoneContactPickerErrorCode = "no_picker" | "no_number" | "in_progress" | "unknown"

/** Maps the native picker module's error codes; anything else is "unknown". */
export function pickerErrorCodeFrom(nativeCode: unknown): PhoneContactPickerErrorCode {
  switch (nativeCode) {
    case "ERR_NO_PICKER":
      return "no_picker"
    case "ERR_NO_NUMBER":
      return "no_number"
    case "ERR_IN_PROGRESS":
      return "in_progress"
    default:
      return "unknown"
  }
}

// ADDED 2026-11-06: typed as `TxKeyPath`, so a role key that no locale defines
// fails `npm run compile`. The import is type-only and erased, so vitest stays fine.
export const SUPPORT_ROLE_TX: Record<SupportRole, TxKeyPath> = {
  sponsor: "support:roleSponsor",
  support: "support:roleSupport",
  friend: "support:roleFriend",
  family: "support:roleFamily",
}
