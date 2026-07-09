/**
 * Cloud-sync wiring — builds the real SyncDeps and owns all trigger
 * registration (mutation hook, AppState resume, gate reaction, logout).
 * app.tsx calls initAttendanceSync(rootStore) once, post-bootstrap.
 *
 * This file is the I/O boundary the vitest suites never import — vitest has
 * no `@/` path-alias config (see MEMORY.md), so keep logic out of here and in
 * attendanceSyncService.ts/syncLogic.ts, which stay free of `@/` imports.
 *
 * Import note: repos/events are pulled from their concrete files
 * (`@/db/repositories`, `@/db/attendanceEvents`) rather than the `@/db`
 * barrel. `attendanceSyncWriter` and `setAttendanceMutationHook` are not
 * re-exported from `@/db/index.ts`, and this task is scoped to NOT touch
 * that barrel file.
 */
import { AppState, type AppStateStatus } from "react-native"
import { reaction } from "mobx"

import { attendanceEvents } from "@/db/attendanceEvents"
import {
  attendanceRepo,
  attendanceSyncWriter,
  setAttendanceMutationHook,
  syncQueueRepo,
} from "@/db/repositories"
import type { RootStore } from "@/models"
import { api } from "@/services/api"
import { ENTITLEMENTS } from "@/services/purchases/config"
import { hasEntitlement } from "@/services/purchases/revenueCatService"
import { logger, type LogAttributes } from "@/utils/logger"
import { loadString, saveString } from "@/utils/storage"

import {
  createAttendanceSyncService,
  type SyncDeps,
  type SyncResource,
} from "./attendanceSyncService"
import {
  reportToLocalCreate,
  reportToLocalUpdate,
  toLocalCreate,
  toLocalUpdate,
  type ServerAttendanceRecord,
  type ServerReportRecord,
} from "./syncLogic"

const log = logger.child({ module: "AttendanceSync" })

// Set once by initAttendanceSync(); every deps callback closes over this
// module-level ref instead of the RootStore instance directly so the
// `deps` object (and the `attendanceSync` singleton built from it) can be
// constructed at module-load time, before any RootStore exists. Every gate()
// call re-reads this ref, so tests/imports of this module before init just
// see `ok: false` rather than crashing.
let rootStoreRef: RootStore | null = null

function cursorKey(resource: SyncResource, uid: string): string {
  return `sync.cursor.${resource}.${uid}`
}

// MMKV key recording which uid's rows currently sit in the outbox. Stamped on
// every enqueue (see deps.queue.enqueue below) so trigger 4 can tell "same
// user signed back in" (owner === userId, queue survives) apart from "a
// different account is signing in on this device" (owner !== userId, queue
// must be cleared before any tick can push the previous owner's rows under
// the new user's token).
const QUEUE_OWNER_KEY = "sync.queueOwnerUid"

/**
 * True while a foreign-owner queue clear is in flight (or still owed).
 *
 * This closes a real cross-account leak. When user B signs in, MobX fires
 * reactions in REGISTRATION order, and the gate-clear reaction (trigger 3) is
 * registered before the account-switch reaction (trigger 4). So `isAuthenticated`
 * flipping true would kick off `fullSync()` — and `pushTick` would drain user
 * A's still-queued rows under B's token — before trigger 4 ever ran its
 * `onLogout()`. The server stamps every pushed record with the *authenticated*
 * uid, so A's attendance would silently land in B's account.
 *
 * Making the reaction `await` wouldn't help (a mobx reaction callback is
 * synchronous). Instead the gate itself refuses to open until the clear has
 * completed, which is the one place every tick — push, pull, and backfill —
 * must pass through.
 */
let ownerClearPending = false

/**
 * Combined availability gate. Cheap MobX-observable checks run first;
 * the RevenueCat entitlement check is an SDK call (cached, but still async
 * I/O) and only runs once everything else has already passed — no point
 * paying for it when the user hasn't even opted in or is offline.
 */
async function gate(): Promise<{ ok: boolean; uid: string }> {
  const rs = rootStoreRef
  if (!rs) return { ok: false, uid: "" }
  const auth = rs.authenticationStore
  const uid = auth.userId ?? ""
  // Hard block: never let any tick run while the outbox still holds another
  // account's rows. Self-heals — the clear flips this back and the next
  // trigger (resume, gate reaction, nudge) syncs normally.
  if (ownerClearPending) return { ok: false, uid }
  const cheapOk =
    rs.profileStore.syncEnabled &&
    !auth.isAnonymous &&
    auth.isAuthenticated &&
    !rs.configStore.maintenanceMode &&
    !rs.networkStore.isOffline &&
    uid.length > 0
  if (!cheapOk) return { ok: false, uid }
  const entitled = await hasEntitlement(ENTITLEMENTS.ATTENDANCE)
  return { ok: entitled, uid }
}

