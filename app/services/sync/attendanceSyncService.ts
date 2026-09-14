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
    /**
     * GET /reports/:id — the only source of a report's rendered body.
     * /sync/reports never returns html/text (metadata-only, server-side
     * constraint we can't change), so this is the sole path that completes
     * a pulled report's local copy.
     */
    getReport(id: string): Promise<{ kind: "ok"; html: string; text: string } | { kind: string }>
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
    /**
     * Ids of local reports whose body is still empty. Backed by local state
     * (not the sync cursor) so backfillReportBodies() can be re-run any
     * number of times — a failed fetch just leaves the id in this set for
     * the next pass to retry.
     */
    reportsMissingBody(): Promise<string[]>
    /** Store a report body fetched from GET /reports/:id. */
    reportSaveBody(id: string, html: string, text: string): Promise<void>
  }
  queue: {
    enqueue(entry: {
      recordId: string
      operation: "create" | "update" | "delete"
      payload?: string
    }): Promise<void>
    pending(): Promise<SyncQueueEntry[]>
    /**
     * I3: per-record dirty check, taken immediately before a pull merge
     * decision (NOT snapshotted once per page — see the comment at its call
     * site in pullTick). Task 6 backs this with an indexed
     * `findByRecordId("attendances", id)` lookup; deliberately a targeted
     * point lookup, not a batch/cache, to keep the check as close as
     * possible to the moment of the write.
     */
    isPending(recordId: string): Promise<boolean>
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
/** Small gap between per-report body fetches so a large first sync doesn't
 * hammer the API. GET /reports/:id is a plain read, so this is politeness,
 * not a documented rate limit. */
const REPORT_BODY_PACE_MS = 300

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
  let backfilling = false
  // Report ids the server answered `not-found` for. Skipped for the rest of
  // the session; cleared by onLogout(). ADDED 2026-09-14: reportsMissingBody()
  // is a plain "empty html/text" filter with no terminal state, so an id the
  // server has never heard of (a Firebase-imported report, or one created
  // against another environment) was re-fetched on EVERY fullSync — one GET,
  // one warning, one analytics event and one entitlement re-check per id per
  // foreground, forever. Mirrors reportPollingLogic's "not-found terminates"
  // (2026-09-13). In-memory on purpose, same reasoning as that decision: no
  // schema column, and a fresh launch retries once in case the row appears.
  const bodyNotFound = new Set<string>()
  // I2: true for the duration of initialBackup(). While set, settlePhase()
  // is a no-op — the backup owns "backing-up" across its two pullTicks and
  // final pushTick, and we don't want an inner tick's finally stomping that
  // back to "idle"/"error" mid-backup.
  // CHANGED 2026-07-09: recordFailure() also defers to this flag now (it
  // used to write phase="error" directly on the 2nd+ consecutive failure,
  // bypassing settlePhase() entirely) — a failure during initialBackup()
  // must not flip the status line to "error" while the backup is still
  // legitimately running. See recordFailure() below.
  let backingUp = false

  function backoffActive(): boolean {
    return deps.now() < nextAllowedAt
  }

  /**
   * I2 FIX: the single authority that restores steady-state `phase`.
   * Before this existed, any early return inside pushTick/pullTick (closed
   * gate, active backoff, the I1 reentrancy guard) skipped `finishCycle()`
   * entirely, so `phase` could stay on "backing-up" or "syncing" forever —
   * the Settings status line would read "Syncing…" with nothing in flight.
   * Every pushTick/pullTick now calls this from its `finally`, so it always
   * runs last regardless of which path was taken. `backingUp` is the one
   * exception: initialBackup() owns the phase while it's mid-flight, so we
   * defer to it and only settle once initialBackup()'s own finally clears
   * the flag and calls this again.
   */
  function settlePhase(): void {
    if (backingUp) return
    runInAction(() => {
      // >=2 consecutive failures matches recordFailure()'s own threshold for
      // flipping to "error" — one flaky request should not park the status
      // line on an alarming state, but a second one in a row should.
      syncState.phase = consecutiveFailures >= 2 ? "error" : "idle"
    })
  }

  function recordFailure(): void {
    consecutiveFailures++
    const idx = Math.min(consecutiveFailures - 1, BACKOFF_MS.length - 1)
    nextAllowedAt = deps.now() + BACKOFF_MS[idx]
    // FIX 2026-07-09: defer to backingUp, same as settlePhase(). Before this,
    // a 2nd+ consecutive failure during initialBackup() (e.g. the attendance
    // pull times out, then the reports pull also times out) flipped phase to
    // "error" directly here, stomping "backing-up" mid-flight even though the
    // backup was still legitimately running — self-correcting once
    // initialBackup()'s finally ran, but visibly wrong on the status line
    // until then. The counter/backoff still need to advance regardless (a
    // real failure happened and future ticks must respect it) — only the
    // phase write is gated. initialBackup()'s own finally calls
    // settlePhase(), which will surface "error" once backingUp clears, if
    // consecutiveFailures is still >= 2 at that point.
    if (backingUp) return
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
    // I1 FIX: the flag must be set synchronously, with NO await between this
    // check and the assignment. `nudgePush`'s debounced timer and a
    // resume/focus-triggered `fullSync` can both call pushTick() around the
    // same tick; if the flag were set only after `await deps.gate()` (as it
    // used to be), both callers would observe `pushing === false`, both would
    // await the gate, and both would then drain the outbox concurrently —
    // double-pushing the same records. Setting it here, before any await,
    // closes that window; the `finally` below clears it (and calls
    // settlePhase(), see I2) no matter which path we return through.
    pushing = true
    try {
      const gate = await deps.gate()
      if (!gate.ok) return
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
      // I2: only announce "syncing" when we're not mid-initialBackup — the
      // backup already shows "backing-up" and flipping to "syncing" here
      // would be a confusing flicker for a tick that's really part of the
      // same backup pass.
      if (!backingUp && (syncState.phase === "idle" || syncState.phase === "error")) {
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
      settlePhase() // I2: authoritative restore — runs no matter which path we took above.
    }
  }

  /** Pull one resource to completion (pages until hasMore=false). */
  async function pullTick(resource: SyncResource): Promise<void> {
    if (pulling || backoffActive()) return
    // I1 FIX: same reentrancy race as pushTick — set the flag before the
    // first await so two overlapping callers (e.g. fullSync() firing off
    // both pullTick("attendance") and a stray resume trigger) can't both slip
    // past the `if (pulling)` check while the flag is still false and then
    // both page through the API concurrently, double-applying merges and
    // racing the cursor.
    pulling = true
    let changed = false
    try {
      const gate = await deps.gate()
      if (!gate.ok) return
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

        let pageClean = true
        for (const rec of page.records) {
          try {
            const existsLocally =
              resource === "attendance"
                ? await deps.local.exists(rec.id)
                : await deps.local.reportExists(rec.id)
            // I3 FIX: dirty check happens per-record, immediately before the
            // merge decision — NOT a `pendingIds` set snapshotted once per
            // page (the old shape). With a per-page snapshot, a record
            // edited (and enqueued) after the snapshot was taken but before
            // its turn later in this same page's loop was invisible to the
            // dirty check: the older server copy silently clobbered the
            // fresh local edit, the queue entry survived, and the NEXT
            // pushTick read the now-server-reverted row via findByIds and
            // pushed+synced it — the user's edit vanished with no error
            // anywhere. Re-reading here shrinks the race window from "the
            // whole page" down to "the gap between this check and the write
            // below" (see the post-write re-check a few lines down for that
            // residual window). Reports have no push path, so they can never
            // be dirty — skip the lookup entirely rather than pay an await
            // for a call that would always return false.
            const hasPendingPush =
              resource === "attendance" ? await deps.queue.isPending(rec.id) : false
            const action = mergePullDecision({
              deleted: rec.deleted,
              hasPendingPush,
              existsLocally,
            })
            if (action === "skip-dirty") continue
            changed = true
            if (resource === "attendance") {
              const a = rec as ServerAttendanceRecord
              if (action === "delete") await deps.local.remove(a.id)
              else if (action === "update") await deps.local.updateFromServer(a)
              else await deps.local.createFromServer(a)
              // I3: post-write re-check. One residual await-sized window
              // remains — an enqueue can still land between the isPending()
              // check above and this write completing — and we can't close
              // it without a transactional read+write across a repository
              // boundary this file doesn't own. What we CAN do is make a
              // surviving clobber loud instead of silent.
              // CHANGED 2026-07-09: simplified from `pendingAfter &&
              // !hasPendingPush` — `hasPendingPush` is ALWAYS false by the
              // time execution reaches this line, because mergePullDecision
              // returns "skip-dirty" (which `continue`s past this whole
              // block) whenever it's true. So `!hasPendingPush` was a dead
              // conjunct, not a real condition. If the record is pending NOW,
              // an edit landed in the residual window above and this write
              // raced it. We don't attempt recovery here (the queued edit
              // will still win on the next pushTick's LWW push); we just make
              // sure it's never a silent data loss again.
              const pendingAfter = await deps.queue.isPending(a.id)
              if (pendingAfter) {
                deps.log.error("sync: pull write raced a concurrent local edit", { id: a.id })
              }
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
      settlePhase() // I2: authoritative restore — runs no matter which path we took above.
    }
  }

  /**
   * Report body backfill — runs after every reports pull (see the
   * "Report body backfill" section of the 2026-07-09 sync spec). Design
   * correction from the original lazy-fetch-on-open plan: a synced device
   * must end up with a COMPLETE local copy, not one that goes to the network
   * the first time the user opens a report. `/sync/reports` is metadata-only
   * server-side and we can't change that, so the client completes the copy
   * itself via GET /reports/:id.
   *
   * Deliberately driven by LOCAL STATE (`deps.local.reportsMissingBody()` —
   * "which local rows have no body yet?") rather than by the pull cursor.
   * Two reasons:
   *   1. A failed body fetch must never be able to strand the cursor. The
   *      cursor's only job is paging `/sync/reports`; tying it to body
   *      fetches would let a single unlucky GET /reports/:id block the next
   *      metadata pull from ever advancing.
   *   2. An interrupted backfill (app killed mid-pass, network drop) needs
   *      no separate resume bookkeeping — the missing-body set is
   *      RECOMPUTED from local rows every time this runs, so "resume" is
   *      just "run again."
   */
  async function backfillReportBodies(): Promise<void> {
    // Deliberately shares `backoffActive()` with push/pull: if the API is in an
    // outage bad enough to have armed the backoff, there is no point walking a
    // list of report ids to fetch one by one. Skipping is conservative and
    // self-healing — the ids stay in reportsMissingBody() and the next pass
    // after the backoff expires picks them up.
    if (backfilling || backoffActive()) return
    // Same I1 rule as pushTick/pullTick: the guard must be set synchronously,
    // before the first await. fullSync() and a resume-triggered fullSync()
    // can overlap, and if the flag were set after `await deps.gate()` both
    // callers would see `backfilling === false`, both would pass the check,
    // and both would fetch the same missing bodies concurrently.
    backfilling = true
    let savedAny = false
    try {
      const gate = await deps.gate()
      if (!gate.ok) return
      const ids = (await deps.local.reportsMissingBody()).filter((id) => !bodyNotFound.has(id))
      if (ids.length === 0) return
      for (let i = 0; i < ids.length; i++) {
        if (i > 0) {
          await deps.sleep(REPORT_BODY_PACE_MS)
          // Re-check the gate between fetches, exactly like pushTick's
          // inter-batch re-check: the user can sign out (or lose the
          // entitlement/network) mid-backfill, and fetching under the wrong
          // identity is worse than leaving the remaining ids for next time.
          const gateNow = await deps.gate()
          if (!gateNow.ok) return
        }
        const id = ids[i]
        // FIX 2026-07-09: the fetch AND the local write are now isolated in
        // one per-item try/catch, mirroring pullTick's per-record catch.
        // Before this, `reportSaveBody` was awaited unguarded — a thrown
        // local write (SQLite lock, disk full; see pullTick's "disk full"
        // test for why this is a realistic failure in this codebase) aborted
        // the rest of the ids in this loop AND propagated out of
        // backfillReportBodies() into fullSync() (skipping the subsequent
        // pushTick()) or initialBackup() (skipping the enqueue loop and
        // final pushTick()) — one bad local write silently killed the whole
        // sync pass.
        try {
          const result = await deps.api.getReport(id)
          if (result.kind === "ok") {
            const ok = result as { kind: "ok"; html: string; text: string }
            await deps.local.reportSaveBody(id, ok.html, ok.text)
            savedAny = true
          } else {
            // Deliberately NOT recordFailure(): that counter/backoff exists to
            // protect the push/pull ticks from a flaky *whole sync endpoint*.
            // A single report body being unavailable (deleted server-side,
            // transient 500, whatever) is a per-item condition, not a signal
            // that the sync engine itself is unhealthy — feeding it into the
            // shared backoff would let one bad report id gate attendance
            // push/pull for everyone. The id just stays in
            // reportsMissingBody()'s result and gets retried next pass —
            // EXCEPT `not-found`, which is remembered for the session (see
            // `bodyNotFound`): the server has no such row and retrying it
            // cannot succeed.
            if (result.kind === "not-found") bodyNotFound.add(id)
            deps.log.warn("sync: report body fetch failed", { id, kind: result.kind })
          }
        } catch (err) {
          // Same per-item-vs-whole-endpoint reasoning as above: NOT
          // recordFailure(). A failed local write leaves `id` in
          // reportsMissingBody()'s result (reportSaveBody never ran, or
          // partially ran and the repo rolled back), so the next sync pass
          // retries it — the same self-healing property the fetch-failure
          // branch already has.
          deps.log.warn("sync: report body backfill failed", { id, error: String(err) })
        }
      }
      if (savedAny) deps.emitSynced()
    } finally {
      backfilling = false
      settlePhase() // I2: authoritative restore — same rule as pushTick/pullTick.
    }
  }

  /** Pull both resources, backfill any missing report bodies, then drain the
   * outbox — the standard resume/focus sync. Backfill runs after the reports
   * pull so a page of newly-pulled report shells gets its bodies filled in
   * the same pass. */
  async function fullSync(): Promise<void> {
    await pullTick("attendance")
    await pullTick("reports")
    await backfillReportBodies()
    await pushTick()
  }

  /** Debounced push — rapid-fire mutations collapse to one tick. */
  function nudgePush(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      // Fires from a bare timer with no caller to reject into, so a local
      // SQLite failure inside pushTick() would be an unhandled rejection.
      void pushTick().catch((error) => {
        deps.log.error("sync: debounced push failed", { error: String(error) })
      })
    }, PUSH_DEBOUNCE_MS)
  }

  /**
   * First toggle-ON (and every re-enable): full pull, then enqueue the ENTIRE
   * local dataset and drain. No diffing against the pull — pushing records
   * the server already has is a safe LWW no-op (per the API doc). Interrupted
   * runs need no special resume: the queue is durable SQL and the next
   * launch's ticks keep draining.
   *
   * Never rejects. Network failures are already absorbed by pullTick/pushTick
   * (they call recordFailure() and return), but a local-SQLite throw from
   * allIds()/enqueue()/backfillReportBodies() used to escape — and because the
   * only caller is a fire-and-forget `void initialBackup()` in Settings, that
   * became an unhandled rejection AND settlePhase() parked the status line on
   * "idle" (consecutiveFailures was still 0), so a backup that died mid-flight
   * rendered as "All backed up ✓". Swallow-and-surface instead.
   */
  async function initialBackup(): Promise<void> {
    const gate = await deps.gate()
    if (!gate.ok) return
    // I2 FIX: backingUp + try/finally guarantee the phase is restored no
    // matter how this exits — a failed pull, a closed gate on the later
    // pushTick, or a thrown error. Before this fix, any of those early
    // returns skipped straight past the end of the function and left
    // `phase` stuck on "backing-up", so the Settings status line read
    // "Backing up…" forever even though nothing was happening anymore.
    backingUp = true
    let failed = false
    runInAction(() => {
      syncState.phase = "backing-up"
    })
    try {
      await pullTick("attendance")
      await pullTick("reports")
      // Complete the local copy before draining the outbox: initialBackup is
      // exactly the "device B gets a full local copy" scenario this backfill
      // exists for. backfillReportBodies() is a no-op internally while
      // backingUp is true w.r.t. phase (settlePhase() defers to us), so this
      // doesn't disturb the "backing-up" status line.
      await backfillReportBodies()
      const ids = await deps.local.allIds()
      for (const id of ids) {
        await deps.queue.enqueue({ recordId: id, operation: "update" })
      }
      await pushTick()
    } catch (error) {
      deps.log.error("sync: initial backup failed", { error: String(error) })
      failed = true
    } finally {
      backingUp = false
      // A thrown backup is an error state regardless of consecutiveFailures —
      // settlePhase() would read 0 failures and report "idle".
      if (failed) {
        runInAction(() => {
          syncState.phase = "error"
        })
      } else {
        settlePhase()
      }
    }
  }

  /**
   * Drop the outbox and reset sync state.
   *
   * Despite the name, the only production caller invokes this when a DIFFERENT
   * account signs in, not on logout — an ordinary sign-out deliberately keeps
   * the queue so the same user's offline edits survive signing back in (the
   * gate blocks pushes while unauthenticated anyway). Clearing here exists
   * because the server stamps every pushed record with the authenticated uid,
   * so the previous user's rows must never reach a push under the new user's
   * token. See takeQueueOwnership() in services/sync/index.ts.
   */
  async function onLogout(): Promise<void> {
    bodyNotFound.clear()
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

  return {
    syncState,
    pushTick,
    pullTick,
    backfillReportBodies,
    fullSync,
    nudgePush,
    initialBackup,
    onLogout,
  }
}
