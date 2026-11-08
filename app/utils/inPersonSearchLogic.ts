/**
 * inPersonSearchLogic — the pure half of the In-Person segment's ZIP search.
 *
 * The segment searches from a typed US ZIP / Canadian postal code by default
 * and uses GPS only when the person picks it (spec
 * docs/superpowers/specs/2026-11-07-in-person-zip-search-design.md). Every
 * decision lives here so vitest can cover it; the hooks only do I/O.
 *
 * No runtime imports at all: vitest has no `@/` alias (CLAUDE.md "Test Runner
 * Split"). Nothing here logs, and nothing here may ever be handed a postal
 * code to log: a code and its point are persisted only in MMKV.
 */

export type InPersonSearchMode = "gps" | "zip"
export type PostalCountry = "US" | "CA"

export interface NormalizedPostal {
  country: PostalCountry
  /** Canonical wire form: US five digits; CA uppercase, no space ("K1A0B1" or "K1A"). */
  code: string
  /**
   * ADDED 2026-11-08: what the api looks the code up by, and so what the app
   * sends, memoises and dedupes by. US: the five digits (same as `code`).
   * Canada: the FSA, the first three characters. The api's postal table holds
   * Canadian FSAs only (GeoNames publishes no full Canadian codes); its
   * `normalizePostalCode` (api src/mcp/postal.ts) keys "K1A 0B1" as "K1A". So
   * "K1A 0B1" and "K1A 0B2" are one lookup with one answer, and sending only
   * the FSA tells the server less than the full code would. `code` stays the
   * full form for display and MMKV.
   */
  key: string
}

// First letter: the Canada Post letters that start a real FSA. The other
// positions additionally exclude D F I O Q U (Canada Post never issues them).
const CA_FIRST = "ABCEGHJKLMNPRSTVXY"
const CA_OTHER = "ABCEGHJKLMNPRSTVWXYZ"
const US_RE = /^(\d{5})(?:-?\d{4})?$/
const CA_RE = new RegExp(`^([${CA_FIRST}]\\d[${CA_OTHER}])(?:\\d[${CA_OTHER}]\\d)?$`)

/** Canonicalise what the person typed, or null when it is no accepted shape. */
export function normalizePostalInput(raw: string): NormalizedPostal | null {
  // Spaces anywhere ("k1a 0b1", " 80203 ") carry no meaning; a hyphen only
  // matters in ZIP+4, and the Canadian regex tolerates none, so strip the
  // hyphen from Canadian candidates only after the US shape has been tried.
  const compact = raw.replace(/\s+/g, "").toUpperCase()
  const us = US_RE.exec(compact)
  if (us) return { country: "US", code: us[1], key: us[1] }
  const ca = CA_RE.exec(compact.replace(/-/g, ""))
  if (ca) {
    // Keep the full six characters when given, else the bare FSA. The key is
    // always the FSA (capture group 1), see `NormalizedPostal.key`.
    return { country: "CA", code: compact.replace(/-/g, ""), key: ca[1] }
  }
  return null
}

/**
 * Whether typing alone should look a code up. ADDED 2026-11-08 (ZIP search):
 * only a complete code does — a US ZIP, or a full six-character Canadian
 * code. A bare FSA ("K1A") is an accepted shape, but while typing it is
 * almost always the first half of a full code: looking it up at three
 * characters sent two lookups for every Canadian, and in a saved map view the
 * FSA's found point closed the keyboard mid-code. Submit and retry still
 * accept a bare FSA (the hook sends them to `decideZipLookup` without this
 * check), so someone who means the FSA presses the keyboard's Search key.
 */
export function shouldAutoLookup(normalized: NormalizedPostal | null): boolean {
  if (!normalized) return false
  return normalized.country === "US" || normalized.code.length === 6
}

export function parseSearchMode(raw: string | null | undefined): InPersonSearchMode | null {
  return raw === "gps" || raw === "zip" ? raw : null
}

