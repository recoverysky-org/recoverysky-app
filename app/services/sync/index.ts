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
import { getDb } from "@/db/provider"
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
  ownershipAction,
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

/** MMKV key for the per-account set of report ids with no server-side body. */
function bodyNotFoundKey(uid: string): string {
  return `sync.bodyNotFound.${uid}`
}

// MMKV key recording which uid's rows currently sit in the outbox. Stamped by
// enqueueAttendance() — the single enqueue path — so trigger 4 can tell "same
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
 * synchronous). Instead the gate refuses to open until the clear has completed.
 * The gate checks this flag both before and after its `await` on the
 * entitlement SDK: a tick whose gate() started earlier in the same synchronous
 * mobx flush would otherwise read the flag before the account reaction set it,
 * suspend on that await, and resume with a stale `ok`.
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
  // Hard block: the DB is opened by <DatabaseProvider> (React), but this
  // service is wired from app.tsx's RootStore setup path, which runs BEFORE
  // that provider mounts. Any tick reaching a repository before openDb() has
  // resolved throws "Database not opened". Every tick funnels through gate()
  // before its first SQLite call, so blocking here covers all paths (cold
  // start, focus, resume, nudge, reactions). Self-heals: SyncResumer fires a
  // fullSync() once the DB is ready. Keep this BEFORE the syncEnabled/auth
  // checks — it's the most fundamental precondition of the lot.
  if (!getDb().db) return { ok: false, uid }
  const cheapOk =
    rs.profileStore.syncEnabled &&
    !auth.isAnonymous &&
    auth.isAuthenticated &&
    !rs.configStore.maintenanceMode &&
    !rs.networkStore.isOffline &&
    uid.length > 0
  if (!cheapOk) return { ok: false, uid }
  const entitled = await hasEntitlement(ENTITLEMENTS.ATTENDANCE)
  // Re-check after the await: the account-switch reaction may have raised the
  // flag while this call was suspended on the entitlement SDK.
  if (ownerClearPending) return { ok: false, uid }
  return { ok: entitled, uid }
}

/**
 * Resolves when the in-flight foreign-owner clear finishes; rejects (and STAYS
 * rejected) if that clear failed. `null` when no clear is owed.
 *
 * Anything that writes to the outbox must await this first. Awaiting a
 * already-rejected promise re-throws every time, which is exactly what we want:
 * the outbox stays untouched until a launch manages to clear it.
 */
let ownerClear: Promise<void> | null = null

/**
 * THE ONLY place that writes to the outbox.
 *
 * Enqueue and ownership-stamp are welded together on purpose. Every queued row
 * must be attributable to the uid that created it, because on an account switch
 * we decide whether to wipe the queue by comparing the stored owner to the
 * incoming user. A call site that enqueued without stamping would leave the
 * owner unset, `takeQueueOwnership()` would read "no previous owner, nothing to
 * clear", and the previous user's rows would push under the new user's token.
 * (That bug shipped once: the mutation hook called syncQueueRepo.enqueue()
 * directly while only this adapter stamped.) Route every enqueue through here.
 *
 * It also WAITS for any owed clear before touching anything. Stamping while a
 * foreign-owner clear was pending or had failed would advance the owner to the
 * new user over a queue that still held the previous user's rows — the next
 * launch's boot check would then see `owner === uid`, skip the retry, and push
 * those rows under the new user's token. Racing the clear is the same bug as
 * skipping it.
 */
async function enqueueAttendance(entry: {
  recordId: string
  operation: "create" | "update" | "delete"
  payload?: string
}): Promise<void> {
  // Throws if the clear failed — the caller logs and drops this enqueue. The
  // record itself is safe in SQLite; the next launch clears the queue and a
  // later initialBackup()/mutation re-enqueues it.
  if (ownerClear) await ownerClear

  unwrap(await syncQueueRepo.enqueue({ tableName: "attendances", ...entry }), "enqueue")
  // Skip when there is no uid (this can be reached before rootStoreRef is set),
  // and skip a redundant MMKV write when the stored owner already matches.
  const uid = rootStoreRef?.authenticationStore.userId
  if (uid && loadString(QUEUE_OWNER_KEY) !== uid) {
    saveString(QUEUE_OWNER_KEY, uid)
  }
}