/**
 * Hand the outbox to `uid`, clearing any previous owner's rows first.
 *
 * Sets `ownerClearPending` SYNCHRONOUSLY before the async clear starts, so a
 * tick racing us from another reaction sees a closed gate. Stamps the new owner
 * immediately too: if the process dies mid-clear, the next launch's boot check
 * sees owner === uid and won't re-clear, while the rows it failed to delete
 * belong to nobody the gate would push them under.
 */
function takeQueueOwnership(uid: string): void {
  const owner = loadString(QUEUE_OWNER_KEY)
  if (owner && owner !== uid) {
    ownerClearPending = true
    saveString(QUEUE_OWNER_KEY, uid)
    log.info("Account switch — clearing the previous owner's outbox", { owner, uid })
    void attendanceSync
      .onLogout()
      .catch((err) => log.error("Failed to clear foreign outbox", { error: String(err) }))
      .finally(() => {
        ownerClearPending = false
      })
    return
  }
  if (owner !== uid) saveString(QUEUE_OWNER_KEY, uid)
}

/**
 * Unwrap a RecoverySkyResult at the deps boundary. A failed local op THROWS
 * here on purpose: pullTick's per-record try/catch treats a throw as "this
 * record's merge failed," which keeps the pull cursor on the current page
 * for retry instead of silently skipping the record. Softening this to a
 * quiet return would let a failed local write advance the cursor past data
 * that was never actually applied.
 */
