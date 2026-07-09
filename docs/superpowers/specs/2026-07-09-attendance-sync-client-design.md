# Attendance Cloud Backup & Multi-Device Sync — Client Design

**Date:** 2026-07-09
**Status:** Approved (brainstorming complete)
**API reference:** the server `/sync` endpoints, documented in the API repo's
attendance-sync doc (`POST /sync/attendance`, `GET /sync/attendance`,
`GET /sync/reports`). Server design spec:
`docs/superpowers/specs/2026-07-08-attendance-sync-design.md` (API repo).

## Summary

Attendance records are created locally on-device and historically only reached
the server inside emailed reports. This feature adds **opt-in continuous cloud
backup** of attendance records and **cursor-based incremental pull** so a
second device (or a reinstall) can reconstruct full history and stay current.
Reports flow **down only** — they are created server-side by `POST /reports`;
a second device pulls their metadata and then fetches every body during sync,
so it ends up with a complete local copy.

## Product decisions (settled during brainstorming)

| Decision | Choice |
|---|---|
| Who gets sync | Gated on the **`recoverysky-attendance`** RevenueCat entitlement (`useSubscription().hasAttendance`) |
| Anonymous users | Cannot sync (API returns `403` — requires Auth0 identity). Not a real state: the attendance purchase flow forces sign-in, so `hasAttendance` implies signed-in. A defensive `!isAnonymous` check stays in the gate but should never fire. |
| Opt-in model | **Settings toggle, default OFF** (`profileStore.syncEnabled`). Attendance data is sensitive — it reveals meeting attendance — so backup is explicit consent, not automatic. |
| Toggle OFF semantics | **Pause only.** Stop ticks; keep the outbox queue, cursors, and all server-side data. Re-enabling re-runs initial backup (idempotent, self-healing). No server wipe in v1. |
| Reports | Pull-only. Never pushed by the app. `GET /sync/reports` returns metadata only, so sync then fetches each missing body via `GET /reports/:id` **during the sync pass** — a synced device ends up with a complete local copy, and report detail views never hit the network. **CHANGED 2026-07-09:** originally specified as lazy-fetch-on-open; corrected because a second device must hold the full dataset (offline-complete), not a metadata shell. |
| Triggers | Event-driven push (debounced) + pull on cold start / foreground resume / Attendance screen focus. **No polling interval, no OS background tasks** (none exist in this app). |
| Initial backup UX | Fire-and-forget with a status line in Settings ("Backing up…" → "All backed up ✓ · <time>"). No blocking UI. |
| Conflicts | Accept the API's last-arrived-wins (server-stamped `updated`). No client-side conflict surfacing in v1. |

## API verification result

The `/sync` API supports everything the client needs — no API changes
required. Verified:

- Every field of the server `attendanceRecordSchema` exists locally.
  `@recoverysky-org/common@1.20.2` (installed) added `updated` (default `1`)
  and `deleted` (default `0`) to both `attendances` and `attendance_reports`
  via client SQLite migrations `0049`/`0050`; model types expose
  `updated: number` / `deleted: boolean`.
- Client-generated IDs round-trip (proven by the Firebase-import path, which
  writes server records via `attendanceRepo.create({ id })`).
- Push is idempotent; `rejected: "stale"` means "server already newer" and is
  success for our purposes.
- Rate limits (200/batch, 10 req/min) allow a multi-year history to back up
  in minutes when paced (~7 s between batches).
- `uid` is server-stamped from the Auth0 `sub`; signed-in users'
  `authStore.userId` **is** the Auth0 sub, and the Attendance screen loads by
  `findUnproduced()`/`findArchived()` (not uid-filtered), so pulled records
  render without normalization work. Pull-merge overwriting local `uid` with
  the server value quietly fixes legacy anonymous-era rows
  (`uid = deviceId`).

## Architecture

### Chosen approach (Option C of three considered)