/**
 * Hand the outbox to `uid`, clearing any previous owner's rows first.
 *
 * Two ordering rules, both load-bearing:
 *
 * 1. `ownerClearPending` is raised SYNCHRONOUSLY, before the async clear starts,
 *    so a tick racing us from an earlier-registered reaction sees a closed gate.
 * 2. The new owner is stamped only AFTER the clear is confirmed. If we stamped
 *    first and the clear then failed (or the process died mid-clear), the next
 *    launch would see owner === uid, skip the retry, and push the leftover
 *    foreign rows. Leaving the old owner in place means the boot check retries.
 *
 * On failure we deliberately leave `ownerClearPending` true and `ownerClear`
 * rejected: sync stays off, and every enqueue keeps throwing, rather than
 * draining someone else's attendance into this account. The next launch's boot
 * reconciliation retries the clear — which only works because the stamp still
 * names the OLD owner, so `ownershipAction` still says "clear-then-stamp".
 */
function takeQueueOwnership(uid: string): void {
  const owner = loadString(QUEUE_OWNER_KEY)
  const action = ownershipAction(owner, uid)
  if (action === "noop") return
  if (action === "clear-then-stamp") {
    ownerClearPending = true
    // `owner` is non-null on this branch by ownershipAction's contract; the
    // ?? "" only satisfies the logger's attribute type.
    const previousOwner = owner ?? ""
    log.info("Account switch — clearing the previous owner's outbox", { previousOwner, uid })

    // Published so enqueueAttendance() can await it. On success the stamp
    // advances and the gate reopens; on failure the promise stays rejected, so
    // every later enqueue throws instead of stamping over an uncleared queue.
    const clear = attendanceSync.onLogout().then(() => {
      saveString(QUEUE_OWNER_KEY, uid)
      ownerClearPending = false
      ownerClear = null
    })
    ownerClear = clear

    // Observe the rejection so Node/Hermes doesn't report it as unhandled. This
    // does NOT reset the flag or the promise — awaiting `ownerClear` elsewhere
    // must still throw. No `finally`: resetting unconditionally would reopen the
    // gate over a queue that still holds foreign rows.
    clear.catch((err) => {
      log.error("Failed to clear foreign outbox — sync stays disabled until relaunch", {
        previousOwner,
        uid,
        error: String(err),
      })
    })
    return
  }
  // action === "stamp": nobody owned the queue yet.
  saveString(QUEUE_OWNER_KEY, uid)
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
    enqueue: (entry) => enqueueAttendance(entry),
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
      // THROW on a partial clear. clearPending() returns a
      // RecoverySkyResult<number> that reports per-row delete failures, and a
      // surviving row is one of the previous owner's records — pushing it
      // under the next user's token moves their attendance into someone else's
      // account. takeQueueOwnership() relies on this throw to fail CLOSED:
      // the gate stays shut and the owner stamp is not advanced, so the next
      // launch retries the clear instead of quietly pushing foreign rows.
      unwrap(await syncQueueRepo.clearPending(), "clearPending")
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
  // Per-uid list of report ids whose body the server has said does not exist
  // (ADDED 2026-09-14, see `bodyNotFound` in attendanceSyncService.ts). MMKV
  // like the cursors: a few dozen UUIDs at most, and it must survive a
  // relaunch — the in-memory-only version re-asked every id on every cold
  // start and got the IP banned by the edge's 404-probing rule.
  bodyNotFound: {
    get: (uid) => {
      const raw = loadString(bodyNotFoundKey(uid))
      if (!raw) return []
      try {
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
      } catch {
        return []
      }
    },
    set: (uid, ids) => {
      saveString(bodyNotFoundKey(uid), JSON.stringify(ids))
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
    // Routed through enqueueAttendance(), NOT syncQueueRepo.enqueue(), so the
    // row is stamped with its owner. See enqueueAttendance's comment: an
    // unstamped row defeats the account-switch clear.
    void enqueueAttendance({
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
      void attendanceSync
        .fullSync()
        .catch((err) => log.error("fullSync failed", { error: String(err) }))
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
      if (available)
        void attendanceSync
          .fullSync()
          .catch((err) => log.error("fullSync failed", { error: String(err) }))
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

  // 5. Cold-start catch-up is NOT fired here. initAttendanceSync runs from
  //    app.tsx's RootStore setup, which precedes <DatabaseProvider> mounting
  //    and opening the SQLite database — so a fullSync() here reliably raced
  //    the DB and threw "Database not opened" on every launch (the gate()
  //    DB-open guard would now no-op it anyway). <SyncResumer> owns this
  //    trigger instead: it fires fullSync() exactly once, when the database
  //    reports ready. gate() still decides whether that does any real work.
  log.info("Attendance sync initialized")
}
