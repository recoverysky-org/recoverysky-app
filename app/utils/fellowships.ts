import { Fellowship } from "@recoverysky-org/common/browser"

/**
 * Active recovery fellowships surfaced in the app's pickers and filters
 * (Settings, Onboarding, Live tab, Listings tab), driven by the
 * `EXPO_PUBLIC_FELLOWSHIPS` build-time env var — e.g. `"AA,NA,CMA"`.
 *
 * Why env-driven instead of a hardcoded array: the *set* of fellowships we
 * offer is a product decision that changes without any native change (we
 * dropped RD and added CMA here purely via .env). Before this, four screens
 * each carried their own `[AA, NA, RD]` literal, so adding/removing one meant
 * editing four files and risking drift. This is the single source of truth.
 *
 * The canonical list of *valid* fellowship values still lives in the
 * `Fellowship` enum in recoverysky-common — this only narrows which of those
 * the UI currently exposes. `EXPO_PUBLIC_FELLOWSHIPS` is baked in at build
 * time by Expo's static `process.env.EXPO_PUBLIC_*` substitution, so this
 * const is resolved once at module load.
 *
 * Validation: each token must be a real `Fellowship` enum value; unknown
 * tokens (a typo in .env) are dropped with a warning so they can't inject a
 * bogus picker entry. If the var is unset/empty/all-invalid we fall back to
 * [AA, NA] so the UI is never left with an empty fellowship list.
 */

const DEFAULT_FELLOWSHIPS: Fellowship[] = [Fellowship.AA, Fellowship.NA]

// All real enum values except NONE ("") — NONE is the "unset" sentinel and
// must never be a selectable option.
const VALID_FELLOWSHIPS = new Set<string>(
  Object.values(Fellowship).filter((v) => v !== Fellowship.NONE),
)

export const ACTIVE_FELLOWSHIPS: Fellowship[] = (() => {
  // process.env.EXPO_PUBLIC_* is typed `any` in this project — pin to string
  // so the parsing chain below stays type-safe.
  const raw: string | undefined = process.env.EXPO_PUBLIC_FELLOWSHIPS
  if (!raw) return DEFAULT_FELLOWSHIPS

  const parsed = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => {
      if (VALID_FELLOWSHIPS.has(token)) return true
      // eslint-disable-next-line no-console
      console.warn(
        `[fellowships] ignoring unknown EXPO_PUBLIC_FELLOWSHIPS token: "${token}" ` +
          `(not a Fellowship enum value)`,
      )
      return false
    })
    .map((token) => token as Fellowship)

  return parsed.length > 0 ? parsed : DEFAULT_FELLOWSHIPS
})()