Reuse the **existing, dormant `sync_queue` SQLite table** (already migrated,
already wrapped as `syncQueueRepo` in `app/db/repositories.ts:103`) as a
durable outbox — but write a **fresh processor** purpose-built for `/sync`
semantics. The old `SyncService` class (client-wins, push-only,
meetings/schedules-only, never instantiated) stays untouched and dead; do not
extend it.

Rejected alternatives: (A) reviving `SyncService` — wrong conflict model and
API shape, would be a rewrite wearing a reuse costume; (B) an MMKV
"pending ids" set — reinvents outbox bookkeeping the SQL table already has,
with worse durability and debuggability.

### Components

**`app/services/sync/syncLogic.ts`** — pure logic, **zero `@/` runtime
imports** (type-only imports OK) so it unit-tests without path-alias setup:

- `toServerRecord(local)` — local repo shape → API `attendanceRecordSchema`
  (booleans stay booleans; `events` already a parsed array; tombstones built
  from a queue payload snapshot get `deleted: true`).
- `mergePullDecision(pulled, { hasPendingPush, existsLocally })` →
  `"skip-dirty" | "tombstone-delete" | "update" | "create"`.
- `mergeReportFields(pulled, local)` — metadata merge that **preserves** local
  `html`, `text`, `messageId`, `retry` (server never sends them).
- `chunk(records, 200)` — push batching.

**`app/services/sync/attendanceSyncService.ts`** — orchestrator singleton:

- `pushTick()`, `pullTick("attendance" | "reports")`, `backfillReportBodies()`,
  `initialBackup()`.
- Gate: `profileStore.syncEnabled && hasAttendance && !isAnonymous &&
  isAuthenticated && !configStore.maintenanceMode && !networkStore.isOffline`.
  Checked at every tick **and between push batches** (sign-out mid-drain).
- `syncState` — a plain-MobX observable
  `{ phase: "idle" | "backing-up" | "syncing" | "error", lastSyncedAt,
  pendingCount }` consumed by Settings via `observer()`. Plain MobX, not a new
  event bus, per the house "MobX, not an event bus" doctrine.
- Exponential backoff floor on consecutive failures (30 s → 1 min → 5 min,
  reset on success).

**API methods** (`app/services/api/index.ts`, house discriminated-union +
`waitForAttestation()` pattern):

- `pushSyncAttendance(records)` → `{ kind: "ok", accepted, rejected } |
  GeneralApiProblem`
- `pullSyncAttendance(since, limit?)` → `{ kind: "ok", records, cursor,
  hasMore } | GeneralApiProblem`
- `pullSyncReports(since, limit?)` — same envelope.

**Outbox enqueue choke point** — the `attendanceRepo` wrappers in
`app/db/repositories.ts` (`create`, `update`, `markProcessed`, `markProduced`,
`markArchived`, `addEvent`, `delete`). After a successful mutation, if
`syncEnabled`, enqueue `{ table_name: "attendances", record_id, operation }`.
This covers every mutation site in the app (externalAttendance,
useReportSender, AttendanceScreen edits/soft-deletes, NinetyInNinetyCard,
future ones) with zero call-site changes.

- Queue rows carry **`record_id` only**; current row data is read at push time
  (`findByIds`), so N offline edits collapse into one push of final state
  (correct under server LWW).
- **Exception — hard `delete`:** snapshot the full row into the queue
  `payload` *before* deleting; the snapshot becomes the `deleted: true`
  tombstone push. (`NinetyInNinetyCard.tsx:194` is the only hard-delete site
  today.)
- The pull-merge path writes via the underlying repo directly (bypassing the
  wrappers) so pulled records never re-enqueue themselves.

**State & persistence:**

- `ProfileStore`: new `syncEnabled: false` prop + `setSyncEnabled` action
  (MMKV-persisted snapshot prop, like `attendanceEnabled`).
- MMKV keys, **per account** (`<uid>` = `authStore.userId`):
  `sync.cursor.attendance.<uid>`, `sync.cursor.reports.<uid>`,
  `sync.lastSyncedAt.<uid>`. Cursors are opaque server values — persisted and
  echoed back, never computed client-side.

