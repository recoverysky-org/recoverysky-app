// app/services/sync/attendanceSyncService.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createAttendanceSyncService, type SyncDeps } from "./attendanceSyncService"
import type { ServerAttendanceRecord } from "./syncLogic"

const baseRecord = {
  id: "att-1",
  iid: "i",
  uid: "u",
  mid: "m",
  zid: "z",
  created: 1,
  valid: true,
  events: [],
  uzid: "",
  zpid: "",
  zuid: "",
  meetingHost: "",
  meetingName: "",
  meetingTopic: "",
  archived: false,
  processed: 1,
  start: 1,
  end: 2,
  credit: 1,
  produced: 0,
  arid: "",
}

function serverRec(
  id: string,
  extra: Partial<ServerAttendanceRecord> = {},
): ServerAttendanceRecord {
  return { ...baseRecord, id, deleted: false, updated: 100, ...extra }
}

function makeDeps(overrides: Partial<SyncDeps> = {}): SyncDeps & {
  calls: Record<string, unknown[][]>
} {
  const calls: Record<string, unknown[][]> = {}
  const track =
    <T>(name: string, impl: (...args: any[]) => T) =>
    (...args: any[]): T => {
      ;(calls[name] ??= []).push(args)
      return impl(...args)
    }

  const deps: SyncDeps = {
    api: {
      pushAttendance: track("pushAttendance", async () => ({
        kind: "ok" as const,
        accepted: 1,
        rejected: [],
      })),
      pullAttendance: track("pullAttendance", async () => ({
        kind: "ok" as const,
        records: [],
        cursor: 0,
        hasMore: false,
      })),
      pullReports: track("pullReports", async () => ({
        kind: "ok" as const,
        records: [],
        cursor: 0,
        hasMore: false,
      })),
    },
    local: {
      findByIds: track("findByIds", async (ids: string[]) =>
        ids.map((id) => ({ ...baseRecord, id })),
      ),
      allIds: track("allIds", async () => [] as string[]),
      exists: track("exists", async () => false),
      createFromServer: track("createFromServer", async () => {}),
      updateFromServer: track("updateFromServer", async () => {}),
      remove: track("remove", async () => {}),
      reportExists: track("reportExists", async () => false),
      reportCreateFromServer: track("reportCreateFromServer", async () => {}),
      reportUpdateFromServer: track("reportUpdateFromServer", async () => {}),
      reportRemove: track("reportRemove", async () => {}),
    },
    queue: {
      enqueue: track("enqueue", async () => {}),
      pending: track("pending", async () => []),
      markSynced: track("markSynced", async () => {}),
      markFailed: track("markFailed", async () => {}),
      clearPending: track("clearPending", async () => {}),
    },
    cursors: {
      get: track("cursorGet", () => 0),
      set: track("cursorSet", () => {}),
      getLastSyncedAt: () => null,
      setLastSyncedAt: track("setLastSyncedAt", () => {}),
    },
    gate: track("gate", async () => ({ ok: true, uid: "auth0|u1" })),
    emitSynced: track("emitSynced", () => {}),
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: track("logError", () => {}) },
    now: () => 1_000_000,
    sleep: track("sleep", async () => {}),
    ...overrides,
  }
  return Object.assign(deps, { calls })
}

describe("gate", () => {
  it("pushTick and pullTick are no-ops when the gate is closed", async () => {
    const deps = makeDeps({ gate: async () => ({ ok: false, uid: "" }) })
    const svc = createAttendanceSyncService(deps)
    await svc.pushTick()
    await svc.pullTick("attendance")
    expect(deps.calls.pending).toBeUndefined()
    expect(deps.calls.pullAttendance).toBeUndefined()
  })
})

