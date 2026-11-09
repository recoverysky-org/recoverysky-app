// Pure decisions for Support Contacts (spec D1/D3/D4/D5): the people (sponsor
// first) the user can call or text from the Home card and Support screen.
// CHANGED 2026-11-08 (Jenova): no longer "up to three". A person may add as many
// as they wish; the Home card lists them all.
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

export const SUPPORT_ROLES = ["sponsor", "support", "friend", "family"] as const
export type SupportRole = (typeof SUPPORT_ROLES)[number]

export interface SupportContact {
  role: SupportRole
  name: string
  /** Stored verbatim as the picker gave it (trimmed); cleaned only to dial (dialableNumber). */
  number: string
}

export interface PickedPhoneContact {
  name: string
  number: string
}

// CHANGED 2026-11-08: the "full" kind is gone with the three-contact cap.
export type AddResult =
  | { kind: "ok"; contacts: SupportContact[] }
  | { kind: "duplicate" }
  | { kind: "invalid" }

/**
 * Every non-digit removed. This is the duplicate key: "1-555-010-0001" and
 * "+1 (555) 010-0001" are the same person however the address book formats them.
 */
export function digitsOf(number: string): string {
  return number.replace(/\D/g, "")
}

// Formatting an address book adds and a dialer ignores: whitespace (\s includes NBSP), ( ) . - /,
// and the invisible bidi marks some address books wrap numbers in (U+200E, U+200F, U+202A-U+202E,
// U+2066-U+2069).
const NUMBER_FORMATTING = /[\s().\-/\u200E\u200F\u202A-\u202E\u2066-\u2069]/g
// Runs after formatting is gone, so "ext. 23" is already "ext23". A digit on both sides, once:
// "x23" alone or a second marker is left in place and fails the shape check below.
const EXTENSION_MARKER = /(\d)(?:extension|ext|x)(?=\d)/i
// Optional leading +, then digits, *, #, and pauses (, or ;), with a digit before the first pause
// so the part a text goes to always holds one. \d is ASCII-only in JS, so non-ASCII digits fail:
// we would rather refuse a number than hand the dialer one it may read differently.
const DIALABLE_SHAPE = /^\+?[*#]*\d[\d*#,;]*$/

/**
 * What `tel:` receives, or null when the number cannot be dialled as it stands.
 * ADDED 2026-11-06 (final review I-2): replaces normalizeNumber, which kept a leading "+" and the
 * digits and dropped everything else. A number saved as "555-010-0001,,23" became tel:555010000123,
 * a longer number that rings a stranger with no error and no toast. So only formatting is stripped
 * here; a pause (,), a wait (;), * and # are kept, an extension becomes one pause, and anything else
 * (vanity letters, a "+" not at the start, non-ASCII digits) is refused rather than guessed at.
 */
export function dialableNumber(raw: string): string | null {
  const cleaned = raw.trim().replace(NUMBER_FORMATTING, "").replace(EXTENSION_MARKER, "$1,")
  return DIALABLE_SHAPE.test(cleaned) ? cleaned : null
}

/** The first contact is the sponsor; everyone after defaults to "support". */
export function defaultRoleFor(contacts: readonly SupportContact[]): SupportRole {
  return contacts.length === 0 ? "sponsor" : "support"
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
  // CHANGED 2026-11-06 (final review I-2): anything dialableNumber accepts is a number too. A
  // nameless contact whose number carries bidi marks or an extension got past the character class
  // and would have rendered the number as the name.
  const trimmedName = picked.name.trim()
  const name =
    /^[0-9\s+().#*,;/-]*$/.test(trimmedName) || dialableNumber(trimmedName) !== null
      ? ""
      : trimmedName
  const number = picked.number.trim()
  // CHANGED 2026-11-06 (final review I-2): the check was "has any digit". A number we could not
  // dial (1-800-FLOWERS) would have been saved and then failed in the moment it was needed.
  if (dialableNumber(number) === null) return { kind: "invalid" }
  const key = digitsOf(number)
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
 * lot rather than showing a half-trusted list on a crisis surface. Elements
 * are rebuilt so stray extra fields never survive.
 * CHANGED 2026-11-08: every stored contact is kept; the three-contact cap is gone.
 * There is no size cap either: expo-secure-store's 2048-byte figure is a JS-side
 * console warning only (neither the iOS keychain nor the Android encryptor
 * enforces one), and a long list is still a few kilobytes.
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
  return parsed.map(({ role, name, number }) => ({ role, name, number }))
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

/**
 * The link for the phone or messages app, or null when the number cannot be dialled (the caller
 * shows its "couldn't open" toast). ADDED 2026-11-06 (final review I-2).
 * - `call` keeps pauses and waits; the dialer plays them after the call connects.
 * - `text` stops at the first pause or wait: messages go to the phone number, not an extension.
 * - `#` is percent-encoded in both, because a bare `#` starts a URL fragment and whatever follows
 *   it would silently fall off the number.
 */
export function dialUrl(kind: DialKind, number: string): string | null {
  const dialable = dialableNumber(number)
  if (dialable === null) return null
  const target = kind === "call" ? dialable : dialable.split(/[,;]/, 1)[0]
  return `${kind === "call" ? "tel:" : "sms:"}${target.replace(/#/g, "%23")}`
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
