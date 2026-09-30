# Delete my cloud backup

**Date:** 2026-09-28
**Status:** **TABLED 2026-09-30 — not started.** Jenova parked the feature after the spec and
plan (`docs/superpowers/plans/2026-09-29-delete-cloud-backup.md`) were written. Nothing is
implemented in `app`, `api` or `common`. To resume: re-read this spec, re-confirm the decisions
with Jenova, build §2 on the api first, then execute the plan. (Originally: spec approved in chat
2026-09-28.)
**Repos touched:** `app` (this spec's implementation), `api` + `common` (contract in §2 —
**specified here only; nothing in `../api` is changed by this work**).
**Origin:** Jenova, 2026-09-28: "we need to add a 'delete my cloud backup' button to Settings
Cloud Backup".
**Required reading first:** `docs/BACKUP.md` (the sync engine this plugs into).

## Why

Cloud Backup (Settings → Cloud Backup, opt-in, attendance entitlement) copies a user's
attendance to the server and syncs it across their devices. Today the only way out is the
toggle, and toggling OFF is pause-only — the server keeps everything. Users want the button for
two reasons, and the design serves both:

- **Privacy** — get my attendance history off RecoverySky's servers.
- **Fresh start** — my backup is a mess (old account data, duplicates); wipe it and optionally
  re-back-up from this device later.

## Decisions (settled in the brainstorm — do not re-derive)

1. **Hard delete, never tombstones.** A tombstone (`deleted: true`) is how sync propagates a
   *user's deletion of a record* — every other device that pulls it deletes its local copy.
   Deleting the backup must not do that implicitly; local wipes happen only when the user asks
   for them (decision 3), through the marker (decision 4).
2. **Server attendance reports are never deleted.** They are RecoverySky's record of what was
   sent to supervision — proof of delivery. They are corporate data, not the user's backup.
3. **The dialog offers an optional local wipe.** "Delete backup" deletes the server copy and
   turns backup off everywhere. "Delete backup and device data" additionally deletes local
   attendance **and** local reports on every one of the user's devices.
4. **A server-side deletion marker drives every device.** One per user: an `epoch` counter
   bumped by each delete, plus the `deletedAt` / `wipeLocal` of the latest delete. Devices
   apply a marker whose epoch is newer than the one they last applied.
5. **Stale pushes are refused by the server.** Every push carries the client's epoch; a stale
   one gets `409 backup_deleted`. Enforcement lives on the server so an offline device, or an
   old app version, cannot resurrect deleted rows.
6. **Corporate data is never re-served to a user after a wipe.** Once a wipe hides a report
   from the user, it stays hidden — re-enabling Cloud Backup, a later delete without a wipe,
   a new device, or a reinstall never brings it back. Every user-facing report endpoint
   enforces this (§2.5), not just the sync pull.
7. **A local wipe keeps anything created after the deletion.** A device that was offline for a
   week must not lose meetings logged during that week.
8. **The marker check is not gated on `syncEnabled` or the entitlement.** A device with backup
   turned off still honours a wipe the user asked for.

## 1. User experience

### 1.1 The row

Settings → Cloud Backup, below the toggle and `SyncStatusLine`: a destructive-styled row
**"Delete cloud backup"**, shown whenever the Cloud Backup section is shown (the section is
already gated on `hasAttendance`), regardless of whether the toggle is on — a user who paused
backup still has data on the server.

