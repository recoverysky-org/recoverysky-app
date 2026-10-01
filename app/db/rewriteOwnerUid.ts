/**
 * Move local rows from a device owner's previous subs to their current one.
 *
 * ADDED 2026-09-30 (spec 2 §7, docs/superpowers/specs/2026-09-17-device-owner-
 * and-wrong-account-recovery-design.md). When the owner's identity is linked
 * into another account from a different device, Auth0 starts answering with
 * the primary's sub, and the ownership gate moves `ownerSub` there
 * (`relinked`). Rows stamped with the old sub would otherwise be orphaned:
 * report polling skips `attendance_reports` rows whose `uid` is not the
 * signed-in user's (reportPollingLogic "skip-foreign"), so those reports sat
 * on Pending forever; reminders were left on a sub that no longer exists.
 *
 * Raw SQL on purpose, NOT the repositories: attendanceRepo's mutation hook
 * enqueues every write to the sync outbox, and rewriting a column the server
 * ignores (it stamps the token's sub) must not re-push every record.
 *
 * Idempotent — `WHERE uid IN (...)` matches nothing once the rows have moved —
 * so it is safe to run on every database open while the owner has previous
 * subs (OwnerRelinkMigrator) and again from the gate itself. One transaction,
 * so a crash leaves either all three tables moved or none.
 */

import { logger } from "@/utils/logger"

import { getDb } from "./provider"

const log = logger.child({ module: "rewriteOwnerUid" })

/** Tables whose `uid` column records the owning account (common-lib schema). */
const OWNED_TABLES = ["attendances", "attendance_reports", "reminders"] as const

/**
 * Returns the number of rows moved, or `null` when the database is not open
 * (the caller retries on the next open). Throws only if SQLite does.
 */
export function rewriteOwnerUid(fromSubs: readonly string[], toSub: string): number | null {
  const from = fromSubs.filter((sub) => sub && sub !== toSub)
  if (from.length === 0) return 0
  const { expoDb } = getDb()
  if (!expoDb) return null

  const placeholders = from.map(() => "?").join(", ")
  let moved = 0
  expoDb.withTransactionSync(() => {
    for (const table of OWNED_TABLES) {
      const result = expoDb.runSync(`UPDATE ${table} SET uid = ? WHERE uid IN (${placeholders})`, [
        toSub,
        ...from,
      ])
      moved += result.changes
    }
  })
  if (moved > 0) log.info("Moved local rows to the relinked owner", { moved })
  return moved
}
