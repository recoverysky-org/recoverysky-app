/**
 * Rating engine configuration.
 *
 * Thresholds are env-overridable (same `EXPO_PUBLIC_*` pattern as the rest of
 * the app); the backoff schedule and approve cooldown are fixed constants
 * (not worth env-plumbing). See the design doc for the full rationale.
 */

/**
 * Parse a numeric env var, allowing a legitimate `0`.
 *
 * `Number(x) || fallback` is the obvious shorthand but it's WRONG here: it
 * treats `0` as falsy and returns the fallback, so `EXPO_PUBLIC_RATING_MIN_DAYS=0`
 * (used in dev to fire the prompt immediately) would silently become the default.
 */
function numEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export interface RatingConfig {
  /** Min counted events before the first soft-ask (warm-up event gate). */
  MIN_EVENTS: number
  /** Min days since install before the first soft-ask (warm-up tenure gate). */
  MIN_DAYS: number
  /** Min days between re-asks for a user who already approved (version-gated path). */
  APPROVE_MIN_GAP_DAYS: number
  /** Exponential backoff (days) between re-asks after each deny; past the end → stop. */
  DENY_BACKOFF_DAYS: number[]
}

export const CFG: RatingConfig = {
  MIN_EVENTS: numEnv(process.env.EXPO_PUBLIC_RATING_MIN_EVENTS, 5),
  MIN_DAYS: numEnv(process.env.EXPO_PUBLIC_RATING_MIN_DAYS, 3),
  APPROVE_MIN_GAP_DAYS: 90,
  DENY_BACKOFF_DAYS: [45, 120, 365],
}

/** MMKV key for the new rating-engine state. */
export const STORAGE_KEY = "app-rating-engine-v1"

/**
 * MMKV key written by the OLD review service. Its presence is how we detect a
 * pre-existing install during migration — see state.ts::computeInitialState.
 */
export const LEGACY_STORAGE_KEY = "app-review-state-v4"

/** Where the deny-path feedback divert sends users (same URL as Settings/Home/Login). */
export const SUPPORT_URL = "https://www.recoverysky.org/support"