describe("pushTick", () => {
  it("collapses multiple queue entries per record into one push of current row state", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "create", payload: null },
      { queueId: "q2", recordId: "att-1", operation: "update", payload: null },
    ]
    const svc = createAttendanceSyncService(deps)
    await svc.pushTick()
    expect(deps.calls.pushAttendance).toHaveLength(1)
    const batch = deps.calls.pushAttendance[0][0] as ServerAttendanceRecord[]
    expect(batch).toHaveLength(1)
    expect(batch[0].id).toBe("att-1")
    // both queue entries resolve on success
    expect(deps.calls.markSynced.map((c) => c[0]).sort()).toEqual(["q1", "q2"])
  })

  it("builds a tombstone from the delete snapshot payload", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      {
        queueId: "q1",
        recordId: "att-9",
        operation: "delete",
        payload: JSON.stringify({ ...baseRecord, id: "att-9" }),
      },
    ]
    const svc = createAttendanceSyncService(deps)
    await svc.pushTick()
    const batch = deps.calls.pushAttendance[0][0] as ServerAttendanceRecord[]
    expect(batch[0].id).toBe("att-9")
    expect(batch[0].deleted).toBe(true)
    // findByIds must NOT be asked for the deleted row
    expect(deps.calls.findByIds).toBeUndefined()
  })

  it("treats rejected:stale as success and rejected:invalid as failure", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "update", payload: null },
      { queueId: "q2", recordId: "att-2", operation: "update", payload: null },
    ]
    deps.local.findByIds = async (ids: string[]) => ids.map((id) => ({ ...baseRecord, id }))
    deps.api.pushAttendance = async () => ({
      kind: "ok" as const,
      accepted: 0,
      rejected: [
        { id: "att-1", reason: "stale" as const },
        { id: "att-2", reason: "invalid" as const },
      ],
    })
    const svc = createAttendanceSyncService(deps)
    await svc.pushTick()
    expect(deps.calls.markSynced.map((c) => c[0])).toEqual(["q1"])
    expect(deps.calls.markFailed.map((c) => c[0])).toEqual(["q2"])
  })

  it("leaves entries pending on a whole-request failure and enters backoff", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "update", payload: null },
    ]
    // NOTE: wrapped in a manual call-tracker (not a raw override) because the
    // assertion below reads deps.calls.pushAttendance — a bare reassignment
    // bypasses makeDeps()'s track() wrapper and leaves that array undefined
    // regardless of implementation correctness. See task-5-report.md for the
    // full note on this brief-fixture bug.
    deps.api.pushAttendance = async (...args: unknown[]) => {
      ;(deps.calls.pushAttendance ??= []).push(args)
      return { kind: "timeout" as const }
    }
    const svc = createAttendanceSyncService(deps)
    await svc.pushTick()
    expect(deps.calls.markSynced).toBeUndefined()
    expect(deps.calls.markFailed).toBeUndefined()
    // second tick inside the backoff window is a no-op (no new API call)
    await svc.pushTick()
    expect(deps.calls.pushAttendance).toHaveLength(1)
  })
})

describe("pullTick", () => {
  it("applies create/update/delete and skips dirty records", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "dirty-1", operation: "update", payload: null },
    ]
    deps.local.exists = async (id: string) => id === "existing-1"
    deps.api.pullAttendance = async () => ({
      kind: "ok" as const,
      records: [
        serverRec("new-1"),
        serverRec("existing-1"),
        serverRec("gone-1", { deleted: true }),
        serverRec("dirty-1"),
      ],
      cursor: 500,
      hasMore: false,
    })
    const svc = createAttendanceSyncService(deps)
    await svc.pullTick("attendance")
    expect(deps.calls.createFromServer).toHaveLength(1)
    expect(deps.calls.updateFromServer).toHaveLength(1)
    expect(deps.calls.remove.map((c) => c[0])).toEqual(["gone-1"])
    // dirty-1 untouched
    expect(deps.calls.cursorSet[0]).toEqual(["attendance", "auth0|u1", 500])
    expect(deps.calls.emitSynced).toHaveLength(1)
  })

  it("does not advance the cursor when a record in the page fails to merge", async () => {
    const deps = makeDeps()
    deps.api.pullAttendance = async () => ({
      kind: "ok" as const,
      records: [serverRec("new-1")],
      cursor: 500,
      hasMore: false,
    })
    deps.local.createFromServer = async () => {
      throw new Error("disk full")
    }
    const svc = createAttendanceSyncService(deps)
    await svc.pullTick("attendance")
    expect(deps.calls.cursorSet).toBeUndefined()
  })

  it("pages until hasMore=false, advancing since from each page cursor", async () => {
    const deps = makeDeps()
    const sinceSeen: number[] = []
    let page = 0
    deps.api.pullAttendance = async (since: number) => {
      sinceSeen.push(since)
      page++
      return page === 1
        ? { kind: "ok" as const, records: [serverRec("a")], cursor: 100, hasMore: true }
        : { kind: "ok" as const, records: [serverRec("b")], cursor: 200, hasMore: false }
    }
    const svc = createAttendanceSyncService(deps)
    await svc.pullTick("attendance")
    expect(sinceSeen).toEqual([0, 100])
  })
})

describe("initialBackup", () => {
  it("pulls both resources, enqueues every local id, then pushes", async () => {
    const deps = makeDeps()
    deps.local.allIds = async () => ["att-1", "att-2"]
    const svc = createAttendanceSyncService(deps)
    await svc.initialBackup()
    expect(deps.calls.pullAttendance).toHaveLength(1)
    expect(deps.calls.pullReports).toHaveLength(1)
    expect(deps.calls.enqueue.map((c) => (c[0] as { recordId: string }).recordId)).toEqual([
      "att-1",
      "att-2",
    ])
  })
})

describe("onLogout", () => {
  it("clears pending queue entries", async () => {
    const deps = makeDeps()
    const svc = createAttendanceSyncService(deps)
    await svc.onLogout()
    expect(deps.calls.clearPending).toHaveLength(1)
  })
})

describe("nudgePush", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  it("debounces rapid nudges into one pushTick", async () => {
    const deps = makeDeps()
    const svc = createAttendanceSyncService(deps)
    svc.nudgePush()
    svc.nudgePush()
    svc.nudgePush()
    await vi.advanceTimersByTimeAsync(4000)
    expect(deps.calls.gate).toHaveLength(1) // one tick, not three
    vi.useRealTimers()
  })
})
