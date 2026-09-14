/**
 * Report Polling Service
 *
 * Adaptive polling for attendance report delivery confirmation.
 * Fire-and-forget with deduplication.
 *
 * Schedule (see `reportPollingLogic.ts` for the constants and decisions):
 *   15s initial delay
 *   0–5 min: every 10s
 *   5–60 min: every 60s
 *   60 min+: every 15 min
 *
 * CHANGED 2026-09-13: this used to "never stop until resolved". A Loki sweep
 * found one 4.10.1 device polling six reports it could never see — created
 * under the user's email identity, polled while signed in with the Google
 * identity — for 710 failed calls in three days, 44 of them 429s. The loop
 * now (a) only resumes reports the signed-in identity owns and that are
 * younger than seven days, (b) measures its cadence from the report's real
 * age instead of restarting the fast phase on every cold start, (c) drops to
 * the slow interval after any API problem, (d) stops on `not-found`, and
 * (e) can be cancelled wholesale when the signed-in identity changes. All
 * decisions are pure and vitest-covered in `reportPollingLogic.ts`.
 */

import { attendanceReportRepo, attendanceEvents, type AttendanceReportUpdateInput } from "@/db"
import { api } from "@/services/api"
import { logger } from "@/utils/logger"

import { decideResume, getNextDelay, isTerminalProblem } from "./reportPollingLogic"

const log = logger.child({ module: "ReportPolling" })

// ============================================================================
// Types
// ============================================================================

/** Extended update input — `retry` exists in SQLite schema but not in compiled .d.ts */
type UpdateInput = AttendanceReportUpdateInput & { retry?: number }

interface ActivePoll {
  /** The pending timer, or null while a request is in flight. */
  timer: ReturnType<typeof setTimeout> | null
  /**
   * Set by `stopAllPolls()`. A poll that was mid-request when cancelled
   * checks this after the await and exits instead of scheduling again —
   * clearing the timer alone cannot reach a request already on the wire.
   */
  cancelled: boolean
}

// ============================================================================
// Constants
// ============================================================================

const INITIAL_DELAY_MS = 15_000

// ============================================================================
// Module state
// ============================================================================

/** Active polls, keyed by report id, for deduplication and cancellation. */
const activePolls = new Map<string, ActivePoll>()

/**
 * Bumped by `stopAllPolls()`. `resumeUnconfirmedPolls` captures it before its
 * SQLite await and bails if it moved, so an identity change that lands while
 * the resume query is in flight cannot have the stale pass start polls for
 * the previous identity — `stopAllPolls()` ran before those polls existed and
 * had nothing to cancel.
 */
let resumeGeneration = 0

// ============================================================================
// Polling
// ============================================================================

/**
 * Start adaptive polling for a report's delivery confirmation.
 *
 * Fire-and-forget — polls until `confirmed !== 0` or `error === true`, or
 * until the server answers `not-found` (see `isTerminalProblem`).
 *
 * `startedAt` anchors the cadence. Omit it for a fresh send (now); the
 * cold-start resumer passes the report's `generated` timestamp so a
 * three-day-old backlog report polls at the slow interval immediately.
 *
 * Deduplication is asymmetric on purpose: a resume (`startedAt` given) is a
 * no-op if the report is already being polled, but a fresh send restarts an
 * active poll. A resumed poll may be sitting on a 15-minute timer, and after
 * a resend / replace the user is watching for a result — restarting from the
 * fast phase is the behavior they expect.
 */
