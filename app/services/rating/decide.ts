/**
 * Rating engine decision core — PURE, no I/O.
 *
 * `shouldPrompt` is the entire eligibility gate expressed as one pure function
 * so it can be exhaustively unit-tested without mocking Alert/StoreReview/MMKV.
 */

import type { RatingConfig } from "./config"
import type { RatingState } from "./types"

/**
 * Whole-day difference between an ISO timestamp and a Date.
 *
 * Normalizes both ends to local noon before diffing — mirrors the codebase's
 * existing day-math (ProfileStore.cleanDays, useNinetyInNinety.daysBetween) so
 * DST shifts and timezone boundaries can't produce an off-by-one.
 */
export function daysBetween(startIso: string, end: Date): number {
  const start = new Date(startIso)
  start.setHours(12, 0, 0, 0)
  const e = new Date(end.getTime())
  e.setHours(12, 0, 0, 0)
  return Math.floor((e.getTime() - start.getTime()) / 86_400_000)
}

/**
 * Should we show the soft-ask right now?
 *
 * Note: this is intentionally independent of `reviewEnabled` — that flag gates
 * the prompt in the orchestrator (maybePrompt), NOT here, so the pure gate stays
 * about user-state only.
 */
export function shouldPrompt(
  s: RatingState,
  now: Date,
  version: string | null,
  cfg: RatingConfig,
): boolean {
  if (s.disabled) return false

  // Warm-up gate (applies to the first prompt; cheap to keep checking after).
  if (s.events < cfg.MIN_EVENTS) return false
  if (daysBetween(s.installedAt, now) < cfg.MIN_DAYS) return false

  // First-ever prompt: warm-up satisfied → go.
  if (s.lastPromptAt === null) return true

  const gap = daysBetween(s.lastPromptAt, now)

  // Approver path: only re-ask on a NEW native version, after a long floor.
  // (The OS also rate-limits requestReview to ~3/yr and silently no-ops, so
  // re-asking an approver more aggressively buys nothing.)
  if (s.approvedAtVersion !== null) {
    return version !== null && version !== s.approvedAtVersion && gap >= cfg.APPROVE_MIN_GAP_DAYS
  }

  // Denier path: exponential backoff; past the end of the schedule → never auto-ask again.
  const wait = cfg.DENY_BACKOFF_DAYS[s.denyCount - 1]
  if (wait === undefined) return false
  return gap >= wait
}