**Settings UI** (`SettingsScreen.tsx`): a Cloud Backup section, visible when
`hasAttendance` — `Switch` bound to `syncEnabled` plus a status line rendered
from `syncState`: "Backing up…" / "All backed up ✓ · 2:14 PM" /
"Paused — offline" / "Backup issue, will retry". Toggle ON →
`initialBackup()`. Toggle OFF → pause only.

**Trigger wiring:**

- `attendanceEvents` subscription + enqueue nudge → debounced (~3 s)
  `pushTick()`.
- Cold start (post-bootstrap, after auth/config ready) and `AppState` resume →
  `pullTick()` both resources + `pushTick()`.
- Attendance screen focus → `pullTick()` for both resources (the Reports
  tab lives inside the Attendance screen).
- MobX `reaction` on the gate (maintenance/offline/auth clearing) → catch-up
  tick.
- New `attendanceEvents` type **`"synced"`** emitted after a merge that
  changed rows, so AttendanceScreen / badges / charts reload.

## Data flow

### Push

1. Mutation → wrapper success → enqueue → nudge service.
2. Debounced `pushTick()`: gate → `getPending(maxRetries)` → dedupe ids →
   `findByIds` → `toServerRecord` → chunks of ≤200 → `POST /sync/attendance`,
   paced ~7 s apart when multiple batches.
