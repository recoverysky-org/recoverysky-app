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

  // Stands in for the MMKV-backed store: survives across service instances
  // created from the same deps, which is how the tests model a relaunch.
  const notFoundStore = new Map<string, string[]>()

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
      getReport: track("getReport", async () => ({
        kind: "ok" as const,
        html: "<p>x</p>",
        text: "x",
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
      reportsMissingBody: track("reportsMissingBody", async () => [] as string[]),
      reportSaveBody: track("reportSaveBody", async () => {}),
    },
    queue: {
      enqueue: track("enqueue", async () => {}),
      pending: track("pending", async () => []),
      isPending: track("isPending", async () => false),
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
    bodyNotFound: {
      get: track("bodyNotFoundGet", (uid: string) => notFoundStore.get(uid) ?? []),
      set: track("bodyNotFoundSet", (uid: string, ids: string[]) => {
        notFoundStore.set(uid, ids)
      }),
    },
    gate: track("gate", async () => ({ ok: true, uid: "auth0|u1" })),
    emitSynced: track("emitSynced", () => {}),
    log: {
      debug: () => {},
      info: () => {},
      warn: track("logWarn", () => {}),
      error: track("logError", () => {}),
    },
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

  it("pushTick is reentrant-safe: overlapping calls drain the outbox once", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "update", payload: null },
    ]
    const svc = createAttendanceSyncService(deps)
    await Promise.all([svc.pushTick(), svc.pushTick()]) // concurrent, not sequential
    expect(deps.calls.pushAttendance).toHaveLength(1)
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
    // I3: dirty-skip is now driven by the per-record queue.isPending() check,
    // not a queue.pending() snapshot — see the pullTick regression tests
    // below for the race this replaced.
    deps.queue.isPending = async (id: string) => id === "dirty-1"
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

  it("a failed dirty-check never clobbers the local record, and holds the cursor", async () => {
    // repositories.isPending() throws when the sync-queue read fails. It used to
    // fail open (return false), which made a record carrying an unpushed local
    // edit look clean: the server's older copy overwrote it, the next pushTick
    // pushed the clobbered row, and the user's edit vanished silently. The throw
    // must land in the per-record catch — no write, cursor held, retried later.
    const deps = makeDeps()
    deps.local.exists = async () => true
    deps.queue.isPending = async () => {
      throw new Error("sync queue read failed")
    }
    deps.api.pullAttendance = async () => ({
      kind: "ok" as const,
      records: [serverRec("existing-1")],
      cursor: 500,
      hasMore: false,
    })
    const svc = createAttendanceSyncService(deps)
    await svc.pullTick("attendance")
    expect(deps.calls.updateFromServer).toBeUndefined()
    expect(deps.calls.createFromServer).toBeUndefined()
    expect(deps.calls.remove).toBeUndefined()
    expect(deps.calls.cursorSet).toBeUndefined()
  })

  it("pullTick is reentrant-safe: overlapping calls drain once", async () => {
    // Deliberately does NOT override deps.api.pullAttendance — an override
    // would replace the makeDeps() track() wrapper and leave calls.pullAttendance
    // undefined regardless of correctness (see the note on the pushAttendance
    // backoff test above). The default tracked mock (ok, empty page) is enough:
    // a reentrant second call still reaches the API if the guard is broken.
    const deps = makeDeps()
    const svc = createAttendanceSyncService(deps)
    await Promise.all([svc.pullTick("attendance"), svc.pullTick("attendance")]) // concurrent
    expect(deps.calls.pullAttendance).toHaveLength(1)
  })

  it("skips a record that is dirty at write time, not merely at page-snapshot time", async () => {
    const deps = makeDeps()
    deps.api.pullAttendance = async () => ({
      kind: "ok" as const,
      records: [serverRec("a"), serverRec("b")],
      cursor: 5,
      hasMore: false,
    })
    // "b" becomes dirty only after the page began merging — a per-page
    // snapshot taken before the loop would have missed this.
    deps.queue.isPending = async (id: string) => id === "b"
    const svc = createAttendanceSyncService(deps)
    await svc.pullTick("attendance")
    const written = (deps.calls.createFromServer ?? []).map((c) => (c[0] as { id: string }).id)
    expect(written).toEqual(["a"]) // "b" was skipped as dirty
  })

  it("logs an error when a write raced a concurrent local edit", async () => {
    const deps = makeDeps()
    deps.api.pullAttendance = async () => ({
      kind: "ok" as const,
      records: [serverRec("a")],
      cursor: 5,
      hasMore: false,
    })
    let seen = 0
    deps.queue.isPending = async () => {
      seen++
      return seen > 1 // clean before the write, dirty after it
    }
    const svc = createAttendanceSyncService(deps)
    await svc.pullTick("attendance")
    expect(deps.calls.logError?.length ?? 0).toBeGreaterThan(0)
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

describe("backfillReportBodies", () => {
  it("fetches and stores every missing body", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1", "r2"]
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    expect(deps.calls.getReport.map((c) => c[0])).toEqual(["r1", "r2"])
    expect(deps.calls.reportSaveBody).toHaveLength(2)
    expect(deps.calls.reportSaveBody[0]).toEqual(["r1", "<p>x</p>", "x"])
    expect(deps.calls.reportSaveBody[1]).toEqual(["r2", "<p>x</p>", "x"])
    expect(deps.calls.emitSynced).toHaveLength(1)
  })

  it("a failed fetch does not abort the rest", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1", "r2"]
    deps.api.getReport = async (id: string) => {
      ;(deps.calls.getReport ??= []).push([id])
      if (id === "r1") return { kind: "timeout" as const }
      return { kind: "ok" as const, html: "<p>x</p>", text: "x" }
    }
    const svc = createAttendanceSyncService(deps)
    await expect(svc.backfillReportBodies()).resolves.toBeUndefined()
    expect(deps.calls.reportSaveBody).toHaveLength(1)
    expect(deps.calls.reportSaveBody[0][0]).toBe("r2")
    expect(deps.calls.logWarn?.length ?? 0).toBeGreaterThan(0)
  })

  it("a not-found body is not fetched again in the same session", async () => {
    // The server has no such row at all (Firebase-imported report, or one
    // created against another environment) — it will never appear. Before
    // 2026-09-14 every fullSync re-walked the whole list: N GETs, N analytics
    // events, N warnings, on every foreground.
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1", "r2"]
    deps.api.getReport = async (id: string) => {
      ;(deps.calls.getReport ??= []).push([id])
      if (id === "r1") return { kind: "not-found" as const }
      return { kind: "ok" as const, html: "<p>x</p>", text: "x" }
    }
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    await svc.backfillReportBodies()
    expect(deps.calls.getReport.map((c) => c[0])).toEqual(["r1", "r2", "r2"])
  })

  it("a transient fetch failure IS retried on the next pass", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1"]
    deps.api.getReport = async (id: string) => {
      ;(deps.calls.getReport ??= []).push([id])
      return { kind: "timeout" as const }
    }
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    await svc.backfillReportBodies()
    expect(deps.calls.getReport).toHaveLength(2)
  })

  it("onLogout forgets not-found ids so the next account starts clean", async () => {
    // The persisted set is keyed per uid, so a different account signing in
    // on this device must not inherit the previous account's marks.
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1"]
    deps.api.getReport = async (id: string) => {
      ;(deps.calls.getReport ??= []).push([id])
      return { kind: "not-found" as const }
    }
    let uid = "auth0|u1"
    deps.gate = async () => ({ ok: true, uid })
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    await svc.onLogout()
    uid = "auth0|u2"
    await svc.backfillReportBodies()
    expect(deps.calls.getReport).toHaveLength(2)
  })

  it("a not-found body is remembered across launches for the same account", async () => {
    // 2026-09-14 incident: the in-memory set alone meant every cold start
    // re-asked GET /reports/:id for the same 25 body-less ids, and CrowdSec's
    // http-probing scenario (distinct 404 paths, leaky bucket of 10) banned
    // the IP four times in a day. A new service instance from the same deps
    // is the test's model of a relaunch.
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1", "r2"]
    deps.api.getReport = async (id: string) => {
      ;(deps.calls.getReport ??= []).push([id])
      if (id === "r1") return { kind: "not-found" as const }
      return { kind: "ok" as const, html: "<p>x</p>", text: "x" }
    }
    await createAttendanceSyncService(deps).backfillReportBodies()
    expect(deps.calls.bodyNotFoundSet).toContainEqual(["auth0|u1", ["r1"]])
    await createAttendanceSyncService(deps).backfillReportBodies()
    expect(deps.calls.getReport.map((c) => c[0])).toEqual(["r1", "r2", "r2"])
  })

  it("stops after five not-founds in one pass and holds the backfill for a minute", async () => {
    // Budget, not just pacing: the http-probing bucket holds 10 distinct
    // 404 paths and drains one every 10 s, so no per-request gap short of
    // 10 s keeps a long list of never-fetchable ids under it. Five per pass
    // with a one-minute hold caps us at 5 in-bucket, ever.
    const deps = makeDeps()
    let now = 1_000_000
    deps.now = () => now
    deps.local.reportsMissingBody = async () => ["r1", "r2", "r3", "r4", "r5", "r6", "r7"]
    deps.api.getReport = async (id: string) => {
      ;(deps.calls.getReport ??= []).push([id])
      return { kind: "not-found" as const }
    }
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    expect(deps.calls.getReport).toHaveLength(5)
    await svc.backfillReportBodies()
    expect(deps.calls.getReport).toHaveLength(5)
    now += 60_001
    await svc.backfillReportBodies()
    expect(deps.calls.getReport.map((c) => c[0])).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
      "r6",
      "r7",
    ])
  })

  it("a not-found mark is dropped when the server later updates that report", async () => {
    // The only way a body can appear for an id we gave up on is the server
    // copy changing (a resend). That arrives as an `update` on the reports
    // pull, so that is the one event that re-arms the fetch.
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1"]
    deps.api.getReport = async (id: string) => {
      ;(deps.calls.getReport ??= []).push([id])
      return { kind: "not-found" as const }
    }
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    expect(deps.calls.getReport).toHaveLength(1)

    deps.local.reportExists = async () => true
    deps.api.pullReports = async () => ({
      kind: "ok" as const,
      records: [
        {
          id: "r1",
          uid: "auth0|u1",
          name: "",
          email: "",
          timezone: "",
          generated: 1,
          confirmed: 0,
          confirmation: "",
          error: false,
          credit: 0,
          fid: "",
          updated: 200,
          deleted: false,
        },
      ],
      cursor: 200,
      hasMore: false,
    })
    await svc.pullTick("reports")
    expect(deps.calls.bodyNotFoundSet).toContainEqual(["auth0|u1", []])
    await svc.backfillReportBodies()
    expect(deps.calls.getReport).toHaveLength(2)
  })

  it("no missing bodies → no requests", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => []
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    expect(deps.calls.getReport).toBeUndefined()
    expect(deps.calls.emitSynced).toBeUndefined()
  })

  it("paces between fetches", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1", "r2"]
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    expect(deps.calls.sleep).toHaveLength(1)
  })

  it("fullSync runs the backfill after the reports pull", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1"]
    const sequence: string[] = []
    const originalPullReports = deps.api.pullReports
    deps.api.pullReports = async (...args: Parameters<typeof originalPullReports>) => {
      sequence.push("pullReports")
      return originalPullReports(...args)
    }
    const originalGetReport = deps.api.getReport
    deps.api.getReport = async (...args: Parameters<typeof originalGetReport>) => {
      sequence.push("getReport")
      return originalGetReport(...args)
    }
    const svc = createAttendanceSyncService(deps)
    await svc.fullSync()
    expect(deps.calls.getReport).toHaveLength(1)
    expect(sequence).toEqual(["pullReports", "getReport"])
  })

  it("gate closed → backfill is a no-op", async () => {
    const deps = makeDeps({ gate: async () => ({ ok: false, uid: "" }) })
    deps.local.reportsMissingBody = async () => ["r1"]
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    expect(deps.calls.reportsMissingBody).toBeUndefined()
    expect(deps.calls.getReport).toBeUndefined()
  })

  it("backfillReportBodies is reentrant-safe: overlapping calls fetch once", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1"]
    const svc = createAttendanceSyncService(deps)
    await Promise.all([svc.backfillReportBodies(), svc.backfillReportBodies()]) // concurrent
    expect(deps.calls.getReport).toHaveLength(1)
  })

  it("re-checks the gate mid-loop: signing out between reports stops the remaining fetches", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1", "r2"]
    let gateCalls = 0
    // First call (inside backfillReportBodies' own gate check) succeeds;
    // the second call (the inter-fetch re-check before r2) reports signed
    // out, mirroring pushTick's inter-batch re-check.
    deps.gate = async () => {
      gateCalls++
      return gateCalls === 1 ? { ok: true, uid: "auth0|u1" } : { ok: false, uid: "" }
    }
    const svc = createAttendanceSyncService(deps)
    await svc.backfillReportBodies()
    expect(deps.calls.getReport?.map((c) => c[0]) ?? []).toEqual(["r1"])
    expect(deps.calls.reportSaveBody).toHaveLength(1)
  })

  it("a failed local write does not abort the rest of the backfill", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1", "r2"]
    // NOTE: manual call-tracker, not a raw override — see the pushTick
    // backoff test's note above on why makeDeps()'s track() wrapper gets
    // bypassed by direct reassignment.
    deps.local.reportSaveBody = async (id: string, html: string, text: string) => {
      ;(deps.calls.reportSaveBody ??= []).push([id, html, text])
      if (id === "r1") throw new Error("disk full")
    }
    const svc = createAttendanceSyncService(deps)
    await expect(svc.backfillReportBodies()).resolves.toBeUndefined()
    expect(deps.calls.getReport.map((c) => c[0])).toEqual(["r1", "r2"])
    // both ids were attempted even though r1's write threw
    expect(deps.calls.reportSaveBody.map((c) => c[0])).toEqual(["r1", "r2"])
    expect(deps.calls.logWarn?.length ?? 0).toBeGreaterThan(0)
  })

  it("a failed local write during fullSync() does not skip the subsequent pushTick", async () => {
    const deps = makeDeps()
    deps.local.reportsMissingBody = async () => ["r1"]
    deps.local.reportSaveBody = async (id: string, html: string, text: string) => {
      ;(deps.calls.reportSaveBody ??= []).push([id, html, text])
      throw new Error("disk full")
    }
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "update", payload: null },
    ]
    const svc = createAttendanceSyncService(deps)
    await svc.fullSync()
    // Proves the sync pass wasn't killed: pushTick ran and hit the API.
    expect(deps.calls.pushAttendance).toHaveLength(1)
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

  it("initialBackup never leaves phase stuck on 'backing-up' when a pull fails", async () => {
    const deps = makeDeps()
    deps.api.pullAttendance = async () => ({ kind: "timeout" as const })
    const svc = createAttendanceSyncService(deps)
    await svc.initialBackup()
    // A single failure doesn't meet recordFailure()'s >=2 threshold for
    // "error", so the only possible settled state here is "idle" — assert
    // the exact value, not just "not stuck", so a future regression that
    // settles on some other phase doesn't slip through.
    expect(svc.syncState.phase).toBe("idle")
  })

  it("a local-SQLite throw neither rejects nor reports success", async () => {
    // The only caller is a fire-and-forget `void initialBackup()` in Settings,
    // so a rejection here would be an unhandled promise rejection, and the
    // status line would read "All backed up ✓" for a backup that never ran.
    const deps = makeDeps()
    deps.local.allIds = async () => {
      throw new Error("database is locked")
    }
    const svc = createAttendanceSyncService(deps)
    await expect(svc.initialBackup()).resolves.toBeUndefined()
    expect(svc.syncState.phase).toBe("error")
    expect(deps.calls.logError.some(([msg]) => String(msg).includes("initial backup failed"))).toBe(
      true,
    )
  })

  it("recordFailure() defers to backingUp: two consecutive failures during initialBackup() never surface 'error' mid-backup, but settle to 'error' once the backup finishes", async () => {
    const deps = makeDeps()
    // deps.now() is a mutable closure that advances on every call so the
    // shared backoff (armed by the first failure) never blocks the second
    // pullTick inside this same initialBackup() pass — see the "phase
    // settling (I2)" describe block below for the same technique. No real or
    // fake timers.
    let currentTime = 1_000_000
    deps.now = () => {
      currentTime += 40_000
      return currentTime
    }
    // Both pulls fail for real (whole-request failure), so initialBackup()
    // sees two consecutive recordFailure() calls: one from
    // pullTick("attendance"), one from pullTick("reports").
    deps.api.pullAttendance = async () => ({ kind: "timeout" as const })
    deps.api.pullReports = async () => ({ kind: "timeout" as const })
    deps.local.allIds = async () => ["att-1"]
    // Constructed first so the deps overrides below (which read
    // svc.syncState) can close over an already-assigned binding.
    const svc = createAttendanceSyncService(deps)
    // Observe phase at every point initialBackup() reaches past the second
    // failure: reportsMissingBody() (backfillReportBodies, right after the
    // two pullTicks) and enqueue() (the loop after the backfill). If
    // recordFailure() bypasses the backingUp guard, the second failure's
    // direct `phase = "error"` write is visible in one of these snapshots.
    const phaseObservations: string[] = []
    deps.local.reportsMissingBody = async () => {
      phaseObservations.push(svc.syncState.phase)
      return []
    }
    deps.queue.enqueue = async () => {
      phaseObservations.push(svc.syncState.phase)
    }
    await svc.initialBackup()
    expect(phaseObservations.length).toBeGreaterThan(0)
    expect(phaseObservations).not.toContain("error")
    expect(phaseObservations.every((p) => p === "backing-up")).toBe(true)
    // consecutiveFailures reached 2 during the backup, so once backingUp
    // clears, initialBackup()'s own settlePhase() call surfaces "error".
    expect(svc.syncState.phase).toBe("error")
  })
})

describe("phase settling (I2)", () => {
  it("a single failure does not park phase in 'syncing'", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "update", payload: null },
    ]
    deps.api.pushAttendance = async () => ({ kind: "timeout" as const })
    const svc = createAttendanceSyncService(deps)
    await svc.pushTick()
    expect(svc.syncState.phase).not.toBe("syncing") // one failure => idle, not error
    expect(svc.syncState.phase).toBe("idle")
  })

  it("a second consecutive failure flips phase to 'error'", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "update", payload: null },
    ]
    deps.api.pushAttendance = async () => ({ kind: "timeout" as const })
    // `now` is a mutable closure so we can advance the clock past
    // nextAllowedAt between ticks — real timers/fake timers are unnecessary
    // and the brief explicitly asks us to avoid vi.useFakeTimers() here.
    let currentTime = 1_000_000
    deps.now = () => currentTime
    const svc = createAttendanceSyncService(deps)
    await svc.pushTick() // 1st failure: nextAllowedAt = currentTime + 30_000
    currentTime += 31_000 // clear the backoff window
    await svc.pushTick() // 2nd consecutive failure
    expect(svc.syncState.phase).toBe("error")
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
