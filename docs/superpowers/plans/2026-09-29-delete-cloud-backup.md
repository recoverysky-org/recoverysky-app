# Delete Cloud Backup Implementation Plan

> **⏸ TABLED 2026-09-30 — do not execute.** The feature is parked; see the spec's Status line.
> Before resuming, re-verify every file path and line reference below against the then-current
> tree — the code this plan was written against will have moved.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Delete cloud backup" row in Settings → Cloud Backup that deletes the user's server-side attendance backup, optionally erases local attendance + reports on every one of their devices, and turns backup off everywhere — driven by a server deletion marker (epoch) every device applies.

**Architecture:** Pure decisions go in `syncLogic.ts` and a new `app/services/api/backupDeletedLogic.ts` (vitest). A new DI-factory service, `backupDeletionService.ts`, owns check / apply / delete, with its ordering vitest-covered. `services/sync/index.ts` wires it to MMKV, SQLite, MobX and report polling. The sync engine learns one new result, a push `backup-deleted`, and one new dep, `checkBackupState()`, which it runs at the top of `fullSync()` / `initialBackup()`. The UI is a flagged row plus a three-button `Alert`.

**Tech Stack:** React Native / Expo 54, MobX-State-Tree, apisauce, expo-sqlite + Drizzle (`@recoverysky-org/common/sqlite`), MMKV, Vitest (pure `.ts`), i18next.

**Spec:** `docs/superpowers/specs/2026-09-28-delete-cloud-backup-design.md` — read it first, and `docs/BACKUP.md`.

## Global Constraints

- **Do not touch `../api` or `../common`.** The server contract is spec §2. Until it's deployed, the new endpoints 404 and the row stays behind `deleteCloudBackupVisible = __DEV__`.
- **Vitest has no `@/` alias.** `syncLogic.ts`, `backupDeletedLogic.ts`, `backupDeletionService.ts`, and `attendanceSyncService.ts` must have **zero runtime `@/` imports**. Type-only imports are fine.
- `app/services/api/` must stay a dependency leaf. It must not import `app/services/sync/` at runtime (type-only is OK), or `npm run lint:deps` sees a cycle.
- **Never log** a raw uid, email, or coordinates. The logger adds the hashed `userId` itself.
- **Local wipes must never fire the attendance mutation hook.** Use the `attendanceSyncWriter.remove` / `.reportRemove` bypass, never `attendanceRepo.delete`.
- `sync.appliedEpoch.<uid>` is written **last** in an apply, and only after every step has succeeded.
- **i18n:** every new key goes into all nine locale files (`en es ar de fr pt ru th uk`). English placeholder text is fine in the eight non-English files.
- **Lint only the files you touched:** `npx eslint --fix <files>`. Never `npm run lint`.
- **Shared checkout:** stage named paths only. Never `git add -A`, never `git stash`. Work on branch `feat/delete-cloud-backup`, in a worktree created with superpowers:using-git-worktrees.
- **JS-only change:** do **not** bump `runtimeVersion`.
- Commit messages follow the repo's gitmoji style and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Spec deviations (decided while planning — keep them)

1. The 409 recogniser lives in `app/services/api/backupDeletedLogic.ts`, not in `syncLogic.ts` (spec §3.1). The API client needs it at runtime, and `api/` may not import `sync/`.
2. Spec §3.2/§3.3 put the check / apply / delete orchestration in `index.ts`. It goes into a new DI factory, `app/services/sync/backupDeletionService.ts`, instead, so its load-bearing ordering can be vitest-covered. `index.ts` only wires it.
3. The local wipe uses the existing `attendanceSyncWriter.remove` / `.reportRemove` rather than a new writer method (spec §3.2 said "extend `attendanceSyncWriter`"). The bypass already exists.
4. After a wipe, polls restart with `stopAllPolls()` + `resumeUnconfirmedPolls(uid)`, so reports generated *after* the deletion keep polling. Events emit as `"synced"`, which `AttendanceScreen` already reloads on, rather than `"archived"` / `"produced"`.

## Review Focus

1. **A local wipe fails part-way** (one SQLite delete fails). Expect: the epoch is **not** saved and the next check re-runs the whole idempotent apply. Nothing reports success. → Task 4, test "a failed wipe does not record the epoch".
2. **The server answers 409 while a 5xx batch is being bisected.** Expect: the bisection stops, nothing is quarantined (`markFailed` not called), and the check runs. → Task 3, test "409 mid-bisection aborts without quarantining".
3. **The DELETE response is lost** (timeout) but the server ran it. Expect: the tap reports failure and nothing local changes; the next foreground `checkBackupState()` applies the marker. → Task 4, tests "delete failure changes nothing locally" + "check applies a newer epoch".
4. **Foreground `fullSync` and a push 409 race.** Expect: one `GET /sync/state` and one apply (single-flight), plus a fresh request on the next call once the first settles. → Task 4, tests "concurrent checks share one request" + "a settled check does not pin the next one".
5. **The device has Cloud Backup OFF.** Expect: it still applies a wipe; the check is gated only on signed-in / online / DB-open / not maintenance. **Another account signing in** reads its own epoch key, not the previous user's. → Task 4, tests "check ignores syncEnabled" + "the applied epoch is per uid".

---

### Task 1: Pure backup-state decisions in `syncLogic.ts`

**Files:**
- Modify: `app/services/sync/syncLogic.ts` (append at end of file)
- Test: `app/services/sync/syncLogic.test.ts` (append; extend the import list)

**Interfaces:**
- Produces:
  - `interface BackupState { epoch: number; deletedAt: number; wipeLocal: boolean }`
  - `type BackupStateAction = "apply" | "noop"`
  - `backupStateAction(server: BackupState, appliedEpoch: number | null | undefined): BackupStateAction`
  - `isWipedAttendance(row: { created: number }, deletedAt: number): boolean`
  - `isWipedReport(row: { generated: number }, deletedAt: number): boolean`

- [ ] **Step 1: Write the failing tests** — add `backupStateAction, isWipedAttendance, isWipedReport, type BackupState` to the existing import from `./syncLogic`, then append:

```ts
describe("backupStateAction", () => {
  const state = (epoch: number): BackupState => ({ epoch, deletedAt: 5_000, wipeLocal: false })

  it("applies a server epoch newer than the one this device applied", () => {
    expect(backupStateAction(state(2), 1)).toBe("apply")
  })
  it("is a no-op for an equal or older server epoch", () => {
    expect(backupStateAction(state(2), 2)).toBe("noop")
    expect(backupStateAction(state(1), 2)).toBe("noop")
  })
  it("treats a never-applied device as epoch 0", () => {
    expect(backupStateAction(state(1), undefined)).toBe("apply")
    expect(backupStateAction(state(1), null)).toBe("apply")
  })
  it("a user who never deleted (epoch 0) is always a no-op", () => {
    expect(backupStateAction(state(0), undefined)).toBe("noop")
  })
})

describe("wipe predicates", () => {
  it("wipes attendance created strictly before the deletion", () => {
    expect(isWipedAttendance({ created: 4_999 }, 5_000)).toBe(true)
    expect(isWipedAttendance({ created: 5_000 }, 5_000)).toBe(false)
    expect(isWipedAttendance({ created: 5_001 }, 5_000)).toBe(false)
  })
  it("wipes reports generated strictly before the deletion", () => {
    expect(isWipedReport({ generated: 4_999 }, 5_000)).toBe(true)
    expect(isWipedReport({ generated: 5_000 }, 5_000)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit -- app/services/sync/syncLogic.test.ts`
Expected: FAIL — `backupStateAction` is not exported.

