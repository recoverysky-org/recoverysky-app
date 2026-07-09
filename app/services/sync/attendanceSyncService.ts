// app/services/sync/attendanceSyncService.ts
/**
 * Attendance cloud-sync orchestrator (dependency-injected).
 *
 * All I/O — API, SQLite, MMKV, entitlement checks, event emission — arrives
 * through `deps` so this file stays free of `@/` runtime imports and is
 * vitest-testable (vitest has no path-alias config). The real wiring lives in
 * app/services/sync/index.ts.
 *
 * Invariants (see the 2026-07-09 sync spec):
 * - Queue entries clear only on server-confirmed accepted/stale.
 * - The pull cursor advances only after a page fully merges.
 * - The gate is re-checked between push batches (sign-out mid-drain).
 */
import type { AttendanceRecord } from "@recoverysky-org/common/sqlite"
import { observable, runInAction } from "mobx"

import {
  SYNC_PUSH_BATCH_MAX,
  chunk,
  mergePullDecision,
  toServerRecord,
  type ServerAttendanceRecord,
  type ServerReportRecord,
} from "./syncLogic"

export type SyncPhase = "idle" | "backing-up" | "syncing" | "error"
export type SyncResource = "attendance" | "reports"

export interface SyncQueueEntry {
  queueId: string
  recordId: string
  operation: "create" | "update" | "delete"
  payload: string | null
}

export interface SyncDeps {
  api: {
    pushAttendance(
      records: ServerAttendanceRecord[],
    ): Promise<
      | { kind: "ok"; accepted: number; rejected: { id: string; reason: "stale" | "invalid" }[] }
      | { kind: string }
    >
    pullAttendance(
      since: number,
    ): Promise<
      | { kind: "ok"; records: ServerAttendanceRecord[]; cursor: number; hasMore: boolean }
      | { kind: string }
    >
    pullReports(
      since: number,
    ): Promise<
      | { kind: "ok"; records: ServerReportRecord[]; cursor: number; hasMore: boolean }
      | { kind: string }
    >
  }
  local: {
    findByIds(ids: string[]): Promise<AttendanceRecord[]>
    allIds(): Promise<string[]>
    exists(id: string): Promise<boolean>
    createFromServer(r: ServerAttendanceRecord): Promise<void>
    updateFromServer(r: ServerAttendanceRecord): Promise<void>
    remove(id: string): Promise<void>
    reportExists(id: string): Promise<boolean>
    reportCreateFromServer(r: ServerReportRecord): Promise<void>
    reportUpdateFromServer(r: ServerReportRecord): Promise<void>
    reportRemove(id: string): Promise<void>
  }
  queue: {
    enqueue(entry: {
      recordId: string
      operation: "create" | "update" | "delete"
      payload?: string
    }): Promise<void>
    pending(): Promise<SyncQueueEntry[]>
    markSynced(queueId: string): Promise<void>
    markFailed(queueId: string, message: string): Promise<void>
    clearPending(): Promise<void>
  }
  cursors: {
    get(resource: SyncResource, uid: string): number
    set(resource: SyncResource, uid: string, value: number): void
    getLastSyncedAt(uid: string): number | null
    setLastSyncedAt(uid: string, value: number): void
  }
  /** Combined availability check — syncEnabled, entitlement, auth, network,
   * maintenance. `uid` is the account key for cursors. */
  gate(): Promise<{ ok: boolean; uid: string }>
  /** Emit attendanceEvents "synced" so screens reload. */
  emitSynced(): void
  log: {
    debug(msg: string, ctx?: Record<string, unknown>): void
    info(msg: string, ctx?: Record<string, unknown>): void
    warn(msg: string, ctx?: Record<string, unknown>): void
    error(msg: string, ctx?: Record<string, unknown>): void
  }
  now(): number
  sleep(ms: number): Promise<void>
}

export interface SyncState {
  phase: SyncPhase
  lastSyncedAt: number | null
  pendingCount: number
}

/** ~7 s between push batches keeps a big drain under the server's 10 req/min limit. */
const BATCH_PACE_MS = 7_000
/** Rapid-fire local edits collapse into one push tick. */
const PUSH_DEBOUNCE_MS = 3_000
/** Consecutive whole-request failures gate ticks: 30 s → 1 min → 5 min. */
const BACKOFF_MS = [30_000, 60_000, 300_000]

export type AttendanceSyncService = ReturnType<typeof createAttendanceSyncService>

