# Attendance Cloud Backup & Multi-Device Sync — Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in cloud backup of attendance records (push + pull via the server `/sync` endpoints) and pull-only report sync, so a second device or reinstall can reconstruct full history.

**Architecture:** A durable outbox (the existing-but-dormant `sync_queue` SQLite table) fed by a mutation hook in the `attendanceRepo` wrappers, drained by a new dependency-injected sync service (`createAttendanceSyncService`) that pushes ≤200-record batches and pulls cursor-paginated pages. Pure mapping/decision logic lives in `syncLogic.ts` (vitest-tested); all I/O wiring lives in `app/services/sync/index.ts`.

**Tech Stack:** React Native / Expo 54, MobX (+MST stores), Drizzle SQLite via `@recoverysky-org/common@1.20.2`, apisauce API wrapper, MMKV storage, vitest (pure `.ts`) + jest-expo (`.test.tsx`).

**Spec:** `docs/superpowers/specs/2026-07-09-attendance-sync-client-design.md` — read it first.

## Global Constraints

- **JS-only feature — do NOT bump `runtimeVersion`** in `app.json`. Ships as an OTA.
- **Vitest has no `@/` path alias.** Any file with a co-located `.test.ts` must have zero `@/` runtime imports (type-only imports and real-package imports like `mobx` / `@recoverysky-org/common/sqlite` are fine).
- Jest (`jest-expo`) only runs `**/*.test.tsx`; vitest runs `.test.ts`. `npm test` runs both.
- ESLint: named React imports only; no raw `Text`/`Switch` label strings — use `tx` props / `translate()`; unused vars prefixed `_`.
- **Comment liberally** (project overrides minimal-comment style): every non-obvious gate, ordering constraint, or cross-file invariant gets a comment saying *why*.
- All user-facing strings go through i18n (`en.ts` is the type source; add `es.ts` translations; other locales fall back to English).
- Sync gate (checked at every tick): `profileStore.syncEnabled && !isAnonymous && isAuthenticated && !configStore.maintenanceMode && !networkStore.isOffline && hasEntitlement(ENTITLEMENTS.ATTENDANCE)`.
- Server semantics (from the API doc): push batch cap **200**; push rate limit ~10/min (pace batches ~7 s apart); `rejected: "stale"` = success (server newer); `uid` and `updated` are server-stamped — send them but never trust them; deletions are pushes with `deleted: true`; pull cursor is opaque — echo back only.
- Update `CHANGELOG.md` `[Unreleased]` in the same commit as the feature lands (Task 9).

---

### Task 1: Pure sync logic module (`syncLogic.ts`)

**Files:**
- Create: `app/services/sync/syncLogic.ts`
- Test: `app/services/sync/syncLogic.test.ts` (vitest)

**Interfaces:**
- Consumes: type-only imports from `@recoverysky-org/common/sqlite` (`AttendanceRecord`, `AttendanceCreateInput`, `AttendanceUpdateInput`, `AttendanceReportCreateInput`, `AttendanceReportUpdateInput`).
- Produces (used by Tasks 2, 5, 6):
  - `interface ServerAttendanceRecord` / `interface ServerReportRecord`
  - `const SYNC_PUSH_BATCH_MAX = 200`
  - `toServerRecord(record: AttendanceRecord, deleted?: boolean): ServerAttendanceRecord`
  - `type MergeAction = "skip-dirty" | "delete" | "update" | "create"`
  - `mergePullDecision(input: { deleted: boolean; hasPendingPush: boolean; existsLocally: boolean }): MergeAction`
  - `toLocalCreate(server: ServerAttendanceRecord): AttendanceCreateInput`
  - `toLocalUpdate(server: ServerAttendanceRecord): AttendanceUpdateInput`
  - `reportToLocalCreate(server: ServerReportRecord): AttendanceReportCreateInput`
  - `reportToLocalUpdate(server: ServerReportRecord): AttendanceReportUpdateInput`
  - `chunk<T>(items: T[], size: number): T[][]`

- [ ] **Step 1: Write the failing test**

