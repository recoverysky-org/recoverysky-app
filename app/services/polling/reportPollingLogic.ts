/**
 * reportPollingLogic — pure decisions for attendance report delivery polling.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it (vitest
 * has no path-alias resolution in this repo — see CLAUDE.md "Test Runner
 * Split"). The I/O half — timers, the API call, the SQLite update, the
 * events — lives in `reportPollingService.ts`.
 *
 * ADDED 2026-09-13 after a Loki sweep found one 4.10.1 device signed in with
 * its Google identity polling six reports created under the email identity:
 * 710 failed status calls in three days, 44 of them 429s. The server answers
 * an ownership mismatch with 404 (deliberately indistinguishable from "no
 * such id"), and the poller had no terminal condition except a 200 with
 * `confirmed` / `error` set, so every cold start re-armed all six from the
 * fast phase. Three rules below close that, and every other "polls forever"
 * shape with it:
 *   1. only resume reports the signed-in identity owns (`decideResume`)
 *   2. anchor the cadence on the report's real age, and back off after any
 *      problem (`getNextDelay`)
 *   3. stop on `not-found` (`isTerminalProblem`)
 */

// ============================================================================
// Cadence
// ============================================================================

export const FAST_INTERVAL_MS = 10_000 // 0–5 min
export const MEDIUM_INTERVAL_MS = 60_000 // 5–60 min
export const SLOW_INTERVAL_MS = 900_000 // 60 min+
export const FAST_THRESHOLD_MS = 5 * 60_000
export const SLOW_THRESHOLD_MS = 60 * 60_000

/**
 * Reports older than this are never resumed at cold start. Postmark's
 * delivery / bounce webhook lands within minutes of a send; a week-old
 * unconfirmed report is a lost webhook or a foreign row, and asking the
 * server every 15 minutes for the rest of the install's life will not
 * change that. The row stays "Pending" in the UI — that is the honest
 * state from this device's point of view.
 */
export const MAX_POLL_AGE_MS = 7 * 24 * 60 * 60_000

/** What the last poll attempt produced. `problem` is any non-ok API result. */
export type PollOutcome = "pending" | "problem"

/**
 * Next delay before polling again.
 *
 * `startedAt` is the report's `generated` timestamp, NOT the moment polling
 * began. A cold-start resume used to restart the fast phase for every backlog
 * report at once — six reports × 6 calls/min — which is how the 60/min
 * `reports-status` bucket got exhausted. Anchoring on the report's real age
 * means a resumed three-day-old report polls at the slow cadence immediately.
 *
 * Any API problem jumps straight to the slow interval regardless of age. A
 * 429 retried every 10 s is what turned a rate-limit into a loop; a 5xx,
 * connection failure, or 401 from a degraded device lane is no more likely
 * to clear in 10 s than in 15 min.
 */
export function getNextDelay(startedAt: number, now: number, outcome: PollOutcome): number {
  if (outcome === "problem") return SLOW_INTERVAL_MS
  const elapsed = now - startedAt
  if (elapsed < FAST_THRESHOLD_MS) return FAST_INTERVAL_MS
  if (elapsed < SLOW_THRESHOLD_MS) return MEDIUM_INTERVAL_MS
  return SLOW_INTERVAL_MS
}

// ============================================================================
// Resume
// ============================================================================

export type ResumeDecision = "resume" | "skip-foreign" | "skip-stale"

/** The two report columns the resume decision reads. */
export interface ResumeCandidate {
  uid: string
  generated: number
}

/**
 * Whether a cold-start resume should poll this unconfirmed report.
 *
 * Foreign first: a report stamped with another identity's uid gets a 404
 * from the server no matter how fresh it is, so ownership is checked before
 * age. An empty uid is a row created before the column was stamped; the
 * server's status route is id-addressed for those, so it can still resolve.
 */
export function decideResume(
  report: ResumeCandidate,
  currentUid: string | undefined,
  now: number,
): ResumeDecision {
  if (report.uid !== "" && report.uid !== currentUid) return "skip-foreign"
  if (now - report.generated > MAX_POLL_AGE_MS) return "skip-stale"
  return "resume"
}

// ============================================================================
// Termination
// ============================================================================

/**
 * Whether an API problem kind means "stop polling this report".
 *
 * Only `not-found`: the server has said "no such report, or not yours", and
 * neither changes by asking again. Everything else — 429, 5xx, offline, a
 * 401 while the device lane is degraded — is a reason to wait, not to quit.
 * Nothing is persisted on termination; the next cold start retries once and
 * `decideResume` bounds that.
 */
export function isTerminalProblem(kind: string): boolean {
  return kind === "not-found"
}
