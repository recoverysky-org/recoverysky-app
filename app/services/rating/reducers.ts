/**
 * Rating engine state transitions — PURE, no I/O.
 *
 * Each returns a NEW state object (never mutates) so the orchestrator can
 * `state = reduceX(state)` and the transitions stay trivially unit-testable.
 */

import type { RatingConfig } from "./config"
import type { RatingState } from "./types"

/**
 * Count one event. Takes NO flag argument by design — this is the structural
 * guarantee that counting is unconditional (re-adding a `reviewEnabled` check
 * here would be bug #2 all over again). The prompt gate lives in maybePrompt.
 */
export function reduceRecordEvent(s: RatingState): RatingState {
  return { ...s, events: s.events + 1 }
}

/** User tapped "Yes!" — stamp the approve so the version-gated cooldown applies. */
export function applyApprove(s: RatingState, nowIso: string, version: string | null): RatingState {
  return { ...s, lastPromptAt: nowIso, approvedAtVersion: version }
}

/**
 * User tapped "Not really" — advance the backoff index. Once we've exhausted the
 * backoff schedule (denyCount past the last step), disable permanently so we
 * never auto-ask again.
 */
export function applyDeny(s: RatingState, nowIso: string, cfg: RatingConfig): RatingState {
  const denyCount = s.denyCount + 1
  return {
    ...s,
    lastPromptAt: nowIso,
    denyCount,
    disabled: denyCount > cfg.DENY_BACKOFF_DAYS.length,
  }
}