```ts
// app/services/sync/syncLogic.test.ts
import { describe, expect, it } from "vitest"

import {
  SYNC_PUSH_BATCH_MAX,
  chunk,
  mergePullDecision,
  reportToLocalCreate,
  reportToLocalUpdate,
  toLocalCreate,
  toLocalUpdate,
  toServerRecord,
  type ServerAttendanceRecord,
  type ServerReportRecord,
} from "./syncLogic"

const localRecord = {
  id: "att-1",
  iid: "iid-1",
  uid: "device-abc", // legacy anonymous-era uid — server re-stamps from Auth0 sub
  mid: "mid-1",
  zid: "123456789",
  created: 1751900000000,
  valid: true,
  events: [{ timestamp: 1751900000000, message: "joined", json: "{}" }],
  uzid: "uz-1",
  zpid: "zp-1",
  zuid: "zu-1",
  meetingHost: "Host",
  meetingName: "Morning Meeting",
  meetingTopic: "Topic",
  archived: false,
  processed: 1751900060000,
  start: 1751900000000,
  end: 1751903600000,
  credit: 3600000,
  produced: 0,
  arid: "",
}

const serverRecord: ServerAttendanceRecord = {
  ...localRecord,
  uid: "auth0|user1",
  deleted: false,
  updated: 1751999999999,
}

const serverReport: ServerReportRecord = {
  id: "rep-1",
  uid: "auth0|user1",
  name: "Jane D.",
  email: "jane@example.com",
  timezone: "America/New_York",
  generated: 1751900000000,
  confirmed: 1751900500000,
  confirmation: "msg-123",
  error: false,
  credit: 3600000,
  fid: "",
  updated: 1751999999999,
  deleted: false,
}

describe("toServerRecord", () => {
  it("maps every schema field and defaults deleted=false, updated=0", () => {
    const result = toServerRecord(localRecord)
    expect(result).toEqual({ ...localRecord, deleted: false, updated: 0 })
  })

  it("builds a tombstone when deleted=true (hard-delete snapshot path)", () => {
    expect(toServerRecord(localRecord, true).deleted).toBe(true)
  })
})

describe("mergePullDecision", () => {
  it("skips records with a pending outbound push (local edit wins LWW later)", () => {
    expect(
      mergePullDecision({ deleted: false, hasPendingPush: true, existsLocally: true }),
    ).toBe("skip-dirty")
    // dirty-skip beats even a tombstone — our later push resurrects deliberately (LWW)
    expect(
      mergePullDecision({ deleted: true, hasPendingPush: true, existsLocally: true }),
    ).toBe("skip-dirty")
  })

  it("deletes on tombstone", () => {
    expect(
      mergePullDecision({ deleted: true, hasPendingPush: false, existsLocally: true }),
    ).toBe("delete")
  })

  it("updates existing, creates new", () => {
    expect(
      mergePullDecision({ deleted: false, hasPendingPush: false, existsLocally: true }),
    ).toBe("update")
    expect(
      mergePullDecision({ deleted: false, hasPendingPush: false, existsLocally: false }),
    ).toBe("create")
  })
})

describe("local converters", () => {
  it("toLocalCreate carries id and uid (server uid becomes local uid on create)", () => {
    const input = toLocalCreate(serverRecord)
    expect(input.id).toBe("att-1")
    expect(input.uid).toBe("auth0|user1")
    expect(input.credit).toBe(3600000)
    expect(input.events).toEqual(localRecord.events)
  })

  it("toLocalUpdate omits id/uid/created (AttendanceUpdateInput does not support them)", () => {
    const input = toLocalUpdate(serverRecord)
    expect(input).not.toHaveProperty("id")
    expect(input).not.toHaveProperty("uid")
    expect(input).not.toHaveProperty("created")
    expect(input.valid).toBe(true)
    expect(input.arid).toBe("")
  })

  it("reportToLocalUpdate NEVER touches html/text/messageId/retry (server omits bodies; local copies must survive)", () => {
    const input = reportToLocalUpdate(serverReport)
    expect(input).not.toHaveProperty("html")
    expect(input).not.toHaveProperty("text")
    expect(input).not.toHaveProperty("messageId")
    expect(input).not.toHaveProperty("retry")
    expect(input.confirmed).toBe(1751900500000)
    expect(input.email).toBe("jane@example.com")
  })

  it("reportToLocalCreate maps required uid/email and metadata", () => {
    const input = reportToLocalCreate(serverReport)
    expect(input.id).toBe("rep-1")
    expect(input.uid).toBe("auth0|user1")
    expect(input.email).toBe("jane@example.com")
    expect(input.generated).toBe(1751900000000)
  })
})

describe("chunk", () => {
  it("splits at the batch max", () => {
    const items = Array.from({ length: SYNC_PUSH_BATCH_MAX + 1 }, (_, i) => i)
    const batches = chunk(items, SYNC_PUSH_BATCH_MAX)
    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(200)
    expect(batches[1]).toHaveLength(1)
  })

  it("handles empty and exact-size inputs", () => {
    expect(chunk([], 200)).toEqual([])
    expect(chunk(Array.from({ length: 200 }, (_, i) => i), 200)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/services/sync/syncLogic.test.ts`
Expected: FAIL — cannot resolve `./syncLogic`.

- [ ] **Step 3: Write the implementation**

```ts
// app/services/sync/syncLogic.ts
/**
 * Pure sync logic — record mapping and merge decisions for the /sync API.
 *
 * ZERO runtime imports from `@/` — this file is vitest-tested and vitest has
 * no path-alias config (see the project testing convention). Type-only
 * imports are erased at compile time and are safe.
 */
import type {
  AttendanceCreateInput,
  AttendanceRecord,
  AttendanceReportCreateInput,
  AttendanceReportUpdateInput,
  AttendanceUpdateInput,
} from "@recoverysky-org/common/sqlite"

/** Server push batch cap — a larger batch gets 400 badRequest. */
export const SYNC_PUSH_BATCH_MAX = 200

/**
 * The wire shape of an attendance record on /sync (attendanceRecordSchema).
 * `uid` and `updated` are server-stamped; we send them only to satisfy the
 * schema — the server ignores both.
 */
export interface ServerAttendanceRecord {
  id: string
  iid: string
  uid: string
  mid: string
  zid: string
  created: number
  valid: boolean
  uzid: string
  zpid: string
  zuid: string
  meetingHost: string
  meetingName: string
  meetingTopic: string
  archived: boolean
  events: { timestamp: number; message: string; json: string }[]
  processed: number
  start: number
  end: number
  credit: number
  produced: number
  arid: string
  deleted: boolean
  updated: number
}

/** The wire shape of a report on GET /sync/reports — metadata only, no html/text. */
export interface ServerReportRecord {
  id: string
  uid: string
  name: string
  email: string
  timezone: string
  generated: number
  confirmed: number
  confirmation: string
  error: boolean
  credit: number
  fid: string
  updated: number
  deleted: boolean
}

/**
 * Map a local attendance row to the push wire shape.
 * `deleted: true` builds a tombstone (used for the hard-delete snapshot path —
 * the local row is already gone by push time, so the caller passes the
 * pre-delete snapshot as `record`).
 */
export function toServerRecord(record: AttendanceRecord, deleted = false): ServerAttendanceRecord {
  return {
    id: record.id,
    iid: record.iid,
    uid: record.uid, // ignored by server (stamped from the Auth0 sub)
    mid: record.mid,
    zid: record.zid,
    created: record.created,
    valid: record.valid,
    uzid: record.uzid,
    zpid: record.zpid,
    zuid: record.zuid,
    meetingHost: record.meetingHost ?? "",
    meetingName: record.meetingName ?? "",
    meetingTopic: record.meetingTopic ?? "",
    archived: record.archived,
    events: record.events ?? [],
    processed: record.processed,
    start: record.start,
    end: record.end,
    credit: record.credit,
    produced: record.produced,
    arid: record.arid,
    deleted,
    updated: 0, // ignored by server (server-stamped receipt time)
  }
}

export type MergeAction = "skip-dirty" | "delete" | "update" | "create"

/**
 * Decide what to do with one pulled record.
 *
 * Order matters: dirty-skip is checked FIRST, even against tombstones — a
 * record with a pending outbound entry has a local edit that will push later
 * and win last-write-wins on the server. Applying the pull now would clobber
 * the user's unpushed change.
 */
export function mergePullDecision(input: {
  deleted: boolean
  hasPendingPush: boolean
  existsLocally: boolean
}): MergeAction {
  if (input.hasPendingPush) return "skip-dirty"
  if (input.deleted) return "delete"
  return input.existsLocally ? "update" : "create"
}

/** Pulled record → local create input. New rows adopt the server uid. */
export function toLocalCreate(server: ServerAttendanceRecord): AttendanceCreateInput {
  return {
    id: server.id,
    iid: server.iid,
    uid: server.uid,
    mid: server.mid,
    zid: server.zid,
    created: server.created,
    valid: server.valid,
    events: server.events,
    uzid: server.uzid,
    zpid: server.zpid,
    zuid: server.zuid,
    meetingHost: server.meetingHost,
    meetingName: server.meetingName,
    meetingTopic: server.meetingTopic,
    archived: server.archived,
    processed: server.processed,
    start: server.start,
    end: server.end,
    credit: server.credit,
    produced: server.produced,
    arid: server.arid,
  }
}

/**
 * Pulled record → local update input. AttendanceUpdateInput has no id/uid/
 * created fields, so existing rows keep their local uid — acceptable: the
 * attendance list queries findUnproduced/findArchived (not uid-filtered).
 */
export function toLocalUpdate(server: ServerAttendanceRecord): AttendanceUpdateInput {
  return {
    iid: server.iid,
    valid: server.valid,
    events: server.events,
    uzid: server.uzid,
    zpid: server.zpid,
    zuid: server.zuid,
    meetingHost: server.meetingHost,
    meetingName: server.meetingName,
    meetingTopic: server.meetingTopic,
    archived: server.archived,
    processed: server.processed,
    start: server.start,
    end: server.end,
    credit: server.credit,
    produced: server.produced,
    arid: server.arid,
  }
}

/** Pulled report → local create. Bodies (html/text) start empty because the
 * /sync/reports pull is metadata-only; backfillReportBodies() fills them in
 * during the same sync pass via GET /reports/:id. */
export function reportToLocalCreate(server: ServerReportRecord): AttendanceReportCreateInput {
  return {
    id: server.id,
    uid: server.uid,
    fid: server.fid,
    name: server.name,
    timezone: server.timezone,
    email: server.email,
    error: server.error,
    generated: server.generated,
    confirmed: server.confirmed,
    confirmation: server.confirmation,
    credit: server.credit,
  }
}

/**
 * Pulled report → local update. DELIBERATELY omits html/text/messageId/retry:
 * the sync pull is metadata-only, and an update that included empty bodies
 * would wipe the locally-stored rendered report. Preservation-by-omission.
 */
export function reportToLocalUpdate(server: ServerReportRecord): AttendanceReportUpdateInput {
  return {
    fid: server.fid,
    name: server.name,
    timezone: server.timezone,
    email: server.email,
    error: server.error,
    confirmed: server.confirmed,
    confirmation: server.confirmation,
    credit: server.credit,
  }
}

/** Split items into batches of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/services/sync/syncLogic.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run compile`
Expected: no errors.

