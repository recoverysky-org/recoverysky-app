/**
 * Pure logic for the Meetings tab's shared filter bar (Fellowship + Lang).
 *
 * ADDED 2026-09-26. The two filters used to live inside each segment, with
 * three different behaviours: Live held a browse-only override, In-Person held
 * another inside useNearbySchedules, and Search wrote straight to
 * `profileStore.fellowship`, silently changing the user's Settings. They now
 * live once, above the segmented control, in MeetingFiltersContext. This module
 * holds every decision that context and the segments make, so vitest can cover
 * them.
 *
 * Deliberately free of runtime `@/` imports (CLAUDE.md "Test Runner Split").
 * Spec: docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md
 */

/**
 * ISO 639-1 codes (uppercase) → native display names.
 * MOVED 2026-09-26 verbatim from ListingsScreen.tsx so all three segments share
 * one table.
 */
export const LANGUAGE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  EN: "English",
  ES: "Español",
  FR: "Français",
  PT: "Português",
  DE: "Deutsch",
  RU: "Русский",
  AR: "العربية",
  TH: "ไทย",
  IT: "Italiano",
  JA: "日本語",
  KO: "한국어",
  ZH: "中文",
  NL: "Nederlands",
  PL: "Polski",
  SV: "Svenska",
  HE: "עברית",
  HI: "हिन्दी",
  TR: "Türkçe",
  UK: "Українська",
  FA: "فارسی",
}

/** Native name for a code; an unknown code shows as itself rather than blank. */
export function getLanguageDisplayName(code: string): string {
  return LANGUAGE_DISPLAY_NAMES[code] ?? code
}

/**
 * The fellowship the bar shows.
 *
 * Precedence: the value the user picked in the bar (persisted), then their
 * Settings fellowship, then the first fellowship this build offers.
 * Each candidate must be in `active`: a build can drop a fellowship via
 * EXPO_PUBLIC_FELLOWSHIPS, and sending a retired code to the nearby/daily
 * endpoints would return an empty list with no way to explain it.
 *
 * This is called during render, never used to seed state. `saved` is
 * `profileStore.fellowship`, which reads "AA" until ProfileHydrator loads the
 * real value from encrypted SQLite. Deriving it every render lets the
 * hydrated value flow through. Seeding state from it would freeze the
 * pre-hydration default.
 */
export function resolveFellowship(i: {
  persisted: string | null
  saved: string | undefined
  active: readonly string[]
}): string {
  if (i.persisted && i.active.includes(i.persisted)) return i.persisted
  if (i.saved && i.active.includes(i.saved)) return i.saved
  return i.active[0] ?? ""
}

/**
 * MMKV value → language code, or null for "all languages".
 * Junk that isn't a 2–3 letter code reads as "all" rather than as a filter
 * that could never match anything.
 */
export function parsePersistedLanguage(raw: string | null): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase()
  return /^[A-Z]{2,3}$/.test(code) ? code : null
}

/** The only field these helpers read. Structural, so every meeting shape fits. */
export type LanguageCarrier = { language?: string | null }

/**
 * Options for the Lang picker: the languages present in `meetings`, plus the
 * current selection whether or not it is present. Without that, a remembered
 * "ES" on a list with no Spanish meetings would vanish from the picker. The
 * user could then neither see what is filtering the list nor clear it.
 */
export function buildLanguageOptions(
  meetings: readonly LanguageCarrier[],
  selected: string | null,
): string[] {
  const codes = new Set<string>()
  for (const m of meetings) {
    if (m.language) codes.add(m.language.toUpperCase())
  }
  if (selected) codes.add(selected)
  return Array.from(codes).sort()
}

/** `null` = all languages. Meeting data mixes case, so compare uppercased. */
export function matchesLanguage(meeting: LanguageCarrier, selected: string | null): boolean {
  if (!selected) return true
  return meeting.language?.toUpperCase() === selected
}