3. Per-record result: `accepted` or `rejected:"stale"` → `markSynced`;
   `rejected:"invalid"` → `markFailed` + Sentry log (client bug — schema
   drift; `getPending`'s `maxRetries` fences infinite retry). Whole-request
   failure → nothing marked; entries stay pending for the next trigger.

### Pull

1. Gate → `GET /sync/<resource>?since=<cursor>` → page while `hasMore`.
2. Per record, `mergePullDecision`:
   - pending queue entry → **skip** (our local edit pushes later, wins LWW);
   - `deleted: true` → hard-delete locally (bypass);
   - exists → bypass `update`, full overwrite including server
     `uid`/`updated`;
   - new → bypass `create` with server `id`.
   Reports use `mergeReportFields` (preserve local body fields).
3. Persist cursor **after each fully-merged page** — a killed app resumes at
   the right page; re-merging a page is idempotent and safe.
4. Changed rows → emit `attendanceEvents` `"synced"`.

### Report body backfill (runs after every reports pull)

`GET /sync/reports` is metadata-only, so a pulled report initially has an
empty `html`/`text`. `backfillReportBodies()` closes that gap so a synced
device holds the complete dataset and the report detail view never needs the
network:

1. Ask local storage for every report id with an empty body
   (`reportsMissingBody()`).
2. For each, `GET /reports/:id` → persist `html`/`text`
   (`reportSaveBody(id, html, text)`), paced ~300 ms apart.
3. A failed fetch is logged and left alone — the report simply stays in the
   missing-body set and the next sync retries it.

**Deliberately decoupled from the cursor.** The backfill is driven by local
state ("which rows lack a body?"), not by the pull cursor, so a body fetch
that fails can never strand the cursor, and a device interrupted mid-backfill
resumes naturally on its next sync. It is idempotent and safe to run on every
sync pass.

This is also why `reportToLocalUpdate` still omits `html`/`text` (see the pure
module above): the metadata pull must never overwrite a body we already hold.

### Initial backup (toggle ON)

1. `syncState.phase = "backing-up"`.
2. Full pull of both resources (existing cursor or `0`) — same code path as
   any pull — then `backfillReportBodies()`.
3. Enqueue **every** local attendance row (`findAll`), then drain via paced
   `pushTick()`. No diffing against the pull — pushing everything is safe
   under LWW (per the API doc's explicit guidance).
4. Queue empty → `phase = "idle"`, stamp `lastSyncedAt`.
5. Interrupted mid-way: the queue is durable SQL and the backfill is driven by
   local state; the next launch's ticks resume both. No special resume logic.

**`phase` never sticks.** Every tick restores the steady-state phase in a
`finally` (→ `"error"` when at/after the second consecutive failure, else
`"idle"`), and `initialBackup()` holds `"backing-up"` via a flag that its own
`finally` clears. An early return — closed gate, active backoff, reentrancy —
therefore cannot strand the Settings status line mid-"Backing up…".

## Edge cases

- **Hard delete offline** → payload-snapshot tombstone (above).
- **Soft delete** (`valid: false`), edits, archive → ordinary field pushes.
- **Two devices edit offline** → API last-arrived-wins; accepted tradeoff.
- **Account switch on one device** → cursors are per-uid; **on logout, clear
  the pending sync queue** — never push user A's records under user B's token
  (the server would stamp them with B's uid). Mixed-account rows in local
  SQLite are pre-existing app behavior, out of scope.
- **Toggle OFF → ON** → re-run `initialBackup()`; idempotent.
- **maintenanceMode / offline** → ticks early-return (house pattern for
  API-dependent features); gate reaction fires catch-up when it clears.
- **Sign-out mid-push** → gate re-checked between batches.
- **Overlapping ticks** → `pushTick`/`pullTick` set their in-flight flag
  **synchronously, before the first `await`**, and clear it in `finally`. The
  guard is worthless if set after awaiting the gate: two callers (a debounced
  `nudgePush` and a resume-triggered `fullSync`) would both observe
  `pushing === false` and drain the outbox concurrently.
- **Local edit during a pull merge** → the dirty check is re-read immediately
  before each record's write, not snapshotted once per page. Otherwise a record
  edited mid-page is not seen as dirty, the older server copy overwrites the
  user's edit, and the queue then pushes the clobbered row and marks it
  synced — silent data loss. (A one-await residual window remains; a write that
  is clobbered anyway is logged as an error rather than passing silently.)

## Error handling

- **Network/server problems** (timeout, cannot-connect, 5xx, 429): entries
  stay pending; next natural trigger retries, subject to the backoff floor.
  `phase = "error"` only after repeated consecutive failures (no flicker).
- **401/403**: theoretically unreachable behind the gate — pause ticks, Sentry
  log with auth-state snapshot, status line "Backup issue, will retry".
  **Never clear the queue on auth errors.**
- **`rejected:"invalid"`**: `markFailed` + Sentry log; no user-facing error;
  rest of batch unaffected (API validates per-record).
- **Pull-merge failure on one record**: log, skip, **do not advance the cursor
  past that page**; next pull retries the page (idempotent).
- **Invariant:** the cursor advances only after a page fully merges; queue
  entries clear only on server-confirmed `accepted`/`stale`. There is no path
  where a record is dropped between "user did it" and "server confirmed it".

## Testing

- **Unit — `syncLogic.test.ts`** (pure module, no alias setup needed):
  `toServerRecord` field mapping incl. tombstone-from-snapshot;
  `mergePullDecision` all four outcomes; `mergeReportFields` body
  preservation; `chunk` at 0 / 200 / 201.
- **Unit — orchestrator** with mocked `api` + repos: response dispatch
  (accepted / stale / invalid / problem), gate short-circuits,
  cursor-advance-only-on-success, logout-clears-queue.
- **Manual e2e checklist** (goes in the implementation plan): two simulators,
  one account — record on A appears on B after resume; edit / delete
  propagation both ways; toggle-ON initial backup of a seeded history;
  airplane-mode edits reconcile on reconnect; maintenance mode pauses and
  auto-resumes.

## Out of scope (v1)

- Server-side wipe on toggle-off (pause only; revisit if users ask).
- Conflict surfacing UI (LWW is silent).
- OS background sync (no background-task infra in the app).
- Meetings/schedules sync (the old `SyncService` scaffold's original targets).
- Paywall upsell on the Cloud Backup row for non-entitled users (row is
  simply hidden in v1).