```bash
git add app/services/sync/syncLogic.ts app/services/sync/syncLogic.test.ts
git commit -m "✨ feat(sync): pure sync logic — wire mapping, merge decisions, batching"
```

---

### Task 2: `/sync` API methods

**Files:**
- Modify: `app/services/api/index.ts` (add types near the existing `FirebaseAttendanceRecord` types ~line 145; add methods after `getFirebaseReports`)

**Interfaces:**
- Consumes: `ServerAttendanceRecord`, `ServerReportRecord` from `@/services/sync/syncLogic` (type-only).
- Produces (used by Task 6):
  - `api.pushSyncAttendance(records: ServerAttendanceRecord[]): Promise<{ kind: "ok"; data: SyncPushResult } | GeneralApiProblem>`
  - `api.pullSyncAttendance(since: number, limit?: number): Promise<{ kind: "ok"; data: SyncPullEnvelope<ServerAttendanceRecord> } | GeneralApiProblem>`
  - `api.pullSyncReports(since: number, limit?: number): Promise<{ kind: "ok"; data: SyncPullEnvelope<ServerReportRecord> } | GeneralApiProblem>`
  - `api.getReport(params: { id: string }): Promise<{ kind: "ok"; data: ReportDetail } | GeneralApiProblem>`
  - Exported types: `SyncPushResult`, `SyncPullEnvelope<T>`, `SyncRejectedRecord`, `ReportDetail`

- [ ] **Step 1: Add the types** (in the types section of `app/services/api/index.ts`):

```ts
import type { ServerAttendanceRecord, ServerReportRecord } from "@/services/sync/syncLogic"

/** One rejected record from POST /sync/attendance. "stale" = server already
 * has a newer version (success for our purposes); "invalid" = failed schema
 * validation (a client bug worth logging). */
export interface SyncRejectedRecord {
  id: string
  reason: "stale" | "invalid"
}

/** Response of POST /sync/attendance. */
export interface SyncPushResult {
  accepted: number
  rejected: SyncRejectedRecord[]
}

/** Envelope of GET /sync/attendance and GET /sync/reports. `cursor` is opaque —
 * persist it and echo it back as `since`; never compute it client-side. */
export interface SyncPullEnvelope<T> {
  records: T[]
  cursor: number
  hasMore: boolean
}

/** Full report from GET /reports/:id — used to lazy-fetch bodies for reports
 * that arrived via sync (metadata-only). Only the fields we consume. */
export interface ReportDetail {
  id: string
  html: string
  text: string
}
```

- [ ] **Step 2: Add the four methods** (after `getFirebaseReports`, following the house pattern — `waitForAttestation`, `getGeneralApiProblem`, `bad-data` guard):

```ts
  /**
   * Push new/changed attendance records to cloud backup.
   * POST /sync/attendance — max 200 records per call (SYNC_PUSH_BATCH_MAX);
   * uid/updated are server-stamped. Idempotent: retry freely.
   */
  async pushSyncAttendance(
    records: ServerAttendanceRecord[],
  ): Promise<{ kind: "ok"; data: SyncPushResult } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Pushing sync attendance", { count: records.length })

    const response = await this.recoverySkyApi.post<SyncPushResult>("/sync/attendance", {
      records,
    })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Sync push failed", { problem: problem?.kind, count: records.length })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || typeof response.data.accepted !== "number") {
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }

  /**
   * Pull attendance changes since a cursor.
   * GET /sync/attendance?since=<ms>&limit=<n> — includes deleted:true tombstones.
   */
  async pullSyncAttendance(
    since: number,
    limit = 500,
  ): Promise<{ kind: "ok"; data: SyncPullEnvelope<ServerAttendanceRecord> } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Pulling sync attendance", { since, limit })

    const response = await this.recoverySkyApi.get<SyncPullEnvelope<ServerAttendanceRecord>>(
      "/sync/attendance",
      { since, limit },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Sync attendance pull failed", { problem: problem?.kind, since })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || !Array.isArray(response.data.records)) {
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }

  /**
   * Pull report metadata since a cursor (read-only; reports have no push path).
   * GET /sync/reports?since=<ms>&limit=<n> — html/text never included.
   */
  async pullSyncReports(
    since: number,
    limit = 500,
  ): Promise<{ kind: "ok"; data: SyncPullEnvelope<ServerReportRecord> } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Pulling sync reports", { since, limit })

    const response = await this.recoverySkyApi.get<SyncPullEnvelope<ServerReportRecord>>(
      "/sync/reports",
      { since, limit },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Sync reports pull failed", { problem: problem?.kind, since })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || !Array.isArray(response.data.records)) {
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }

  /**
   * Fetch one full report (including rendered html/text bodies).
   * GET /reports/:id — the /sync/reports pull is metadata-only, so
   * backfillReportBodies() calls this during sync to complete the local copy.
   */
  async getReport(params: {
    id: string
  }): Promise<{ kind: "ok"; data: ReportDetail } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching report detail", { reportId: params.id })

    const response = await this.recoverySkyApi.get<ReportDetail>(`/reports/${params.id}`)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Report detail fetch failed", { problem: problem?.kind, reportId: params.id })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || typeof response.data.html !== "string") {
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }
```