export function createAttendanceSyncService(deps: SyncDeps) {
  const syncState = observable<SyncState>({
    phase: "idle",
    lastSyncedAt: null,
    pendingCount: 0,
  })

  let consecutiveFailures = 0
  let nextAllowedAt = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  // Reentrancy guards — a tick fired while the same tick is mid-flight is a no-op.
  let pushing = false
  let pulling = false

  function backoffActive(): boolean {
    return deps.now() < nextAllowedAt
  }

  function recordFailure(): void {
    consecutiveFailures++
    const idx = Math.min(consecutiveFailures - 1, BACKOFF_MS.length - 1)
    nextAllowedAt = deps.now() + BACKOFF_MS[idx]
    // phase flips to "error" only on REPEATED failures so one flaky request
    // doesn't flicker the Settings status line.
    if (consecutiveFailures >= 2) {
      runInAction(() => {
        syncState.phase = "error"
      })
    }
  }

  function recordSuccess(): void {
    consecutiveFailures = 0
    nextAllowedAt = 0
  }

  function finishCycle(uid: string): void {
    const at = deps.now()
    deps.cursors.setLastSyncedAt(uid, at)
    runInAction(() => {
      syncState.phase = "idle"
      syncState.lastSyncedAt = at
    })
  }

  /** Drain the outbox: read current rows, batch, push, resolve queue entries. */
  async function pushTick(): Promise<void> {
    if (pushing || backoffActive()) return
    const gate = await deps.gate()
    if (!gate.ok) return
    pushing = true
    try {
      const entries = await deps.queue.pending()
      runInAction(() => {
        syncState.pendingCount = entries.length
      })
      if (entries.length === 0) {
        if (syncState.phase === "backing-up" || syncState.phase === "syncing") {
          finishCycle(gate.uid)
        }
        return
      }
      if (syncState.phase === "idle" || syncState.phase === "error") {
        runInAction(() => {
          syncState.phase = "syncing"
        })
      }

      // Group queue entries by record. N edits collapse to the record's
      // current row; any delete entry wins (it was the final operation —
      // getPending is FIFO) and its payload snapshot becomes the tombstone.
      interface Work {
        queueIds: string[]
        tombstonePayload: string | null
      }
      const byRecord = new Map<string, Work>()
      for (const e of entries) {
        const w = byRecord.get(e.recordId) ?? { queueIds: [], tombstonePayload: null }
        w.queueIds.push(e.queueId)
        if (e.operation === "delete") w.tombstonePayload = e.payload
        byRecord.set(e.recordId, w)
      }

      const upsertIds = [...byRecord.entries()]
        .filter(([, w]) => w.tombstonePayload === null)
        .map(([id]) => id)
      const rows = upsertIds.length > 0 ? await deps.local.findByIds(upsertIds) : []
      const rowById = new Map(rows.map((r) => [r.id, r]))

      const records: ServerAttendanceRecord[] = []
      const queueIdsByRecord = new Map<string, string[]>()
      for (const [recordId, w] of byRecord) {
        if (w.tombstonePayload !== null) {
          try {
            const snapshot = JSON.parse(w.tombstonePayload) as AttendanceRecord
            records.push(toServerRecord(snapshot, true))
            queueIdsByRecord.set(recordId, w.queueIds)
          } catch {
            deps.log.error("sync: unparseable delete snapshot", { recordId })
            for (const qid of w.queueIds) await deps.queue.markFailed(qid, "bad snapshot")
          }
          continue
        }
        const row = rowById.get(recordId)
        if (!row) {
          // Row vanished without a delete entry (hard delete raced the queue?).
          // Nothing to push — fail the entries so they stop retrying.
          deps.log.warn("sync: queued record missing locally", { recordId })
          for (const qid of w.queueIds) await deps.queue.markFailed(qid, "local row missing")
          continue
        }
        records.push(toServerRecord(row))
        queueIdsByRecord.set(recordId, w.queueIds)
      }

      const batches = chunk(records, SYNC_PUSH_BATCH_MAX)
      for (let i = 0; i < batches.length; i++) {
        if (i > 0) {
          await deps.sleep(BATCH_PACE_MS)
          // Re-check between batches: the user may sign out (or go offline)
          // mid-drain, and pushing under the wrong identity is worse than
          // leaving entries pending.
          const gateNow = await deps.gate()
          if (!gateNow.ok) return
        }
        const result = await deps.api.pushAttendance(batches[i])
        if (result.kind !== "ok") {
          // Whole-request failure — entries stay pending; next trigger retries.
          recordFailure()
          return
        }
        const ok = result as {
          accepted: number
          rejected: { id: string; reason: "stale" | "invalid" }[]
        }
        const invalid = new Set(ok.rejected.filter((r) => r.reason === "invalid").map((r) => r.id))
        for (const rec of batches[i]) {
          const queueIds = queueIdsByRecord.get(rec.id) ?? []
          if (invalid.has(rec.id)) {
            // A client bug (schema drift) — log loudly, don't retry forever.
            deps.log.error("sync: server rejected record as invalid", { id: rec.id })
            for (const qid of queueIds) await deps.queue.markFailed(qid, "invalid")
          } else {
            // accepted OR stale: either way the server is settled — done.
            for (const qid of queueIds) await deps.queue.markSynced(qid)
          }
        }
        recordSuccess()
      }

      const remaining = await deps.queue.pending()
      runInAction(() => {
        syncState.pendingCount = remaining.length
      })
      if (remaining.length === 0) finishCycle(gate.uid)
    } finally {
      pushing = false
    }
  }

  /** Pull one resource to completion (pages until hasMore=false). */
  async function pullTick(resource: SyncResource): Promise<void> {
    if (pulling || backoffActive()) return
    const gate = await deps.gate()
    if (!gate.ok) return
    pulling = true
    let changed = false
    try {
      let since = deps.cursors.get(resource, gate.uid)
      for (;;) {
        const result =
          resource === "attendance"
            ? await deps.api.pullAttendance(since)
            : await deps.api.pullReports(since)
        if (result.kind !== "ok") {
          recordFailure()
          return
        }
        // `as unknown as` (not a direct `as`): pullAttendance/pullReports return a
        // union of two record types whose `records` arrays don't structurally
        // overlap enough for tsc to allow a direct cast here (unlike the
        // analogous cast in pushTick, where the two variants overlap enough).
        const page = result as unknown as {
          records: (ServerAttendanceRecord | ServerReportRecord)[]
          cursor: number
          hasMore: boolean
        }
        if (page.records.length === 0) {
          recordSuccess()
          return
        }

        // Snapshot pending ids once per page — a record with an unpushed local
        // edit must not be clobbered by an older server copy (dirty-skip).
        const pending = await deps.queue.pending()
        const pendingIds = new Set(pending.map((e) => e.recordId))

        let pageClean = true
        for (const rec of page.records) {
          try {
            const existsLocally =
              resource === "attendance"
                ? await deps.local.exists(rec.id)
                : await deps.local.reportExists(rec.id)
            const action = mergePullDecision({
              deleted: rec.deleted,
              // Reports have no push path, so nothing is ever dirty.
              hasPendingPush: resource === "attendance" && pendingIds.has(rec.id),
              existsLocally,
            })
            if (action === "skip-dirty") continue
            changed = true
            if (resource === "attendance") {
              const a = rec as ServerAttendanceRecord
              if (action === "delete") await deps.local.remove(a.id)
              else if (action === "update") await deps.local.updateFromServer(a)
              else await deps.local.createFromServer(a)
            } else {
              const r = rec as ServerReportRecord
              if (action === "delete") await deps.local.reportRemove(r.id)
              else if (action === "update") await deps.local.reportUpdateFromServer(r)
              else await deps.local.reportCreateFromServer(r)
            }
          } catch (err) {
            pageClean = false
            deps.log.warn("sync: pull merge failed for record", {
              resource,
              id: rec.id,
              error: String(err),
            })
          }
        }

        // Cursor advances ONLY past fully-merged pages. A failed record keeps
        // the cursor on this page so the next pull retries it — merge is
        // idempotent, so the re-run is safe.
        if (!pageClean) {
          recordFailure()
          return
        }
        deps.cursors.set(resource, gate.uid, page.cursor)
        since = page.cursor
        recordSuccess()
        if (!page.hasMore) return
      }
    } finally {
      pulling = false
      if (changed) deps.emitSynced()
    }
  }

  /** Pull both resources then drain the outbox — the standard resume/focus sync. */
  async function fullSync(): Promise<void> {
    await pullTick("attendance")
    await pullTick("reports")
    await pushTick()
  }

  /** Debounced push — rapid-fire mutations collapse to one tick. */
  function nudgePush(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void pushTick()
    }, PUSH_DEBOUNCE_MS)
  }

  /**
   * First toggle-ON (and every re-enable): full pull, then enqueue the ENTIRE
   * local dataset and drain. No diffing against the pull — pushing records
   * the server already has is a safe LWW no-op (per the API doc). Interrupted
   * runs need no special resume: the queue is durable SQL and the next
   * launch's ticks keep draining.
   */
  async function initialBackup(): Promise<void> {
    const gate = await deps.gate()
    if (!gate.ok) return
    runInAction(() => {
      syncState.phase = "backing-up"
    })
    await pullTick("attendance")
    await pullTick("reports")
    const ids = await deps.local.allIds()
    for (const id of ids) {
      await deps.queue.enqueue({ recordId: id, operation: "update" })
    }
    await pushTick()
  }

  /** Logout: never push user A's records under user B's token. */
  async function onLogout(): Promise<void> {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    await deps.queue.clearPending()
    runInAction(() => {
      syncState.phase = "idle"
      syncState.pendingCount = 0
      syncState.lastSyncedAt = null
    })
  }

  return { syncState, pushTick, pullTick, fullSync, nudgePush, initialBackup, onLogout }
}