- [ ] **Step 3: Implement** — append to `app/services/sync/syncLogic.ts`:

```ts
/**
 * The server's cloud-backup deletion marker — `GET /sync/state` and the
 * `DELETE /sync/backup` response (spec 2026-09-28-delete-cloud-backup §2).
 * `epoch` goes up by one on every delete; `deletedAt` (server-clock ms) and
 * `wipeLocal` describe the LATEST delete only.
 */
export interface BackupState {
  epoch: number
  deletedAt: number
  wipeLocal: boolean
}

export type BackupStateAction = "apply" | "noop"

/**
 * Should this device apply the server's deletion marker?
 *
 * `appliedEpoch` is the MMKV `sync.appliedEpoch.<uid>` value; absent means 0,
 * so a fresh install applies the current marker. That is safe: sign-in comes
 * before any local attendance exists, so the wipe removes nothing, and the
 * install still learns the epoch its pushes must carry.
 */
export function backupStateAction(
  server: BackupState,
  appliedEpoch: number | null | undefined,
): BackupStateAction {
  return server.epoch > (appliedEpoch ?? 0) ? "apply" : "noop"
}

/**
 * Local rows a "delete device data" wipe removes: only those that existed
 * before the deletion. A device that was offline and logged meetings AFTER
 * the user pressed delete keeps them (spec decision 7). Strictly-before, so a
 * record stamped at the exact millisecond survives.
 *
 * `created`/`generated` are device-clock ms and `deletedAt` is server-clock;
 * skew shifts this boundary by the skew — accepted in the spec (§3.1).
 */
export function isWipedAttendance(row: { created: number }, deletedAt: number): boolean {
  return row.created < deletedAt
}

/** Report counterpart of isWipedAttendance — keyed on `generated`. */
export function isWipedReport(row: { generated: number }, deletedAt: number): boolean {
  return row.generated < deletedAt
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- app/services/sync/syncLogic.test.ts`
Expected: PASS (all old tests plus the new ones).

- [ ] **Step 5: Commit**

```bash
git add app/services/sync/syncLogic.ts app/services/sync/syncLogic.test.ts
git commit -m "✨ feat(sync): pure backup-deletion marker decisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: API client — recogniser, `deleteCloudBackup`, `getSyncState`, epoch on push

**Files:**
- Create: `app/services/api/backupDeletedLogic.ts`
- Test: `app/services/api/backupDeletedLogic.test.ts`
- Modify: `app/services/api/index.ts` (`pushSyncAttendance` ~L1640–1665; add two methods directly after `pullSyncReports`)
- Modify: `app/services/sync/index.ts` (the `pushAttendance` adapter in `deps.api`, only to pass the new required argument; Task 5 replaces the `0`)

**Interfaces:**
- Consumes: `BackupState` (type-only) from `../sync/syncLogic` (Task 1).
- Produces:
  - `backupDeletedEpoch(status: number | undefined, body: unknown): number | null`
  - `parseBackupState(body: unknown): BackupState | null`
  - `api.pushSyncAttendance(records: ServerAttendanceRecord[], epoch: number): Promise<{ kind: "ok"; data: SyncPushResult } | { kind: "backup-deleted"; epoch: number } | GeneralApiProblem>`
  - `api.deleteCloudBackup(wipeLocal: boolean): Promise<{ kind: "ok"; data: BackupState & { deleted: number } } | GeneralApiProblem>`
  - `api.getSyncState(): Promise<{ kind: "ok"; data: BackupState } | GeneralApiProblem>`

- [ ] **Step 1: Write the failing tests** — create `app/services/api/backupDeletedLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { backupDeletedEpoch, parseBackupState } from "./backupDeletedLogic"

describe("backupDeletedEpoch", () => {
  it("reads the epoch from a 409 backup_deleted body", () => {
    expect(backupDeletedEpoch(409, { error: "backup_deleted", message: "x", epoch: 3 })).toBe(3)
  })
  it("a 409 backup_deleted without a usable epoch still counts, as 0", () => {
    expect(backupDeletedEpoch(409, { error: "backup_deleted" })).toBe(0)
    expect(backupDeletedEpoch(409, { error: "backup_deleted", epoch: -1 })).toBe(0)
    expect(backupDeletedEpoch(409, { error: "backup_deleted", epoch: "3" })).toBe(0)
  })
  it("ignores other 409s and other statuses", () => {
    expect(backupDeletedEpoch(409, { error: "conflict" })).toBeNull()
    expect(backupDeletedEpoch(400, { error: "backup_deleted", epoch: 3 })).toBeNull()
    expect(backupDeletedEpoch(undefined, undefined)).toBeNull()
    expect(backupDeletedEpoch(409, null)).toBeNull()
  })
})

