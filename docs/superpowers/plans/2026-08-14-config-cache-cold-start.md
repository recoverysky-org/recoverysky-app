# Config Cache: First-Launch-Only `/config` Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache the raw `/config` payload in the SQLCipher-encrypted SQLite DB so warm cold-starts render without a live `/config` fetch; the fetch gate applies only on first launch (or cache miss).

**Architecture:** A new `config_caches` table ships in `@recoverysky-org/common` (its Drizzle schema/migrations own every table). The app reads the cache in `app.tsx` init after opening the DB early (the `openDb()` module singleton + idempotent migrations make this safe before `DatabaseProvider` mounts), applies it via a new `ConfigStore.applyServerConfig` action, and fires the live fetch un-awaited. A MobX reaction persists each successful payload back to the cache, keeping `models/` free of `db/` imports.

**Tech Stack:** MobX-State-Tree, Drizzle ORM + expo-sqlite (SQLCipher), vitest for pure logic, common-lib generator pipeline (`ts-to-json` → `json-to-drizzle-sqlite` → `drizzle-kit generate`).

**Spec:** `docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md` — read it first; every decision below argues from it.

## Global Constraints

- **No `runtimeVersion` bump.** All app changes are JS + a JS-consumed migration; ships as an OTA. If you find yourself touching native config, stop — you've left the spec.
- **Two repos.** Tasks 1 is in `/Users/jenova/projects/recoverysky-org/common` (branch `root`); Tasks 2–6 are in `/Users/jenova/projects/recoverysky-org/app` (branch `root`). Every shell command below states its working directory — subagents do NOT inherit it; `cd` explicitly and verify `git branch --show-current` prints `root` before committing.
- **Stage named paths only** (`git add <file> …`), never `git add -A` / `git stash` — this checkout is shared with concurrent sessions.
- **Never lint the whole project.** `npx eslint --fix <file>` scoped to files you touched only.
- **Vitest purity:** `app/utils/configCacheLogic.ts` must have zero runtime `@/` imports (type-only `@/` imports are fine — they're erased).
- **Comment discipline (repo standard):** when moving or changing commented code, the comments move with it verbatim; behavior changes get an appended `CHANGED 2026-08-14:` note, not a deleted comment.
- **Test runners:** `*.test.ts` → vitest (`npm run test:unit -- <path>`); component tests are jest `.tsx` (none needed here). Full check: `npm run compile && npm test`.
- **The table name is `config_caches`** (the common-lib pluralizer output), not the spec's shorthand `config_cache`. Export name from the generated schema: `config_caches`.

---

### Task 1: `config_caches` table in `@recoverysky-org/common` + release 2.8.0

**Files (all in `/Users/jenova/projects/recoverysky-org/common`):**
- Create: `src/models/config_cache.ts`
- Modify: `src/models/index.ts` (one export line)
- Generated (by scripts, do not hand-edit): `src/models/json/config_cache.json`, `src/models/drizzle/sqlite/config_caches.drizzle.ts`, `src/models/drizzle/sqlite/index.ts`, `src/models/migrations/sqlite/0055_*.sql` + `meta/`, and `lib/**` build output
- Modify: `package.json` (version `2.7.2` → `2.8.0`)

**Interfaces:**
- Consumes: nothing.
- Produces: npm package `@recoverysky-org/common@2.8.0` whose `/sqlite` subpath exports the `config_caches` Drizzle table (columns `id: text` PK default `'default'`, `payload: text` notNull default `''`, `fetchedAt: integer` notNull default `0`) and a `migrations` bundle containing its CREATE TABLE. Task 2 depends on this being published.

- [ ] **Step 1: Confirm repo state**

Run: `cd /Users/jenova/projects/recoverysky-org/common && git branch --show-current && git status --short`
Expected: `root`, clean (or only foreign files you will not touch — do not stage them).

- [ ] **Step 2: Write the model class**

Create `src/models/config_cache.ts`:

```typescript
/**
 * Config Cache Model
 *
 * Client-side single-row cache of the app's raw /config response, so the
 * app can cold-start from the encrypted SQLite DB without gating on a live
 * fetch after first launch. SQLite-only — this never syncs to PostgreSQL,
 * hence the pg skip below.
 *
 * Spec (app repo): docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 *
 * @pg skip
 */
export class config_cache {
  id: string = "default";

  /** Raw /config response JSON, stringified verbatim */
  payload: string = "";

  /** Epoch ms of the successful fetch that produced payload */
  fetchedAt: number = 0;
}
```

The `@pg skip` JSDoc annotation is read by `src/scripts/ts-to-json.ts` (regex `/@pg\s+skip/i`) and becomes `x-pg-skip` in the JSON schema, which `json-to-drizzle.ts` honors — same mechanism `meeting_verification.ts` uses for `@sqlite skip`.

- [ ] **Step 3: Register the model in the barrel**

In `src/models/index.ts`, add (alphabetical placement beside the existing lines, e.g. after the `chat_message` export):

```typescript
export * from './config_cache.js';
```

- [ ] **Step 4: Run the generator pipeline**

Run, from `/Users/jenova/projects/recoverysky-org/common`:

```bash
pnpm json:schema && pnpm drizzle:schema:sqlite && pnpm drizzle:generate:sqlite
```

Expected console output includes generation of `config_cache.json` and `config_caches.drizzle.ts`, and drizzle-kit creating a new migration `src/models/migrations/sqlite/0055_<codename>.sql`.

- [ ] **Step 5: Verify the generated artifacts**

Run: `cat src/models/drizzle/sqlite/config_caches.drizzle.ts && cat src/models/migrations/sqlite/0055_*.sql && grep -c "x-pg-skip" src/models/json/config_cache.json`
Expected: a `sqliteTable('config_caches', …)` with `id` text PK default `'default'`, `payload` text notNull default `''`, `fetchedAt` integer notNull default `0`; a `CREATE TABLE \`config_caches\`` migration; grep prints `1`. Also `git status --short` must show ONLY the files listed in this task's header (plus `src/models/migrations/sqlite/meta/` journal updates and the regenerated `src/models/drizzle/sqlite/index.ts`) — any pg-side diff means the `@pg skip` didn't take; stop and fix before continuing.

- [ ] **Step 6: Build and run the unit tests**

Run: `pnpm build && pnpm test:unit`
Expected: build succeeds (copies migrations into `lib/models/`), tests pass.

- [ ] **Step 7: Commit the feature**

```bash
cd /Users/jenova/projects/recoverysky-org/common
git add src/models/config_cache.ts src/models/index.ts src/models/json/config_cache.json src/models/drizzle/sqlite/config_caches.drizzle.ts src/models/drizzle/sqlite/index.ts src/models/migrations/sqlite
git commit -m "✨ feat(models): config_cache — client-side /config payload cache (sqlite-only)"
```

- [ ] **Step 8: Release 2.8.0**

Edit `package.json`: `"version": "2.7.2"` → `"version": "2.8.0"`. Then:

```bash
git add package.json
git commit -m "v2.8.0"
git push
pnpm publish
```

If `pnpm publish` fails on auth: `NPM_TOKEN` must be in the environment and `npm run set_token` run first — if the token isn't available, STOP and ask Jenova to publish; do not work around it.

- [ ] **Step 9: Verify the publish**

Run: `npm view @recoverysky-org/common version`
Expected: `2.8.0`

---

### Task 2: Dependency bump + `ConfigCacheSqliteRepository` (app repo)

**Files (all in `/Users/jenova/projects/recoverysky-org/app`):**
- Modify: `package.json` (`"@recoverysky-org/common": "^2.4.1"` → `"^2.8.0"`) + `package-lock.json` (via npm)
- Create: `app/db/ConfigCacheSqliteRepository.ts`
- Modify: `app/db/repositories.ts` (lazy wrapper, mirroring `profileRepository` at `app/db/repositories.ts:792-854`)
- Modify: `app/db/index.ts` (re-exports)

**Interfaces:**
- Consumes: `config_caches` table export from `@recoverysky-org/common/sqlite` (Task 1).
- Produces: `configCacheRepository` with exactly `load(): Promise<ConfigCacheRecord | null>` and `save(payload: string, fetchedAt: number): Promise<void>`, re-exported from `@/db`; `ConfigCacheRecord` is `{ id: string; payload: string; fetchedAt: number }`. Tasks 3 and 5 rely on these names.

- [ ] **Step 1: Bump the dependency**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npm install @recoverysky-org/common@^2.8.0`
Expected: `package.json` shows `"^2.8.0"`; `node -e "console.log(require('@recoverysky-org/common/package.json').version)"` prints `2.8.0`.

- [ ] **Step 2: Write the repository class**

Create `app/db/ConfigCacheSqliteRepository.ts`:

```typescript
/**
 * ConfigCacheSqliteRepository - SQLite data access for the /config cache
 *
 * Single-row (id "default") cache of the raw /config response JSON, stored
 * in the encrypted SQLite database so warm cold-starts don't gate on a live
 * fetch. Mirrors UserProfileSqliteRepository's shape — see that file for
 * why single-row repositories live app-side over the common-lib table.
 *
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */

import { config_caches as configCaches } from "@recoverysky-org/common/sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "ConfigCacheRepo" })

/** Cache row as stored in SQLite */
export interface ConfigCacheRecord {
  id: string
  payload: string
  fetchedAt: number
}

const DEFAULT_ID = "default"

export class ConfigCacheSqliteRepository {
  constructor(private db: ExpoSQLiteDatabase<Record<string, never>>) {}

  /** Read the single cache row. null = cache miss (never throws). */
  async load(): Promise<ConfigCacheRecord | null> {
    try {
      const rows = await this.db
        .select()
        .from(configCaches as any)
        .limit(1)
      return (rows[0] as ConfigCacheRecord) || null
    } catch (error) {
      log.error("load error", { error: String(error) })
      return null
    }
  }

  /** Upsert the single cache row. Failures are logged, never thrown —
   *  a failed cache write must not break the config fetch path. */
  async save(payload: string, fetchedAt: number): Promise<void> {
    try {
      await this.db
        .insert(configCaches as any)
        .values({ id: DEFAULT_ID, payload, fetchedAt })
        .onConflictDoUpdate({
          target: configCaches.id as any,
          set: { payload, fetchedAt },
        })
    } catch (error) {
      log.error("save error", { error: String(error) })
    }
  }
}
```

- [ ] **Step 3: Add the lazy wrapper in `repositories.ts`**

In `app/db/repositories.ts`, add the import beside the `UserProfileSqliteRepository` import (line 47):

```typescript
import { ConfigCacheSqliteRepository, type ConfigCacheRecord } from "./ConfigCacheSqliteRepository"
```

and re-export the type plus append after the `profileRepository` block (ends line 854), following its exact lazy-singleton pattern:

```typescript
export type { ConfigCacheRecord }

// ============================================================================
// Config Cache Repository (encrypted SQLite — startup config cache)
// ============================================================================

let _configCacheRepo: ConfigCacheSqliteRepository | null = null

function getConfigCacheRepo(): ConfigCacheSqliteRepository {
  const { db } = getDb()
  if (!db) throw new Error("Database not opened")
  if (!_configCacheRepo) _configCacheRepo = new ConfigCacheSqliteRepository(db as any)
  return _configCacheRepo
}

/**
 * Startup config cache — raw /config payload persisted so warm cold-starts
 * skip the live fetch. NOT part of the attendance sync outbox: config is
 * server-issued app data, not a user mutation, so nothing here enqueues.
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */
export const configCacheRepository = {
  /** null on any failure (db not open, row absent) — callers treat as cache miss */
  load: async (): Promise<ConfigCacheRecord | null> => {
    try {
      return await getConfigCacheRepo().load()
    } catch (error) {
      log.error("configCacheRepository load error", { error: String(error) })
      return null
    }
  },

  /** Fire-and-forget safe: swallows "Database not opened" (pre-open reaction fire) */
  save: async (payload: string, fetchedAt: number): Promise<void> => {
    try {
      await getConfigCacheRepo().save(payload, fetchedAt)
    } catch (error) {
      log.error("configCacheRepository save error", { error: String(error) })
    }
  },
}
```

- [ ] **Step 4: Re-export from `app/db/index.ts`**

In the `from "./repositories"` export block (`app/db/index.ts:33-61`), add `configCacheRepository,` after `profileRepository,` and `type ConfigCacheRecord,` in the type section.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run compile`
Expected: clean. Then:

```bash
cd /Users/jenova/projects/recoverysky-org/app
git add package.json package-lock.json app/db/ConfigCacheSqliteRepository.ts app/db/repositories.ts app/db/index.ts
git commit -m "✨ feat(db): config cache repository over common 2.8.0 config_caches table"
```

---

### Task 3: Pure decision logic `configCacheLogic.ts` (TDD, vitest)

**Files:**
- Create: `app/utils/configCacheLogic.ts`
- Test: `app/utils/configCacheLogic.test.ts`

**Interfaces:**
- Consumes: `ServerConfig` **type-only** from `@/services/api` — note this type is created in Task 4; write `import type { ServerConfig } from "@/services/api"` now and expect the typecheck for THIS task via the test run only (vitest erases the type import). If executing tasks strictly in order and `npm run compile` complains about the missing export, that's expected until Task 4 lands — the vitest suite is this task's gate.
- Produces: `decideStartupConfigPath(row: { payload: string; fetchedAt: number } | null): { mode: "warm"; config: ServerConfig } | { mode: "cold" }`. Task 5 relies on this exact signature.

- [ ] **Step 1: Write the failing tests**

Create `app/utils/configCacheLogic.test.ts`:

```typescript
import { describe, expect, it } from "vitest"

import { decideStartupConfigPath } from "./configCacheLogic"

describe("decideStartupConfigPath", () => {
  it("returns cold for a null row (first launch / cache miss)", () => {
    expect(decideStartupConfigPath(null)).toEqual({ mode: "cold" })
  })

  it("returns cold for an empty payload", () => {
    expect(decideStartupConfigPath({ payload: "", fetchedAt: 123 })).toEqual({ mode: "cold" })
  })

  it("returns cold for invalid JSON", () => {
    expect(decideStartupConfigPath({ payload: "{not json", fetchedAt: 123 })).toEqual({
      mode: "cold",
    })
  })

  it("returns cold for JSON that is not an object (array)", () => {
    expect(decideStartupConfigPath({ payload: "[1,2]", fetchedAt: 123 })).toEqual({ mode: "cold" })
  })

  it("returns cold for JSON that is not an object (scalar)", () => {
    expect(decideStartupConfigPath({ payload: "42", fetchedAt: 123 })).toEqual({ mode: "cold" })
  })

  it("returns cold for JSON null", () => {
    expect(decideStartupConfigPath({ payload: "null", fetchedAt: 123 })).toEqual({ mode: "cold" })
  })

  it("returns warm with the parsed config for a valid payload", () => {
    const payload = JSON.stringify({ AGENT_URL: "https://agent.example", MAINTENANCE_MODE: true })
    const decision = decideStartupConfigPath({ payload, fetchedAt: 123 })
    expect(decision.mode).toBe("warm")
    if (decision.mode === "warm") {
      expect(decision.config.AGENT_URL).toBe("https://agent.example")
      // Maintenance fields ride along untouched — ConfigStore.applyServerConfig
      // ({ fromCache: true }) is what ignores them, not the parser.
      expect(decision.config.MAINTENANCE_MODE).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npm run test:unit -- app/utils/configCacheLogic.test.ts`
Expected: FAIL — cannot resolve `./configCacheLogic`.

- [ ] **Step 3: Write the implementation**

Create `app/utils/configCacheLogic.ts`:

```typescript
/**
 * Pure decision logic for the startup config cache.
 *
 * Kept free of runtime `@/` imports so vitest can load it (see "Test Runner
 * Split" in CLAUDE.md) — the type-only import below is erased at compile
 * time. The I/O halves live in app/db/ConfigCacheSqliteRepository.ts and
 * the init path in app.tsx.
 *
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */

import type { ServerConfig } from "@/services/api"

/** The cache row fields this decision needs (subset of ConfigCacheRecord) */
export interface CachedConfigRow {
  payload: string
  fetchedAt: number
}

export type StartupConfigDecision =
  | { mode: "warm"; config: ServerConfig }
  | { mode: "cold" }

/**
 * Decide the startup path from the cache row. Warm = a parseable object
 * payload; anything else (missing row, empty payload, bad JSON, non-object
 * JSON) is cold — byte-for-byte the pre-cache gated startup. Deliberately
 * no field-level validation: the payload was written verbatim from a
 * successful /config response, and ConfigStore.applyServerConfig already
 * guards every field it applies.
 */
export function decideStartupConfigPath(row: CachedConfigRow | null): StartupConfigDecision {
  if (!row || !row.payload) return { mode: "cold" }
  try {
    const parsed: unknown = JSON.parse(row.payload)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { mode: "cold" }
    }
    return { mode: "warm", config: parsed as ServerConfig }
  } catch {
    return { mode: "cold" }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- app/utils/configCacheLogic.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app
git add app/utils/configCacheLogic.ts app/utils/configCacheLogic.test.ts
git commit -m "✨ feat(utils): warm/cold startup decision for the config cache (vitest)"
```

---

### Task 4: `ServerConfig` type + `ConfigStore.applyServerConfig` refactor

**Files:**
- Modify: `app/services/api/index.ts:896-944` (extract the inline `/config` response type)
- Modify: `app/models/ConfigStore.ts:162-264` (extract mapping into an action; add volatile payload)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface ServerConfig` from `app/services/api/index.ts` (exact fields = the current inline literal at lines 899-920); `ConfigStore` action `applyServerConfig(config: ServerConfig, opts: { fromCache: boolean }): void`; volatile observables `lastConfigPayload: ServerConfig | null` and `lastConfigFetchedAt: number` set by `fetchConfig` on success. Task 5 relies on all three names.

- [ ] **Step 1: Extract `ServerConfig` in the API layer**

In `app/services/api/index.ts`, above the `getConfig` method, add:

```typescript
/**
 * Raw /config response shape. Exported (rather than left inline in
 * getConfig's signature) because the startup config cache stores this
 * payload verbatim — ConfigStore.applyServerConfig and
 * utils/configCacheLogic.ts both consume the same type.
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */
export interface ServerConfig {
  AGENT_URL: string
  SOCIAL_URL?: string
  REVENUE_CAT_API_TEST_KEY: string
  REVENUE_CAT_API_APPLE_KEY: string
  REVENUE_CAT_API_GOOGLE_KEY: string
  OTLP_API_KEY: string
  UMAMI_URL: string
  UMAMI_WEBSITE_ID: string
  UMAMI_X_API_KEY: string
  REVIEW_ENABLED?: boolean
  MAINTENANCE_MODE?: boolean
  MAINTENANCE_MESSAGE?: string
  MAINTENANCE_UNTIL?: string
  LATEST_VERSION?: string
  PRESENCE_RADIUS_M?: number
  /** Dev-build-only presence radius; ignored entirely in production. */
  DEV_PRESENCE_RADIUS_M?: number
  /** In-Person map style URLs (keyed MapTiler URLs); absent = map off */
  MAP_STYLE_URL_LIGHT?: string
  MAP_STYLE_URL_DARK?: string
}
```

Then replace both inline literals: `getConfig(): Promise<{ kind: "ok"; config: ServerConfig } | GeneralApiProblem>` and `this.recoverySkyApi.get<ServerConfig>("/config")`. Move the two field comments into the interface as shown; do not change any field.

- [ ] **Step 2: Refactor `ConfigStore` — extract `applyServerConfig`**

In `app/models/ConfigStore.ts`:

(a) Add the import: `import { api, type ServerConfig } from "@/services/api"` (replacing the existing `import { api }`; verify `api` is exported alongside — it is, same module).

(b) Add a volatile block between `.views(...)` (ends line 161) and `.actions(...)`:

```typescript
  .volatile(() => ({
    /**
     * The raw payload of the last successful /config fetch (and its
     * timestamp). Volatile on purpose: the app.tsx persistence reaction
     * watches this and writes it to the encrypted SQLite cache — models/
     * must not import db/ (same direction as ProfileHydrator). Never in
     * MMKV snapshots.
     */
    lastConfigPayload: null as ServerConfig | null,
    lastConfigFetchedAt: 0,
  }))
```

(c) Inside `.actions((store) => ...)`, define a local function ABOVE `fetchConfig` containing the entire mapping block currently at lines 180-225 (`if (config.AGENT_URL) ...` through `store.isLoaded = true`), **moved verbatim with all its comments** (the `PRESENCE_RADIUS_M` guard comments, the `outageMode`-clear comment), wrapped as:

```typescript
      /**
       * Apply a /config payload to the store. Shared by the live fetch and
       * the startup cache path. `fromCache` skips the maintenance fields and
       * the outage clear: cached maintenance state is point-in-time and must
       * not be replayed at a later launch, and outage is only ever set on
       * the cold-cache path where this function runs with fromCache=false.
       * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
       */
      function applyServerConfig(config: ServerConfig, opts: { fromCache: boolean }) {
        /* body = ConfigStore.ts lines 182-225 moved here verbatim,
           comments included, with exactly two edits, both shown below */
      }
```

The body is the existing mapping block (`if (config.AGENT_URL) store.agentUrl = config.AGENT_URL` at line 182 through `store.isLoaded = true` at line 225), moved **verbatim with all its comments** (the `PRESENCE_RADIUS_M` guard comments, the `DEV_PRESENCE_RADIUS_M` comments, the outage-clear comment). Exactly two edits to the moved lines:

Edit 1 — the three maintenance assignments (currently lines 196-198) become:

```typescript
        if (!opts.fromCache) {
          store.maintenanceMode = config.MAINTENANCE_MODE ?? false
          store.maintenanceMessage = config.MAINTENANCE_MESSAGE ?? ""
          store.maintenanceUntil = config.MAINTENANCE_UNTIL ?? ""
        }
```

Edit 2 — the outage clear (currently lines 218-224) keeps its comment, gains the guard and a CHANGED note:

```typescript
              // Clear any cold-start outage gate ONLY when the service
              // reports itself as healthy. While maintenance is active we
              // keep the gate up so the user-facing state (full-screen vs
              // banner) is decided at app startup and doesn't flip mid-poll.
              // CHANGED 2026-08-14: guarded on !fromCache — cached
              // maintenance/outage state is point-in-time and must not be
              // replayed at a later launch.
              if (!opts.fromCache && !store.maintenanceMode) {
                store.outageMode = false
              }
```

Every other moved line — including `store.isLoaded = true` as the final statement — is byte-for-byte unchanged.

(d) In `fetchConfig`'s success branch (currently lines 180-228), replace the moved block with:

```typescript
            if (result.kind === "ok") {
              const { config } = result
              applyServerConfig(config, { fromCache: false })
              // Stash the raw payload for the app.tsx persistence reaction
              // (writes it to the encrypted SQLite config cache).
              store.lastConfigPayload = config
              store.lastConfigFetchedAt = Date.now()

              log.info("Config loaded from server", { attempt })
              return // success
            }
```

(e) Export the action: add `applyServerConfig,` to the returned actions object (it sits beside `fetchConfig`, `setOutageMode`, `reset`).

- [ ] **Step 3: Verify**

Run: `npm run compile && npm test`
Expected: compile clean; both runners pass (this also confirms Task 3's type-only import now resolves).

- [ ] **Step 4: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app
git add app/services/api/index.ts app/models/ConfigStore.ts
git commit -m "♻️ refactor(config): extract applyServerConfig + ServerConfig type; stash raw payload for cache"
```

---

### Task 5: Early DB open + warm/cold init wiring in `app.tsx`

**Files:**
- Create: `app/db/earlyOpen.ts`
- Modify: `app/db/index.ts` (one export line)
- Modify: `app/app.tsx` — cache read after `logger.setContext({ deviceId })` (line 446), persistence reaction, and the fetch block at lines 498-514

**Interfaces:**
- Consumes: `configCacheRepository` (Task 2), `decideStartupConfigPath` (Task 3), `applyServerConfig` / `lastConfigPayload` / `lastConfigFetchedAt` (Task 4), existing `openDb` / `getSqliteEncryptionKey` / common-lib `migrations`.
- Produces: `openDbEarly(): Promise<boolean>` exported from `@/db`; the final startup behavior.

- [ ] **Step 1: Write `earlyOpen.ts`**

Create `app/db/earlyOpen.ts`:

```typescript
/**
 * Early database open for the cold-start config cache.
 *
 * app.tsx init needs to read the cached /config payload BEFORE the React
 * tree (and therefore DatabaseProvider) mounts — the tree only renders
 * once init calls setRootStore. Safe to open here because openDb() is a
 * module singleton (DatabaseProvider's later call reuses the instance)
 * and drizzle migrations are idempotent (tracked in __drizzle_migrations),
 * so DatabaseProvider's own migrate() becomes a no-op. Running migrate()
 * here also guarantees the config_caches table exists before the first
 * read — no "table missing on first launch after OTA" edge.
 *
 * Returns false on ANY failure: the caller treats that as a cache miss and
 * takes the cold (gated) path. DatabaseProvider still owns the user-facing
 * error UX for a genuinely broken database — this function never throws.
 *
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */

import { migrations } from "@recoverysky-org/common/sqlite"

import { getSqliteEncryptionKey } from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { openDb } from "./provider"

const log = logger.child({ module: "earlyOpen" })

export async function openDbEarly(): Promise<boolean> {
  try {
    const key = await getSqliteEncryptionKey()
    const { db } = await openDb(key)
    // Dynamic import mirrors DatabaseProvider — keeps the migrator out of
    // the module graph until it's actually needed.
    const { migrate } = await import("drizzle-orm/expo-sqlite/migrator")
    await migrate(db, migrations)
    return true
  } catch (error) {
    // Expected on web if expo-sqlite isn't available there — cold path.
    log.warn("Early DB open failed — config cache unavailable this launch", {
      error: String(error),
    })
    return false
  }
}
```

Add to `app/db/index.ts` after line 25: `export { openDbEarly } from "./earlyOpen"`.

- [ ] **Step 2: Wire the cache read into init**

In `app/app.tsx`, add to the existing `from "./db"` import list (lines 47-56): `configCacheRepository`, `openDbEarly`. Add `import { decideStartupConfigPath } from "./utils/configCacheLogic"` (with the `./utils` imports) and add `type ServerConfig` to the `from "./services/api"` import (line 61: `import { api, type ServerConfig } from "./services/api"`).

Immediately after `logger.setContext({ deviceId })` (line 446), insert:

```typescript
        // Startup config cache — read BEFORE the /status precheck so a warm
        // cache is in hand when we decide the config path below. Opening the
        // DB here is safe/idempotent (see openDbEarly). Any failure lands on
        // cachedConfig = null, which is byte-for-byte the pre-cache startup.
        // Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
        let cachedConfig: ServerConfig | null = null
        if (await openDbEarly()) {
          const row = await configCacheRepository.load()
          const decision = decideStartupConfigPath(row)
          if (decision.mode === "warm") {
            cachedConfig = decision.config
            log.info("Config cache warm", { fetchedAt: row?.fetchedAt })
          } else {
            log.info("Config cache cold (first launch or unreadable cache)")
          }
        }

        // Persist every successful /config payload to the encrypted SQLite
        // cache. A reaction (not a ConfigStore side effect) so models/ stays
        // free of db/ imports — same direction as ProfileHydrator. Registered
        // BEFORE the fetch below so the very first launch's payload is
        // captured too (a save before the DB opens just logs and no-ops;
        // the 60s config poll self-heals). Never disposed: config polling
        // runs for the app's lifetime.
        reaction(
          () => _rootStore.configStore.lastConfigPayload,
          (payload) => {
            if (!payload) return
            void configCacheRepository.save(
              JSON.stringify(payload),
              _rootStore.configStore.lastConfigFetchedAt,
            )
          },
        )
```

- [ ] **Step 3: Branch the fetch block**

Replace `app/app.tsx` lines 498-514 (the `// Fetch server config...` comment through the `setOutageMode()` else-if) with — keeping the original comment block and appending the CHANGED note:

```typescript
        // Fetch server config (keys, secrets, URLs from /config endpoint).
        // Cold-start outage gate fires for two cases — both route to the
        // full-screen MaintenanceScreen instead of the runtime banner:
        //   1. Fetch failed after all retries: nothing cached to render.
        //   2. Fetch succeeded but server reported MAINTENANCE_MODE=true:
        //      we don't want a fresh-launched user staring at an empty
        //      meeting list with a banner; the full screen is the more
        //      honest UX. The gate clears on the next poll where
        //      maintenance is off (see ConfigStore.fetchConfig).
        // CHANGED 2026-08-14: both gates now apply ONLY when the config
        // cache is cold (first launch / unreadable cache). A warm cache
        // seeds the store and the fetch runs un-awaited in the background;
        // maintenance then arrives as the banner (spec decision: banner-only
        // on warm starts). outageMode is never set on the warm path.
        // Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
        if (cachedConfig) {
          _rootStore.configStore.applyServerConfig(cachedConfig, { fromCache: true })
          // Deliberately un-awaited: refreshes store + cache when it lands.
          void _rootStore.configStore.fetchConfig()
        } else {
          await _rootStore.configStore.fetchConfig()
          if (!_rootStore.configStore.isLoaded) {
            log.warn("Config fetch exhausted all retries — entering outage mode")
            _rootStore.configStore.setOutageMode()
          } else if (_rootStore.configStore.maintenanceMode) {
            log.info("Cold start with maintenance active — entering outage mode")
            _rootStore.configStore.setOutageMode()
          }
        }
```

Leave everything after (the OTLP key update at line 517, `initAttendanceSync`, notifications, …) untouched — on the warm path those now read cached values, which is the point.

- [ ] **Step 4: Verify**

Run: `npm run compile && npm test && npx eslint --fix app/app.tsx app/db/earlyOpen.ts app/db/index.ts`
Expected: compile clean, both runners pass, lint clean (re-run compile if eslint changed anything).

- [ ] **Step 5: Smoke test on simulator**

Run: `npm start -- --clear` and launch the iOS simulator build. Verify in logs, in order: first launch → `"Config cache cold (first launch or unreadable cache)"` → `"Config loaded from server"`; then kill and relaunch → `"Config cache warm"` and NO awaited config gate (app renders immediately after attestation). If the simulator isn't available in this environment, state that explicitly in the task report — do not claim the smoke test ran.

- [ ] **Step 6: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app
git add app/app.tsx app/db/earlyOpen.ts app/db/index.ts
git commit -m "✨ feat(startup): warm cold-start from config cache; /config gate now first-launch-only"
```

---

### Task 6: CHANGELOG + CLAUDE.md updates

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `CLAUDE.md` (ConfigStore bullet + Maintenance Mode section)

**Interfaces:** none — documentation of Tasks 1-5's behavior.

- [ ] **Step 1: CHANGELOG entry**

Under `## [Unreleased]`, add (create the `### Changed` / `### Build` headings if absent):

```markdown
### Changed

- Cold start no longer gates on a live `/config` fetch after first launch: the
  raw payload is cached in the encrypted SQLite database (`config_caches`) and
  refreshed in the background. Fixes the false-positive "The system is offline"
  full screen for users on slow or flaky networks at launch, and removes up to
  ~14s of retry stall from startup. Launching during server maintenance with a
  warm cache now shows the maintenance banner instead of the full-screen
  takeover (full screen remains for true first launches). Spec:
  `docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md`.

### Build

- `@recoverysky-org/common` 2.7.1 → 2.8.0 (adds the `config_caches` table).
```

- [ ] **Step 2: CLAUDE.md — ConfigStore bullet**

In the ConfigStore bullet of the "State Management" section, replace `NOT persisted to MMKV (security)` with:

```markdown
NOT persisted to MMKV (security). The raw /config payload IS cached in the
encrypted SQLite `config_caches` table so warm cold-starts skip the fetch
gate — maintenance fields are never applied from cache. See
`applyServerConfig` and docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md.
```

- [ ] **Step 3: CLAUDE.md — Maintenance Mode section**

In the `outageMode` description, after the three-trigger list, add:

```markdown
  CHANGED 2026-08-14: triggers 2 and 3 now fire only when the config cache
  is cold (first launch / unreadable cache). Warm-cache starts seed
  ConfigStore from SQLite, fetch in the background, and surface maintenance
  as the banner instead — see the config-cache spec.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app
git add CHANGELOG.md CLAUDE.md
git commit -m "📝 docs: record config-cache startup behavior (changelog + CLAUDE.md)"
```

---

## Final Verification (before claiming done)

- [ ] `cd /Users/jenova/projects/recoverysky-org/app && npm run compile && npm run lint:deps && npm test` — all clean. (`lint:deps` matters: `earlyOpen.ts` adds a `db → services/encryption` import; depcruise must stay happy.)
- [ ] Manual checklist from the spec — these need a device/simulator and Jenova's hands; list them in the completion report as pending-manual rather than claiming them done:
  1. Airplane-mode warm start → app renders from cache.
  2. Server in maintenance + warm start → app renders, banner appears when the background fetch returns.
  3. Fresh install with no network → current outage behavior unchanged.
  4. Rotate a config value server-side → warm start uses stale value; next successful fetch corrects store + cache.
  5. Login (DB rekey) → cache still readable after.
- [ ] This is an OTA-able change: confirm `app.json` `runtimeVersion` is untouched by `git diff`.
