/**
 * Rating engine persisted state I/O. The pure first-run logic lives in
 * migrate.ts; this file is the only one here that touches MMKV.
 */

import { load, remove, save } from "@/utils/storage"

import { LEGACY_STORAGE_KEY, STORAGE_KEY, type RatingConfig } from "./config"
import { computeInitialState } from "./migrate"
import type { LegacyReviewState, RatingState } from "./types"

export type { RatingState } from "./types"

export function loadState(): RatingState | null {
  return load<RatingState>(STORAGE_KEY)
}

export function saveState(state: RatingState): void {
  save(STORAGE_KEY, state)
}

/** Load existing state, or migrate/create it, persisting the result. */
export function initState(now: Date, cfg: RatingConfig): RatingState {
  const existing = loadState()
  const legacy = existing ? null : load<LegacyReviewState>(LEGACY_STORAGE_KEY)
  const { state, removeLegacy } = computeInitialState(existing, legacy, now, cfg)
  if (!existing) saveState(state)
  if (removeLegacy) remove(LEGACY_STORAGE_KEY)
  return state
}