export function pollForConfirmation(reportId: string, startedAt?: number): void {
  const existing = activePolls.get(reportId)
  if (existing) {
    if (startedAt !== undefined) {
      log.debug("Poll already active, skipping resume", { reportId })
      return
    }
    log.debug("Poll already active, restarting for fresh send", { reportId })
    cancelPoll(reportId, existing)
  }

  const anchor = startedAt ?? Date.now()
  const handle: ActivePoll = { timer: null, cancelled: false }
  activePolls.set(reportId, handle)
  log.info("Poll started", { reportId, ageMs: Date.now() - anchor })

  const finish = () => {
    // Only forget the handle if it is still ours — a restart may have
    // replaced it while this request was in flight.
    if (activePolls.get(reportId) === handle) activePolls.delete(reportId)
  }

  const poll = async () => {
    handle.timer = null
    log.debug("Poll attempt", { reportId, ageMs: Date.now() - anchor })

    let outcome: "pending" | "problem" = "pending"
    try {
      const result = await api.getReportStatus({ id: reportId })
      if (handle.cancelled) {
        log.debug("Poll cancelled mid-request, dropping result", { reportId })
        return
      }
      if (result.kind === "ok") {
        const { confirmed, error, confirmation, html, retry } = result.data
        log.debug("Poll response", {
          reportId,
          confirmed,
          error,
          retry,
          hasConfirmation: !!confirmation,
          hasHtml: !!html,
        })

        if (confirmed !== 0 || error) {
          log.info("Poll resolved", {
            reportId,
            confirmed,
            error,
            retry,
            confirmation: confirmation || "none",
            ageMs: Date.now() - anchor,
          })
          await attendanceReportRepo.update(reportId, {
            confirmed,
            error,
            confirmation,
            html,
            retry,
          } as UpdateInput)
          log.debug("Poll: DB updated", { reportId })
          attendanceEvents.emit({ type: "produced", id: reportId, reportId })
          attendanceEvents.emit({
            type: "delivery_resolved",
            id: reportId,
            reportId,
            deliveryError: !!error,
          })
          finish()
          return
        }
      } else if (isTerminalProblem(result.kind)) {
        // The server has said "no such report, or not yours" — the row stays
        // Pending locally (nothing is persisted), and the next cold start's
        // `decideResume` decides whether it is worth one more look.
        log.info("Poll abandoned: server reports not found", { reportId })
        finish()
        return
      } else {
        outcome = "problem"
        log.warn("Poll: API non-ok", { reportId, kind: result.kind })
      }
    } catch (err) {
      if (handle.cancelled) return
      outcome = "problem"
      log.error("Poll: exception", { reportId, error: String(err) })
    }

    // Not resolved — schedule next poll
    const delay = getNextDelay(anchor, Date.now(), outcome)
    log.debug("Poll: scheduling next", { reportId, delayMs: delay, outcome })
    handle.timer = setTimeout(poll, delay)
  }

  handle.timer = setTimeout(poll, INITIAL_DELAY_MS)
}

function cancelPoll(reportId: string, handle: ActivePoll): void {
  handle.cancelled = true
  if (handle.timer) clearTimeout(handle.timer)
  if (activePolls.get(reportId) === handle) activePolls.delete(reportId)
}

/**
 * Cancel every active poll. Called by `ReportPollingResumer` when the
 * signed-in identity changes: the old identity's reports would 404 for the
 * new one, and the new identity's backlog needs its own resume pass.
 */
export function stopAllPolls(): void {
  resumeGeneration++
  if (activePolls.size === 0) return
  log.info("Stopping all polls", { count: activePolls.size })
  for (const [reportId, handle] of activePolls) cancelPoll(reportId, handle)
}

/**
 * Resume polling for unconfirmed reports the signed-in identity can see.
 * Call once on app startup after the database is ready, and again whenever
 * the identity changes (after `stopAllPolls()`).
 *
 * `currentUid` is `AuthenticationStore.userId` — undefined when signed out.
 * Rows owned by a different identity and rows past the age cap are skipped
 * (`decideResume`); they stay Pending in the Reports list.
 */
export async function resumeUnconfirmedPolls(currentUid: string | undefined): Promise<void> {
  const generation = resumeGeneration
  try {
    const result = await attendanceReportRepo.findUnconfirmed()
    if (generation !== resumeGeneration) {
      log.info("Resume pass superseded by identity change, dropping", { currentUid: !!currentUid })
      return
    }
    if (!result.ok) {
      log.warn("Failed to query unconfirmed reports", { error: String(result.error) })
      return
    }
    if (result.value.length === 0) {
      log.debug("No unconfirmed reports to resume")
      return
    }
    const now = Date.now()
    let resumed = 0
    let skippedForeign = 0
    let skippedStale = 0
    for (const report of result.value) {
      const decision = decideResume(report, currentUid, now)
      if (decision === "resume") {
        resumed++
        pollForConfirmation(report.id, report.generated)
      } else if (decision === "skip-foreign") {
        skippedForeign++
      } else {
        skippedStale++
      }
    }
    log.info("Resumed polling for unconfirmed reports", {
      unconfirmed: result.value.length,
      resumed,
      skippedForeign,
      skippedStale,
    })
  } catch (err) {
    log.error("Failed to resume report polling", { error: String(err) })
  }
}
