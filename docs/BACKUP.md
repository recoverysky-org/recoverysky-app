# Attendance Cloud Backup & Multi-Device Sync

How attendance records and reports are backed up to the server and kept in
step across a user's devices.

Design spec: `docs/superpowers/specs/2026-07-09-attendance-sync-client-design.md`.
Implementation plan: `docs/superpowers/plans/2026-07-09-attendance-sync-client.md`.

---

## The one invariant you must not break

**The server stamps every pushed attendance record with the uid of the
authenticated caller.** It does not trust, or even read, the `uid` field on the
wire.

This single fact drives most of the design below. If user A queues an offline
edit, signs out, and user B signs in on the same device, pushing A's queued row
while B holds the access token silently moves A's attendance record into B's
account. There is no server-side check that would catch it — the push looks
perfectly valid.

Everything in the "Queue ownership" section exists to make that impossible.

## Architecture at a glance

```
 attendance mutation (create/update/archive/delete/…)
        │
        ▼
 repositories.ts  ──notifyAttendanceMutation()──▶  sync/index.ts
        │                                              │
        │                                       enqueueAttendance()
        │                                              │
        │                                              ▼
        │                                    sync_queue (SQLite outbox)
        │                                              │
        │                                       nudgePush() (3s debounce)
        │                                              ▼
        │                                      attendanceSyncService
        │                                       pushTick / pullTick
        │                                              │
        ▼                                              ▼
   local SQLite  ◀──attendanceSyncWriter──────  POST /sync/attendance
                                                 GET  /sync/attendance
                                                 GET  /sync/reports
                                                 GET  /reports/:id
```

Three ideas carry the whole thing:

1. **An outbox, not a differ.** Every local attendance mutation writes a row to
   the `sync_queue` table before it is pushed. The queue is durable SQL, so an
   app kill mid-push loses nothing — the next tick drains what's left. We never
   diff local state against server state to decide what to send.

2. **A single choke point.** `app/db/repositories.ts` is the only place
   attendance rows are mutated, so it is the only place that needs to notify the
   sync layer. Call sites throughout the app remain unaware that sync exists.

3. **A separate writer for inbound data.** Records arriving from a pull are
   written through `attendanceSyncWriter`, which **never** fires the mutation
   hook. Without this, pulling a record would enqueue it for push, which would
   pull it again — an infinite loop.

## Files

| File | Responsibility |
| --- | --- |
| `app/services/sync/syncLogic.ts` | Pure functions: wire mapping, merge decisions, batching, `ownershipAction()`. Zero `@/` runtime imports so vitest can reach it. |
| `app/services/sync/attendanceSyncService.ts` | The engine. A DI factory — all I/O arrives as `deps`. Owns `syncState`, the reentrancy guards, backoff, and pacing. |
| `app/services/sync/index.ts` | The wiring. Builds the real `deps`, owns the gate, queue ownership, and the four triggers. |
| `app/db/repositories.ts` | The mutation hook, `attendanceSyncWriter`, `syncQueueRepo`. |
| `app/models/ProfileStore.ts` | `syncEnabled` (MMKV, default false). |
| `app/screens/SettingsScreen.tsx` | The opt-in toggle and `SyncStatusLine`. |

`syncLogic.ts` is the only file with meaningful unit-test coverage of its
decision logic, which is why anything worth testing gets extracted into it.
**Vitest has no `@/` path alias in this repo**, so a module that imports `@/…`
at runtime is untestable. Type-only imports are erased and therefore fine.

## The gate

No sync traffic happens unless *all* of these hold, checked on every tick in
`gate()`:

- `profileStore.syncEnabled` — the user opted in
- the RevenueCat `recoverysky-attendance` entitlement is active
- `authenticationStore.isAuthenticated` and **not** `isAnonymous`
- a non-empty `userId`
- not `configStore.maintenanceMode`
- not `networkStore.isOffline`
- no queue-ownership clear is pending (see below)

The entitlement check is `await`ed, so `gate()` re-checks the ownership flag
*after* that await. A sign-in can land while we're suspended.

## Triggers

There is no polling and no OS background task. Sync runs on:

1. **A local mutation** → `enqueueAttendance()` → `nudgePush()`, debounced 3 s so
   a burst of edits collapses into one push.
2. **App resume / foreground** → `fullSync()`.
3. **The Attendance screen gaining focus** → `fullSync()`.
4. **The gate transitioning closed → open** (a MobX reaction) → `fullSync()`.
5. **Cold start**, after boot reconciliation → `fullSync()`.

## Queue ownership

The outbox must survive an ordinary sign-out/sign-in round trip — a user who
edits offline, gets logged out by a token expiry, and logs back in must not lose
their edits. But it must *not* survive an account switch, per the invariant at
the top.

