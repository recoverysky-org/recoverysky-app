/**
 * Rating engine shared types. Kept dependency-free (no `@/` imports) so the pure
 * modules and unit tests can consume them without pulling in MMKV/native code.
 */

export interface RatingState {
  /** Total counted events. Incremented unconditionally (never gated). */
  events: number
  /** ISO timestamp the engine first saw this install; anchors the daysSinceInstall gate. */
  installedAt: string
  /** ISO timestamp of the last soft-ask; null until the first prompt. */
  lastPromptAt: string | null
  /** Number of "Not really" taps → index into the deny backoff schedule. */
  denyCount: number
  /** Native app version when the user last tapped "Yes!"; null if never approved. */
  approvedAtVersion: string | null
  /** Terminal stop: backoff exhausted, or future explicit opt-out. */
  disabled: boolean
}

/** Shape of the OLD review service's persisted state (for migration only). */
export interface LegacyReviewState {
  totalMeetings?: number
  disabled?: boolean
}
