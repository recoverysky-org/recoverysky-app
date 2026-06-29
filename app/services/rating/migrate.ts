/**
 * First-run state derivation — PURE, no I/O (kept free of `@/` imports so it's
 * unit-testable without MMKV). The rollout-critical migration logic lives here.
 */

import type { RatingConfig } from "./config"
import type { LegacyReviewState, RatingState } from "./types"

/**
 * Decide the initial state from what's on disk.
 *
 * @param existing  current v1 state if any (load returns null on miss)
 * @param legacy    old v4 state if any — its mere PRESENCE marks a pre-existing install
 * @returns         the state to use, and whether the legacy key should be deleted
 */
export function computeInitialState(
  existing: RatingState | null,
  legacy: LegacyReviewState | null,
  now: Date,
  cfg: RatingConfig,
): { state: RatingState; removeLegacy: boolean } {
  if (existing) return { state: existing, removeLegacy: false }

  if (legacy !== null) {
    // Pre-existing install. We do NOT carry legacy.totalMeetings — it's a
    // meaningless ~0 because the old service gated counting behind REVIEW_ENABLED
    // (which was false in prod). Instead seed the install as already past the
    // warm-up so the next event prompts once the flag flips on. installedAt is
    // backdated past MIN_DAYS so the tenure gate also clears immediately.
    //
    // legacy.disabled is intentionally dropped: with REVIEW_ENABLED off the auto
    // reminder never showed, so it could only be a Settings "Rate App" tap; the
    // rollout goal is to (re-)engage every existing user once.
    const backdated = new Date(now.getTime())
    backdated.setDate(backdated.getDate() - (cfg.MIN_DAYS + 1))
    return {
      state: {
        events: cfg.MIN_EVENTS,
        installedAt: backdated.toISOString(),
        lastPromptAt: null,
        denyCount: 0,
        approvedAtVersion: null,
        disabled: false,
      },
      removeLegacy: true,
    }
  }

  // Fresh post-ship install → normal warm-up from now.
  return {
    state: {
      events: 0,
      installedAt: now.toISOString(),
      lastPromptAt: null,
      denyCount: 0,
      approvedAtVersion: null,
      disabled: false,
    },
    removeLegacy: false,
  }
}