We track the owner in MMKV under `sync.queueOwnerUid`, stamped by
`enqueueAttendance()` on every enqueue. `ownershipAction(owner, uid)` in
`syncLogic.ts` decides what happens when `uid` signs in:

| Recorded owner | Signing in | Action |
| --- | --- | --- |
| none | any uid | `stamp` — fresh install, adopt the queue |
| same uid | that uid | `noop` — offline edits survive, as intended |
| different uid | new uid | `clear-then-stamp` — **delete the queue first** |

The clear is **fail-closed**. While it is in flight, `ownerClearPending` is true
and `gate()` returns `{ ok: false }`, so nothing can push. If the clear *fails*,
the flag is deliberately never reset and the `ownerClear` promise stays
rejected — every subsequent `enqueueAttendance()` awaits it and throws. Sync
stays dead until the next launch retries the clear. A permanently broken sync is
an acceptable outcome; leaking one user's recovery attendance into another
user's account is not.

This ordering is load-bearing and subtle: **MobX fires reactions in registration
order.** The `userId` reaction — the one that clears the queue — is registered
before the cold-start `fullSync()` runs, and boot reconciliation calls
`takeQueueOwnership(bootUid)` *before* the first `fullSync()`. Reorder these and
a `fullSync()` drains the previous account's rows before the clear lands.

Signing *out* does nothing. The gate closes on `isAuthenticated`, and the queue
waits to see who signs in next.

## Push

`pushTick()` drains `sync_queue` in batches of at most `SYNC_PUSH_BATCH_MAX`
(200 — a larger batch gets a 400 from the server), sleeping `BATCH_PACE_MS`
(7 s) between batches to stay under the ~10 req/min limit.

Per-record results:

- `rejected: "stale"` is **success**. The server has a newer version; our push
  lost last-write-wins, which is the correct outcome. Mark synced.
- `rejected: "invalid"` is a **client bug** — schema drift. Log loudly and drop
  the item rather than retrying forever.
- Deletions are pushes with `deleted: true`. Because the local row is gone by
  push time, `repositories.ts` snapshots the row *before* deleting it and stores
  the snapshot on the queue item.

Failures increment `consecutiveFailures` and arm a backoff of 30 s → 60 s →
5 min. `getPending()` retries an item until `retryCount >= 3`.

## Pull

`pullTick(resource)` walks an opaque server cursor, persisted per-account in
MMKV under `sync.cursor.<resource>.<uid>`. Per-account keying means an account
switch cannot inherit the wrong cursor.

For each pulled record, `mergePullDecision()` picks one of four actions. **The
dirty check comes first, even ahead of tombstones:**

```
if (hasPendingPush) return "skip-dirty"   // a local edit is queued; it wins later
if (deleted)        return "delete"
return existsLocally ? "update" : "create"
```

Applying a pull over a record with a queued local edit would clobber the user's
unpushed change, then push the clobbered version, then mark it synced — silent
data loss. The dirty check is re-evaluated **per record, immediately before the
write** (not once per page), because a mutation can land while the page is in
flight. After the write we re-check and log if we lost the race.

A failed local write returns an error rather than a quiet skip, so the cursor
never advances past data we didn't persist.

## Reports

Reports are **pull-only**. They are generated server-side; the app never pushes
one. But `GET /sync/reports` returns **metadata only** — never the `html` or
`text` body.

So `reportToLocalUpdate()` deliberately omits `html`/`text`. Including them as
empty strings would wipe a locally-stored rendered report. Preservation by
omission — that's what the comment on it means.

To give a second device a genuinely complete local copy (no lazy-fetch, no
network dependency when opening an old report), `backfillReportBodies()` runs as
part of every sync pass. It asks the local DB which reports are missing a body,
then fetches each one via `GET /reports/:id`, paced at `REPORT_BODY_PACE_MS`
(300 ms). Each fetch is individually try/caught — one failure must not abort the
pass, because `fullSync()` still has an outbox to drain afterwards.

**The backfill is driven by local state, not by the cursor.** A failed body
fetch therefore cannot strand the pull cursor; the next pass simply notices the
body is still missing and tries again.

## Status and the Settings toggle

`syncState` is a plain MobX `observable` — `{ phase, lastSyncedAt, pendingCount }`.
`phase` is one of `idle | backing-up | syncing | error`.

`SyncStatusLine` is a standalone `observer()` component, deliberately *not* an
inline render inside `SettingsScreen`. A multi-minute initial backup ticks
`syncState` continuously; inlining it would re-render the entire Settings screen
on every tick.

`phase` flips to `error` only after **two consecutive** failures, so a single
flaky request doesn't park an alarming message in front of the user. Both
`recordFailure()` and `settlePhase()` defer while `backingUp` is true, so a
mid-backup failure can't stomp the `backing-up` phase before the backup has
actually stopped.

### Toggle semantics