- [ ] **Step 3: Verify**

Run: `npm run compile && npm run lint:check`
Expected: no errors (lint may auto-flag import order — fix so the type import sits with the other `@/` imports).

- [ ] **Step 4: Commit**

```bash
git add app/services/api/index.ts
git commit -m "✨ feat(api): /sync push+pull endpoints and GET /reports/:id detail fetch"
```

---

### Task 3: `ProfileStore.syncEnabled`

**Files:**
- Modify: `app/models/ProfileStore.ts` (props ~line 60, setters ~line 310, reset ~line 457)

**Interfaces:**
- Produces: `profileStore.syncEnabled: boolean` (default `false`), `profileStore.setSyncEnabled(value: boolean)` — used by Tasks 6 and 8.

- [ ] **Step 1: Add the prop** (next to `attendanceEnabled` in `.props({...})`):

```ts
    // Cloud backup opt-in — default OFF. Attendance data reveals meeting
    // attendance; backing it up to the server is explicit user consent
    // (Settings toggle), never automatic. See the 2026-07-09 sync spec.
    syncEnabled: types.optional(types.boolean, false),
```

- [ ] **Step 2: Add the setter** (next to `setAttendanceEnabled`):

```ts
      setSyncEnabled(value: boolean) {
        self.syncEnabled = value
      },
```

- [ ] **Step 3: Add to the reset action** (the block that resets `attendanceEnabled = true`, ~line 457):

```ts
        self.syncEnabled = false // opt-in resets with the profile — consent doesn't survive a reset
```

- [ ] **Step 4: Verify and commit**

Run: `npm run compile`
Expected: no errors.

```bash
git add app/models/ProfileStore.ts
git commit -m "✨ feat(profile): syncEnabled opt-in flag for cloud backup"
```

---

### Task 4: DB layer — mutation hook, sync writer, queue wrapper, `"synced"` event

**Files:**
- Modify: `app/db/repositories.ts`
- Modify: `app/db/attendanceEvents.ts`

**Interfaces:**
- Produces (used by Tasks 5–7):
  - `setAttendanceMutationHook(fn: ((m: AttendanceMutation) => void) | null): void` where `AttendanceMutation = { recordId: string; operation: "create" | "update" | "delete"; snapshot?: AttendanceRecord }`
  - `attendanceRepo.findByIds(ids: string[])` (pass-through, new)
  - `attendanceSyncWriter` — hook-bypassing writes: `exists(id)`, `createFromServer(input)`, `updateFromServer(id, input)`, `remove(id)`, `reportExists(id)`, `reportCreateFromServer(input)`, `reportUpdateFromServer(id, input)`, `reportRemove(id)`
  - `syncQueueRepo` gains: `getPending(maxRetries?)`, `markSynced(id)`, `markFailed(id, message)`, `deleteItem(id)`, `clearPending()`
  - `attendanceEvents` type union gains `"synced"`

- [ ] **Step 1: Add the mutation hook and notify helper** (top of the Attendance Repository section in `repositories.ts`):

```ts
// ============================================================================
// Attendance mutation hook (cloud sync outbox)
// ============================================================================

export type AttendanceMutationOp = "create" | "update" | "delete"

export interface AttendanceMutation {
  recordId: string
  operation: AttendanceMutationOp
  /** Pre-delete row snapshot — only present on "delete". The sync push builds
   * a deleted:true tombstone from this because the row is gone by push time. */
  snapshot?: AttendanceRecord
}

// Single choke point for the sync outbox: every app-side attendance mutation
// flows through the attendanceRepo wrappers below, so one hook here covers
// externalAttendance, useReportSender, AttendanceScreen edits, and
// NinetyInNinetyCard — and any future mutation site — with zero call-site
// changes. The sync service registers itself at init
// (app/services/sync/index.ts). Pull-merge writes go through
// attendanceSyncWriter instead, which deliberately does NOT notify — pulled
// records must never re-enqueue themselves.
let attendanceMutationHook: ((m: AttendanceMutation) => void) | null = null

export function setAttendanceMutationHook(fn: ((m: AttendanceMutation) => void) | null): void {
  attendanceMutationHook = fn
}

function notifyAttendanceMutation(m: AttendanceMutation): void {
  // Isolated: a throwing hook must never break the mutation that already succeeded.
  try {
    attendanceMutationHook?.(m)
  } catch (err) {
    log.error("attendanceMutationHook threw (isolated)", { error: String(err) })
  }
}
```

- [ ] **Step 2: Notify from every mutating `attendanceRepo` wrapper.** Replace the existing bodies of `create`, `update`, `markProcessed`, `markProduced`, `markArchived`, `addEvent`, and `delete`:

```ts
  /** Create a new attendance record */
  create: async (input: AttendanceCreateInput) => {
    const result = await getAttendanceRepo().create(input)
    // create() resolves to the new row id; prefer it over input.id (which is optional)
    if (result.ok) notifyAttendanceMutation({ recordId: result.value, operation: "create" })
    return result
  },

  /** Update an attendance record */
  update: async (id: string, input: AttendanceUpdateInput) => {
    const result = await getAttendanceRepo().update(id, input)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
  },

  /** Mark attendance as processed with calculated values */
  markProcessed: async (
    id: string,
    data: { start: number; end: number; credit: number; valid: boolean },
  ) => {
    const result = await getAttendanceRepo().markProcessed(id, data)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
  },

  /** Mark attendance as produced (link to a report, also archives) */
  markProduced: async (id: string, arid: string) => {
    const result = await getAttendanceRepo().markProduced(id, arid)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
  },

  /** Mark an attendance record as archived */
  markArchived: async (id: string) => {
    const result = await getAttendanceRepo().markArchived(id)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
  },

  /** Add an event to an attendance record */
  addEvent: async (id: string, event: AttendanceEvent) => {
    const result = await getAttendanceRepo().addEvent(id, event)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "update" })
    return result
  },

  /** Delete an attendance record (hard delete — NinetyInNinetyCard cleanup).
   * Snapshot the row FIRST: the sync tombstone push needs the full record
   * after the row is gone. */
  delete: async (id: string) => {
    const existing = await getAttendanceRepo().findById(id)
    const snapshot = existing.ok && existing.value ? existing.value : undefined
    const result = await getAttendanceRepo().delete(id)
    if (result.ok) notifyAttendanceMutation({ recordId: id, operation: "delete", snapshot })
    return result
  },
```

Also add the pass-through `findByIds` (next to `findById`):

```ts
  /** Find multiple attendance records by id (sync push reads current rows) */
  findByIds: async (ids: string[]) => {
    return getAttendanceRepo().findByIds(ids)
  },
```

- [ ] **Step 3: Add `attendanceSyncWriter`** (after the `attendanceRepo` object):

```ts
/**
 * Hook-bypassing writes for the sync pull-merge path.
 *
 * INVARIANT: nothing in here calls notifyAttendanceMutation. Records applied
 * from a server pull must not re-enter the sync outbox — that would echo
 * every pulled record straight back to the server forever.
 */
export const attendanceSyncWriter = {
  exists: async (id: string): Promise<boolean> => {
    const result = await getAttendanceRepo().findById(id)
    return result.ok && result.value !== null
  },

  createFromServer: async (input: AttendanceCreateInput) => {
    return getAttendanceRepo().create(input)
  },

  updateFromServer: async (id: string, input: AttendanceUpdateInput) => {
    return getAttendanceRepo().update(id, input)
  },

  /** Apply a pulled tombstone: hard-delete the local row. */
  remove: async (id: string) => {
    return getAttendanceRepo().delete(id)
  },

  reportExists: async (id: string): Promise<boolean> => {
    const result = await getAttendanceReportRepo().findById(id)
    return result.ok && result.value !== null
  },

  reportCreateFromServer: async (input: AttendanceReportCreateInput) => {
    return getAttendanceReportRepo().create(input)
  },

  reportUpdateFromServer: async (id: string, input: AttendanceReportUpdateInput) => {
    return getAttendanceReportRepo().update(id, input)
  },

  reportRemove: async (id: string) => {
    return getAttendanceReportRepo().delete(id)
  },
}
```

- [ ] **Step 4: Expand the `syncQueueRepo` wrapper** (replace the existing minimal object):

```ts
/**
 * Sync queue repository instance (lazy) — the durable outbox for cloud sync.
 *
 * Queue rows for create/update carry only recordId (current row data is read
 * at push time so N edits collapse to one push); delete rows carry a JSON
 * snapshot payload for tombstone construction.
 */
function getSyncQueueRepo(): SyncQueueRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_syncQueueRepo) _syncQueueRepo = new SyncQueueRepository(db as any)
  return _syncQueueRepo
}

export const syncQueueRepo = {
  enqueue: async (input: {
    tableName: string
    recordId: string
    operation: "create" | "update" | "delete"
    payload?: string
  }) => {
    return getSyncQueueRepo().enqueue(input)
  },

  /** Pending + retryable-failed items, FIFO */
  getPending: async (maxRetries?: number) => {
    return getSyncQueueRepo().getPending(maxRetries)
  },

  markSynced: async (id: string) => {
    return getSyncQueueRepo().markSynced(id)
  },

  markFailed: async (id: string, errorMessage: string) => {
    return getSyncQueueRepo().markFailed(id, errorMessage)
  },

  deleteItem: async (id: string) => {
    return getSyncQueueRepo().delete(id)
  },

  /**
   * Delete every pending/retryable item. Called on logout — user A's queued
   * records must never be pushed under user B's token (the server would
   * stamp them with B's uid).
   */
  clearPending: async () => {
    const pending = await getSyncQueueRepo().getPending()
    if (!pending.ok) return pending
    for (const item of pending.value) {
      await getSyncQueueRepo().delete(item.id)
    }
    return { ok: true as const, value: pending.value.length }
  },
}
```

- [ ] **Step 5: Add `"synced"` to `attendanceEvents`** (`app/db/attendanceEvents.ts`):

```ts
export type AttendanceChangeType =
  | "created"
  | "processed"
  | "acknowledged"
  | "produced"
  | "archived"
  | "delivery_resolved"
  // Emitted by the cloud-sync service after a pull merge changed local rows —
  // screens reload lists the same way they do for local mutations. The `id`
  // on these events is the constant "sync" (no single record changed).
  | "synced"
```

- [ ] **Step 6: Verify and commit**

Run: `npm run compile && npm run lint:check`
Expected: no errors.

```bash
git add app/db/repositories.ts app/db/attendanceEvents.ts
git commit -m "✨ feat(db): attendance mutation hook, sync writer bypass, outbox queue wrapper"
```

---

### Task 5: Sync service (DI factory) + vitest tests

**Files:**
- Create: `app/services/sync/attendanceSyncService.ts`
- Test: `app/services/sync/attendanceSyncService.test.ts` (vitest)

**Interfaces:**
- Consumes: everything from `./syncLogic` (Task 1). `mobx` (real package, vitest-safe). Type-only: `AttendanceRecord` from `@recoverysky-org/common/sqlite`.
- Produces (used by Tasks 6–8):
  - `createAttendanceSyncService(deps: SyncDeps): AttendanceSyncService`
  - `AttendanceSyncService = { syncState, nudgePush(), pushTick(), pullTick(resource), fullSync(), initialBackup(), onLogout() }`
  - `syncState: { phase: "idle" | "backing-up" | "syncing" | "error"; lastSyncedAt: number | null; pendingCount: number }` (mobx observable)
  - `interface SyncDeps` (exact shape below)

**Design notes for the implementer:**
- ZERO `@/` runtime imports (vitest-tested). All I/O arrives via `deps`.
- Reentrancy guards: `pushTick` and `pullTick` are no-ops while already running.
- Backoff: consecutive whole-request failures gate ticks for 30 s → 60 s → 300 s; any success resets. `phase = "error"` only at ≥2 consecutive failures.
- Cursor rule: advance only after a page fully merges; never advance on an empty page.
- Gate is re-checked between push batches (sign-out mid-drain).