/**
 * A stored pick wins. With none, someone who already allowed location in the
 * app starts on GPS (what they had before); everyone else starts on ZIP so no
 * permission prompt greets a first visit.
 */
export function decideStartingSearchMode(input: {
  stored: string | null | undefined
  locationEnabled: boolean
}): InPersonSearchMode {
  return parseSearchMode(input.stored) ?? (input.locationEnabled ? "gps" : "zip")
}

export interface StoredZip {
  code: string
  country: PostalCountry
  lat: number
  lon: number
}

export function serializeStoredZip(z: StoredZip): string {
  return JSON.stringify({ code: z.code, country: z.country, lat: z.lat, lon: z.lon })
}

function inRange(n: unknown, limit: number): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= -limit && n <= limit
}

/** Validates every field: a hand-edited or corrupt MMKV value must never become a search centre. */
export function parseStoredZip(raw: string | null | undefined): StoredZip | null {
  if (!raw) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== "object" || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.code !== "string" || o.code === "") return null
  if (o.country !== "US" && o.country !== "CA") return null
  if (!inRange(o.lat, 90) || !inRange(o.lon, 180)) return null
  return { code: o.code, country: o.country, lat: o.lat, lon: o.lon }
}

export type ZipAnswer =
  | { found: true; lat: number; lon: number; country: PostalCountry }
  | { found: false }

export type ZipLookupDecision =
  | { action: "invalid" }
  | { action: "unavailable" }
  | { action: "memo"; answer: ZipAnswer }
  | { action: "in-flight" }
  | { action: "fetch"; code: string }

/**
 * What to do with typed input. Order matters: a malformed code is invalid even
 * when the route is known missing (`unavailable`, a 404 earlier this session),
 * the memo answers before any network, and only the SAME code in flight is
 * deduped, so a changed code is never swallowed.
 */
export function decideZipLookup(input: {
  normalized: NormalizedPostal | null
  memo: ReadonlyMap<string, ZipAnswer>
  unavailable: boolean
  inFlightCode: string | null
}): ZipLookupDecision {
  const { normalized, memo, unavailable, inFlightCode } = input
  if (!normalized) return { action: "invalid" }
  if (unavailable) return { action: "unavailable" }
  // CHANGED 2026-11-08: keyed by `key`, not `code`, matching the api (Canada
  // by FSA). `inFlightCode` and the memo hold keys, and the fetch sends one.
  const answer = memo.get(normalized.key)
  if (answer) return { action: "memo", answer }
  if (inFlightCode === normalized.key) return { action: "in-flight" }
  return { action: "fetch", code: normalized.key }
}

/**
 * GPS is allowed only in GPS mode with location enabled; in ZIP mode it is
 * never allowed, whatever the setting. The centre is the fix (GPS) or the
 * resolved ZIP point (ZIP).
 */
export function deriveSearchFlags(input: {
  mode: InPersonSearchMode | null
  locationEnabled: boolean
  hasFix: boolean
  hasZipCenter: boolean
}): { gpsAllowed: boolean; hasCenter: boolean } {
  const { mode, locationEnabled, hasFix, hasZipCenter } = input
  const gpsAllowed = mode === "gps" && locationEnabled
  const hasCenter = mode === "gps" ? gpsAllowed && hasFix : mode === "zip" ? hasZipCenter : false
  return { gpsAllowed, hasCenter }
}

/** The location visit gate runs only for GPS mode that has not been enabled yet. */
export function shouldRunVisitGate(input: {
  mode: InPersonSearchMode | null
  locationEnabled: boolean
}): boolean {
  return input.mode === "gps" && !input.locationEnabled
}

/** In ZIP mode without an OS grant, "I'm Here" must explain before it asks. */
export function shouldExplainImHere(input: {
  mode: InPersonSearchMode | null
  osGranted: boolean
}): boolean {
  return input.mode === "zip" && !input.osGranted
}