- Disabled while `networkStore.isOffline`, `configStore.maintenanceMode` or
  `configStore.outageMode` (the request cannot succeed; see CLAUDE.md "Features that
  self-disable under maintenanceMode"). The disabled row shows a one-line hint why.
- Disabled while a delete is in flight (spinner in place of the chevron).
- A11y: `accessibilityRole="button"`, label = row title, hint = what it does,
  `accessibilityState={{ disabled }}`.
- Hidden behind `deleteCloudBackupVisible` (a local `const`, same pattern as
  `agentTabVisible`) until the API contract in §2 is deployed — the endpoint 404s until then.
  `__DEV__ ||` it for development against a local API.

### 1.2 The dialog

`Alert.alert` with three buttons (supported on iOS and Android):

| Button | Style | Action |
| --- | --- | --- |
| Cancel | `cancel` | nothing |
| Delete backup | `destructive` | `deleteCloudBackup({ wipeLocal: false })` |
| Delete backup and device data | `destructive` | `deleteCloudBackup({ wipeLocal: true })` |

Body copy must say, in plain words:
- Your attendance backup will be permanently deleted from RecoverySky's servers.
- Cloud Backup will be turned off on all your devices.
- "Delete backup and device data" also erases attendance and reports on this phone and your
  other devices. This cannot be undone.
- Reports you've already sent stay on file with RecoverySky as proof of delivery.

**Web fallback** (`Alert` is a no-op on react-native-web — see "Permissions & the Location
Gate"): `window.confirm` for "Delete backup?", then a second `window.confirm` for "Also erase
attendance and reports on your devices?".

### 1.3 After

- Success: toast "Cloud backup deleted" (or "Cloud backup and device data deleted"); the toggle
  reads OFF; if wiped, the Attendance tab reloads empty (minus post-deletion records — none, on
  the initiating device).
- Failure: toast with the generic error; nothing local changes (the local steps run only after
  the server confirms — §3.2).
- Re-enabling the toggle later behaves like a first enable: `initialBackup()` re-pushes
  whatever is local, stamped with the new epoch.

### 1.4 i18n

New keys under `settingsScreen:` in **all nine** locale files (English placeholder text is
acceptable in the other eight — see CLAUDE.md "Internationalization"):
`deleteCloudBackup`, `deleteCloudBackupHint`, `deleteCloudBackupConfirmTitle`,
`deleteCloudBackupConfirmBody`, `deleteCloudBackupOnly`, `deleteCloudBackupAndDevice`,
`deleteCloudBackupDone`, `deleteCloudBackupAndDeviceDone`, `deleteCloudBackupFailed`,
`deleteCloudBackupUnavailable`, plus the two web-confirm strings.

## 2. API contract (for `../api` + `../common` — not implemented by this work)

Written against `api/src/routes/sync.ts` as of 2026-09-28. All new routes live in that router
and follow its conventions: `authenticateSignedIn` then `deviceAuth`, `createRateLimiter()` on
writes, zod-validated input answered with `badRequest(...)` →
`{ error: kind, message }`, `uid = req.user!.sub` (never from the wire), errors logged with
`summarizeError(...)` and `userId: hashUserId(uid)` — never raw subs.

### 2.1 Storage

New Postgres table in `common` (drizzle, `pg/`), one row per user, created lazily:

```ts
// sync_backup_state
uid                    text     primary key
epoch                  integer  not null default 0
deleted_at             bigint   not null default 0   // ms epoch of the latest delete
wipe_local             boolean  not null default false // of the latest delete
reports_hidden_before  bigint   not null default 0   // ms; MONOTONIC — see below
updated                bigint   not null
```

`reports_hidden_before` only moves forward: a wipe sets it to
`GREATEST(reports_hidden_before, deleted_at)`; a delete without a wipe leaves it alone. Nothing
ever lowers it (decision 6).

Plus `AttendanceRepository.deleteAllForUid(uid): Result<number>` — a hard `DELETE ... WHERE
uid = $1` returning the row count — and a small `SyncBackupStateRepository`
(`get(uid)`, `recordDeletion(uid, wipeLocal, now)` returning the new state).

### 2.2 `DELETE /sync/backup`

```
DELETE /sync/backup?wipeLocal=true|false
  middleware: authenticateSignedIn, deviceAuth, createRateLimiter()
  query:      z.object({ wipeLocal: z.enum(["true","false"]).default("false")
                           .transform(v => v === "true") })
  200 { deleted: number, epoch: number, deletedAt: number, wipeLocal: boolean }
  400 { error: "bad_request", message }       invalid query
  500 { error: "internal", message }          transaction failed — nothing changed
```

In **one transaction**: `deleteAllForUid(uid)` on `attendances`, then `recordDeletion` (epoch
+1, `deleted_at = now`, `wipe_local`, `reports_hidden_before` per §2.1). `now` is server
`Date.now()` — the same clock that stamps `attendances.updated` on push. Logged at info:
`{ userId, deviceId, deleted, epoch, wipeLocal }`, "Cloud backup deleted".

Idempotent in effect: a retry after a lost response deletes nothing new and bumps the epoch
again, which every device (including the caller) simply applies.

### 2.3 `GET /sync/state`

```
GET /sync/state
  middleware: authenticateSignedIn, deviceAuth
  200 { epoch: number, deletedAt: number, wipeLocal: boolean }
```

A user with no row gets `{ epoch: 0, deletedAt: 0, wipeLocal: false }`. `reports_hidden_before`
is not exposed; it is server-side policy.

### 2.4 `POST /sync/attendance` — epoch check

`syncPushSchema` gains `epoch: z.number().int().nonnegative().optional()`. Before validating
records: if `(body.epoch ?? 0) < state.epoch`, answer

```
409 { error: "backup_deleted", message, epoch: <current> }
```

and write nothing. A missing `epoch` counts as 0, so old app versions cannot push into an
account whose backup was deleted (their push fails and backs off; acceptable — the user who
deleted is on a new version by definition). A user with no state row is epoch 0 and unaffected.

### 2.5 Hidden reports — every user-facing report endpoint

A report is **hidden** when its `generated < reports_hidden_before` for its owner. Hidden
reports are answered exactly as a report owned by someone else — the existing ownership-miss
answer, a 404 (reports.ts: "404 rather than 403 — a 403 confirms the id names a real report"):

| Endpoint | Hidden-report behaviour |
| --- | --- |
| `GET /sync/reports` | omitted from the page (filter in the query, so paging and `hasMore` stay correct) |
| `GET /reports/:id` | 404 |
| `POST /reports/status` | 404 for that id |
| `POST /reports` resend / error-resend / forward (`fid`) of a hidden id | 404 |
| `POST /reports/confirmation` (Postmark webhook) | **unchanged** — delivery proof keeps updating |

Nothing is ever deleted from `attendance_reports`.

## 3. App: applying a deletion

### 3.1 Pure logic (`app/services/sync/syncLogic.ts`, vitest)

```ts
interface BackupState { epoch: number; deletedAt: number; wipeLocal: boolean }

/** "apply" when the server epoch is newer than the last one this device applied. */
backupStateAction(server: BackupState, appliedEpoch: number): "apply" | "noop"

/** Local rows a wipe removes: created strictly before the deletion (decision 7). */
isWipedAttendance(row: { created: number }, deletedAt: number): boolean
isWipedReport(row: { generated: number }, deletedAt: number): boolean

/** 409 body recogniser for the push path. */
isBackupDeletedRejection(status: number | undefined, body: unknown): BackupState["epoch"] | null
```

`created` / `generated` are device-clock millis while `deletedAt` is server-clock; a skewed
device clock shifts the wipe boundary by the skew. Accepted: the boundary only matters for
records logged within minutes of the delete, and the server-side report hiding (§2.5) uses the
server's own `generated` and `deleted_at` stamps, so corporate data is unaffected.

`appliedEpoch` absent → 0, so a fresh install applies the current marker. That is safe: sign-in
precedes any local data (guest mode holds none), so a wipe on a fresh install removes nothing.

### 3.2 `applyBackupDeletion(state)` (`app/services/sync/index.ts`)

Order is load-bearing:

1. `profileStore.setSyncEnabled(false)` — closes the gate before anything else can push.
2. Clear `sync_queue`. Those rows are exactly what would resurrect deleted data.
3. If `state.wipeLocal`:
   - delete local attendance rows with `isWipedAttendance` and local reports with
     `isWipedReport`, **through the non-enqueuing writer path** (extend
     `attendanceSyncWriter`) — the mutation hook must not fire, or step 2 is undone;
   - `stopAllPolls()` (report delivery polling) and remove `sync.bodyNotFound.<uid>`;
   - emit `attendanceEvents` (`"archived"`/`"produced"` as appropriate) so Attendance, reports
     and 90-in-90 views reload.
4. Save MMKV `sync.appliedEpoch.<uid> = state.epoch` — **last**, so a crash mid-apply re-runs
   the whole thing on the next check (every step is idempotent).
5. Log info `"Cloud backup deletion applied"` `{ epoch, wipeLocal, wipedAttendance,
   wipedReports, initiator: boolean }` — counts only.

Pull cursors are left as they are: server attendance is empty, and hidden reports are filtered
server-side, so no cursor trick is needed (and none would survive a reinstall anyway).

The **initiating** device calls `DELETE /sync/backup`; on 200 it calls `applyBackupDeletion`
with the response. On any failure it changes nothing locally.

### 3.3 When devices check (`checkBackupState()`)

`GET /sync/state` → `backupStateAction` → `applyBackupDeletion` when `"apply"`. Runs:

- cold start, **after** boot reconciliation's `takeQueueOwnership` (see BACKUP.md "Queue
  ownership" — registration order matters);
- app foreground;
- at the start of `fullSync()`, before the first push;
- on a push `409 backup_deleted` (then the tick ends; no retry of that batch).

Its own gate: signed in, not anonymous, non-empty `userId`, online, not `maintenanceMode` /
`outageMode`, no ownership clear pending. Deliberately **not** `syncEnabled` or the entitlement
(decision 8). Single-flight, so foreground + `fullSync` collapse into one request. Failures are
logged at debug and retried at the next trigger; they never block `fullSync` beyond that tick.

### 3.4 Push carries the epoch

`pushSyncAttendance(records)` sends `{ records, epoch: appliedEpoch }`. The API method gains a
`{ kind: "backup-deleted", epoch }` result for the 409 so the engine can hand off to §3.3
without treating it as a transport failure (it is not retryable — see `isRetryableProblem()`).

### 3.5 API methods (`app/services/api/index.ts`)

- `deleteCloudBackup(wipeLocal: boolean)` →
  `{ kind: "ok"; data: BackupState & { deleted: number } } | GeneralApiProblem`
- `getSyncState()` → `{ kind: "ok"; data: BackupState } | GeneralApiProblem`

Both go through the normal token freshness gate.

## 4. Testing

- **Vitest** (`syncLogic.test.ts`): `backupStateAction` (newer / equal / older / absent
  applied), the two wipe predicates at the boundary (`created === deletedAt` is kept),
  `isBackupDeletedRejection` on 409 bodies with and without `epoch`, and on non-409s.
- **Manual** (add to `docs/BACKUP.md`'s checklist): 
  1. one device, delete backup only → toggle off, local data intact, server empty;
  2. two devices, A deletes → B turns off on next foreground;
  3. B offline with a queued edit while A deletes → B's push gets 409, queue cleared, the edit
     is not on the server;
  4. A deletes with wipe while B has backup **off** → B wipes on next foreground;
  5. B logs a meeting offline after A's wipe → B keeps it;
  6. after a wipe, re-enable backup on any device → no pre-wipe report ever reappears;
     reinstall and sign in → same.
- `app/services/sync/index.ts` has no automated coverage by design (BACKUP.md).

## 5. Docs, changelog, release

- `docs/BACKUP.md`: new section "Deleting the backup" (marker, epoch, 409, hidden reports) and
  a row in the Files table; update "Triggers" with `checkBackupState()`.
- `CHANGELOG.md` `[Unreleased]` → Added.
- CLAUDE.md "Attendance Cloud Backup & Sync": one bullet on the epoch/409 invariant.
- JS-only: **no `runtimeVersion` bump**. Ships as an OTA once §2 is deployed; the
  `deleteCloudBackupVisible` flag stays false until then.

## Out of scope

- Implementing §2 in `../api` / `../common`.
- Deleting reminders, chat, profile, or the Auth0 account (that is "Delete User Data" /
  account deletion).
- Any user-visible listing of hidden reports.