describe("parseBackupState", () => {
  it("accepts a well-formed state", () => {
    expect(parseBackupState({ epoch: 2, deletedAt: 10, wipeLocal: true, extra: 1 })).toEqual({
      epoch: 2,
      deletedAt: 10,
      wipeLocal: true,
    })
  })
  it("rejects missing or mistyped fields", () => {
    expect(parseBackupState({ epoch: 2, deletedAt: 10 })).toBeNull()
    expect(parseBackupState({ epoch: "2", deletedAt: 10, wipeLocal: false })).toBeNull()
    expect(parseBackupState({ epoch: -1, deletedAt: 10, wipeLocal: false })).toBeNull()
    expect(parseBackupState(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- app/services/api/backupDeletedLogic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `app/services/api/backupDeletedLogic.ts`:

```ts
/**
 * Pure parsers for the cloud-backup deletion contract (spec
 * 2026-09-28-delete-cloud-backup §2). Lives in services/api/ rather than
 * sync/syncLogic.ts because the API client needs it at RUNTIME, and api/ must
 * stay a dependency leaf — it may import sync/ types only.
 * ZERO `@/` runtime imports: vitest-tested.
 */
import type { BackupState } from "../sync/syncLogic"

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0
}

/**
 * The server's epoch from a `409 { error: "backup_deleted", epoch }` push
 * refusal, or null when the response is anything else. A malformed epoch
 * still counts as a refusal (returns 0): what matters is that the push was
 * refused and the device must re-check /sync/state, which carries the
 * authoritative epoch anyway.
 */
export function backupDeletedEpoch(status: number | undefined, body: unknown): number | null {
  if (status !== 409 || !body || typeof body !== "object") return null
  const b = body as { error?: unknown; epoch?: unknown }
  if (b.error !== "backup_deleted") return null
  return isNonNegativeInt(b.epoch) ? b.epoch : 0
}

/** Validate a GET /sync/state or DELETE /sync/backup body. Extra fields are dropped. */
export function parseBackupState(body: unknown): BackupState | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  if (!isNonNegativeInt(b.epoch) || !isNonNegativeInt(b.deletedAt)) return null
  if (typeof b.wipeLocal !== "boolean") return null
  return { epoch: b.epoch, deletedAt: b.deletedAt, wipeLocal: b.wipeLocal }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- app/services/api/backupDeletedLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the API client** — in `app/services/api/index.ts`:

Add the imports: the value import next to the other `./…Logic` imports, and the type next to the existing `import type { ServerAttendanceRecord, ServerReportRecord } from "@/services/sync/syncLogic"` (extend that line to include `BackupState`):

```ts
import { backupDeletedEpoch, parseBackupState } from "./backupDeletedLogic"
```

Replace `pushSyncAttendance` with:

```ts
  /**
   * Push new/changed attendance records to cloud backup.
   * POST /sync/attendance — max 200 records per call (SYNC_PUSH_BATCH_MAX);
   * uid/updated are server-stamped. Idempotent: retry freely.
   *
   * CHANGED 2026-09-29: carries `epoch` — the last cloud-backup deletion this
   * device applied. The server refuses a stale epoch with
   * 409 backup_deleted so an offline device or an old build can't resurrect
   * a deleted backup (spec 2026-09-28-delete-cloud-backup §2.4). An api that
   * predates the field ignores it (zod strips unknown keys), so this is safe
   * to ship first.
   */
  async pushSyncAttendance(
    records: ServerAttendanceRecord[],
    epoch: number,
  ): Promise<
    | { kind: "ok"; data: SyncPushResult }
    | { kind: "backup-deleted"; epoch: number }
    | GeneralApiProblem
  > {
    log.debug("Pushing sync attendance", { count: records.length, epoch })

    const response = await this.recoverySkyApi.post<SyncPushResult>("/sync/attendance", {
      records,
      epoch,
    })

    if (!response.ok) {
      // Checked BEFORE the generic classifier, which would call a 409 "rejected".
      const deletedEpoch = backupDeletedEpoch(response.status, response.data)
      if (deletedEpoch !== null) {
        log.debug("Sync push refused — cloud backup was deleted", { epoch: deletedEpoch })
        return { kind: "backup-deleted", epoch: deletedEpoch }
      }
      const problem = getGeneralApiProblem(response)
      log.debug("Sync push failed", { problem: problem?.kind, count: records.length })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || typeof response.data.accepted !== "number") {
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }
```

Add directly after `pullSyncReports`:

```ts
  /**
   * Delete this user's cloud backup (spec 2026-09-28-delete-cloud-backup §2.2).
   * DELETE /sync/backup?wipeLocal= — hard-deletes every server attendance row,
   * bumps the deletion epoch. Server reports are NEVER deleted (they are proof
   * of delivery). NOT idempotent in epoch: a retry bumps it again, which every
   * device simply applies.
   */
  async deleteCloudBackup(
    wipeLocal: boolean,
  ): Promise<{ kind: "ok"; data: BackupState & { deleted: number } } | GeneralApiProblem> {
    log.debug("Deleting cloud backup", { wipeLocal })

    const response = await this.recoverySkyApi.delete<unknown>("/sync/backup", {
      wipeLocal: String(wipeLocal),
    })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Cloud backup delete failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    const state = parseBackupState(response.data)
    const deleted = (response.data as { deleted?: unknown } | undefined)?.deleted
    if (!state || typeof deleted !== "number") return { kind: "bad-data" }

    return { kind: "ok", data: { ...state, deleted } }
  }

  /**
   * The user's cloud-backup deletion marker (spec §2.3). GET /sync/state —
   * `{ epoch: 0, ... }` for a user who never deleted.
   */
  async getSyncState(): Promise<{ kind: "ok"; data: BackupState } | GeneralApiProblem> {
    const response = await this.recoverySkyApi.get<unknown>("/sync/state")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Sync state fetch failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    const state = parseBackupState(response.data)
    if (!state) return { kind: "bad-data" }
    return { kind: "ok", data: state }
  }
```

In `app/services/sync/index.ts`, change the `pushAttendance` adapter's call to `api.pushSyncAttendance(records, 0)`, with a comment `// epoch wired in Task 5`. Task 5 replaces the `0`.

- [ ] **Step 6: Type-check and lint**

Run: `npm run compile && npx eslint --fix app/services/api/index.ts app/services/api/backupDeletedLogic.ts app/services/api/backupDeletedLogic.test.ts app/services/sync/index.ts && npm run lint:deps`
Expected: no errors; no new depcruise violations.

- [ ] **Step 7: Commit**

```bash
git add app/services/api/backupDeletedLogic.ts app/services/api/backupDeletedLogic.test.ts app/services/api/index.ts app/services/sync/index.ts
git commit -m "✨ feat(api): cloud backup delete/state methods, epoch on sync push

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sync engine — `checkBackupState` dep and push `backup-deleted`

**Files:**
- Modify: `app/services/sync/attendanceSyncService.ts` (`SyncDeps` ~L37–134, `pushBatch` ~L365, `isolatePoison` ~L411, `fullSync` ~L845, `initialBackup` ~L880)
- Test: `app/services/sync/attendanceSyncService.test.ts`
- Modify: `app/services/sync/index.ts` (add a placeholder dep so it compiles; Task 5 replaces it)

**Interfaces:**
- Consumes: the `{ kind: "backup-deleted"; epoch: number }` push result (Task 2).
- Produces: `SyncDeps.checkBackupState(): Promise<"applied" | "noop">`. It never rejects. `"applied"` means a newer marker was applied, sync is now off, and the queue is cleared.

- [ ] **Step 1: Add the dep to the test fixture** — in `makeDeps()`, next to `gate:`, add:

```ts
    checkBackupState: track("checkBackupState", async () => "noop" as const),
```

- [ ] **Step 2: Write the failing tests** — append:

```ts
describe("cloud backup deletion", () => {
  it("fullSync checks the deletion marker first and stops when it applied one", async () => {
    const deps = makeDeps({ checkBackupState: async () => "applied" as const })
    const svc = createAttendanceSyncService(deps)
    await svc.fullSync()
    expect(deps.calls.pullAttendance).toBeUndefined()
    expect(deps.calls.pending).toBeUndefined()
  })

  it("fullSync proceeds normally when the marker is a no-op", async () => {
    const deps = makeDeps()
    const svc = createAttendanceSyncService(deps)
    await svc.fullSync()
    expect(deps.calls.checkBackupState).toHaveLength(1)
    expect(deps.calls.pullAttendance).toHaveLength(1)
  })

  it("initialBackup does not enqueue anything once a marker was applied", async () => {
    const deps = makeDeps({ checkBackupState: async () => "applied" as const })
    deps.local.allIds = async () => ["att-1"]
    const svc = createAttendanceSyncService(deps)
    await svc.initialBackup()
    expect(deps.calls.enqueue).toBeUndefined()
    expect(svc.syncState.phase).not.toBe("backing-up")
  })

  it("a push refused as backup-deleted runs the check and does not quarantine or mark synced", async () => {
    const deps = makeDeps({
      checkBackupState: async (...args: unknown[]) => {
        ;(deps.calls.checkBackupState ??= []).push(args)
        return "applied" as const
      },
    })
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "update", payload: null },
    ]
    deps.api.pushAttendance = async () => ({ kind: "backup-deleted", epoch: 2 })
    const svc = createAttendanceSyncService(deps)
    await svc.pushTick()
    expect(deps.calls.checkBackupState).toHaveLength(1)
    expect(deps.calls.markFailed).toBeUndefined()
    expect(deps.calls.markSynced).toBeUndefined()
    expect(svc.syncState.phase).not.toBe("error")
  })

  it("backs off when a backup-deleted refusal could not be resolved", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "update", payload: null },
    ]
    let pushes = 0
    deps.api.pushAttendance = async () => {
      pushes++
      return { kind: "backup-deleted", epoch: 2 }
    }
    const svc = createAttendanceSyncService(deps) // checkBackupState → "noop"
    await svc.pushTick()
    await svc.pushTick() // inside the backoff window — no second request
    expect(pushes).toBe(1)
  })

  it("409 mid-bisection aborts without quarantining", async () => {
    const deps = makeDeps()
    deps.queue.pending = async () => [
      { queueId: "q1", recordId: "att-1", operation: "update", payload: null },
      { queueId: "q2", recordId: "att-2", operation: "update", payload: null },
    ]
    let call = 0
    deps.api.pushAttendance = async () => {
      call++
      return call === 1 ? { kind: "server" } : { kind: "backup-deleted", epoch: 2 }
    }
    const svc = createAttendanceSyncService(deps)
    await svc.pushTick()
    expect(call).toBe(2) // whole batch, then the first half — no right half
    expect(deps.calls.markFailed).toBeUndefined()
    expect(deps.calls.checkBackupState).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:unit -- app/services/sync/attendanceSyncService.test.ts`
Expected: FAIL (a type error on `checkBackupState` and the new assertions fail).

- [ ] **Step 4: Implement** — in `attendanceSyncService.ts`:

(a) In `SyncDeps`, directly after `gate(): ...`, add:

```ts
  /**
   * Check the server's cloud-backup deletion marker (GET /sync/state) and
   * apply it if it is newer than this device's (spec
   * 2026-09-28-delete-cloud-backup §3.3). Has its OWN gate — deliberately not
   * `gate()`, because a device with backup off must still honour a wipe.
   * `"applied"` means sync was just turned off and the outbox cleared; callers
   * must stop. Never rejects.
   */
  checkBackupState(): Promise<"applied" | "noop">
```

(b) Add this helper just above `pushBatch`:

```ts
  /**
   * The server refused a push with 409 backup_deleted: another device deleted
   * the cloud backup since this one last checked. Apply the marker (it turns
   * sync off and clears the outbox — which is exactly the rows the server
   * just refused), then end the tick. Never quarantine: the records are fine,
   * the backup is gone. If the check could not resolve it (offline blip, a
   * failed GET), back off like any failure rather than re-pushing into the
   * same 409 on every nudge.
   */
  async function onBackupDeleted(): Promise<"abort"> {
    deps.log.info("sync: push refused — cloud backup was deleted; checking marker")
    const outcome = await deps.checkBackupState()
    if (outcome !== "applied") recordFailure()
    return "abort"
  }
```

(c) In `pushBatch`, directly after the `if (result.kind === "ok") { ... }` block and **before** `if (result.kind !== "server")`, add:

```ts
    if (result.kind === "backup-deleted") return onBackupDeleted()
```

(d) In `isolatePoison`'s `for (const half of halves)` loop, directly after its `if (result.kind === "ok") { ... continue }` block and **before** `if (result.kind !== "server")`, add the same line:

```ts
      if (result.kind === "backup-deleted") return onBackupDeleted()
```

(e) Replace `fullSync` with:

```ts
  async function fullSync(): Promise<void> {
    // ADDED 2026-09-29: the deletion marker comes first. Every catch-up path
    // (cold start via SyncResumer, foreground, Attendance focus, gate
    // reaction) funnels through here, so this is the one place a device
    // learns another device deleted the backup — BEFORE it pushes rows the
    // server would refuse (spec 2026-09-28-delete-cloud-backup §3.3).
    if ((await deps.checkBackupState()) === "applied") return
    await pullTick("attendance")
    await pullTick("reports")
    await backfillReportBodies()
    await pushTick()
  }
```

(f) In `initialBackup`, directly after `if (!gate.ok) return` add:

```ts
    // ADDED 2026-09-29: a stale device re-enabling backup would otherwise
    // enqueue its whole history just to have the push 409. Apply the marker
    // first; that turns backup back off, and the user can re-enable from a
    // current epoch.
    if ((await deps.checkBackupState()) === "applied") return
```

(g) In `app/services/sync/index.ts`'s `deps` object, add `checkBackupState: async () => "noop" as const,` next to `gate,`, with the comment `// real wiring in Task 5`, so the app compiles.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- app/services/sync/attendanceSyncService.test.ts`
Expected: PASS (all existing plus the six new ones).

- [ ] **Step 6: Type-check and lint**

Run: `npm run compile && npx eslint --fix app/services/sync/attendanceSyncService.ts app/services/sync/attendanceSyncService.test.ts app/services/sync/index.ts`

- [ ] **Step 7: Commit**

```bash
git add app/services/sync/attendanceSyncService.ts app/services/sync/attendanceSyncService.test.ts app/services/sync/index.ts
git commit -m "✨ feat(sync): engine honours the backup deletion marker and push 409

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `backupDeletionService.ts` — check / apply / delete orchestration

**Files:**
- Create: `app/services/sync/backupDeletionService.ts`
- Test: `app/services/sync/backupDeletionService.test.ts`

**Interfaces:**
- Consumes: `BackupState` and `backupStateAction` (Task 1).
- Produces:
  - `interface BackupDeletionDeps` (shown below)
  - `type DeleteCloudBackupResult = { kind: "ok"; wipeLocal: boolean } | { kind: "unavailable" } | { kind: "failed"; problem: string }`
  - `createBackupDeletion(deps: BackupDeletionDeps): { checkBackupState(): Promise<"applied" | "noop">; deleteCloudBackup(wipeLocal: boolean): Promise<DeleteCloudBackupResult> }`

- [ ] **Step 1: Write the failing tests** — create `app/services/sync/backupDeletionService.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { createBackupDeletion, type BackupDeletionDeps } from "./backupDeletionService"
import type { BackupState } from "./syncLogic"

function makeDeps(overrides: Partial<BackupDeletionDeps> = {}) {
  const order: string[] = []
  const epochs = new Map<string, number>()
  let serverState: BackupState = { epoch: 0, deletedAt: 0, wipeLocal: false }
  let stateCalls = 0
  const deps: BackupDeletionDeps = {
    api: {
      getSyncState: async () => {
        stateCalls++
        return { kind: "ok" as const, data: serverState }
      },
      deleteCloudBackup: async (wipeLocal) => ({
        kind: "ok" as const,
        data: { epoch: 1, deletedAt: 5_000, wipeLocal, deleted: 12 },
      }),
    },
    canCheck: () => true,
    uid: () => "auth0|a",
    appliedEpoch: {
      get: (uid) => epochs.get(uid) ?? 0,
      set: (uid, e) => {
        order.push("setEpoch")
        epochs.set(uid, e)
      },
    },
    disableSync: () => order.push("disableSync"),
    clearQueue: async () => {
      order.push("clearQueue")
    },
    wipeLocalBefore: async () => {
      order.push("wipe")
      return { attendance: 3, reports: 1 }
    },
    afterWipe: async () => {
      order.push("afterWipe")
    },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  }
  return {
    deps,
    order,
    epochs,
    setServer: (s: BackupState) => (serverState = s),
    stateCalls: () => stateCalls,
  }
}

describe("checkBackupState", () => {
  it("is a no-op when the server epoch is not newer", async () => {
    const h = makeDeps()
    expect(await createBackupDeletion(h.deps).checkBackupState()).toBe("noop")
    expect(h.order).toEqual([])
  })

  it("check applies a newer epoch: sync off, queue cleared, epoch saved last", async () => {
    const h = makeDeps()
    h.setServer({ epoch: 2, deletedAt: 5_000, wipeLocal: false })
    expect(await createBackupDeletion(h.deps).checkBackupState()).toBe("applied")
    expect(h.order).toEqual(["disableSync", "clearQueue", "setEpoch"])
    expect(h.epochs.get("auth0|a")).toBe(2)
  })

  it("wipes local data when the marker asks for it, before saving the epoch", async () => {
    const h = makeDeps()
    h.setServer({ epoch: 1, deletedAt: 5_000, wipeLocal: true })
    await createBackupDeletion(h.deps).checkBackupState()
    expect(h.order).toEqual(["disableSync", "clearQueue", "wipe", "afterWipe", "setEpoch"])
  })

  it("a failed wipe does not record the epoch, so the next check re-runs it", async () => {
    const h = makeDeps({
      wipeLocalBefore: async () => {
        throw new Error("delete failed")
      },
    })
    h.setServer({ epoch: 1, deletedAt: 5_000, wipeLocal: true })
    const svc = createBackupDeletion(h.deps)
    expect(await svc.checkBackupState()).toBe("noop")
    expect(h.epochs.has("auth0|a")).toBe(false)
  })

  it("a failed queue clear does not record the epoch", async () => {
    const h = makeDeps({
      clearQueue: async () => {
        throw new Error("clear failed")
      },
    })
    h.setServer({ epoch: 1, deletedAt: 5_000, wipeLocal: false })
    expect(await createBackupDeletion(h.deps).checkBackupState()).toBe("noop")
    expect(h.epochs.has("auth0|a")).toBe(false)
  })

  it("does nothing and makes no request when its gate is closed", async () => {
    const h = makeDeps({ canCheck: () => false })
    h.setServer({ epoch: 1, deletedAt: 5_000, wipeLocal: true })
    expect(await createBackupDeletion(h.deps).checkBackupState()).toBe("noop")
    expect(h.stateCalls()).toBe(0)
  })

  it("check ignores syncEnabled — the gate is canCheck alone", async () => {
    // BackupDeletionDeps has no syncEnabled input at all; this pins that a
    // device with backup OFF (canCheck true) still applies a wipe.
    const h = makeDeps()
    h.setServer({ epoch: 1, deletedAt: 5_000, wipeLocal: true })
    expect(await createBackupDeletion(h.deps).checkBackupState()).toBe("applied")
    expect(h.order).toContain("wipe")
  })

  it("the applied epoch is per uid", async () => {
    const h = makeDeps({ uid: () => "auth0|b" })
    h.epochs.set("auth0|a", 5)
    h.setServer({ epoch: 1, deletedAt: 5_000, wipeLocal: false })
    expect(await createBackupDeletion(h.deps).checkBackupState()).toBe("applied")
    expect(h.epochs.get("auth0|b")).toBe(1)
    expect(h.epochs.get("auth0|a")).toBe(5)
  })

  it("does not apply when the user changed while the request was in flight", async () => {
    let uid = "auth0|a"
    const h = makeDeps({ uid: () => uid })
    h.deps.api.getSyncState = async () => {
      uid = "auth0|b"
      return { kind: "ok" as const, data: { epoch: 1, deletedAt: 5_000, wipeLocal: true } }
    }
    expect(await createBackupDeletion(h.deps).checkBackupState()).toBe("noop")
    expect(h.order).toEqual([])
  })

  it("a failed state fetch is a no-op", async () => {
    const h = makeDeps()
    h.deps.api.getSyncState = async () => ({ kind: "timeout" })
    expect(await createBackupDeletion(h.deps).checkBackupState()).toBe("noop")
  })

  it("concurrent checks share one request", async () => {
    const h = makeDeps()
    h.setServer({ epoch: 1, deletedAt: 5_000, wipeLocal: false })
    const svc = createBackupDeletion(h.deps)
    const [a, b] = await Promise.all([svc.checkBackupState(), svc.checkBackupState()])
    expect([a, b]).toEqual(["applied", "applied"])
    expect(h.stateCalls()).toBe(1)
  })

  it("a settled check does not pin the next one (incl. a synchronous closed-gate return)", async () => {
    let open = false
    const h = makeDeps({ canCheck: () => open })
    const svc = createBackupDeletion(h.deps)
    await svc.checkBackupState() // gate closed — resolves without awaiting anything
    open = true
    await svc.checkBackupState()
    expect(h.stateCalls()).toBe(1)
  })
})

describe("deleteCloudBackup", () => {
  it("deletes on the server, then applies locally as the initiator", async () => {
    const h = makeDeps()
    const result = await createBackupDeletion(h.deps).deleteCloudBackup(true)
    expect(result).toEqual({ kind: "ok", wipeLocal: true })
    expect(h.order).toEqual(["disableSync", "clearQueue", "wipe", "afterWipe", "setEpoch"])
    expect(h.epochs.get("auth0|a")).toBe(1)
  })

  it("delete failure changes nothing locally", async () => {
    const h = makeDeps()
    h.deps.api.deleteCloudBackup = async () => ({ kind: "timeout" })
    const result = await createBackupDeletion(h.deps).deleteCloudBackup(true)
    expect(result).toEqual({ kind: "failed", problem: "timeout" })
    expect(h.order).toEqual([])
  })

  it("is unavailable, with no request, when its gate is closed", async () => {
    let called = false
    const h = makeDeps({ canCheck: () => false })
    h.deps.api.deleteCloudBackup = async () => {
      called = true
      return { kind: "timeout" }
    }
    expect(await createBackupDeletion(h.deps).deleteCloudBackup(false)).toEqual({
      kind: "unavailable",
    })
    expect(called).toBe(false)
  })

  it("reports success once the server confirmed, even if the local apply throws", async () => {
    // The server copy is gone either way; the next check retries the apply.
    const h = makeDeps({
      clearQueue: async () => {
        throw new Error("clear failed")
      },
    })
    const result = await createBackupDeletion(h.deps).deleteCloudBackup(false)
    expect(result).toEqual({ kind: "ok", wipeLocal: false })
    expect(h.epochs.has("auth0|a")).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- app/services/sync/backupDeletionService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `app/services/sync/backupDeletionService.ts`:

```ts
/**
 * Cloud-backup deletion — check, apply, and the initiating delete (spec
 * docs/superpowers/specs/2026-09-28-delete-cloud-backup-design.md §3).
 *
 * A DI factory like attendanceSyncService so the ORDER of an apply — which
 * is what keeps a deleted backup from being resurrected — is vitest-covered.
 * ZERO `@/` runtime imports; services/sync/index.ts builds the real deps.
 */
import { backupStateAction, type BackupState } from "./syncLogic"

export interface BackupDeletionDeps {
  api: {
    getSyncState(): Promise<{ kind: "ok"; data: BackupState } | { kind: string }>
    deleteCloudBackup(
      wipeLocal: boolean,
    ): Promise<{ kind: "ok"; data: BackupState & { deleted: number } } | { kind: string }>
  }
  /**
   * Signed in (not anonymous), DB open, online, not maintenance/outage, no
   * account-switch queue clear pending. Deliberately NOT syncEnabled or the
   * attendance entitlement: a device with backup off must still honour a
   * wipe the user asked for (spec decision 8).
   */
  canCheck(): boolean
  /** Current Auth0 userId, "" when signed out. Never logged. */
  uid(): string
  /** MMKV `sync.appliedEpoch.<uid>`; 0 when absent. */
  appliedEpoch: { get(uid: string): number; set(uid: string, epoch: number): void }
  /** profileStore.setSyncEnabled(false) — closes the sync gate. */
  disableSync(): void
  /** Drop every pending outbox row. Throws on a partial clear. */
  clearQueue(): Promise<void>
  /** Hard-delete local attendance/reports from before `deletedAt`, bypassing the mutation hook. Throws on any failed delete. */
  wipeLocalBefore(deletedAt: number): Promise<{ attendance: number; reports: number }>
  /** Post-wipe housekeeping: forget bodyNotFound, restart report polls, reload lists. */
  afterWipe(uid: string): Promise<void>
  log: {
    debug(msg: string, ctx?: Record<string, unknown>): void
    info(msg: string, ctx?: Record<string, unknown>): void
    warn(msg: string, ctx?: Record<string, unknown>): void
    error(msg: string, ctx?: Record<string, unknown>): void
  }
}

export type DeleteCloudBackupResult =
  | { kind: "ok"; wipeLocal: boolean }
  | { kind: "unavailable" }
  | { kind: "failed"; problem: string }

export type BackupDeletion = ReturnType<typeof createBackupDeletion>

export function createBackupDeletion(deps: BackupDeletionDeps) {
  let inFlight: Promise<"applied" | "noop"> | null = null

  /**
   * Order is load-bearing (spec §3.2):
   * 1. sync off FIRST — closes the gate so no tick can push while we work;
   * 2. clear the outbox — those rows are exactly what would resurrect the
   *    deleted backup;
   * 3. optional local wipe;
   * 4. record the epoch LAST — any throw above leaves it unrecorded, so the
   *    next check re-runs the whole apply (every step is idempotent).
   */
  async function apply(state: BackupState, uid: string, initiator: boolean): Promise<void> {
    deps.disableSync()
    await deps.clearQueue()
    let wiped = { attendance: 0, reports: 0 }
    if (state.wipeLocal) {
      wiped = await deps.wipeLocalBefore(state.deletedAt)
      await deps.afterWipe(uid)
    }
    deps.appliedEpoch.set(uid, state.epoch)
    deps.log.info("Cloud backup deletion applied", {
      epoch: state.epoch,
      wipeLocal: state.wipeLocal,
      wipedAttendance: wiped.attendance,
      wipedReports: wiped.reports,
      initiator,
    })
  }

  async function runCheck(): Promise<"applied" | "noop"> {
    try {
      if (!deps.canCheck()) return "noop"
      const uid = deps.uid()
      if (!uid) return "noop"
      const result = await deps.api.getSyncState()
      if (result.kind !== "ok") {
        deps.log.debug("Backup state check failed — will retry on the next trigger", {
          kind: result.kind,
        })
        return "noop"
      }
      const state = (result as { kind: "ok"; data: BackupState }).data
      if (backupStateAction(state, deps.appliedEpoch.get(uid)) === "noop") return "noop"
      // An account switch while the GET was in flight: this marker belongs to
      // the previous user. Applying it would wipe the new user's data under
      // the old user's instruction. The next trigger re-checks for the new uid.
      if (deps.uid() !== uid) return "noop"
      await apply(state, uid, false)
      return "applied"
    } catch (error) {
      deps.log.error("Applying cloud backup deletion failed — will retry", {
        error: String(error),
      })
      return "noop"
    }
  }

  /**
   * Single-flight: fullSync on foreground and a push 409 routinely land
   * together. Cleared via `.then` on the SAME promise rather than a
   * `finally` inside runCheck — a closed gate returns before any await, so
   * an inner `finally` would run before `inFlight` was even assigned and
   * pin a settled promise forever.
   */
  function checkBackupState(): Promise<"applied" | "noop"> {
    if (inFlight) return inFlight
    const p = runCheck()
    inFlight = p
    void p.then(() => {
      if (inFlight === p) inFlight = null
    })
    return p
  }

  /**
   * The Settings button. Local state changes only after the server confirmed
   * the delete; once it has, the user-facing answer is success even if the
   * local apply throws — the server copy IS gone, and the next
   * checkBackupState() (foreground, fullSync, a push 409) finishes the apply
   * because the epoch was not recorded.
   */
  async function deleteCloudBackup(wipeLocal: boolean): Promise<DeleteCloudBackupResult> {
    if (!deps.canCheck()) return { kind: "unavailable" }
    const uid = deps.uid()
    if (!uid) return { kind: "unavailable" }
    const result = await deps.api.deleteCloudBackup(wipeLocal)
    if (result.kind !== "ok") {
      deps.log.warn("Cloud backup delete failed", { kind: result.kind, wipeLocal })
      return { kind: "failed", problem: result.kind }
    }
    const { deleted, ...state } = (
      result as { kind: "ok"; data: BackupState & { deleted: number } }
    ).data
    deps.log.info("Cloud backup deleted on the server", {
      deleted,
      epoch: state.epoch,
      wipeLocal: state.wipeLocal,
    })
    try {
      await apply(state, uid, true)
    } catch (error) {
      deps.log.error("Cloud backup deleted, but the local apply failed — next check retries", {
        error: String(error),
      })
    }
    return { kind: "ok", wipeLocal: state.wipeLocal }
  }

  return { checkBackupState, deleteCloudBackup }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- app/services/sync/backupDeletionService.test.ts`
Expected: PASS (all 16).

- [ ] **Step 5: Lint**

Run: `npx eslint --fix app/services/sync/backupDeletionService.ts app/services/sync/backupDeletionService.test.ts`

- [ ] **Step 6: Commit**

```bash
git add app/services/sync/backupDeletionService.ts app/services/sync/backupDeletionService.test.ts
git commit -m "✨ feat(sync): backup deletion service — check, ordered apply, delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire it in `services/sync/index.ts`

**Files:**
- Modify: `app/services/sync/index.ts`

**Interfaces:**
- Consumes: `createBackupDeletion` (Task 4), `isWipedAttendance` / `isWipedReport` (Task 1), `api.getSyncState` / `api.deleteCloudBackup` / `api.pushSyncAttendance(records, epoch)` (Task 2), `SyncDeps.checkBackupState` (Task 3).
- Produces: `export const backupDeletion: BackupDeletion`. Settings in Task 6 calls `backupDeletion.deleteCloudBackup(wipeLocal)`.

No automated coverage (this file imports `@/` — see `docs/BACKUP.md`). The logic it calls is covered by Tasks 1 to 4; this task gets verified by hand in Task 7.

- [ ] **Step 1: Imports** — add `attendanceReportRepo` to the `@/db/repositories` import. Add:

```ts
import { resumeUnconfirmedPolls, stopAllPolls } from "@/services/polling/reportPollingService"
```

Add `remove` to the `@/utils/storage` import. Add:

```ts
import { createBackupDeletion } from "./backupDeletionService"
```

Add `isWipedAttendance, isWipedReport` to the `./syncLogic` import.

- [ ] **Step 2: Epoch key helpers** — below `bodyNotFoundKey`, add:

```ts
/**
 * MMKV key for the last cloud-backup deletion epoch this device applied for
 * `uid` (spec 2026-09-28-delete-cloud-backup §3.2). Per uid for the same
 * reason as the cursors: an account switch must not inherit another user's
 * epoch. Every push carries it; the server 409s a stale one.
 */
function appliedEpochKey(uid: string): string {
  return `sync.appliedEpoch.${uid}`
}

function getAppliedEpoch(uid: string): number {
  const n = Number(loadString(appliedEpochKey(uid)) ?? "0")
  return Number.isFinite(n) && n >= 0 ? n : 0
}
```

- [ ] **Step 3: The local wipe** — directly below `unwrap()`, add:

```ts
/**
 * "Delete backup and device data": hard-delete local attendance created, and
 * reports generated, before the deletion. Goes through attendanceSyncWriter —
 * the pull path's bypass — so the mutation hook never fires: enqueueing these
 * as tombstones would push deletions at a backup that no longer exists (and
 * the server would 409 them). Throws if any delete failed so the service does
 * not record the epoch; the next check re-runs the (idempotent) wipe.
 */
async function wipeLocalBefore(deletedAt: number): Promise<{ attendance: number; reports: number }> {
  const rows = unwrap(await attendanceRepo.findAll(), "findAll")
  const reports = unwrap(await attendanceReportRepo.findAll(), "reportFindAll")
  let attendance = 0
  let reportCount = 0
  let failed = 0
  for (const r of rows) {
    if (!isWipedAttendance(r, deletedAt)) continue
    if ((await attendanceSyncWriter.remove(r.id)).ok) attendance++
    else failed++
  }
  for (const r of reports) {
    if (!isWipedReport(r, deletedAt)) continue
    if ((await attendanceSyncWriter.reportRemove(r.id)).ok) reportCount++
    else failed++
  }
  if (failed > 0) throw new Error(`wipeLocalBefore: ${failed} local deletes failed`)
  return { attendance, reports: reportCount }
}
```

- [ ] **Step 4: The service singleton** — directly **above** `const deps: SyncDeps = {`, add:

```ts
/**
 * Cloud-backup deletion (spec 2026-09-28-delete-cloud-backup). Built before
 * `deps` because the engine's checkBackupState dep calls into it; both close
 * over rootStoreRef, so building at module load is safe (a call before
 * initAttendanceSync just sees canCheck() === false).
 */
export const backupDeletion = createBackupDeletion({
  api: {
    getSyncState: () => api.getSyncState(),
    deleteCloudBackup: (wipeLocal) => api.deleteCloudBackup(wipeLocal),
  },
  canCheck: () => {
    const rs = rootStoreRef
    // ownerClearPending: never act for an account whose outbox takeover is
    // unfinished — same hard block as gate().
    if (!rs || ownerClearPending || !getDb().db) return false
    const auth = rs.authenticationStore
    return (
      auth.isAuthenticated &&
      !auth.isAnonymous &&
      !!auth.userId &&
      !rs.networkStore.isOffline &&
      !rs.configStore.maintenanceMode &&
      !rs.configStore.outageMode
    )
  },
  uid: () => rootStoreRef?.authenticationStore.userId ?? "",
  appliedEpoch: {
    get: getAppliedEpoch,
    set: (uid, epoch) => {
      saveString(appliedEpochKey(uid), String(epoch))
    },
  },
  disableSync: () => rootStoreRef?.profileStore.setSyncEnabled(false),
  clearQueue: async () => {
    // Same fail-closed unwrap as deps.queue.clearPending: a surviving row is
    // one the server must never see again.
    unwrap(await syncQueueRepo.clearPending(), "clearPending")
  },
  wipeLocalBefore,
  afterWipe: async (uid) => {
    // The wiped reports' ids are meaningless now; drop the persisted set.
    remove(bodyNotFoundKey(uid))
    // Wiped reports must stop polling; reports generated after the deletion
    // (kept) must keep polling — hence stop-all then resume, the same pair
    // ReportPollingResumer uses on an identity change.
    stopAllPolls()
    void resumeUnconfirmedPolls(uid)
    // "synced" already makes every Attendance list (new / archive / reports)
    // reload — see AttendanceScreen's listeners.
    attendanceEvents.emit({ type: "synced", id: "sync" })
  },
  log: {
    debug: (m, c) => log.debug(m, c as LogAttributes | undefined),
    info: (m, c) => log.info(m, c as LogAttributes | undefined),
    warn: (m, c) => log.warn(m, c as LogAttributes | undefined),
    error: (m, c) => log.error(m, c as LogAttributes | undefined),
  },
})
```

- [ ] **Step 5: Engine deps** — replace Task 3's placeholder with:

```ts
  checkBackupState: () => backupDeletion.checkBackupState(),
```

Replace the `pushAttendance` adapter's call from Task 2 with:

```ts
      // Carries the last deletion epoch this device applied; a stale one is
      // refused with 409 backup_deleted (spec 2026-09-28 §2.4), which the
      // engine hands to checkBackupState. Passed through untouched below.
      const uid = rootStoreRef?.authenticationStore.userId ?? ""
      const result = await api.pushSyncAttendance(records, uid ? getAppliedEpoch(uid) : 0)
```

- [ ] **Step 6: Type-check, lint, deps**

Run: `npm run compile && npx eslint --fix app/services/sync/index.ts && npm run lint:deps && npm run test:unit -- app/services/sync`
Expected: clean; no new depcruise cycle (sync → polling → api/db is one-way); all sync tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/services/sync/index.ts
git commit -m "🔌 feat(sync): wire backup deletion — epoch on push, local wipe, poll restart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Settings row, dialog, i18n (all nine locales)

**Files:**
- Modify: `app/screens/SettingsScreen.tsx` (a module-scope flag; hooks and handlers near `handleSyncToggle` ~L462; JSX in the Cloud Backup section ~L1378–1402)
- Modify: `app/i18n/en.ts`, `es.ts`, `ar.ts`, `de.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `th.ts`, `uk.ts` (after the `backupError:` line in each)

**Interfaces:**
- Consumes: `backupDeletion.deleteCloudBackup(wipeLocal): Promise<DeleteCloudBackupResult>` from `@/services/sync` (Task 5). If `@/services/sync`'s barrel doesn't re-export `backupDeletion`, import it from `@/services/sync/index`, or add it to the barrel beside `attendanceSync`.

- [ ] **Step 1: i18n** — in `app/i18n/en.ts`, directly after `backupError: "Backup issue — will retry",` insert:

```ts
    deleteCloudBackup: "Delete cloud backup",
    deleteCloudBackupHint: "Permanently deletes your attendance backup from RecoverySky's servers",
    deleteCloudBackupConfirmTitle: "Delete cloud backup?",
    deleteCloudBackupConfirmBody:
      "Your attendance backup will be permanently deleted from RecoverySky's servers, and Cloud Backup will be turned off on all your devices.\n\n\"Delete backup and device data\" also erases attendance and reports on this phone and your other devices. This cannot be undone.\n\nReports you've already sent stay on file with RecoverySky as proof of delivery.",
    deleteCloudBackupOnly: "Delete backup",
    deleteCloudBackupAndDevice: "Delete backup and device data",
    deleteCloudBackupDone: "Cloud backup deleted",
    deleteCloudBackupAndDeviceDone: "Cloud backup and device data deleted",
    deleteCloudBackupFailed: "Couldn't delete your cloud backup. Please try again.",
    deleteCloudBackupUnavailable: "Needs a connection to RecoverySky",
    deleteCloudBackupWebConfirm:
      "Delete your cloud backup? It will be permanently deleted from RecoverySky's servers and turned off on all your devices. Reports you've already sent stay on file as proof of delivery.",
    deleteCloudBackupWebWipeConfirm:
      "Also erase attendance and reports on this device and your other devices? This cannot be undone. Choose Cancel to keep them.",
```

Insert the identical English block after `backupError:` in each of the other eight locale files. The review queue is `docs/translation-review-2026-08-03.md`; add a line there listing the 12 new keys.

- [ ] **Step 2: Flag** — at module scope in `SettingsScreen.tsx`, near the other top-level constants:

```ts
/**
 * "Delete cloud backup" needs DELETE /sync/backup + GET /sync/state on the api
 * (spec 2026-09-28-delete-cloud-backup §2), which 404 until that ships. Dev
 * builds show it for testing against a local api; flip to `true` in the
 * first OTA after the api deploy.
 */
const deleteCloudBackupVisible = __DEV__
```

- [ ] **Step 3: State and handlers** — in the `SettingsScreen` component body:
  - If `useNetworkStore()` isn't already called in the component itself (it is only in `SyncStatusLine` at the time of writing), add `const networkStore = useNetworkStore()` next to `const configStore = useConfigStore()`.
  - Import `backupDeletion` (see Interfaces).
  - Directly after `handleSyncToggle`, add:

```tsx
  const [deletingBackup, setDeletingBackup] = useState(false)
  // Same trio every API-dependent Settings row respects (CLAUDE.md "Features
  // that self-disable under maintenanceMode"); the request cannot succeed.
  const backupDeleteUnavailable =
    networkStore.isOffline || configStore.maintenanceMode || configStore.outageMode

  const runDeleteCloudBackup = useCallback(
    async (wipeLocal: boolean) => {
      setDeletingBackup(true)
      try {
        const result = await backupDeletion.deleteCloudBackup(wipeLocal)
        if (result.kind === "ok") {
          trackEvent("cloud_backup_deleted", { wipeLocal })
          showToast({
            tx: result.wipeLocal
              ? "settingsScreen:deleteCloudBackupAndDeviceDone"
              : "settingsScreen:deleteCloudBackupDone",
            type: "success",
          })
        } else {
          showToast({
            tx:
              result.kind === "unavailable"
                ? "settingsScreen:deleteCloudBackupUnavailable"
                : "settingsScreen:deleteCloudBackupFailed",
            type: "error",
          })
        }
      } finally {
        setDeletingBackup(false)
      }
    },
    [showToast],
  )

  const handleDeleteCloudBackup = useCallback(() => {
    // react-native-web's Alert is a no-op, so web gets two plain confirms:
    // "delete the backup?" then "also erase device data?" (Cancel = keep it).
    if (Platform.OS === "web") {
      if (!window.confirm(translate("settingsScreen:deleteCloudBackupWebConfirm"))) return
      const wipeLocal = window.confirm(translate("settingsScreen:deleteCloudBackupWebWipeConfirm"))
      void runDeleteCloudBackup(wipeLocal)
      return
    }
    Alert.alert(
      translate("settingsScreen:deleteCloudBackupConfirmTitle"),
      translate("settingsScreen:deleteCloudBackupConfirmBody"),
      [
        { text: translate("common:cancel"), style: "cancel" },
        {
          text: translate("settingsScreen:deleteCloudBackupOnly"),
          style: "destructive",
          onPress: () => void runDeleteCloudBackup(false),
        },
        {
          text: translate("settingsScreen:deleteCloudBackupAndDevice"),
          style: "destructive",
          onPress: () => void runDeleteCloudBackup(true),
        },
      ],
    )
  }, [runDeleteCloudBackup])
```

- [ ] **Step 4: JSX** — in the Cloud Backup section:
  - Change the toggle row's style from `[themed($settingsRow), themed($lastRow)]` to `[themed($settingsRow), !deleteCloudBackupVisible && themed($lastRow)]`.
  - Directly after that row's closing `</View>`, still inside the section, add:

```tsx
          {/* Shown whether or not the toggle is on — a paused backup still
              has data on the server. Destructive styling matches the Account
              section's delete rows. */}
          {deleteCloudBackupVisible && (
            <TouchableOpacity
              style={[
                themed($deleteRow),
                themed($lastRow),
                (backupDeleteUnavailable || deletingBackup) && $dimmedRow,
              ]}
              onPress={handleDeleteCloudBackup}
              disabled={backupDeleteUnavailable || deletingBackup}
              accessibilityRole="button"
              accessibilityLabel={translate("settingsScreen:deleteCloudBackup")}
              accessibilityHint={translate(
                backupDeleteUnavailable
                  ? "settingsScreen:deleteCloudBackupUnavailable"
                  : "settingsScreen:deleteCloudBackupHint",
              )}
              accessibilityState={{
                disabled: backupDeleteUnavailable || deletingBackup,
                busy: deletingBackup,
              }}
            >
              <Icon icon="x" size={18} color={themed($dangerColor).color} />
              <View style={$styles.flex1}>
                <Text style={themed($deleteText)} tx="settingsScreen:deleteCloudBackup" />
                {backupDeleteUnavailable && (
                  <Text style={themed($rowHint)} tx="settingsScreen:deleteCloudBackupUnavailable" />
                )}
              </View>
              {deletingBackup ? (
                <ActivityIndicator size="small" color={themed($dangerColor).color} />
              ) : (
                <Icon icon="caretRight" size={16} color={themed($dangerColor).color} />
              )}
            </TouchableOpacity>
          )}
```

- [ ] **Step 5: Type-check and lint**

Run: `npm run compile && npx eslint --fix app/screens/SettingsScreen.tsx app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts && npm test`
Expected: compile clean (a key missing from any locale is a hard `tsc` error); both runners green.

- [ ] **Step 6: Smoke in a dev build** — `npm run ios`, sign in with an attendance-entitled account, open Settings → Cloud Backup, and check:
  - the row renders under the toggle;
  - VoiceOver reads the label and hint;
  - with airplane mode on, the row is dimmed with the "Needs a connection" hint;
  - tapping it shows the three-button dialog.

The API endpoints don't exist yet, so a confirm should land on the **failed** toast with nothing local changed. That itself is Review Focus #3 in the real app.

- [ ] **Step 7: Commit**

```bash
git add app/screens/SettingsScreen.tsx app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts docs/translation-review-2026-08-03.md
git commit -m "✨ feat(settings): Delete cloud backup row (flagged until the api ships)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, changelog, manual checklist

**Files:**
- Modify: `docs/BACKUP.md`, `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/BACKUP.md`**
  - Add rows to the Files table:
    - `app/services/sync/backupDeletionService.ts`: cloud-backup deletion check / apply / delete (DI factory, vitest).
    - `app/services/api/backupDeletedLogic.ts`: parsers for the 409 and the state body.
  - Add trigger 7 under "Triggers": "`fullSync()` / `initialBackup()` first run `checkBackupState()`, and so does a push refused with 409 `backup_deleted`."
  - Add a section **"Deleting the backup"** covering:
    - it's a hard delete on the server, never tombstones;
    - server reports are never deleted and are hidden from the user forever after a wipe;
    - the epoch, and `sync.appliedEpoch.<uid>`;
    - the order of an apply (sync off → clear queue → wipe → save epoch last);
    - why the check ignores `syncEnabled`;
    - the local wipe keeps anything created after the deletion;
    - the link to the spec.
  - Append the spec's §4 manual checklist items 1–6 to the manual test checklist, verbatim.

- [ ] **Step 2: `CHANGELOG.md`** — under `## [Unreleased]` → `### Added`:

```markdown
- **Delete cloud backup** (Settings → Cloud Backup): permanently deletes the attendance backup from RecoverySky's servers and turns Cloud Backup off on every device; optionally also erases local attendance and reports on all of the user's devices. Sent reports stay on file server-side as proof of delivery and are never shown to the user again after a wipe. Offline devices can't resurrect a deleted backup — the server refuses their stale pushes. Hidden behind a flag until the api's `DELETE /sync/backup` / `GET /sync/state` ship.
```

- [ ] **Step 3: `CLAUDE.md`** — add this bullet to the "Attendance Cloud Backup & Sync" load-bearing facts:

```markdown
- ADDED 2026-09-29: **every push carries the deletion epoch** (`sync.appliedEpoch.<uid>`) and
  the server 409s a stale one. `backupDeletionService.ts` applies a newer marker in a fixed
  order — sync off, clear outbox, optional wipe (via `attendanceSyncWriter`, never the hooked
  repo), epoch saved LAST — and its check deliberately ignores `syncEnabled`. Server reports
  are never deleted; spec `docs/superpowers/specs/2026-09-28-delete-cloud-backup-design.md`.
```

- [ ] **Step 4: Full verification**

Run: `npm run compile && npm run lint:deps && npm test`
Expected: all green. Record the output in the PR / commit notes.

- [ ] **Step 5: Commit**

```bash
git add docs/BACKUP.md CHANGELOG.md CLAUDE.md
git commit -m "📝 docs(sync): delete cloud backup — BACKUP.md, changelog, CLAUDE.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The spec §4 manual checklist (two devices, offline 409, wipe with backup off, post-deletion record kept, no report ever reappears) **can only run once the api side is deployed**. Leave it unchecked in `docs/BACKUP.md` and note that in the PR.