- [ ] **Step 1: Write the failing tests**

```ts
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

function serverRec(id: string, extra: Partial<ServerAttendanceRecord> = {}): ServerAttendanceRecord {
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
    deps.api.pushAttendance = async () => ({ kind: "timeout" })
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/services/sync/attendanceSyncService.test.ts`
Expected: FAIL — cannot resolve `./attendanceSyncService`.

- [ ] **Step 3: Write the implementation**

```ts
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
import { observable, runInAction } from "mobx"

import type { AttendanceRecord } from "@recoverysky-org/common/sqlite"

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
    pushAttendance(records: ServerAttendanceRecord[]): Promise<
      | { kind: "ok"; accepted: number; rejected: { id: string; reason: "stale" | "invalid" }[] }
      | { kind: string }
    >
    pullAttendance(since: number): Promise<
      | { kind: "ok"; records: ServerAttendanceRecord[]; cursor: number; hasMore: boolean }
      | { kind: string }
    >
    pullReports(since: number): Promise<
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
        const page = result as {
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/services/sync/attendanceSyncService.test.ts`
Expected: PASS (all tests). Also run `npx vitest run app/services/sync/` to keep Task 1 green.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run compile`
Expected: no errors.

```bash
git add app/services/sync/attendanceSyncService.ts app/services/sync/attendanceSyncService.test.ts
git commit -m "✨ feat(sync): DI sync service — outbox drain, cursor pull, initial backup"
```

---

### Task 6: Real wiring (`app/services/sync/index.ts`) + `app.tsx` init

**Files:**
- Create: `app/services/sync/index.ts`
- Modify: `app/app.tsx` (inside the rootStore-init effect, after the auth `reaction` block ~line 520)

**Interfaces:**
- Consumes: Tasks 1–5 outputs; `hasEntitlement` + `ENTITLEMENTS` from `@/services/purchases`; `loadString`/`saveString` from `@/utils/storage`; `attendanceEvents`; repos from `@/db`.
- Produces (used by Tasks 7–8):
  - `initAttendanceSync(rootStore: RootStore): void` — call once from `app.tsx`
  - `attendanceSync: AttendanceSyncService` — module singleton (its methods are safe no-ops before init because the gate reads a null rootStore ref)

- [ ] **Step 1: Write the wiring module**

```ts
// app/services/sync/index.ts
/**
 * Cloud-sync wiring — builds the real SyncDeps and owns all trigger
 * registration (mutation hook, AppState resume, gate reaction, logout).
 * app.tsx calls initAttendanceSync(rootStore) once, post-bootstrap.
 *
 * This file is the I/O boundary the vitest suites never import — keep logic
 * out of here and in attendanceSyncService/syncLogic.
 */
import { AppState, type AppStateStatus } from "react-native"

import { reaction } from "mobx"

import {
  attendanceRepo,
  attendanceSyncWriter,
  setAttendanceMutationHook,
  syncQueueRepo,
} from "@/db"
import { attendanceEvents } from "@/db/attendanceEvents"
import type { RootStore } from "@/models"
import { api } from "@/services/api"
import { ENTITLEMENTS } from "@/services/purchases/config"
import { hasEntitlement } from "@/services/purchases/revenueCatService"
import { logger } from "@/utils/logger"
import { loadString, saveString } from "@/utils/storage"

import { createAttendanceSyncService, type SyncDeps, type SyncResource } from "./attendanceSyncService"
import {
  reportToLocalCreate,
  reportToLocalUpdate,
  toLocalCreate,
  toLocalUpdate,
  type ServerAttendanceRecord,
  type ServerReportRecord,
} from "./syncLogic"

const log = logger.child({ module: "AttendanceSync" })

let rootStoreRef: RootStore | null = null

function cursorKey(resource: SyncResource, uid: string): string {
  return `sync.cursor.${resource}.${uid}`
}

async function gate(): Promise<{ ok: boolean; uid: string }> {
  const rs = rootStoreRef
  if (!rs) return { ok: false, uid: "" }
  const auth = rs.authenticationStore
  const uid = auth.userId ?? ""
  // Cheap observable checks first; the RevenueCat entitlement check (an SDK
  // call, though cached) runs last and only if everything else passes.
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

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }, what: string): T {
  // The sync service treats a throwing local op as a merge failure (cursor
  // holds); RecoverySkyResult errors become exceptions at this boundary.
  if (!result.ok) throw new Error(`${what}: ${String(result.error)}`)
  return result.value as T
}