function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${String(result.error)}`)
  return result.value as T
}

const deps: SyncDeps = {
  api: {
    pushAttendance: async (records: ServerAttendanceRecord[]) => {
      const result = await api.pushSyncAttendance(records)
      if (result.kind !== "ok") return result
      return {
        kind: "ok" as const,
        accepted: result.data.accepted,
        rejected: result.data.rejected,
      }
    },
    pullAttendance: async (since: number) => {
      const result = await api.pullSyncAttendance(since)
      if (result.kind !== "ok") return result
      return { kind: "ok" as const, ...result.data }
    },
    pullReports: async (since: number) => {
      const result = await api.pullSyncReports(since)
      if (result.kind !== "ok") return result
      return { kind: "ok" as const, ...result.data }
    },
    // Adapter: SyncDeps wants a flat {kind, html, text}; the API client
    // returns {kind: "ok", data: {id, html, text}}. Same translation shape
    // as the pull adapters above.
    getReport: async (id: string) => {
      const result = await api.getReport({ id })
      if (result.kind !== "ok") return result
      return { kind: "ok" as const, html: result.data.html, text: result.data.text }
    },
  },
  local: {
    findByIds: async (ids) => unwrap(await attendanceRepo.findByIds(ids), "findByIds"),
    allIds: async () => unwrap(await attendanceRepo.findAll(), "findAll").map((r) => r.id),
    exists: (id) => attendanceSyncWriter.exists(id),
    createFromServer: async (r) => {
      unwrap(await attendanceSyncWriter.createFromServer(toLocalCreate(r)), "create")
    },
    updateFromServer: async (r) => {
      unwrap(await attendanceSyncWriter.updateFromServer(r.id, toLocalUpdate(r)), "update")
    },
    remove: async (id) => {
      unwrap(await attendanceSyncWriter.remove(id), "remove")
    },
    reportExists: (id) => attendanceSyncWriter.reportExists(id),
    reportCreateFromServer: async (r: ServerReportRecord) => {
      unwrap(
        await attendanceSyncWriter.reportCreateFromServer(reportToLocalCreate(r)),
        "reportCreate",
      )
    },
    reportUpdateFromServer: async (r: ServerReportRecord) => {
      unwrap(
        await attendanceSyncWriter.reportUpdateFromServer(r.id, reportToLocalUpdate(r)),
        "reportUpdate",
      )
    },
    reportRemove: async (id) => {
      unwrap(await attendanceSyncWriter.reportRemove(id), "reportRemove")
    },
    reportsMissingBody: () => attendanceSyncWriter.reportsMissingBody(),
    reportSaveBody: async (id, html, text) => {
      unwrap(await attendanceSyncWriter.reportSaveBody(id, html, text), "reportSaveBody")
    },
  },
  queue: {
    enqueue: async (entry) => {
      unwrap(await syncQueueRepo.enqueue({ tableName: "attendances", ...entry }), "enqueue")
      // Stamp the queue's owner here — NOT in setAttendanceMutationHook —
      // so both the per-mutation hook and initialBackup()'s bulk enqueue
      // (which calls this same adapter, not the hook) keep the ownership
      // record accurate. Skip when there's no uid (shouldn't happen once
      // gate() has passed, but this adapter can theoretically be called
      // before rootStoreRef is set) and skip a redundant write when the
      // stored owner already matches, to avoid hammering MMKV on every row.
      const uid = rootStoreRef?.authenticationStore.userId
      if (uid && loadString(QUEUE_OWNER_KEY) !== uid) {
        saveString(QUEUE_OWNER_KEY, uid)
      }
    },
    // Per-record dirty check for the pull merge — see the predicate note on
    // syncQueueRepo.isPending() in db/repositories.ts. It MUST match
    // getPending()'s status/retryCount predicate exactly.
    isPending: (recordId) => syncQueueRepo.isPending(recordId),
    pending: async () => {
      const items = unwrap(await syncQueueRepo.getPending(), "getPending")
      return items.map((i) => ({
        queueId: i.id,
        recordId: i.recordId,
        operation: i.operation as "create" | "update" | "delete",
        payload: i.payload,
      }))
    },
    markSynced: async (id) => {
      unwrap(await syncQueueRepo.markSynced(id), "markSynced")
    },
    markFailed: async (id, message) => {
      unwrap(await syncQueueRepo.markFailed(id, message), "markFailed")
    },
    clearPending: async () => {
      // clearPending() returns a RecoverySkyResult<number> that surfaces
      // per-row delete failures (see the long comment on it in
      // db/repositories.ts — a silently-dropped failure here could leak
      // user A's queued records into user B's account). It already logs on
      // partial failure; SyncDeps only needs the call to happen, so the
      // Result itself is intentionally discarded at this boundary.
      await syncQueueRepo.clearPending()
    },
  },
  cursors: {
    get: (resource, uid) => Number(loadString(cursorKey(resource, uid)) ?? "0"),
    set: (resource, uid, value) => {
      saveString(cursorKey(resource, uid), String(value))
    },
    getLastSyncedAt: (uid) => {
      const v = loadString(`sync.lastSyncedAt.${uid}`)
      return v ? Number(v) : null
    },
    setLastSyncedAt: (uid, value) => {
      saveString(`sync.lastSyncedAt.${uid}`, String(value))
    },
  },
  gate,
  emitSynced: () => {
    // id "sync": no single record changed — subscribers just reload lists.
    attendanceEvents.emit({ type: "synced", id: "sync" })
  },
  log: {
    // SyncDeps declares ctx as `Record<string, unknown>` (attendanceSyncService.ts
    // stays free of `@/` imports, so it can't reference our LogAttributes type);
    // every real call site in that file passes plain string/number/boolean
    // values, so the cast to LogAttributes here is safe in practice.
    debug: (m, c) => log.debug(m, c as LogAttributes | undefined),
    info: (m, c) => log.info(m, c as LogAttributes | undefined),
    warn: (m, c) => log.warn(m, c as LogAttributes | undefined),
    error: (m, c) => log.error(m, c as LogAttributes | undefined),
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** Module singleton — safe to import anywhere; every tick gates on
 * rootStoreRef, so calling any method before initAttendanceSync() is a
 * harmless no-op rather than a crash. */
export const attendanceSync = createAttendanceSyncService(deps)

let initialized = false

/**
 * Wire sync triggers. Call exactly once from app.tsx after setupRootStore —
 * this registers MobX reactions and an AppState listener that would
 * duplicate on a second call (same reason the outage-recovery path uses
 * Updates.reloadAsync() instead of re-running bootstrap in place).
 *
 * None of the reaction()/AppState.addEventListener() disposers below are
 * retained — deliberate, not a leak: this is a single-call, app-lifetime
 * singleton (the `initialized` guard above enforces "exactly once"), so
 * there's nothing to tear down before process exit.
 */
export function initAttendanceSync(rootStore: RootStore): void {
  if (initialized) {
    log.warn("initAttendanceSync called twice — ignoring")
    return
  }
  initialized = true
  rootStoreRef = rootStore

  // 1. Outbox feed: every attendanceRepo mutation enqueues (only when the
  //    user has opted in) and nudges a debounced push. Enqueue even when
  //    offline or in maintenance — the queue IS the offline buffer; only the
  //    push/pull *ticks* are gated on connectivity, not the enqueue itself.
  //    A `delete` mutation carries a pre-delete `snapshot` (the row is gone
  //    by push time); serialize it into the queue row's payload so pushTick
  //    can build the `deleted: true` tombstone from it.
  setAttendanceMutationHook((m) => {
    if (!rootStore.profileStore.syncEnabled) return
    void syncQueueRepo
      .enqueue({
        tableName: "attendances",
        recordId: m.recordId,
        operation: m.operation,
        payload: m.snapshot ? JSON.stringify(m.snapshot) : undefined,
      })
      .then(() => attendanceSync.nudgePush())
      .catch((err) => log.error("sync enqueue failed", { error: String(err) }))
  })

  // 2. Foreground resume → catch-up sync. There is no OS background sync for
  //    this app, so "the user backgrounded and reopened" is the main signal
  //    that time has passed and the server may have changes.
  let appState = AppState.currentState
  AppState.addEventListener("change", (nextState: AppStateStatus) => {
    if (appState.match(/inactive|background/) && nextState === "active") {
      void attendanceSync.fullSync()
    }
    appState = nextState
  })

  // 3. Gate-clear reaction: when sync becomes available (opted in, back
  //    online, maintenance ended, signed in), fire a catch-up sync.
  //    Entitlement is deliberately NOT part of this observable expression —
  //    RevenueCat state isn't a MobX observable here, so the tick's own
  //    gate() call re-checks entitlement itself; this reaction only reacts
  //    to the cheap MST/MobX-observable half of the gate.
  reaction(
    () =>
      rootStore.profileStore.syncEnabled &&
      !rootStore.authenticationStore.isAnonymous &&
      rootStore.authenticationStore.isAuthenticated &&
      !rootStore.configStore.maintenanceMode &&
      !rootStore.networkStore.isOffline,
    (available) => {
      if (available) void attendanceSync.fullSync()
    },
  )

  // 4. Account switch → drop the queue. Cursors are keyed per-uid already,
  //    so no cursor cleanup is needed here. This reaction is keyed off
  //    sign-IN, not off any userId change: an ordinary sign-out sets
  //    userId -> undefined via AuthenticationStore.logout(), and that
  //    transition must NOT clear the queue — the gate already blocks every
  //    push while unauthenticated, so queued rows sit safely until the same
  //    user signs back in and resumes the drain with their offline edits
  //    intact. Only a *different* account signing in on this device (the
  //    stored QUEUE_OWNER_KEY disagreeing with the incoming userId) clears
  //    the queue, and it does so before any tick can push the previous
  //    owner's rows under the new user's token — the server stamps every
  //    pushed record with the authenticated uid.
  //
  //    The clear is async but this callback is synchronous, so the handoff
  //    can't await it. takeQueueOwnership() instead raises `ownerClearPending`
  //    synchronously, which slams the gate shut for every tick until the clear
  //    finishes. Without that, trigger 3 above — registered FIRST, so it runs
  //    FIRST when isAuthenticated flips — would start a fullSync() and push the
  //    previous owner's rows under the new user's token before we ever got here.
  reaction(
    () => rootStore.authenticationStore.userId,
    (userId) => {
      if (!userId) return
      takeQueueOwnership(userId)
    },
  )

  // 4b. Boot-time reconciliation. The reaction above only fires on a *change*.
  //     If the process died between an account switch and the clear completing
  //     (or the app relaunches already signed in as someone other than the
  //     recorded owner), no change ever occurs and the foreign rows would sit
  //     in the outbox waiting to be pushed under the wrong identity.
  const bootUid = rootStore.authenticationStore.userId
  if (bootUid) takeQueueOwnership(bootUid)

  // 5. Cold-start catch-up (post-bootstrap). gate() inside fullSync()/its
  //    ticks decides whether this actually does anything — for the common
  //    case (syncEnabled still false) every tick below short-circuits on
  //    the gate and this is a no-op.
  void attendanceSync.fullSync()

  log.info("Attendance sync initialized")
}
