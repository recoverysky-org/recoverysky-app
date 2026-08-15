# Config Cache: First-Launch-Only `/config` Gate

**Date:** 2026-08-14
**Status:** Approved design, pending implementation plan

## Problem

Cold start hard-blocks on a live `/config` fetch. Combined with the `/status`
precheck, this produced the false-positive "The system is offline" reports:
a user on a slow or momentarily absent network at launch gets the full-screen
MaintenanceScreen even though the backend is healthy (measured ~0.6 s `/status`
response from broadband while users saw outages). The config payload seldom
changes, yet every launch re-pays a network round trip — up to ~14 s of
retries in bad conditions — before the app renders.

Related, separately-scoped fixes from the same investigation (not this spec):

1. Wire device-connectivity awareness (NetInfo → `NetworkStore`) so
   device-offline is distinguished from server-down. Native dep →
   `runtimeVersion` bump.
2. Escalating precheck timeouts (2.5 s → 4 s → 6 s ladder). JS-only, OTA.

## Scope decisions (settled with Jenova, 2026-08-14)

- **Config gate only.** Attestation remains a blocking cold-start gate on
  physical production devices, and the `/status` precheck stays in front of it
  (it still prevents the misleading "Device Verification Failed" alert). This
  spec does NOT deliver fully-offline cold start; it removes the `/config`
  dependency from warm starts.
- **Banner-only maintenance on warm starts.** A warm-cache launch renders from
  cache; if the background fetch reports maintenance, the amber banner appears
  — same as maintenance starting mid-session. The full-screen
  cold-start-into-maintenance takeover now applies only to first launch. This
  deliberately supersedes the "more honest UX" full-screen decision for the
  warm-cache case; local-first features (attendance history, meeting list)
  stay usable.
- **Cache lives in the common-lib schema.** New Drizzle table + migration in
  `@recoverysky-org/common`, released and version-bumped here. On-pattern with
  every other table; the app-owned raw-SQL escape hatch was considered and
  rejected as off-pattern.

## What the cache wins

- Warm starts stop depending on `/config` at all: outage trigger #2
  (config fetch failed after `/status` passed) and trigger #3 (cold start
  into maintenance) disappear for warm starts.
- Faster startup: the `/config` round trip (up to 3 attempts × timeout +
  2/4/8 s backoff) leaves the critical path.
- A half-up state where `/status` answers but `/config` fails no longer
  bricks launch.

## Security posture

The documented "ConfigStore is NOT persisted (security)" decision was about
plaintext MMKV snapshots. This cache lives in the SQLCipher-encrypted SQLite
database — the same tier as ProfileStore's volatile sensitive data. The
encryption key sits in SecureStore (Keychain/Keystore) once established
(locally generated for anonymous users, JWT-claim-derived for authenticated),
so the DB — and the cache — opens fully offline after first launch. The MMKV
prohibition on config stands; this does not weaken it.

## Design

### 1. Cache shape (common-lib change)

`config_cache` table in `@recoverysky-org/common`, single row:

| column      | type    | notes                                   |
| ----------- | ------- | --------------------------------------- |
| `id`        | text PK | fixed key, always the same value        |
| `payload`   | text    | the **raw `/config` response JSON**     |
| `fetchedAt` | integer | epoch ms of the successful fetch        |

Store the raw server payload, not the MST snapshot — no mapping drift between
cache format and store shape. Everything in the payload is cached; maintenance
fields (`MAINTENANCE_MODE` / `MAINTENANCE_MESSAGE` / `MAINTENANCE_UNTIL`) are
simply never *applied* from cache because they are point-in-time.

**No TTL.** A background refresh fires on every launch and the 60 s poll
continues; a rotated key (RevenueCat, OTLP, MapTiler-in-style-URL) means
seconds of failing calls after launch, self-healed by the next successful
fetch — not a bricked app. Revisit only if key rotation becomes routine.

### 2. Startup flow (`app.tsx` init)

Right after deviceId setup, init opens the database itself:
`getSqliteEncryptionKey()` → `openDb(key)` → `migrate()` → read cache row.

This is safe because `openDb()` is a module singleton (`provider.ts` guards on
`if (!expoDb)` — DatabaseProvider's later call reuses the instance) and
Drizzle migrations are idempotent (tracked in `__drizzle_migrations`).
Running `migrate()` in init also guarantees the `config_cache` table exists
before the first read — the first-launch-after-OTA "table missing" edge cannot
occur. Expected added cost on the critical path is tens of ms (dynamic import
+ open + PRAGMA key + no-op migrate), traded against removing a network round
trip.

- **Warm cache:** `/status` precheck and attestation gate exactly as today →
  `applyServerConfig(cachedPayload, { fromCache: true })` → `isLoaded = true`
  → fire `fetchConfig()` **unawaited** → continue init. Downstream consumers
  (Umami, push registration, RevenueCat) receive real values from cache.
  `outageMode` is never set on this path.
- **Cold cache** (true first launch, reinstall, cache read/parse failure):
  current behavior byte-for-byte — await `fetchConfig()`, outage gate on
  failure, full-screen maintenance on cold-start-into-maintenance.

### 3. ConfigStore changes

- Extract the field-mapping block of `fetchConfig` into an
  `applyServerConfig(config, { fromCache })` action used by both paths. The
  `fromCache` path skips maintenance fields and does not clear `outageMode`
  (irrelevant there anyway — outage is only set on the cold-cache path).
- `fetchConfig` stashes the raw payload in a volatile prop
  (`lastConfigPayload`) on success.
- A MobX reaction in `app.tsx` (same pattern as the auth-identity and
  language-sync reactions) persists `lastConfigPayload` + timestamp to the
  cache repository whenever it changes. Models stay free of `db/` imports —
  the ProfileHydrator direction, preserved.

### 4. Edge handling

- Any cache read or JSON-parse failure degrades to the cold-cache path.
  Never a crash; never a gate skip without config data.
- The post-login DB rekey (`PRAGMA rekey`) preserves rows; the cache survives
  account transitions unchanged.
- Account switch / logout: the cache holds server-issued app config, not
  user data — no ownership concern, no clearing required.
- Web: follows whatever `DatabaseProvider` does on web today. If the DB is
  unavailable there, web keeps the current gated path. Verify during
  implementation.
- `EXPO_PUBLIC_RESEED_DB=true` deletes the DB inside `openDb()` — the cache
  goes with it, which correctly lands on the cold-cache path.

### 5. Testing

- Pure decision logic in a new `app/utils/configCacheLogic.ts` — zero runtime
  `@/` imports so vitest can load it (repo pattern): warm/cold path decision
  from the cache row, and which fields apply from cache vs live fetch.
- Repository read/write and the init-path wiring are I/O — covered by the
  manual checklist, not unit tests (same posture as `services/sync/index.ts`).
- Manual checklist:
  - Airplane-mode warm start → app renders from cache (then whatever the
    precheck/attestation gates do per their own rules).
  - Server in maintenance + warm start → app renders, banner appears when
    the background fetch returns.
  - Fresh install with no network → current outage behavior unchanged.
  - Rotate a config value server-side → warm start uses stale value, next
    successful fetch corrects store + cache.
  - Login (rekey) → cache still readable after.

## Release path

1. Common-lib: `config_cache` schema + migration, release, `npm install`
   bump here.
2. App changes ship as a single OTA — JS + JS-consumed migration only, no new
   native dependency, **no `runtimeVersion` bump**.
3. CHANGELOG entry under `[Unreleased]` → `Changed` (startup no longer gates
   on `/config` after first launch) as part of the implementation commit.
