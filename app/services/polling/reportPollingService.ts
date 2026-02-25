/**
 * Report Polling Service
 *
 * Adaptive polling for attendance report delivery confirmation.
 * Fire-and-forget with deduplication — never stops until resolved.
 *
 * Schedule:
 *   15s initial delay
 *   0–5 min: every 10s
 *   5–60 min: every 60s
 *   60 min+: every 15 min
 */

import {
  attendanceReportRepo,
  attendanceEvents,
  type AttendanceReportUpdateInput,
} from "@/db"
import { api } from "@/services/api"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "ReportPolling" })

// ============================================================================
// Types
// ============================================================================

/** Extended update input — `retry` exists in SQLite schema but not in compiled .d.ts */
type UpdateInput = AttendanceReportUpdateInput & { retry?: number }

// ============================================================================
// Constants
// ============================================================================

const INITIAL_DELAY_MS = 15_000
const FAST_INTERVAL_MS = 10_000 // 0–5 min
const MEDIUM_INTERVAL_MS = 60_000 // 5–60 min
const SLOW_INTERVAL_MS = 900_000 // 60 min+
const FAST_THRESHOLD_MS = 5 * 60_000
const SLOW_THRESHOLD_MS = 60 * 60_000

// ============================================================================
// Module state
// ============================================================================

/** Active polls tracked for deduplication */
const activePolls = new Set<string>()

// ============================================================================
// Helpers
// ============================================================================

/** Compute next poll delay based on elapsed time since polling started */
function getNextDelay(startTime: number): number {
  const elapsed = Date.now() - startTime
  if (elapsed < FAST_THRESHOLD_MS) return FAST_INTERVAL_MS
  if (elapsed < SLOW_THRESHOLD_MS) return MEDIUM_INTERVAL_MS
  return SLOW_INTERVAL_MS
}

// ============================================================================
// Polling
// ============================================================================

/**
 * Start adaptive polling for a report's delivery confirmation.
 *
 * Fire-and-forget — polls until `confirmed !== 0` or `error === true`.
 * Deduplication: calling with the same reportId while a poll is active is a no-op.
 */
export function pollForConfirmation(reportId: string): void {
  if (activePolls.has(reportId)) {
    log.debug("Poll already active, skipping", { reportId })
    return
  }

  activePolls.add(reportId)
  const startTime = Date.now()
  log.info("Poll started", { reportId })

  const poll = async () => {
    const elapsed = Date.now() - startTime
    log.debug("Poll attempt", { reportId, elapsedMs: elapsed })

    try {
      const result = await api.getReportStatus({ id: reportId })
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
            elapsedMs: Date.now() - startTime,
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
          activePolls.delete(reportId)
          return
        }
      } else {
        log.warn("Poll: API non-ok", { reportId, kind: result.kind })
      }
    } catch (err) {
      log.error("Poll: exception", { reportId, error: String(err) })
    }

    // Not resolved — schedule next poll (never give up)
    const delay = getNextDelay(startTime)
    log.debug("Poll: scheduling next", { reportId, delayMs: delay, elapsedMs: Date.now() - startTime })
    setTimeout(poll, delay)
  }

  setTimeout(poll, INITIAL_DELAY_MS)
}

/**
 * Resume polling for all unconfirmed reports.
 * Call once on app startup after the database is ready.
 */
export async function resumeUnconfirmedPolls(): Promise<void> {
  try {
    const result = await attendanceReportRepo.findUnconfirmed()
    if (!result.ok) {
      log.warn("Failed to query unconfirmed reports", { error: String(result.error) })
      return
    }
    if (result.value.length === 0) {
      log.debug("No unconfirmed reports to resume")
      return
    }
    for (const report of result.value) {
      pollForConfirmation(report.id)
    }
    log.info("Resumed polling for unconfirmed reports", { count: result.value.length })
  } catch (err) {
    log.error("Failed to resume report polling", { error: String(err) })
  }
}