- **ON** calls `initialBackup()`: a full pull of both resources, then the report
  backfill, then a paced push of the entire local attendance history. Minutes,
  not seconds, for a long history — hence fire-and-forget with a status line.
  `initialBackup()` **never rejects**; it logs and sets `phase = "error"`
  internally, so the bare `void` at the call site is safe.
- **OFF is pause-only.** It clears nothing: not the outbox, not the cursors, not
  server-side data. The gate simply closes and the mutation hook stops
  enqueueing.

Re-enabling safely re-enqueues *every* local record. That is not a bug: the
server's last-write-wins upsert turns a re-push of an unchanged row into a no-op,
so there is nothing to diff and nothing to guard against.

## Testing

`npx vitest run` covers `syncLogic.ts` and `attendanceSyncService.ts` (via
injected fakes) — 123 tests at time of writing.

**`app/services/sync/index.ts` has zero automated coverage.** It imports `@/`
modules, so vitest cannot load it. That file holds the gate and the entire queue
ownership mechanism. Every change to it must be exercised by hand:

1. Sign in as user A with the attendance entitlement. Enable Cloud Backup.
2. Go offline (airplane mode). Create or edit an attendance record.
3. Sign out. Sign in as a **different** user B.
4. Go back online. Wait for a sync pass.
5. **Assert:** none of A's records appear in B's account, on this device or any
   other device signed in as B.

Then repeat steps 1–4 signing back in as **A**, and assert the offline edit
survives and reaches the server. Both halves matter — a fix for one has twice
broken the other during development.

## Known issues

Open items as of the initial merge (2026-07-09). None is a data-leak path — the
cross-account invariant at the top of this document holds — but each is real, and
each was found by review rather than by a test. They are listed in the order a
maintainer should care about them.

### 1. Two overlapping ownership clears are not serialized

`app/services/sync/index.ts`, `takeQueueOwnership()`.

If a second account switch begins while a first `clear-then-stamp` is still in
flight (boot reconciliation starts clear₁ for B, then the `userId` reaction fires
for C), a second `onLogout()` is launched and `ownerClear` is reassigned. Clear₁'s
`.then` then stamps the *wrong* owner and resets `ownerClearPending` decoupled
from clear₂'s outcome. If clear₂ partially fails after clear₁ succeeded, the gate
can reopen with survivor rows still in the queue.

Requires two *different* accounts signing in inside the clear window **and** a
partial delete failure. An ordinary sign-out → sign-in produces a single call.

**Fix:** if a clear is already pending, chain onto the existing `ownerClear`
rather than starting a parallel one.

### 2. The mutation hook enqueues on `syncEnabled` alone, not on the entitlement

`app/services/sync/index.ts`, the `notifyAttendanceMutation` handler.

The hook gates enqueue on `profileStore.syncEnabled`, but the Settings section
that owns that toggle is gated on `hasAttendance`. A user who enables backup and
then lets the `recoverysky-attendance` entitlement lapse keeps enqueueing on every
mutation. `gate()` blocks the *push*, so the rows accumulate as permanently
pending — `retryCount` never increments, so they never expire — and the Settings
section is now hidden, so the user cannot toggle it off.

Unbounded outbox growth. No leak, no data loss.

**Fix:** gate the hook on the entitlement too, or keep the Settings section
visible (disabled) whenever `syncEnabled` is true.

### 3. `gate()` captures `uid` before the entitlement `await`

`app/services/sync/index.ts`, `gate()`.

`uid` is read at entry and returned after the awaited entitlement check. If an
account switch fully completes *inside* that await — flag raised and cleared —
`gate()` returns a stale `uid`, which is then used to build cursor keys.

The dangerous direction is safe: the queue is empty once a clear completes, so
nothing of the old user's can push. The worst case is a pull writing the new
user's server rows under the old uid's cursor key. Cursor confusion, not a leak.
The reentrancy guards make it near-unreachable.

**Fix:** re-read `uid` after the await, or thread the pre-await `uid` through and
abort if it changed.

### 4. Offline after a successful backup hides the last-synced time

`SyncStatusLine` checks `isOffline` before `lastSyncedAt`, so a user who backed up
successfully and then went offline sees "Paused — offline" rather than
"All backed up ✓ · <time>". This is the branch order the spec mandates, so it is
intended behavior — but it reads as a regression to anyone who didn't write it,
and it is worth confirming with the product owner rather than silently "fixing".

### 5. `app/i18n/index.ts` carries a cosmetic reformat

`baseResources` was expanded from one line to nine by Prettier during the i18n
task. No behavior change. Noted only so nobody goes looking for meaning in it.

## Deploying

This feature is JS-only. It ships over the air via `npm run update`. **Do not
bump `runtimeVersion`** — no native module changed. See `CLAUDE.md`.

The manual account-switch check in "Testing" above is a genuine release gate, not
a formality: the file it exercises has no automated coverage, and four separate
review rounds found real cross-account defects in it before merge.