const deps: SyncDeps = {
  api: {
    pushAttendance: async (records: ServerAttendanceRecord[]) => {
      const result = await api.pushSyncAttendance(records)
      if (result.kind !== "ok") return result
      return { kind: "ok" as const, accepted: result.data.accepted, rejected: result.data.rejected }
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
      unwrap(await attendanceSyncWriter.reportCreateFromServer(reportToLocalCreate(r)), "reportCreate")
    },
    reportUpdateFromServer: async (r: ServerReportRecord) => {
      unwrap(await attendanceSyncWriter.reportUpdateFromServer(r.id, reportToLocalUpdate(r)), "reportUpdate")
    },
    reportRemove: async (id) => {
      unwrap(await attendanceSyncWriter.reportRemove(id), "reportRemove")
    },
  },
  queue: {
    enqueue: async (entry) => {
      unwrap(
        await syncQueueRepo.enqueue({ tableName: "attendances", ...entry }),
        "enqueue",
      )
    },
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
    debug: (m, c) => log.debug(m, c),
    info: (m, c) => log.info(m, c),
    warn: (m, c) => log.warn(m, c),
    error: (m, c) => log.error(m, c),
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** Module singleton — safe to import anywhere; every tick gates on rootStoreRef. */
export const attendanceSync = createAttendanceSyncService(deps)

let initialized = false

/**
 * Wire sync triggers. Call exactly once from app.tsx after setupRootStore —
 * reactions registered here would duplicate on a second call (same reason the
 * outage path uses Updates.reloadAsync instead of re-running bootstrap).
 */
export function initAttendanceSync(rootStore: RootStore): void {
  if (initialized) {
    log.warn("initAttendanceSync called twice — ignoring")
    return
  }
  initialized = true
  rootStoreRef = rootStore

  // 1. Outbox feed: every attendanceRepo mutation enqueues (when opted in)
  //    and nudges a debounced push. Enqueue even when offline/maintenance —
  //    the queue IS the offline buffer; only the push tick is gated.
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

  // 2. Foreground resume → catch-up sync (there is no OS background sync).
  let appState = AppState.currentState
  AppState.addEventListener("change", (nextState: AppStateStatus) => {
    if (appState.match(/inactive|background/) && nextState === "active") {
      void attendanceSync.fullSync()
    }
    appState = nextState
  })

  // 3. Gate-clear reaction: when sync becomes available (toggle on, back
  //    online, maintenance over, signed in), fire a catch-up. Entitlement is
  //    not observable here — the tick's own gate() re-checks it.
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

  // 4. Account change → drop the queue (never push user A's records under
  //    user B's token) . Cursors are per-uid keys, so no cursor cleanup needed.
  reaction(
    () => rootStore.authenticationStore.userId,
    (userId, prevUserId) => {
      if (prevUserId && userId !== prevUserId) {
        void attendanceSync.onLogout()
      }
    },
  )

  // 5. Cold-start catch-up (post-bootstrap) — gate() inside decides.
  void attendanceSync.fullSync()

  log.info("Attendance sync initialized")
}
```

- [ ] **Step 2: Call it from `app.tsx`.** Inside the rootStore-init effect, after the auth-state `reaction` block (search for `// React to auth state changes`), add:

```ts
        // Cloud backup / multi-device sync — wires the outbox mutation hook,
        // resume + gate reactions, and fires a cold-start catch-up. Gated
        // internally on profileStore.syncEnabled + entitlement, so this is a
        // no-op for users who haven't opted in.
        initAttendanceSync(_rootStore)
```

with the import at the top of `app.tsx`:

```ts
import { initAttendanceSync } from "@/services/sync"
```

- [ ] **Step 3: Verify**

Run: `npm run compile && npm run lint:check && npm run lint:deps`
Expected: no errors. (`lint:deps` guards the new `services/sync` ↔ `db` ↔ `services/api` edges against circular-dependency violations — if it flags `api → services/sync`, the type-only import in Task 2 is the cause; confirm it is `import type`.)

- [ ] **Step 4: Smoke test in simulator**

Run: `npm start -- --clear`, launch iOS simulator, sign in, watch logs for `Attendance sync initialized`. With `syncEnabled` still false (default), confirm NO `/sync` requests fire (gate works).

- [ ] **Step 5: Commit**

```bash
git add app/services/sync/index.ts app/app.tsx
git commit -m "✨ feat(sync): wire sync service — mutation hook, resume/gate triggers, cold-start catch-up"
```

---

### Task 7: AttendanceScreen — reload on `"synced"`, pull on focus

**CHANGED 2026-07-09:** this task originally added a lazy-fetch of report bodies
on first open. That is gone. Sync now downloads every report body during the
sync pass (`backfillReportBodies()`, Task 5), so a synced device already holds
the full dataset and the detail view never touches the network. `handleViewReport`
and the row's `disabled={!item.html}` coupling stay exactly as they are today.

**Files:**
- Modify: `app/screens/AttendanceScreen.tsx`

**Interfaces:**
- Consumes: `attendanceSync` from `@/services/sync`.

- [ ] **Step 1: Reload lists on `"synced"`.** Three existing subscriptions filter event types — add `"synced"` to each:

New-records section (~line 241): `if (event.type === "processed" || event.type === "created" || event.type === "synced")`

Archive section (~line 441): `if (event.type === "archived" || event.type === "synced")`

Reports section (~line 568): `if (event.type === "produced" || event.type === "delivery_resolved" || event.type === "synced")`

- [ ] **Step 2: Pull on screen focus.** In the top-level screen component (the one that owns the section routing focus listener), add:

```ts
  // Cloud sync: catch up whenever the user lands on the Attendance tab. The
  // service gates internally (opt-in + entitlement + online), so this is free
  // for non-synced users. Covers both resources — the Reports tab lives here.
  useEffect(() => {
    return navigation.addListener("focus", () => {
      void attendanceSync.fullSync()
    })
  }, [navigation])
```

with import: `import { attendanceSync } from "@/services/sync"`

- [ ] **Step 3: Do NOT touch `handleViewReport`.** Leave the existing body-presence
check and the row's `disabled={!item.html}` coupling alone. A report whose body has
not been backfilled yet is briefly un-openable, which is honest: the row lights up on
the next `"synced"` event once `backfillReportBodies()` has stored its body. Adding a
per-open network fetch here would re-introduce exactly the lazy path this design
rejected.

- [ ] **Step 4: Verify**

Run: `npm run compile && npm run lint:check`
Expected: no errors.

Manual: in the simulator, open Attendance → Reports; existing reports open instantly.

- [ ] **Step 5: Commit**

```bash
git add app/screens/AttendanceScreen.tsx
git commit -m "✨ feat(attendance): reload lists on sync, pull on screen focus"
```

---

### Task 8: Settings — Cloud Backup toggle + status line + i18n

**Files:**
- Modify: `app/screens/SettingsScreen.tsx`
- Modify: `app/i18n/en.ts` (settingsScreen section, ~line 270)
- Modify: `app/i18n/es.ts` (settingsScreen section, ~line 264)

**Interfaces:**
- Consumes: `profileStore.syncEnabled`/`setSyncEnabled` (Task 3), `attendanceSync.syncState`/`initialBackup` (Tasks 5–6), `useSubscription().hasAttendance`, `useNetworkStore()`.

- [ ] **Step 1: Add i18n keys.** In `en.ts` under `settingsScreen` (after the Subscription Section keys):

```ts
    // Cloud Backup Section
    backupSection: "Cloud Backup",
    cloudBackup: "Back up attendance",
    cloudBackupHint: "Keep your attendance history safe and synced across devices",
    backupBackingUp: "Backing up…",
    backupSyncing: "Syncing…",
    backupAllBackedUp: "All backed up ✓ · {{time}}",
    backupPausedOffline: "Paused — offline",
    backupError: "Backup issue — will retry",
```

In `es.ts`, same keys:

```ts
    // Cloud Backup Section
    backupSection: "Copia de seguridad",
    cloudBackup: "Respaldar asistencia",
    cloudBackupHint: "Mantén tu historial de asistencia seguro y sincronizado entre dispositivos",
    backupBackingUp: "Respaldando…",
    backupSyncing: "Sincronizando…",
    backupAllBackedUp: "Todo respaldado ✓ · {{time}}",
    backupPausedOffline: "Pausado — sin conexión",
    backupError: "Problema al respaldar — reintentará",
```

- [ ] **Step 2: Add a `SyncStatusLine` observer component** (above the SettingsScreen component in the same file — standalone observer per the FlatList-header convention, and because it re-renders on every syncState change):

```tsx
/**
 * One-line backup status under the Cloud Backup toggle. Standalone observer:
 * syncState ticks during a multi-minute initial backup and we don't want the
 * whole Settings screen re-rendering per tick.
 */
const SyncStatusLine = observer(function SyncStatusLine() {
  const { themed } = useAppTheme()
  const networkStore = useNetworkStore()
  const { phase, lastSyncedAt, pendingCount } = attendanceSync.syncState

  let text: string
  if (networkStore.isOffline) {
    text = translate("settingsScreen:backupPausedOffline")
  } else if (phase === "backing-up") {
    text = `${translate("settingsScreen:backupBackingUp")}${pendingCount > 0 ? ` (${pendingCount})` : ""}`
  } else if (phase === "syncing") {
    text = translate("settingsScreen:backupSyncing")
  } else if (phase === "error") {
    text = translate("settingsScreen:backupError")
  } else if (lastSyncedAt) {
    text = translate("settingsScreen:backupAllBackedUp", {
      time: new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    })
  } else {
    return null // enabled but never completed a cycle and not currently active
  }

  return <Text style={themed($rowHint)}>{text}</Text>
})
```

(`$rowHint` already exists in this file's styles — reuse it. If `useNetworkStore` isn't imported yet, add it from `@/models`.)

- [ ] **Step 3: Add the section** (after the Subscription section block, ~line 915, following the exact section pattern used by Notifications):

```tsx
        {/* Cloud Backup Section — only for attendance subscribers; the /sync
            API requires the attendance entitlement AND a signed-in identity
            (the purchase flow forces sign-in, so hasAttendance implies it). */}
        {hasAttendance && (
          <View style={themed($section)} onLayout={trackSection("cloudBackup")}>
            <View style={themed($sectionHeader)}>
              <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.tint} />
              <Text style={themed($sectionTitle)} tx="settingsScreen:backupSection" />
            </View>

            <View style={themed($settingsRow)}>
              <View style={$styles.flex1}>
                <Text style={themed($rowLabel)} tx="settingsScreen:cloudBackup" />
                {profileStore.syncEnabled ? (
                  <SyncStatusLine />
                ) : (
                  <Text style={themed($rowHint)} tx="settingsScreen:cloudBackupHint" />
                )}
              </View>
              <Switch
                value={profileStore.syncEnabled}
                onValueChange={handleSyncToggle}
                trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
                thumbColor="#FFFFFF"
                accessibilityLabel={translate("settingsScreen:cloudBackup")}
              />
            </View>
          </View>
        )}
```

- [ ] **Step 4: Add the toggle handler** (next to `handleNotificationsToggle`):

```ts
  const handleSyncToggle = useCallback(
    (value: boolean) => {
      profileStore.setSyncEnabled(value)
      trackEvent("cloud_backup_toggle", { enabled: value })
      if (value) {
        // Fire-and-forget: full pull + full push of the entire local history.
        // Idempotent — re-enabling after a pause safely re-runs it. Progress
        // shows in SyncStatusLine; the user can leave the screen.
        void attendanceSync.initialBackup()
      }
      // Toggle OFF is pause-only: queue, cursors, and server data all kept
      // (per the spec — no server wipe in v1).
    },
    [profileStore],
  )
```

Imports to add: `import { attendanceSync } from "@/services/sync"`; `useNetworkStore` from `@/models` and `observer` from `mobx-react-lite` (both only if not already imported in this file).

- [ ] **Step 5: Verify**

Run: `npm run compile && npm run lint:check && npm test`
Expected: all green.

Manual: simulator with an attendance-entitled account → Settings shows Cloud Backup; toggle ON → status line goes "Backing up…" then "All backed up ✓ · <time>"; network log shows paced `/sync` calls. Toggle OFF → no further `/sync` calls on new attendance.

- [ ] **Step 6: Commit**

```bash
git add app/screens/SettingsScreen.tsx app/i18n/en.ts app/i18n/es.ts
git commit -m "✨ feat(settings): cloud backup opt-in toggle with live sync status"
```

---

### Task 9: Changelog + full verification + manual E2E

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` → `Added`)

- [ ] **Step 1: Changelog entry** under `## [Unreleased]` / `### Added`:

```markdown
- Cloud backup & multi-device sync for attendance (opt-in, Settings → Cloud
  Backup, attendance subscribers only): every attendance record is
  continuously backed up to the server and pulled to other signed-in devices,
  so a reinstall or second phone reconstructs full history. Reports sync down
  as metadata with report bodies fetched on first open. Deletions propagate
  as tombstones; conflicting offline edits resolve last-write-wins on the
  server. Backup pauses (never wipes) when toggled off.
```

- [ ] **Step 2: Full verification suite**

Run each; all must pass before claiming done:

```bash
npm run compile      # TypeScript
npm run lint:check   # ESLint
npm run lint:deps    # dependency-cruiser (new module edges)
npm test             # vitest (syncLogic, attendanceSyncService) + jest
```

- [ ] **Step 3: Manual E2E checklist** (two iOS simulators, one attendance-entitled test account; use the dev API):

1. Device A: sign in, enable Cloud Backup → status reaches "All backed up ✓".
2. Device A: record attendance (external timer) → server receives `/sync/attendance` push within ~5 s.
3. Device B: sign in, enable Cloud Backup → device A's history appears (records + reports).
4. Device B: after sync settles, open a synced report's detail → it renders immediately with NO network request (bodies were downloaded by `backfillReportBodies()` during sync). Put B in airplane mode first to prove it.
5. Device A: edit a record's duration → appears on B after backgrounding/foregrounding B.
6. Device A: delete a 90-in-90 record (hard delete) → disappears from B on next sync (tombstone).
7. Device A: airplane mode → record attendance → re-enable network → foreground → record pushes (queue drained).
8. Toggle OFF on A → record attendance → no push. Toggle ON → initial backup re-runs, record arrives on B.
9. Force maintenance mode (dev server) → ticks pause, no requests; clear it → catch-up fires.
10. Sign out on A → sign in as a different test account → first account's records do NOT push under the new identity (queue cleared), and the new account's pull uses its own cursor.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "📝 docs(changelog): attendance cloud backup & multi-device sync"
```

Release note: this is a JS-only change — it ships via `npm run update` (OTA). Do NOT bump `runtimeVersion`.
