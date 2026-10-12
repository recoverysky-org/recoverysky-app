# User's Manual Skeleton (sub-project 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Sky a user's manual she can search: the `docs/manual/` corpus skeleton with its first area (`backup-and-devices/`) in the app repo, and in the agent repo the `manual` Qdrant collection, the ingest CLI, the `searchManual` / `getManualPage` tools, and the always-on `## The RecoverySky app` prompt section fed by the `manual-map` row.

**Architecture:** Markdown pages with front-matter are chunked one H2 per point into a hybrid (dense + BM25, RRF) Qdrant collection by a new `@recoverysky/manual` package, run by hand. `ManualVectorStore` (memory package) owns the collection; the hybrid query body is extracted from `QdrantVectorStore` into a shared `qdrant/hybridQuery.ts`. Two per-request tools in the tools package search it. The map (`map.md`) is stored as the active `manual-map` system prompt row and reaches `buildSystemPrompt` as `appManual`, the way `base-identity` reaches it as `baseIdentity`.

**Tech Stack:** Agent repo: pnpm 9 workspace, TypeScript 5.7 (ESM, NodeNext), Vitest 2, `@qdrant/js-client-rest` ^1.16, `openai` ^6 (`text-embedding-3-small`, 1536 dims), zod (root override ^4.1.13), `yaml` ^2.8.3, `dotenv` ^16, `commander` ^12, drizzle-orm ^0.38 on Postgres. App repo: Markdown and YAML only (no app code changes).

**Spec:** `docs/superpowers/specs/2026-10-12-user-manual-rag-design.md` (app repo). The spec travels with this plan; executors read both.

## Global Constraints

- **Two checkouts, two branches.** App repo `/Users/jenova/projects/recoverysky-org/app`, branch `feat/user-manual` created from `root`. Agent repo `/Users/jenova/projects/recoverysky-org/agent`, branch `feat/manual-rag` created from `prod` (the agent checkout is on `prod` today and other branches live in worktrees). Every task names its checkout and every shell step starts with `cd` to it; a subagent never inherits a worktree cwd, so pin it in every dispatch.
- **Shared app checkout.** Other sessions use the app checkout at the same time: stage only the paths each task names, never `git add -A`, never `git stash`.
- **Commits:** `<emoji> <type>(<scope>): <subject>`, a body that says why, and the footer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit after every task.
- **Names.** The corpus is the **manual**, never "guide" (`system_prompts` rows and `GET /api/v1/guides` already use "guide"). Collection `manual`; row `manual-map`; tools `searchManual` and `getManualPage`; package `@recoverysky/manual`; store `ManualVectorStore`.
- **The support address in the manual is `support@recoverysky.app`**, and the hand-off sentence is always "Contact support@recoverysky.app and mention […]". The crash screen's `.org` address is a known copy drift and is out of scope.
- **Agent repo code rules:** every local import ends in `.js`; type-only imports use `import type` (`verbatimModuleSyntax`); `noUnusedLocals` / `noUnusedParameters` are on (prefix unused parameters with `_`); tests live in `packages/<pkg>/tests/**/*.test.ts` (the api: `apps/api/src/**/*.test.ts`) and import `../src/x.js`. Workspace packages resolve through `dist`, so run `pnpm build` at the root before any test that crosses a package boundary.
- **Logging rules (agent):** never log a query's text (log `queryChars`), never a raw user id (`hashUserId`), never an error object from Qdrant or pg (`qdrantErrorFields`, `dbErrorFields`, or `{ errorKind }`).
- **Collection layout for `manual`:** named `dense` vector, 1536, Cosine, `on_disk: true`; named `sparse` vector with `index.on_disk: true`; payload indexes `page`, `area`, `platforms`, `tier`, `runId` (keyword) and `order` (integer).
- **Chunk contract:** one point per H2 section, the intro paragraph is order 0 with heading `''`; chunk id `${page}#${heading-slug}` (`${page}#intro` for the intro); point id is the sha256 of the chunk id laid out as a UUID exactly as `messageIdToPointId` does; dense text `"{title} — {screen}\n## {heading}\n{body}"` (no heading line for the intro); sparse text is the dense text plus the page's `aliases` on one more line.
- **Caps:** a section is at most 400 words (ingest fails); `map.md` is at most 600 words and contains no line starting with `## ` or `# ` (it is spliced into the prompt as one section); `searchManual` query 1–300 chars, 5 hits, `content` ≤ 3,000 chars; `getManualPage` id must match `^[a-z0-9-]+/[a-z0-9-]+$`, content ≤ 8,000 chars; score threshold 0.
- **Front-matter:** `title`, `area` (one of `getting-started home meetings attendance settings backup-and-devices account privacy sky status`), `screen` required; `platforms` subset of `[ios, android, web]`, default all three, always written in full to the payload; `tier` one of `free | attendance | premium`, default `free`; `aliases` list of strings, default `[]`; the `<!-- sources: … -->` comment is required, its paths are repo-relative and must exist in the app checkout.
- **Writer and fact-checker are different readers.** A page is accepted only after a reviewer who did not write it has traced every claim to the page's sources (Task 9).
- **App repo tasks change no app code**, so no `npm run compile`, no eslint. The CHANGELOG still gets its `Docs` `(manual)` entry (Task 12).
- **Already-red suites.** Task 0 measures them on a clean tree after `pnpm build`. On 2026-10-12, before a rebuild, four `apps/api` suites failed on `markLogSafe is not a function` because `packages/observability/dist` was older than its `src`; that is a stale build, not a regression. The five suites the evals plan listed as red on 2026-10-10 all pass today.

## Review Focus

1. **A page with a section over 400 words, two H2s that slug to the same id, or a sources path that does not exist** must fail the whole run before anything is written, listing every problem across every page at once. Pinned in Task 10 (`parse.test.ts`, "reports every problem of a page at once") and Task 11 (`ingest.test.ts`, "writes nothing when any page fails to parse").
2. **`map.md` that contains a `## ` line** would open a new section inside the system prompt and could shadow the safety sections. Pinned in Task 10 (`parse.test.ts`, "refuses a map with headings, without sources, or over the word cap").
3. **Qdrant going away mid-request** (the client rejects, times out, or the collection is gone) must make `searchManual` answer `{ hits: [], unavailable: true }` and `getManualPage` answer `{ found: false, unavailable: true }`, never throw into the stream. Pinned in Task 3 (`manualTools.test.ts`, "answers unavailable when the store throws").
4. **A model-chosen page id like `../etc`, `map`, or `Backup/New-Phone`** must be refused by the regex before any Qdrant call. Pinned in Task 3 (`manualTools.test.ts`, "refuses page ids outside the pattern without touching the store").
5. **A second ingest after a page was renamed or a section removed** must delete the old points (sweep by `runId`) and must not re-embed unchanged chunks (diff by `contentHash`, `runId` refreshed in place). Pinned in Task 11 (`ingest.test.ts`, "embeds only changed chunks and refreshes the rest" and "sweeps points from earlier runs and reports how many") and Task 2 (`ManualVectorStore.test.ts`, "deleteWhereRunIdNot counts then deletes with a must_not filter").

## Where this plan departs from the spec, and why

- **`contentHash` covers the embed text plus `aliases`, `platforms` and `tier`** (spec §3.3 says "sha256 of embed text"). With the text alone, an alias or tier edit would leave a stale payload behind because an unchanged hash skips the point. The cost is a re-embed of that page (cents).
- **Unchanged points get `refreshRun`** (a `setPayload` of `runId`, `manualVersion`, `ingestedAt`), a store method the spec's list does not name; the sweep needs it, since it deletes every point whose `runId` is not this run's.
- **The CLI lives at `packages/manual/src/bin/manual.ts`** (spec: `bin/manual.ts`), because every package compiles with `rootDir: ./src`; it builds to `dist/bin/manual.js`, which the root scripts and the package `bin` point at.
- **`map.md` carries a `<!-- sources -->` line** like every page (rule 8 applies to its claims too); the ingest strips it before storing the row, so the prompt never shows it.
- **`getManualPage` joins and caps in the tool**, not in the store; the store returns the ordered sections. Same output as the spec describes.

---

## File Structure

### Agent repo (`/Users/jenova/projects/recoverysky-org/agent`)

```
packages/types/src/manual.ts                      NEW  area/platform/tier enums, payload + hit + page types
packages/types/src/index.ts                       MOD  export the above
packages/memory/src/qdrant/errors.ts              MOD  + CollectionConfigError (moved), + mapQdrantError (moved)
packages/memory/src/qdrant/schema.ts              MOD  imports CollectionConfigError from errors.js and re-exports it
packages/memory/src/qdrant/hybridQuery.ts         NEW  the prefetch dense + sparse, RRF body, returns raw points
packages/memory/src/qdrant/index.ts               MOD  export hybridQuery, mapQdrantError
packages/memory/src/stores/QdrantVectorStore.ts   MOD  hybridSearch calls hybridQuery; imports mapQdrantError
packages/memory/src/stores/ManualVectorStore.ts   NEW  the manual collection: check, search, getPage, ensure, upsert, refreshRun, sweep, findByIds
packages/memory/src/stores/index.ts               MOD  export ManualVectorStore
packages/memory/src/index.ts                      MOD  export ManualVectorStore, MANUAL_COLLECTION, hybridQuery
packages/memory/tests/qdrant/hybridQuery.test.ts  NEW
packages/memory/tests/stores/ManualVectorStore.test.ts NEW
packages/tools/src/manualTools.ts                 NEW  createManualTools(ctx), setManualQdrantStore, setManualEmbeddingProvider, clearManualProviders
packages/tools/src/chatTools.ts                   MOD  spread createManualTools(ctx)
packages/tools/src/index.ts                       MOD  export the above
packages/tools/tests/manualTools.test.ts          NEW
packages/agent/src/systemPrompt.ts                MOD  appManual option + section; TOOL_INSTRUCTIONS 7–8; FIRST_MEMORY_TOOL_NUMBER 9
packages/agent/tests/systemPrompt.test.ts         MOD  + "app manual" describe
packages/pipeline/src/Pipeline.ts                 MOD  deps.appManual / deps.getManualMap; STAGE 5b; pass appManual
packages/pipeline/tests/Pipeline.test.ts          MOD  + three manual-map tests
packages/pipeline/tests/toolList.test.ts          UNCHANGED (must stay green: it checks the list against createChatTools)
apps/api/src/services/systemPrompts.ts            MOD  cached-prompt helper; manualMap getter; loadManualMap()
apps/api/src/services/systemPrompts.test.ts       MOD  + manual map tests
apps/api/src/container.ts                         MOD  ManualVectorStore, setters, init check, deps.appManual / getManualMap
packages/db/src/stores/SystemPromptRepository.ts  MOD  + replaceActive(name, content)
packages/db/tests/integration/systemPrompts.integration.test.ts NEW (DB_TEST_URL-gated)
packages/manual/package.json, tsconfig.json, vitest.config.ts, README.md  NEW
packages/manual/src/index.ts                      NEW  exports
packages/manual/src/parse.ts                      NEW  pure: front-matter, sources, H2 chunking, caps, ids, texts, hash, map + questions validation
packages/manual/src/files.ts                      NEW  I/O: read a manual directory
packages/manual/src/env.ts                        NEW  pure: host names from env, localhost check
packages/manual/src/ingest.ts                     NEW  runIngest(options, deps) with injected store / embedding / prompts
packages/manual/src/check.ts                      NEW  runQuestions(questions, deps, ctx)
packages/manual/src/bin/manual.ts                 NEW  CLI (dotenv, commander), builds the real deps
packages/manual/tests/parse.test.ts, ingest.test.ts, check.test.ts, env.test.ts NEW
packages/manual/tests/fixtures/manual/**          NEW  a two-page fixture corpus
package.json (root)                               MOD  scripts manual:ingest, manual:check
tsconfig.json (root)                              MOD  reference packages/manual
CLAUDE.md, docs/QDRANT.md, .env.example           MOD  document the manual
```

### App repo (`/Users/jenova/projects/recoverysky-org/app`)

```
docs/manual/README.md                             NEW  authoring rules (never ingested)
docs/manual/map.md                                NEW  the prompt section
docs/manual/questions.yml                         NEW  retrieval smoke test
docs/manual/backup-and-devices/cloud-backup.md    NEW
docs/manual/backup-and-devices/using-more-than-one-device.md NEW
docs/manual/backup-and-devices/new-phone.md       NEW
docs/manual/backup-and-devices/one-account-per-phone.md NEW
docs/manual/backup-and-devices/if-backup-isnt-working.md NEW
CLAUDE.md                                         MOD  "User's Manual" section, Repo Docs Map bullet, two release lines
CHANGELOG.md                                      MOD  [Unreleased] → ### Docs → (manual) entry
```

Task order: 0–6 agent (store, tools, prompt, wiring, repository), 7–9 app (rules, map, pages, review), 10–11 agent (the ingest package, dry-run against the real pages), 12 app docs, 13 agent docs, 14 end-to-end against dev.

---

### Task 0: Baseline on both checkouts (no commit)

**Files:** none changed.

- [ ] **Step 1: Create the agent branch and rebuild**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
git status --short            # must be empty
git checkout -b feat/manual-rag prod
pnpm install --frozen-lockfile
pnpm build                    # workspace packages resolve through dist
```

- [ ] **Step 2: Record the red suites on the clean tree**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm vitest run 2>&1 | tail -40
```

Expected after the rebuild: `Test Files  0 failed | 112 passed | 3 skipped` (the three skipped are the `DB_TEST_URL` integration suites). Write whatever actually fails into `.superpowers/sdd/<plan>/ledger.md` (or the task notes) as "red before Task 1". Those files are not regressions of this plan; every later "run the suite" step compares against this list.

- [ ] **Step 3: Create the app branch**

```bash
cd /Users/jenova/projects/recoverysky-org/app
git status --short            # foreign files from other sessions are fine; note them, never stage them
git checkout -b feat/user-manual root
```

---

### Task 1: Share the hybrid query and the Qdrant error mapping (agent, `packages/memory`)

**Files:**
- Create: `packages/memory/src/qdrant/hybridQuery.ts`
- Modify: `packages/memory/src/qdrant/errors.ts` (whole file below)
- Modify: `packages/memory/src/qdrant/schema.ts:72-81` (the `CollectionConfigError` class) and its imports
- Modify: `packages/memory/src/qdrant/index.ts`
- Modify: `packages/memory/src/stores/QdrantVectorStore.ts:33-34, 92-172, 546-604`
- Test: `packages/memory/tests/qdrant/hybridQuery.test.ts` (new); `packages/memory/tests/stores/QdrantVectorStore.test.ts` and `tests/qdrant/schema.test.ts` unchanged and green

**Interfaces:**
- Produces `hybridQuery(client, collectionName, queryEmbedding, queryText, { filter?, limit }): Promise<RawPoint[]>` with `RawPoint = { id: string | number; score: number; payload?: Record<string, unknown> | null }`.
- Produces `mapQdrantError(error: unknown): StoreError` and `CollectionConfigError` from `qdrant/errors.ts` (schema.ts keeps re-exporting the class, so every existing import still works).

- [ ] **Step 1: Write the failing test**

`packages/memory/tests/qdrant/hybridQuery.test.ts`:

```ts
/**
 * The hybrid query body shared by the messages and manual stores: a dense
 * prefetch and a sparse (BM25) prefetch fused with RRF, raw points back.
 */
import { describe, it, expect, vi } from "vitest";
import { hybridQuery } from "../../src/qdrant/hybridQuery.js";
import { getBM25Embedder } from "../../src/qdrant/bm25.js";
import { DENSE_VECTOR_NAME, SPARSE_VECTOR_NAME } from "../../src/qdrant/schema.js";

vi.mock("@recoverysky/observability", () => ({
  getLogger: () => ({ child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
  withSpan: <T>(_name: string, fn: () => T) => fn(),
  hashUserId: (id: string) => `hash-${id}`,
  pipelineMetrics: { errors: { add: vi.fn() }, memoryCacheHits: { add: vi.fn() } },
}));

const embedding = () => Array(1536).fill(0.25);

describe("hybridQuery", () => {
  it("prefetches dense and sparse with the filter, fuses with rrf and returns the points", async () => {
    const points = [{ id: "p1", score: 0.5, payload: { page: "a/b" } }];
    const client = { query: vi.fn().mockResolvedValue({ points }) };
    const filter = { must: [{ key: "area", match: { value: "settings" } }] };

    const result = await hybridQuery(client as never, "manual", embedding(), "back up attendance", { filter, limit: 5 });

    expect(result).toEqual(points);
    const sparse = getBM25Embedder().embed("back up attendance");
    expect(client.query).toHaveBeenCalledWith("manual", {
      prefetch: [
        { query: embedding(), using: DENSE_VECTOR_NAME, filter, limit: 10 },
        { query: { indices: sparse.indices, values: sparse.values }, using: SPARSE_VECTOR_NAME, filter, limit: 10 },
      ],
      query: { fusion: "rrf" },
      limit: 5,
      with_payload: true,
    });
  });

  it("sends no filter when the filter object is empty", async () => {
    const client = { query: vi.fn().mockResolvedValue({ points: [] }) };

    await hybridQuery(client as never, "messages", embedding(), "hello", { filter: {}, limit: 3 });

    const body = client.query.mock.calls[0][1] as { prefetch: Array<{ filter?: unknown }> };
    expect(body.prefetch[0].filter).toBeUndefined();
    expect(body.prefetch[1].filter).toBeUndefined();
  });

  it("lets a client error propagate for the caller to map", async () => {
    const client = { query: vi.fn().mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 })) };

    await expect(hybridQuery(client as never, "manual", embedding(), "x", { limit: 1 })).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm vitest run packages/memory/tests/qdrant/hybridQuery.test.ts
```

Expected: FAIL, `Cannot find module '../../src/qdrant/hybridQuery.js'`.

- [ ] **Step 3: Create `hybridQuery.ts`**

`packages/memory/src/qdrant/hybridQuery.ts`:

```ts
/**
 * The hybrid query body shared by every hybrid collection (messages, manual):
 * a dense prefetch and a sparse BM25 prefetch over the same filter, fused by
 * Reciprocal Rank Fusion. Returns raw points; each store maps its own payload.
 *
 * MOVED 2026-10-12 out of QdrantVectorStore.hybridSearch, which was private
 * and mapped straight to MessagePayload, so the manual store could not reuse
 * it. The messages path behaves exactly as before.
 */

import type { QdrantClient } from '@qdrant/js-client-rest'
import { DENSE_VECTOR_NAME, SPARSE_VECTOR_NAME } from './schema.js'
import { getBM25Embedder } from './bm25.js'

export interface HybridQueryOptions {
  /** Qdrant filter object; an empty object or undefined means no filter */
  filter?: Record<string, unknown>
  /** Points to return after fusion; each prefetch fetches twice as many */
  limit: number
}

/** A point as the query API returns it, before any store maps its payload */
export interface RawPoint {
  id: string | number
  score: number
  payload?: Record<string, unknown> | null
}

export async function hybridQuery(
  client: QdrantClient,
  collectionName: string,
  queryEmbedding: number[],
  queryText: string,
  options: HybridQueryOptions
): Promise<RawPoint[]> {
  const filter = options.filter && Object.keys(options.filter).length > 0 ? options.filter : undefined
  const sparseVector = getBM25Embedder().embed(queryText)

  const result = await client.query(collectionName, {
    prefetch: [
      {
        // Dense vector search
        query: queryEmbedding,
        using: DENSE_VECTOR_NAME,
        filter,
        limit: options.limit * 2, // Fetch more for fusion
      },
      {
        // Sparse BM25 vector search
        query: { indices: sparseVector.indices, values: sparseVector.values },
        using: SPARSE_VECTOR_NAME,
        filter,
        limit: options.limit * 2,
      },
    ],
    query: { fusion: 'rrf' }, // Reciprocal Rank Fusion to combine results
    limit: options.limit,
    with_payload: true,
  })

  return result.points.map((point) => ({
    id: point.id,
    score: point.score,
    payload: (point.payload ?? null) as Record<string, unknown> | null,
  }))
}
```

- [ ] **Step 4: Move `CollectionConfigError` and `mapQdrantError` into `errors.ts`**

Replace `packages/memory/src/qdrant/errors.ts` with:

```ts
/**
 * Qdrant errors: the log fields to record, the config-mismatch error, and
 * the mapping from a thrown error to a StoreError.
 *
 * Log the fields, never the error itself: an unexpected-response error quotes
 * the response body, and a caller's error may carry request data.
 *
 * MOVED 2026-10-12: CollectionConfigError (from schema.ts) and mapQdrantError
 * (from QdrantVectorStore.ts) live here so ManualVectorStore can share them.
 * schema.ts re-exports CollectionConfigError, so existing imports still work.
 * The class lives here rather than in schema.ts because schema.ts imports
 * this file, and the other direction would be a cycle.
 */

import type { StoreError } from '@recoverysky/types'

/** A short machine code (ECONNREFUSED, ETIMEDOUT), never free text */
const CODE_PATTERN = /^[A-Za-z0-9_]{1,40}$/

export function qdrantErrorFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { errorName: typeof error }
  }
  const { status, code } = error as Error & { status?: unknown; code?: unknown }
  return {
    errorName: error.name,
    ...(typeof status === 'number' && { status }),
    ...(typeof code === 'string' && CODE_PATTERN.test(code) && { code }),
  }
}

/**
 * An existing collection whose vectors differ from what this code writes and
 * queries. Every write and search against it would fail with a 400.
 */
export class CollectionConfigError extends Error {
  constructor(collectionName: string, reason: string) {
    super(`Qdrant collection "${collectionName}" does not match: ${reason}`)
    this.name = 'CollectionConfigError'
  }
}

/**
 * Map Qdrant errors to StoreError types
 */
export function mapQdrantError(error: unknown): StoreError {
  const e = error as Error & { status?: number; code?: string }
  const message = e?.message ?? 'Unknown Qdrant error'
  const status = e?.status
  const code = e?.code

  // An existing collection with other vectors: every call would be a 400
  if (error instanceof CollectionConfigError) {
    return {
      kind: 'ValidationError',
      message: error.message,
      context: {},
      cause: error,
    }
  }

  // The client's own timeout aborts the request ("This operation was aborted")
  if (e?.name === 'QdrantClientTimeoutError') {
    return {
      kind: 'TimeoutError',
      message: 'Qdrant operation timed out',
      context: {},
      cause: error,
    }
  }

  // Connection errors
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    message.includes('ECONNRESET') ||
    message.includes('fetch failed')
  ) {
    return {
      kind: 'ConnectionError',
      message: `Qdrant connection failed: ${message}`,
      context: { code, status },
      cause: error,
    }
  }

  // Timeout errors
  if (code === 'ETIMEDOUT' || message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return {
      kind: 'TimeoutError',
      message: `Qdrant operation timed out: ${message}`,
      context: { code, status },
      cause: error,
    }
  }

  // Validation errors (400)
  if (status === 400) {
    return {
      kind: 'ValidationError',
      message: `Qdrant validation error: ${message}`,
      context: { status },
      cause: error,
    }
  }

  // Not found (404)
  if (status === 404) {
    return {
      kind: 'NotFoundError',
      message: `Qdrant resource not found: ${message}`,
      context: { status },
      cause: error,
    }
  }

  return {
    kind: 'UnexpectedError',
    message: `Qdrant error: ${message}`,
    context: { code, status },
    cause: error,
  }
}
```

In `packages/memory/src/qdrant/schema.ts`: delete the `CollectionConfigError` class (lines 72–81) and change the errors import to

```ts
import { qdrantErrorFields, CollectionConfigError } from './errors.js'
export { CollectionConfigError }
```

In `packages/memory/src/qdrant/index.ts`: add

```ts
export { qdrantErrorFields, mapQdrantError, CollectionConfigError } from './errors.js'
export { hybridQuery, type HybridQueryOptions, type RawPoint } from './hybridQuery.js'
```

and remove `CollectionConfigError` from the `./schema.js` export list (it is now exported from errors above; exporting the same name twice is a compile error).

- [ ] **Step 5: Make `QdrantVectorStore` use both**

In `packages/memory/src/stores/QdrantVectorStore.ts`:

1. Replace the import of `qdrantErrorFields` (line 33) with `import { qdrantErrorFields, mapQdrantError } from '../qdrant/errors.js'` and add `import { hybridQuery } from '../qdrant/hybridQuery.js'`.
2. Delete the whole local `mapQdrantError` function (lines 92–172, the doc comment included).
3. Replace the body of `hybridSearch` (lines 546–604) with:

```ts
  /**
   * Hybrid search combining dense vector similarity with BM25 sparse keyword matching
   * Uses Qdrant's query API with prefetch for RRF (Reciprocal Rank Fusion)
   * CHANGED 2026-10-12: the query body moved to qdrant/hybridQuery.ts so the
   * manual store shares it; this method only maps the payload.
   */
  private async hybridSearch(
    queryEmbedding: number[],
    queryText: string,
    filter: Record<string, unknown>,
    limit: number,
    _scoreThreshold: number
  ): Promise<SemanticMatch[]> {
    const points = await hybridQuery(this.client, this.collectionName, queryEmbedding, queryText, { filter, limit })
    return this.mapSearchResults(points)
  }
```

`getBM25Embedder` stays imported: `indexMessage` and `batchIndex` still use it.

- [ ] **Step 6: Run the memory package tests**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm --filter @recoverysky/memory typecheck
pnpm vitest run packages/memory
```

Expected: the new file passes (3 tests); `tests/stores/QdrantVectorStore.test.ts` and `tests/qdrant/schema.test.ts` pass unchanged. If `schema.test.ts` imports `CollectionConfigError` from `../../src/qdrant/schema.js`, it still resolves through the re-export.

- [ ] **Step 7: Rebuild and run the dependants**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm build && pnpm vitest run packages/tools packages/pipeline apps/api
```

Expected: same result as the Task 0 baseline.

- [ ] **Step 8: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
git add packages/memory/src/qdrant/hybridQuery.ts packages/memory/src/qdrant/errors.ts packages/memory/src/qdrant/schema.ts packages/memory/src/qdrant/index.ts packages/memory/src/stores/QdrantVectorStore.ts packages/memory/tests/qdrant/hybridQuery.test.ts
git commit -m "♻️ refactor(memory): share the hybrid query body and the Qdrant error mapping

The manual collection needs the same dense + sparse RRF query the messages
store runs and the same error mapping. hybridQuery returns raw points; each
store maps its own payload. CollectionConfigError moves beside mapQdrantError
(schema.ts re-exports it) so errors.ts never imports schema.ts.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The manual types and `ManualVectorStore` (agent, `packages/types`, `packages/memory`)

**Files:**
- Create: `packages/types/src/manual.ts`
- Modify: `packages/types/src/index.ts` (add an export block)
- Create: `packages/memory/src/stores/ManualVectorStore.ts`
- Modify: `packages/memory/src/stores/index.ts`, `packages/memory/src/index.ts`
- Test: `packages/memory/tests/stores/ManualVectorStore.test.ts`

**Interfaces:**
- Consumes: `hybridQuery`, `mapQdrantError`, `CollectionConfigError` (Task 1); `collectionConfigProblem`, `VECTOR_SIZE`, `DISTANCE_METRIC`, `DENSE_VECTOR_NAME`, `SPARSE_VECTOR_NAME` from `qdrant/schema.ts`; `SparseVector` from `qdrant/bm25.ts`.
- Produces (from `@recoverysky/types`): `MANUAL_COLLECTION = 'manual'`, `MANUAL_AREAS`, `MANUAL_PLATFORMS`, `MANUAL_TIERS`, types `ManualArea`, `ManualPlatform`, `ManualTier`, `ManualChunkPayload`, `ManualSearchHit`, `ManualPageSection`, `ManualPage`.
- Produces (from `@recoverysky/memory`): `class ManualVectorStore` with `checkCollection()`, `search(queryEmbedding, queryText, { area?, platform?, limit }, ctx)`, `getPage(page, ctx)`, `ensureCollection()`, `upsert(points: ManualPoint[])`, `refreshRun(pointIds, run)`, `deleteWhereRunIdNot(runId)`, `findByIds(pointIds)`; and `interface ManualPoint { id: string; dense: number[]; sparse: SparseVector; payload: ManualChunkPayload }`.

- [ ] **Step 1: Add the shared types**

`packages/types/src/manual.ts`:

```ts
/**
 * The user's manual Sky searches: the Qdrant collection, its front-matter
 * vocabulary, the payload of one chunk, and what the tools hand the model.
 * Shared by the memory store, the tools and the ingest package.
 * Spec: app repo docs/superpowers/specs/2026-10-12-user-manual-rag-design.md
 */

/** The Qdrant collection the manual lives in */
export const MANUAL_COLLECTION = 'manual'

/** The areas of docs/manual/, one folder each; front-matter `area` and the folder must agree */
export const MANUAL_AREAS = [
  'getting-started',
  'home',
  'meetings',
  'attendance',
  'settings',
  'backup-and-devices',
  'account',
  'privacy',
  'sky',
  'status',
] as const
export type ManualArea = (typeof MANUAL_AREAS)[number]

export const MANUAL_PLATFORMS = ['ios', 'android', 'web'] as const
export type ManualPlatform = (typeof MANUAL_PLATFORMS)[number]

/** What a user needs to use the feature a page describes */
export const MANUAL_TIERS = ['free', 'attendance', 'premium'] as const
export type ManualTier = (typeof MANUAL_TIERS)[number]

/** The payload of one point: one H2 section of one page (order 0 is the intro) */
export interface ManualChunkPayload {
  corpus: 'manual'
  /** Page id, `<area>/<name>` (the file path without .md) */
  page: string
  /** 0 = intro paragraph, then one per H2 in document order */
  order: number
  /** '' for the intro */
  heading: string
  title: string
  area: ManualArea
  /** On-screen breadcrumb, e.g. "Settings → Cloud Backup" */
  screen: string
  /** Always the full list; the ingest fills the default in */
  platforms: ManualPlatform[]
  tier: ManualTier
  aliases: string[]
  /** The section text, without its heading line */
  content: string
  /** sha256 of what was embedded plus the filter fields; unchanged → not re-embedded */
  contentHash: string
  /** `git describe --tags --always` of the app checkout the ingest read */
  manualVersion: string
  /** The ingest run that last wrote or refreshed this point; the sweep deletes other runs */
  runId: string
  /** Unix ms */
  ingestedAt: number
}

/** One searchManual hit: a section with its breadcrumb */
export interface ManualSearchHit {
  page: string
  title: string
  screen: string
  heading: string
  tier: ManualTier
  platforms: ManualPlatform[]
  content: string
  score: number
}

export interface ManualPageSection {
  order: number
  heading: string
  content: string
}

/** One whole page, sections in document order */
export interface ManualPage {
  page: string
  title: string
  screen: string
  tier: ManualTier
  platforms: ManualPlatform[]
  sections: ManualPageSection[]
}
```

In `packages/types/src/index.ts`, beside the other export blocks, add:

```ts
// The user's manual (Sky's reference to the app)
export {
  MANUAL_COLLECTION,
  MANUAL_AREAS,
  MANUAL_PLATFORMS,
  MANUAL_TIERS,
} from './manual.js'
export type {
  ManualArea,
  ManualPlatform,
  ManualTier,
  ManualChunkPayload,
  ManualSearchHit,
  ManualPageSection,
  ManualPage,
} from './manual.js'
```

Then `cd /Users/jenova/projects/recoverysky-org/agent && pnpm --filter @recoverysky/types build` so the memory package can see the new exports.

- [ ] **Step 2: Write the failing store tests**

`packages/memory/tests/stores/ManualVectorStore.test.ts`:

```ts
/**
 * ManualVectorStore against a fake Qdrant client: filters, payload mapping,
 * page assembly, the layout check, and the ingest-side writes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ManualVectorStore, type ManualPoint } from "../../src/stores/ManualVectorStore.js";
import { DENSE_VECTOR_NAME, SPARSE_VECTOR_NAME } from "../../src/qdrant/schema.js";
import type { TraceContext } from "@recoverysky/types";

const { logSpy, childSpy } = vi.hoisted(() => ({
  logSpy: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  childSpy: vi.fn(),
}));

vi.mock("@recoverysky/observability", () => ({
  getLogger: () => ({
    child: (bindings: Record<string, unknown>) => {
      childSpy(bindings);
      return logSpy;
    },
  }),
  hashUserId: (id: string) => `hash-${id}`,
  withSpan: <T>(_name: string, fn: () => T) => fn(),
  pipelineMetrics: { errors: { add: vi.fn() }, memoryCacheHits: { add: vi.fn() } },
}));

function collectionInfo(mode: "simple" | "hybrid", size = 1536) {
  return {
    points_count: 10,
    config: {
      params:
        mode === "simple"
          ? { vectors: { size, distance: "Cosine" } }
          : {
              vectors: { [DENSE_VECTOR_NAME]: { size, distance: "Cosine" } },
              sparse_vectors: { [SPARSE_VECTOR_NAME]: {} },
            },
    },
  };
}

function createMockClient() {
  return {
    getCollections: vi.fn().mockResolvedValue({ collections: [{ name: "manual" }] }),
    getCollection: vi.fn().mockResolvedValue(collectionInfo("hybrid")),
    createCollection: vi.fn().mockResolvedValue(true),
    createPayloadIndex: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue({ points: [] }),
    scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    upsert: vi.fn().mockResolvedValue({}),
    setPayload: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue({ count: 0 }),
    delete: vi.fn().mockResolvedValue({}),
    retrieve: vi.fn().mockResolvedValue([]),
  };
}

const ctx: TraceContext = { traceId: "t", spanId: "s", requestId: "req-1", startTime: 0 };
const embedding = () => Array(1536).fill(0.1);

function payload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    corpus: "manual",
    page: "backup-and-devices/new-phone",
    order: 1,
    heading: "Before you switch",
    title: "Moving to a new phone",
    area: "backup-and-devices",
    screen: "Settings → Cloud Backup",
    platforms: ["ios", "android"],
    tier: "attendance",
    aliases: ["new phone"],
    content: "Turn on backup on the old phone first.",
    contentHash: "abc",
    manualVersion: "v4.11.0-4",
    runId: "run-1",
    ingestedAt: 1,
    ...overrides,
  };
}

describe("ManualVectorStore", () => {
  let client: ReturnType<typeof createMockClient>;
  let store: ManualVectorStore;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    store = new ManualVectorStore(client as never);
  });

  describe("search", () => {
    it("filters by area and platform with must matches", async () => {
      await store.search(embedding(), "new phone", { area: "backup-and-devices", platform: "android", limit: 5 }, ctx);

      const body = client.query.mock.calls[0][1] as { prefetch: Array<{ filter?: unknown }> };
      expect(body.prefetch[0].filter).toEqual({
        must: [
          { key: "area", match: { value: "backup-and-devices" } },
          { key: "platforms", match: { value: "android" } },
        ],
      });
    });

    it("sends no filter without area or platform", async () => {
      await store.search(embedding(), "new phone", { limit: 5 }, ctx);

      const body = client.query.mock.calls[0][1] as { prefetch: Array<{ filter?: unknown }> };
      expect(body.prefetch[0].filter).toBeUndefined();
    });

    it("maps payloads to hits and drops points without a page or content, counting them", async () => {
      client.query.mockResolvedValue({
        points: [
          { id: "1", score: 0.9, payload: payload() },
          { id: "2", score: 0.8, payload: payload({ content: undefined }) },
          { id: "3", score: 0.7, payload: { title: "no page" } },
        ],
      });

      const result = await store.search(embedding(), "new phone", { limit: 5 }, ctx);

      expect(result.ok && result.value).toEqual([
        {
          page: "backup-and-devices/new-phone",
          title: "Moving to a new phone",
          screen: "Settings → Cloud Backup",
          heading: "Before you switch",
          tier: "attendance",
          platforms: ["ios", "android"],
          content: "Turn on backup on the old phone first.",
          score: 0.9,
        },
      ]);
      expect(logSpy.warn).toHaveBeenCalledWith({ dropped: 2 }, expect.any(String));
    });

    it("logs the query length, never its text", async () => {
      await store.search(embedding(), "my private words", { limit: 5 }, ctx);

      const logged = JSON.stringify([childSpy.mock.calls, logSpy.debug.mock.calls, logSpy.info.mock.calls]);
      expect(logged).not.toContain("my private words");
      expect(logged).toContain('"queryChars":16');
    });

    it("maps a thrown 404 to NotFoundError", async () => {
      client.query.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));

      const result = await store.search(embedding(), "x", { limit: 5 }, ctx);

      expect(!result.ok && result.error.kind).toBe("NotFoundError");
    });
  });

  describe("getPage", () => {
    it("scrolls by page, orders sections by order and returns the page", async () => {
      client.scroll.mockResolvedValue({
        points: [
          { id: "b", payload: payload({ order: 2, heading: "On the new phone", content: "Sign in." }) },
          { id: "a", payload: payload({ order: 0, heading: "", content: "Intro." }) },
          { id: "c", payload: payload({ order: 1, heading: "Before you switch", content: "Back up." }) },
        ],
        next_page_offset: null,
      });

      const result = await store.getPage("backup-and-devices/new-phone", ctx);

      expect(client.scroll).toHaveBeenCalledWith("manual", {
        filter: { must: [{ key: "page", match: { value: "backup-and-devices/new-phone" } }] },
        limit: 64,
        with_payload: true,
        with_vector: false,
      });
      expect(result.ok && result.value).toEqual({
        page: "backup-and-devices/new-phone",
        title: "Moving to a new phone",
        screen: "Settings → Cloud Backup",
        tier: "attendance",
        platforms: ["ios", "android"],
        sections: [
          { order: 0, heading: "", content: "Intro." },
          { order: 1, heading: "Before you switch", content: "Back up." },
          { order: 2, heading: "On the new phone", content: "Sign in." },
        ],
      });
    });

    it("returns null for a page with no points", async () => {
      const result = await store.getPage("account/nowhere", ctx);
      expect(result.ok && result.value).toBeNull();
    });
  });

  describe("checkCollection", () => {
    it("accepts the hybrid layout", async () => {
      const result = await store.checkCollection();
      expect(result.ok).toBe(true);
      expect(client.getCollection).toHaveBeenCalledWith("manual");
    });

    it("reports a dense-only collection as a ValidationError naming the dense vector", async () => {
      client.getCollection.mockResolvedValue(collectionInfo("simple"));

      const result = await store.checkCollection();

      expect(!result.ok && result.error.kind).toBe("ValidationError");
      expect(!result.ok && result.error.message).toMatch(/"dense"/);
    });

    it("reports a missing collection", async () => {
      client.getCollection.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));

      const result = await store.checkCollection();

      expect(!result.ok && result.error.kind).toBe("NotFoundError");
    });
  });

  describe("ingest writes", () => {
    it("ensureCollection creates the hybrid layout and six payload indexes when missing", async () => {
      client.getCollections.mockResolvedValue({ collections: [] });

      await store.ensureCollection();

      expect(client.createCollection).toHaveBeenCalledWith("manual", {
        vectors: { [DENSE_VECTOR_NAME]: { size: 1536, distance: "Cosine", on_disk: true } },
        sparse_vectors: { [SPARSE_VECTOR_NAME]: { index: { on_disk: true } } },
        optimizers_config: { default_segment_number: 2, indexing_threshold: 20000 },
      });
      const fields = client.createPayloadIndex.mock.calls.map((c) => (c[1] as { field_name: string; field_schema: string }).field_name);
      expect(fields).toEqual(["page", "area", "platforms", "tier", "runId", "order"]);
      expect((client.createPayloadIndex.mock.calls[5][1] as { field_schema: string }).field_schema).toBe("integer");
    });

    it("ensureCollection keeps an existing hybrid collection and throws on another layout", async () => {
      await store.ensureCollection();
      expect(client.createCollection).not.toHaveBeenCalled();

      client.getCollection.mockResolvedValue(collectionInfo("simple"));
      await expect(store.ensureCollection()).rejects.toMatchObject({ name: "CollectionConfigError" });
    });

    it("upsert writes named dense and sparse vectors in batches of 100", async () => {
      const points: ManualPoint[] = Array.from({ length: 150 }, (_, i) => ({
        id: `id-${i}`,
        dense: embedding(),
        sparse: { indices: [1], values: [1] },
        payload: payload({ order: i }) as never,
      }));

      await store.upsert(points);

      expect(client.upsert).toHaveBeenCalledTimes(2);
      const first = client.upsert.mock.calls[0][1] as { wait: boolean; points: Array<{ id: string; vector: Record<string, unknown> }> };
      expect(first.wait).toBe(true);
      expect(first.points).toHaveLength(100);
      expect(first.points[0]).toEqual({
        id: "id-0",
        vector: { [DENSE_VECTOR_NAME]: embedding(), [SPARSE_VECTOR_NAME]: { indices: [1], values: [1] } },
        payload: payload({ order: 0 }),
      });
    });

    it("refreshRun sets only the run fields on the given points", async () => {
      await store.refreshRun(["a", "b"], { runId: "run-2", manualVersion: "v5", ingestedAt: 2 });

      expect(client.setPayload).toHaveBeenCalledWith("manual", {
        wait: true,
        payload: { runId: "run-2", manualVersion: "v5", ingestedAt: 2 },
        points: ["a", "b"],
      });
    });

    it("deleteWhereRunIdNot counts then deletes with a must_not filter", async () => {
      client.count.mockResolvedValue({ count: 3 });

      const deleted = await store.deleteWhereRunIdNot("run-2");

      const filter = { must_not: [{ key: "runId", match: { value: "run-2" } }] };
      expect(client.count).toHaveBeenCalledWith("manual", { filter, exact: true });
      expect(client.delete).toHaveBeenCalledWith("manual", { wait: true, filter });
      expect(deleted).toBe(3);
    });

    it("findByIds maps point id to contentHash and skips points without one", async () => {
      client.retrieve.mockResolvedValue([
        { id: "a", payload: { contentHash: "h1" } },
        { id: "b", payload: {} },
      ]);

      const found = await store.findByIds(["a", "b", "c"]);

      expect(client.retrieve).toHaveBeenCalledWith("manual", { ids: ["a", "b", "c"], with_payload: ["contentHash"], with_vector: false });
      expect([...found.entries()]).toEqual([["a", "h1"]]);
    });

    it("findByIds returns an empty map for no ids without calling Qdrant", async () => {
      expect((await store.findByIds([])).size).toBe(0);
      expect(client.retrieve).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm vitest run packages/memory/tests/stores/ManualVectorStore.test.ts
```

Expected: FAIL, `Cannot find module '../../src/stores/ManualVectorStore.js'`.

- [ ] **Step 4: Write the store**

`packages/memory/src/stores/ManualVectorStore.ts`:

```ts
/**
 * The user's manual in Qdrant: the `manual` collection, hybrid layout
 * (named dense 1536/Cosine + named sparse BM25), one point per H2 section.
 *
 * Read by the searchManual / getManualPage tools; written only by the ingest
 * (packages/manual). The chunk text lives in the payload: nothing is hydrated
 * from Postgres, unlike literature.
 * Spec: app repo docs/superpowers/specs/2026-10-12-user-manual-rag-design.md §2.4
 */

import type { QdrantClient } from '@qdrant/js-client-rest'
import type {
  ManualChunkPayload,
  ManualPage,
  ManualPageSection,
  ManualPlatform,
  ManualSearchHit,
  ManualTier,
  Result,
  StoreError,
  TraceContext,
} from '@recoverysky/types'
import { MANUAL_COLLECTION, ok, err } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import {
  VECTOR_SIZE,
  DISTANCE_METRIC,
  DENSE_VECTOR_NAME,
  SPARSE_VECTOR_NAME,
  collectionConfigProblem,
} from '../qdrant/schema.js'
import { qdrantErrorFields, mapQdrantError, CollectionConfigError } from '../qdrant/errors.js'
import { hybridQuery, type RawPoint } from '../qdrant/hybridQuery.js'
import type { SparseVector } from '../qdrant/bm25.js'

export interface ManualSearchOptions {
  area?: string
  platform?: string
  limit: number
}

/** One point the ingest writes */
export interface ManualPoint {
  id: string
  dense: number[]
  sparse: SparseVector
  payload: ManualChunkPayload
}

/** The fields a re-run refreshes on an unchanged point */
export interface ManualRunFields {
  runId: string
  manualVersion: string
  ingestedAt: number
}

/** Most sections one page can have (a page is ~6 H2s; 64 is a bound, not a target) */
const MAX_SECTIONS_PER_PAGE = 64
/** Points per upsert / setPayload / retrieve call */
const BATCH_SIZE = 100

/** The payload indexes every filter the tools and the sweep use */
const PAYLOAD_INDEXES: Array<{ field_name: string; field_schema: 'keyword' | 'integer' }> = [
  { field_name: 'page', field_schema: 'keyword' },
  { field_name: 'area', field_schema: 'keyword' },
  { field_name: 'platforms', field_schema: 'keyword' },
  { field_name: 'tier', field_schema: 'keyword' },
  { field_name: 'runId', field_schema: 'keyword' },
  { field_name: 'order', field_schema: 'integer' },
]

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** A point as a hit, or null when it lacks the page or content the tool needs */
function toHit(point: RawPoint): ManualSearchHit | null {
  const p = point.payload ?? {}
  if (typeof p.page !== 'string' || typeof p.content !== 'string') return null
  return {
    page: p.page,
    title: typeof p.title === 'string' ? p.title : '',
    screen: typeof p.screen === 'string' ? p.screen : '',
    heading: typeof p.heading === 'string' ? p.heading : '',
    tier: (typeof p.tier === 'string' ? p.tier : 'free') as ManualTier,
    platforms: stringList(p.platforms) as ManualPlatform[],
    content: p.content,
    score: point.score,
  }
}

export class ManualVectorStore {
  constructor(
    private readonly client: QdrantClient,
    private readonly vectorSize: number = VECTOR_SIZE
  ) {}

  /**
   * Check that the manual collection exists with the hybrid layout the
   * tools query. Reads only; the ingest creates and writes it.
   */
  async checkCollection(): Promise<Result<void, StoreError>> {
    try {
      const info = await this.client.getCollection(MANUAL_COLLECTION)
      const problem = collectionConfigProblem(info, this.vectorSize, 'hybrid')
      if (problem) {
        return err(mapQdrantError(new CollectionConfigError(MANUAL_COLLECTION, problem)))
      }
      return ok(undefined)
    } catch (error) {
      return err(mapQdrantError(error))
    }
  }

  /**
   * Hybrid search over the manual. `area` and `platform` are must matches;
   * a keyword match on the `platforms` array matches any element.
   */
  async search(
    queryEmbedding: number[],
    queryText: string,
    options: ManualSearchOptions,
    ctx: TraceContext
  ): Promise<Result<ManualSearchHit[], StoreError>> {
    return withSpan('ManualVectorStore.search', async () => {
      const logger = getLogger().child({
        requestId: ctx.requestId,
        queryChars: queryText.length,
        area: options.area,
        platform: options.platform,
        limit: options.limit,
      })

      const must: Array<Record<string, unknown>> = []
      if (options.area) must.push({ key: 'area', match: { value: options.area } })
      if (options.platform) must.push({ key: 'platforms', match: { value: options.platform } })
      const filter = must.length > 0 ? { must } : {}

      try {
        const points = await hybridQuery(this.client, MANUAL_COLLECTION, queryEmbedding, queryText, {
          filter,
          limit: options.limit,
        })
        const hits: ManualSearchHit[] = []
        for (const point of points) {
          const hit = toHit(point)
          if (hit) hits.push(hit)
        }
        if (hits.length < points.length) {
          logger.warn({ dropped: points.length - hits.length }, 'Manual points without page or content dropped')
        }
        logger.debug({ count: hits.length }, 'Manual search completed')
        return ok(hits)
      } catch (error) {
        logger.error(qdrantErrorFields(error), 'Manual search failed')
        pipelineMetrics.errors.add(1, { kind: 'qdrant_manual_search' })
        return err(mapQdrantError(error))
      }
    })
  }

  /** One whole page, sections in order, or null when no point carries that page id */
  async getPage(page: string, ctx: TraceContext): Promise<Result<ManualPage | null, StoreError>> {
    return withSpan('ManualVectorStore.getPage', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId, page })
      try {
        const result = await this.client.scroll(MANUAL_COLLECTION, {
          filter: { must: [{ key: 'page', match: { value: page } }] },
          limit: MAX_SECTIONS_PER_PAGE,
          with_payload: true,
          with_vector: false,
        })
        const hits = result.points
          .map((point) => toHit({ id: point.id, score: 0, payload: point.payload as Record<string, unknown> | null }))
          .filter((hit): hit is ManualSearchHit => hit !== null)
        if (hits.length === 0) return ok(null)

        const ordered = result.points
          .map((point) => point.payload as Record<string, unknown> | null)
          .filter((p): p is Record<string, unknown> => !!p && typeof p.content === 'string')
          .map<ManualPageSection>((p) => ({
            order: typeof p.order === 'number' ? p.order : 0,
            heading: typeof p.heading === 'string' ? p.heading : '',
            content: p.content as string,
          }))
          .sort((a, b) => a.order - b.order)

        const first = hits[0]
        logger.debug({ sections: ordered.length }, 'Manual page read')
        return ok({
          page,
          title: first.title,
          screen: first.screen,
          tier: first.tier,
          platforms: first.platforms,
          sections: ordered,
        })
      } catch (error) {
        logger.error(qdrantErrorFields(error), 'Manual page read failed')
        pipelineMetrics.errors.add(1, { kind: 'qdrant_manual_page' })
        return err(mapQdrantError(error))
      }
    })
  }

  // ---- Ingest side (packages/manual) ----

  /**
   * Create the collection with the hybrid layout when missing, refuse another
   * layout (CollectionConfigError), and make sure every payload index exists
   * (creating an existing index is a no-op).
   */
  async ensureCollection(): Promise<void> {
    const collections = await this.client.getCollections()
    const exists = collections.collections.some((c) => c.name === MANUAL_COLLECTION)
    if (exists) {
      const problem = collectionConfigProblem(await this.client.getCollection(MANUAL_COLLECTION), this.vectorSize, 'hybrid')
      if (problem) throw new CollectionConfigError(MANUAL_COLLECTION, problem)
    } else {
      await this.client.createCollection(MANUAL_COLLECTION, {
        vectors: { [DENSE_VECTOR_NAME]: { size: this.vectorSize, distance: DISTANCE_METRIC, on_disk: true } },
        sparse_vectors: { [SPARSE_VECTOR_NAME]: { index: { on_disk: true } } },
        optimizers_config: { default_segment_number: 2, indexing_threshold: 20000 },
      })
    }
    for (const index of PAYLOAD_INDEXES) {
      await this.client.createPayloadIndex(MANUAL_COLLECTION, { ...index, wait: true })
    }
  }

  /** Upsert points in batches; `wait` so the sweep that follows sees them */
  async upsert(points: ManualPoint[]): Promise<void> {
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const batch = points.slice(i, i + BATCH_SIZE)
      await this.client.upsert(MANUAL_COLLECTION, {
        wait: true,
        points: batch.map((p) => ({
          id: p.id,
          vector: { [DENSE_VECTOR_NAME]: p.dense, [SPARSE_VECTOR_NAME]: p.sparse },
          payload: p.payload as unknown as Record<string, unknown>,
        })),
      })
    }
  }

  /** Stamp unchanged points with this run so the sweep keeps them */
  async refreshRun(pointIds: string[], run: ManualRunFields): Promise<void> {
    for (let i = 0; i < pointIds.length; i += BATCH_SIZE) {
      await this.client.setPayload(MANUAL_COLLECTION, {
        wait: true,
        payload: { ...run },
        points: pointIds.slice(i, i + BATCH_SIZE),
      })
    }
  }

  /** Delete every point another run wrote (renamed and removed pages and sections); returns how many */
  async deleteWhereRunIdNot(runId: string): Promise<number> {
    const filter = { must_not: [{ key: 'runId', match: { value: runId } }] }
    const { count } = await this.client.count(MANUAL_COLLECTION, { filter, exact: true })
    if (count > 0) {
      await this.client.delete(MANUAL_COLLECTION, { wait: true, filter })
    }
    return count
  }

  /** point id → contentHash for the ids that exist (the diff step) */
  async findByIds(pointIds: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>()
    for (let i = 0; i < pointIds.length; i += BATCH_SIZE) {
      const batch = pointIds.slice(i, i + BATCH_SIZE)
      const points = await this.client.retrieve(MANUAL_COLLECTION, {
        ids: batch,
        with_payload: ['contentHash'],
        with_vector: false,
      })
      for (const point of points) {
        const hash = (point.payload as Record<string, unknown> | null)?.contentHash
        if (typeof hash === 'string') found.set(String(point.id), hash)
      }
    }
    return found
  }
}
```

Export it. In `packages/memory/src/stores/index.ts` add:

```ts
export { ManualVectorStore, type ManualPoint, type ManualRunFields, type ManualSearchOptions } from './ManualVectorStore.js'
```

In `packages/memory/src/index.ts`, after the `QdrantVectorStore` line, add:

```ts
export { ManualVectorStore, type ManualPoint, type ManualRunFields, type ManualSearchOptions } from './stores/index.js'
```

and add `hybridQuery, type RawPoint, mapQdrantError, CollectionConfigError,` to the `./qdrant/index.js` export block (keep `qdrantErrorFields` where it is if already listed; it is not today, so add it too).

- [ ] **Step 5: Run the tests**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm --filter @recoverysky/memory typecheck
pnpm vitest run packages/memory/tests/stores/ManualVectorStore.test.ts
```

Expected: PASS, 15 tests. If the `@qdrant/js-client-rest` types reject `with_payload: ['contentHash']` on `retrieve`, pass `with_payload: { include: ['contentHash'] }` instead and change the test's expectation to match; both are valid Qdrant bodies.

- [ ] **Step 6: Rebuild and commit**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm build && pnpm vitest run packages/memory
git add packages/types/src/manual.ts packages/types/src/index.ts packages/memory/src/stores/ManualVectorStore.ts packages/memory/src/stores/index.ts packages/memory/src/index.ts packages/memory/tests/stores/ManualVectorStore.test.ts
git commit -m "✨ feat(memory): ManualVectorStore for the user's manual collection

The manual lives in a hybrid \`manual\` collection, one point per section,
chunk text in the payload. The store reads for the tools (search with area
and platform filters, one page by id, a layout check for boot) and writes for
the ingest (ensure, upsert, refresh a run, sweep other runs, diff by hash).
The front-matter vocabulary and payload type move to @recoverysky/types so
the tools and the ingest share them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The two tools, offered on every request, numbered in the prompt (agent, `packages/tools`, `packages/agent`)

The prompt's tool list and `createChatTools` must change in the same commit: `packages/pipeline/tests/toolList.test.ts` checks that the list names exactly the offered tools.

**Files:**
- Create: `packages/tools/src/manualTools.ts`
- Modify: `packages/tools/src/chatTools.ts`, `packages/tools/src/index.ts`
- Modify: `packages/agent/src/systemPrompt.ts:440-468` (`TOOL_INSTRUCTIONS`, `FIRST_MEMORY_TOOL_NUMBER`)
- Test: `packages/tools/tests/manualTools.test.ts` (new); `packages/tools/tests/literatureTools.test.ts`, `packages/pipeline/tests/toolList.test.ts`, `packages/agent/tests/systemPrompt.test.ts` green

**Interfaces:**
- Consumes: `ManualVectorStore` (Task 2), `MANUAL_AREAS`, `MANUAL_PLATFORMS` from `@recoverysky/types`, `capText` from `./text.js`.
- Produces: `createManualTools(ctx: TraceContext): { searchManual, getManualPage }`; `setManualQdrantStore(store)`, `setManualEmbeddingProvider(provider)`, `clearManualProviders()`. `searchManual` resolves `{ hits: ManualSearchHit[] }` or `{ hits: [], unavailable: true }`; `getManualPage` resolves `{ found: true, page, title, screen, tier, platforms, content }`, `{ found: false }` or `{ found: false, unavailable: true }`.

- [ ] **Step 1: Write the failing tests**

`packages/tools/tests/manualTools.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ok, err, type TraceContext } from '@recoverysky/types'
import {
  createManualTools,
  setManualQdrantStore,
  setManualEmbeddingProvider,
  clearManualProviders,
} from '../src/manualTools.js'

type LogLine = { level: string; fields: Record<string, unknown>; msg: string }
const logs = vi.hoisted(() => [] as LogLine[])

vi.mock('@recoverysky/observability', () => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (fields: unknown, msg?: string) => {
      logs.push(
        typeof fields === 'string'
          ? { level, fields: {}, msg: fields }
          : { level, fields: (fields ?? {}) as Record<string, unknown>, msg: msg ?? '' },
      )
    }
  }
  logger.child = () => logger
  return { getLogger: () => logger, withSpan: (_name: string, fn: () => unknown) => fn() }
})

const callOptions = { toolCallId: 'call-1', messages: [] }
const ctx: TraceContext = { traceId: 'trace-1', spanId: 'span-1', requestId: 'req-1', userId: 'user-1', sessionId: 'conv-1', startTime: 0 }
const userQuery = 'how do I move my attendance to my new phone'

const hit = (content = 'Turn on "Back up attendance" on the old phone first.') => ({
  page: 'backup-and-devices/new-phone',
  title: 'Moving to a new phone',
  screen: 'Settings → Cloud Backup',
  heading: 'Before you switch',
  tier: 'attendance' as const,
  platforms: ['ios', 'android'] as Array<'ios' | 'android' | 'web'>,
  content,
  score: 0.5,
})

function setUp() {
  const embedding = { embed: vi.fn(async () => ok([0.1, 0.2])) }
  const store = {
    search: vi.fn(async () => ok([hit()])),
    getPage: vi.fn(async () =>
      ok({
        page: 'backup-and-devices/new-phone',
        title: 'Moving to a new phone',
        screen: 'Settings → Cloud Backup',
        tier: 'attendance' as const,
        platforms: ['ios', 'android'] as Array<'ios' | 'android' | 'web'>,
        sections: [
          { order: 0, heading: '', content: 'Intro.' },
          { order: 1, heading: 'Before you switch', content: 'Back up first.' },
        ],
      }),
    ),
  }
  setManualQdrantStore(store as never)
  setManualEmbeddingProvider(embedding as never)
  return { embedding, store, tools: createManualTools(ctx) }
}

describe('manual tools', () => {
  beforeEach(() => {
    logs.length = 0
  })
  afterEach(() => {
    clearManualProviders()
  })

  it('offers the two manual tools', () => {
    const { tools } = setUp()
    expect(Object.keys(tools).sort()).toEqual(['getManualPage', 'searchManual'])
  })

  describe('searchManual', () => {
    it("passes the request's trace context, the query text and a limit of 5 to the store", async () => {
      const { embedding, store, tools } = setUp()

      const result = await tools.searchManual.execute!({ query: userQuery, area: 'backup-and-devices', platform: 'android' }, callOptions)

      expect(embedding.embed).toHaveBeenCalledWith(userQuery, ctx, { label: 'manual-query' })
      expect(store.search).toHaveBeenCalledWith([0.1, 0.2], userQuery, { area: 'backup-and-devices', platform: 'android', limit: 5 }, ctx)
      expect(result).toEqual({ hits: [hit()] })
    })

    it('caps each hit at 3,000 characters', async () => {
      const { store, tools } = setUp()
      store.search.mockResolvedValueOnce(ok([hit('word '.repeat(1000))]) as never)

      const result = (await tools.searchManual.execute!({ query: userQuery }, callOptions)) as { hits: Array<{ content: string }> }

      expect(Array.from(result.hits[0].content).length).toBeLessThanOrEqual(3000)
      expect(result.hits[0].content).toMatch(/…$/)
    })

    it('answers unavailable when nothing is configured', async () => {
      const tools = createManualTools(ctx)
      expect(await tools.searchManual.execute!({ query: userQuery }, callOptions)).toEqual({ hits: [], unavailable: true })
      expect(logs.find((l) => l.level === 'warn')).toBeTruthy()
    })

    it('answers unavailable when the embedding fails, logging the kind only', async () => {
      const { embedding, tools } = setUp()
      embedding.embed.mockResolvedValueOnce(err({ kind: 'RateLimitError', message: 'slow down', context: {} }) as never)

      expect(await tools.searchManual.execute!({ query: userQuery }, callOptions)).toEqual({ hits: [], unavailable: true })
      expect(logs.find((l) => l.level === 'error')?.fields).toEqual({ errorKind: 'RateLimitError' })
    })

    it('answers unavailable when the store returns an error', async () => {
      const { store, tools } = setUp()
      store.search.mockResolvedValueOnce(err({ kind: 'ConnectionError', message: 'down', context: {} }) as never)

      expect(await tools.searchManual.execute!({ query: userQuery }, callOptions)).toEqual({ hits: [], unavailable: true })
    })

    it('answers unavailable when the store throws', async () => {
      const { store, tools } = setUp()
      store.search.mockRejectedValueOnce(new Error('socket closed'))

      expect(await tools.searchManual.execute!({ query: userQuery }, callOptions)).toEqual({ hits: [], unavailable: true })
    })

    it('logs the query length, never its text', async () => {
      const { tools } = setUp()
      await tools.searchManual.execute!({ query: userQuery }, callOptions)

      expect(JSON.stringify(logs)).not.toContain(userQuery)
      expect(logs.find((l) => l.msg === 'Searching the manual')?.fields).toMatchObject({ queryChars: userQuery.length })
    })

    it('rejects a query over 300 characters at the schema', () => {
      const { tools } = setUp()
      const schema = tools.searchManual.inputSchema as { safeParse: (v: unknown) => { success: boolean } }
      expect(schema.safeParse({ query: 'x'.repeat(301) }).success).toBe(false)
      expect(schema.safeParse({ query: 'x'.repeat(300), area: 'settings', platform: 'ios' }).success).toBe(true)
      expect(schema.safeParse({ query: 'x', area: 'kitchen' }).success).toBe(false)
    })
  })

  describe('getManualPage', () => {
    it('joins the sections under their headings', async () => {
      const { store, tools } = setUp()

      const result = await tools.getManualPage.execute!({ page: 'backup-and-devices/new-phone' }, callOptions)

      expect(store.getPage).toHaveBeenCalledWith('backup-and-devices/new-phone', ctx)
      expect(result).toEqual({
        found: true,
        page: 'backup-and-devices/new-phone',
        title: 'Moving to a new phone',
        screen: 'Settings → Cloud Backup',
        tier: 'attendance',
        platforms: ['ios', 'android'],
        content: 'Intro.\n\n## Before you switch\nBack up first.',
      })
    })

    it('caps the page at 8,000 characters', async () => {
      const { store, tools } = setUp()
      store.getPage.mockResolvedValueOnce(
        ok({
          page: 'a/b', title: 't', screen: 's', tier: 'free', platforms: ['ios'],
          sections: [{ order: 0, heading: '', content: 'word '.repeat(3000) }],
        }) as never,
      )

      const result = (await tools.getManualPage.execute!({ page: 'a/b' }, callOptions)) as { content: string }

      expect(Array.from(result.content).length).toBeLessThanOrEqual(8000)
    })

    it('refuses page ids outside the pattern without touching the store', async () => {
      const { store, tools } = setUp()

      for (const page of ['map', '../etc/passwd', 'Backup/New-Phone', 'a/b/c', 'a/', 'account/x y']) {
        expect(await tools.getManualPage.execute!({ page }, callOptions)).toEqual({ found: false })
      }
      expect(store.getPage).not.toHaveBeenCalled()
    })

    it('answers found: false for an unknown page', async () => {
      const { store, tools } = setUp()
      store.getPage.mockResolvedValueOnce(ok(null) as never)

      expect(await tools.getManualPage.execute!({ page: 'account/nowhere' }, callOptions)).toEqual({ found: false })
    })

    it('answers unavailable without a store, on a store error and when the store throws', async () => {
      expect(await createManualTools(ctx).getManualPage.execute!({ page: 'a/b' }, callOptions)).toEqual({ found: false, unavailable: true })

      const { store, tools } = setUp()
      store.getPage.mockResolvedValueOnce(err({ kind: 'TimeoutError', message: 't', context: {} }) as never)
      expect(await tools.getManualPage.execute!({ page: 'a/b' }, callOptions)).toEqual({ found: false, unavailable: true })

      store.getPage.mockRejectedValueOnce(new Error('boom'))
      expect(await tools.getManualPage.execute!({ page: 'a/b' }, callOptions)).toEqual({ found: false, unavailable: true })
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm vitest run packages/tools/tests/manualTools.test.ts
```

Expected: FAIL, `Cannot find module '../src/manualTools.js'`.

- [ ] **Step 3: Write the tools**

`packages/tools/src/manualTools.ts`:

```ts
/**
 * Manual tools for the RecoverySky agent: how the app works, from the
 * user's manual (app repo docs/manual/) in the `manual` Qdrant collection.
 *
 * - searchManual: hybrid search, one section per hit, with the on-screen labels
 * - getManualPage: one whole page by id, for multi-step answers
 *
 * The store and the embedding provider are set once at boot; the tools are
 * built per request (createManualTools) so their calls carry the request's
 * trace context. Both are always offered: without a store they answer
 * `unavailable`, so the tool list stays fixed and an environment without a
 * manual behaves as before apart from two inert tools.
 * Spec: app repo docs/superpowers/specs/2026-10-12-user-manual-rag-design.md §2.3
 */

import { z } from 'zod'
import { tool } from 'ai'
import { getLogger, withSpan } from '@recoverysky/observability'
import type { ManualVectorStore } from '@recoverysky/memory'
import { MANUAL_AREAS, MANUAL_PLATFORMS } from '@recoverysky/types'
import type { IEmbeddingProvider, TraceContext } from '@recoverysky/types'
import { capText } from './text.js'

/** Bounds on what the model sends and what goes back into its context */
const MAX_QUERY_CHARS = 300
const SEARCH_LIMIT = 5
const MAX_HIT_CHARS = 3000
const MAX_PAGE_CHARS = 8000
/** A page id is `<area>/<name>`; the map is in the prompt, not the collection */
const PAGE_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+$/

let storeInstance: ManualVectorStore | null = null
let embeddingInstance: IEmbeddingProvider | null = null

export function setManualQdrantStore(store: ManualVectorStore): void {
  storeInstance = store
}

export function setManualEmbeddingProvider(provider: IEmbeddingProvider): void {
  embeddingInstance = provider
}

export function clearManualProviders(): void {
  storeInstance = null
  embeddingInstance = null
}

function thrownErrorFields(error: unknown): Record<string, unknown> {
  return { errorName: error instanceof Error ? error.name : typeof error }
}

const SEARCH_UNAVAILABLE = { hits: [] as never[], unavailable: true as const }
const PAGE_UNAVAILABLE = { found: false as const, unavailable: true as const }
const PAGE_NOT_FOUND = { found: false as const }

/**
 * Build the manual tools for one request
 */
export function createManualTools(ctx: TraceContext) {
  const searchManual = tool({
    description: `Search the RecoverySky user's manual: how to do something in the app, where a setting or tab is, why a feature or tab is missing, what the Attendance and Premium subscriptions include, and where the user's data is kept. Each hit is one section of a page with the on-screen labels to use in the answer; its "page" id can be passed to getManualPage.`,
    inputSchema: z.object({
      query: z.string().min(1).max(MAX_QUERY_CHARS).describe("The user's question, in their words"),
      area: z.enum(MANUAL_AREAS).optional().describe('Limit to one area of the app when the question clearly belongs to it'),
      platform: z.enum(MANUAL_PLATFORMS).optional().describe("The user's platform when you know it (iPhone = ios)"),
    }),
    execute: async ({ query, area, platform }) => {
      return withSpan('tool.searchManual', async () => {
        const logger = getLogger().child({ tool: 'searchManual', requestId: ctx.requestId })
        logger.info({ queryChars: query.length, area, platform }, 'Searching the manual')

        const store = storeInstance
        const embedding = embeddingInstance
        if (!store || !embedding) {
          logger.warn('Manual store or embedding provider not configured, manual search unavailable')
          return SEARCH_UNAVAILABLE
        }

        try {
          const embedded = await embedding.embed(query, ctx, { label: 'manual-query' })
          if (!embedded.ok) {
            logger.error({ errorKind: embedded.error.kind }, 'Failed to embed the manual query')
            return SEARCH_UNAVAILABLE
          }

          const result = await store.search(embedded.value, query, { area, platform, limit: SEARCH_LIMIT }, ctx)
          if (!result.ok) {
            logger.error({ errorKind: result.error.kind }, 'Manual search failed')
            return SEARCH_UNAVAILABLE
          }

          const hits = result.value.map((h) => ({ ...h, content: capText(h.content, MAX_HIT_CHARS) }))
          logger.info({ count: hits.length }, 'Manual search complete')
          return { hits }
        } catch (error) {
          logger.error(thrownErrorFields(error), 'Manual search failed')
          return SEARCH_UNAVAILABLE
        }
      })
    },
  })

  const getManualPage = tool({
    description: `Read one whole page of the RecoverySky user's manual by its id (the "page" of a searchManual hit, like "backup-and-devices/new-phone"). Use it when the answer spans several steps or needs more than one section.`,
    inputSchema: z.object({
      page: z.string().min(3).max(120).describe('The page id from a searchManual hit'),
    }),
    execute: async ({ page }) => {
      return withSpan('tool.getManualPage', async () => {
        const logger = getLogger().child({ tool: 'getManualPage', requestId: ctx.requestId })

        // The id is model-chosen: only the strict shape reaches Qdrant or the log
        if (!PAGE_ID_PATTERN.test(page)) {
          logger.warn({ pageChars: page.length }, 'Rejected a manual page id outside the pattern')
          return PAGE_NOT_FOUND
        }
        logger.info({ page }, 'Reading a manual page')

        const store = storeInstance
        if (!store) {
          logger.warn('Manual store not configured, page read unavailable')
          return PAGE_UNAVAILABLE
        }

        try {
          const result = await store.getPage(page, ctx)
          if (!result.ok) {
            logger.error({ errorKind: result.error.kind }, 'Manual page read failed')
            return PAGE_UNAVAILABLE
          }
          const found = result.value
          if (!found) return PAGE_NOT_FOUND

          const content = found.sections
            .map((s) => (s.heading ? `## ${s.heading}\n${s.content}` : s.content))
            .join('\n\n')
          return {
            found: true as const,
            page: found.page,
            title: found.title,
            screen: found.screen,
            tier: found.tier,
            platforms: found.platforms,
            content: capText(content, MAX_PAGE_CHARS),
          }
        } catch (error) {
          logger.error(thrownErrorFields(error), 'Manual page read failed')
          return PAGE_UNAVAILABLE
        }
      })
    },
  })

  return { searchManual, getManualPage }
}
```

`packages/tools/src/chatTools.ts`:

```ts
/**
 * The tools the chat route offers on every request, apart from the memory
 * tools (getMemoryTools, gated by MEMORY_TOOL_ACCESS). The system prompt's
 * tool list in @recoverysky/agent names exactly these; a pipeline test checks
 * the two stay in step.
 */

import type { TraceContext } from '@recoverysky/types'
import { recoveryTools } from './definitions.js'
import { meetingTools } from './meetingTools.js'
import { createLiteratureTools } from './literatureTools.js'
import { createManualTools } from './manualTools.js'

export function createChatTools(ctx: TraceContext) {
  return {
    ...recoveryTools,
    ...meetingTools,
    ...createLiteratureTools(ctx),
    ...createManualTools(ctx),
  }
}
```

In `packages/tools/src/index.ts`, after the literature block, add:

```ts
// Manual tools: how the RecoverySky app works, from the user's manual
export {
  createManualTools,
  setManualQdrantStore,
  setManualEmbeddingProvider,
  clearManualProviders,
} from "./manualTools.js";
```

- [ ] **Step 4: Number the tools in the prompt**

In `packages/agent/src/systemPrompt.ts`, change the end of `TOOL_INSTRUCTIONS` (after the `listLiterature` entry, before the closing backtick) to:

```ts
6. **listLiterature** - List available literature for a fellowship
   - Use when: User wants to know what literature is available

### App Manual Tools
7. **searchManual** - Search the RecoverySky user's manual for how the app works
   - Use when: User asks how to do something in the app, where a setting or tab is, why a tab or feature is missing, what a subscription includes, or where their data is kept

8. **getManualPage** - Read one whole manual page by its id (from a searchManual hit)
   - Use when: The answer needs several steps or more than one section`;

/** Number of the first memory tool in the list (after the eight above) */
const FIRST_MEMORY_TOOL_NUMBER = 9;
```

- [ ] **Step 5: Run the tests across the three packages**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm build
pnpm vitest run packages/tools packages/agent packages/pipeline/tests/toolList.test.ts
```

Expected: `manualTools.test.ts` 14 tests pass; `literatureTools.test.ts`, `systemPrompt.test.ts` and `toolList.test.ts` pass. If `toolList.test.ts` fails, the list in `TOOL_INSTRUCTIONS` and `createChatTools` disagree; fix the list, never the test.

- [ ] **Step 6: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
git add packages/tools/src/manualTools.ts packages/tools/src/chatTools.ts packages/tools/src/index.ts packages/tools/tests/manualTools.test.ts packages/agent/src/systemPrompt.ts
git commit -m "✨ feat(tools): searchManual and getManualPage, offered on every request

Sky can search the user's manual (hybrid, 5 sections of ≤ 3,000 chars) and
read one page (≤ 8,000 chars). Both are always offered and answer
\`unavailable\` without a store, so the prompt's tool list stays fixed. The
list numbers them 7 and 8; memory tools start at 9.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The `## The RecoverySky app` prompt section and its pipeline wiring (agent, `packages/agent`, `packages/pipeline`)

**Files:**
- Modify: `packages/agent/src/systemPrompt.ts:18-35` (options), `:61-107` (section order), plus a new builder near `buildEarlierCrisisSection`
- Modify: `packages/agent/tests/systemPrompt.test.ts` (append a describe)
- Modify: `packages/pipeline/src/Pipeline.ts:44-70` (deps), `:446-493` (STAGE 5/6)
- Modify: `packages/pipeline/tests/Pipeline.test.ts` (append three tests after the base-identity tests, around line 224)

**Interfaces:**
- Produces: `BuildSystemPromptOptions.appManual?: string`; `PipelineDependencies.appManual?: string` and `PipelineDependencies.getManualMap?: () => Promise<{ id: string; name: string; content: string } | null>`.

- [ ] **Step 1: Write the failing prompt tests**

Append to `packages/agent/tests/systemPrompt.test.ts`, inside the top-level `describe` (match the file's indentation):

```ts
  describe("app manual", () => {
    const MAP = "RecoverySky has four tabs: Home, Meetings, Attendance and Settings.";

    it("adds the section with a map and leaves it out without one", () => {
      const withMap = buildSystemPrompt({ context: createMinimalContext(), appManual: MAP });
      const without = buildSystemPrompt({ context: createMinimalContext() });

      expect(headings(withMap)).toContain("## The RecoverySky app");
      expect(withMap).toContain(MAP);
      expect(withMap).toContain("call searchManual before answering");
      expect(withMap).toContain("support@recoverysky.app");
      expect(without).not.toContain("## The RecoverySky app");
      expect(without).not.toContain("searchManual before answering");
    });

    it("ignores a blank map", () => {
      const prompt = buildSystemPrompt({ context: createMinimalContext(), appManual: "   \n" });
      expect(prompt).not.toContain("## The RecoverySky app");
    });

    it("sits after the crisis sections and before the recovery guidelines", () => {
      const prompt = buildSystemPrompt({
        context: createMinimalContext(),
        crisisCheck: crisisAt(9),
        crisisResources: RESOURCES,
        appManual: MAP,
      });

      const h = headings(prompt);
      const manual = h.indexOf("## The RecoverySky app");
      expect(manual).toBeGreaterThan(h.findIndex((line) => line.includes("CRITICAL CRISIS")));
      expect(manual).toBeLessThan(h.indexOf("## Recovery-Specific Guidelines"));
    });

    it("sits after an earlier-crisis section too", () => {
      const context = createMinimalContext();
      context.sessionState.crisisLevel = 8;
      const prompt = buildSystemPrompt({ context, crisisResources: RESOURCES, appManual: MAP });

      const h = headings(prompt);
      expect(h.indexOf("## The RecoverySky app")).toBeGreaterThan(h.indexOf("## Earlier Crisis in This Conversation"));
    });

    it("numbers the manual tools 7 and 8 and the memory tools from 9", () => {
      const prompt = buildSystemPrompt({ context: createMinimalContext(), memoryToolAccess: "read" });

      expect(prompt).toMatch(/^7\. \*\*searchManual\*\*/m);
      expect(prompt).toMatch(/^8\. \*\*getManualPage\*\*/m);
      expect(prompt).toMatch(/^9\. \*\*recallMemory\*\*/m);
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm vitest run packages/agent/tests/systemPrompt.test.ts
```

Expected: the first four new tests FAIL (no section is emitted); the numbering test passes already (Task 3).

- [ ] **Step 3: Add the option and the section**

In `packages/agent/src/systemPrompt.ts`:

1. In `BuildSystemPromptOptions`, after `crisisResources`, add:

```ts
  /**
   * The manual's map: what the RecoverySky app can do, from the active
   * `manual-map` system prompt row. Present → a "## The RecoverySky app"
   * section with the searchManual / getManualPage instructions; absent or
   * blank → no section (an environment without a manual)
   */
  appManual?: string;
```

2. In the destructuring at the top of `buildSystemPrompt`, add `appManual,` after `crisisResources = [],`.

3. Between the earlier-crisis block and `sections.push(RECOVERY_GUIDELINES);`, insert:

```ts
  // The app the user is in, and how to answer questions about it. After the
  // crisis sections so a crisis still reads first, before the guidelines.
  if (appManual && appManual.trim().length > 0) {
    sections.push(buildAppManualSection(appManual));
  }
```

4. After `buildEarlierCrisisSection`, add:

```ts
/**
 * The fixed instructions under the map. The map itself is written by hand in
 * the app repo (docs/manual/map.md) and must not contain "## " lines: it is
 * spliced into this one section, and the ingest refuses a map with headings.
 */
const APP_MANUAL_INSTRUCTIONS = `You are running inside the RecoverySky app's Agent tab. Above is what the app can do. For any question about using the app (how to, where is, why can't I, what's included, is it private) call searchManual before answering, and answer from what it returns, using the on-screen labels it gives. Use getManualPage when the answer spans several steps. If the manual does not cover the question, say you are not sure and give support@recoverysky.app; never invent a setting, a screen or a feature. When the answer depends on the phone (iPhone or Android) or the subscription and you do not know, ask. Do not mention the manual or the search to the user.`;

function buildAppManualSection(appManual: string): string {
  return `## The RecoverySky app

${appManual.trim()}

${APP_MANUAL_INSTRUCTIONS}`;
}
```

- [ ] **Step 4: Run the agent tests**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm vitest run packages/agent
```

Expected: PASS, including the five new tests.

- [ ] **Step 5: Write the failing pipeline tests**

In `packages/pipeline/tests/Pipeline.test.ts`, after the test `"falls back to a fresh default when the guide is missing and none is cached"`, add:

```ts
  it("gives the prompt builder the cached manual map without a database read", async () => {
    const getManualMap = vi.fn();
    await preflightOf(new Pipeline(deps({ appManual: "Four tabs", getManualMap })));

    expect(getManualMap).not.toHaveBeenCalled();
    const options = buildSystemPrompt.mock.calls[0][0] as unknown as { appManual?: string };
    expect(options.appManual).toBe("Four tabs");
  });

  it("reads the manual map when none is cached", async () => {
    const getManualMap = vi.fn().mockResolvedValue({ id: "m1", name: "manual-map", content: "Four tabs from DB" });
    await preflightOf(new Pipeline(deps({ appManual: undefined, getManualMap })));

    expect(getManualMap).toHaveBeenCalledTimes(1);
    const options = buildSystemPrompt.mock.calls[0][0] as unknown as { appManual?: string };
    expect(options.appManual).toBe("Four tabs from DB");
  });

  it("builds the prompt without a map when no row exists", async () => {
    const getManualMap = vi.fn().mockResolvedValue(null);
    await preflightOf(new Pipeline(deps({ appManual: undefined, getManualMap })));

    const options = buildSystemPrompt.mock.calls[0][0] as unknown as { appManual?: string };
    expect(options.appManual).toBeUndefined();
  });
```

Run `pnpm vitest run packages/pipeline/tests/Pipeline.test.ts`. Expected: the three new tests FAIL (`appManual` is never passed; the typecheck in the test may also complain about unknown deps until Step 6).

- [ ] **Step 6: Wire the pipeline**

In `packages/pipeline/src/Pipeline.ts`:

1. In `PipelineDependencies`, after `getDefaultSystemPrompt`, add:

```ts
  /** The manual's map (the "## The RecoverySky app" section) cached from the manual-map row; undefined until one has loaded */
  appManual?: string
  /** Read the active manual-map row fresh (and cache it as appManual) */
  getManualMap?: () => Promise<{ id: string; name: string; content: string } | null>
```

2. After the `if (baseIdentity === undefined) { … } else { … }` block that ends STAGE 5 and before `// STAGE 6: Build system prompt`, add:

```ts
        // STAGE 5b: Resolve the manual map the same way: cached unless refresh
        // is always on or none has loaded yet. No row means no app section.
        let appManual = this.deps.appManual
        if ((this.deps.promptRefreshAlways || appManual === undefined) && this.deps.getManualMap) {
          const manualMap = await this.deps.getManualMap()
          if (manualMap) appManual = manualMap.content
        }
```

3. In the `buildSystemPrompt({ … })` call, add `appManual,` after `fellowship: input.fellowship,`.

- [ ] **Step 7: Run the pipeline tests and the tool list**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm build && pnpm vitest run packages/pipeline packages/agent
```

Expected: PASS (compare any failure against the Task 0 list).

- [ ] **Step 8: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
git add packages/agent/src/systemPrompt.ts packages/agent/tests/systemPrompt.test.ts packages/pipeline/src/Pipeline.ts packages/pipeline/tests/Pipeline.test.ts
git commit -m "✨ feat(agent): the RecoverySky app section of the system prompt

With a manual map, buildSystemPrompt emits \"## The RecoverySky app\" (the
map plus fixed instructions: search the manual before answering app
questions, use on-screen labels, hand off to support@recoverysky.app, never
invent a screen) after the crisis sections and before the guidelines. The
pipeline resolves the map like the base identity: cached, read fresh when
none has loaded or PROMPT_REFRESH_ALWAYS is on.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Load the `manual-map` row and wire the container (agent, `apps/api`)

**Files:**
- Modify: `apps/api/src/services/systemPrompts.ts` (whole file below)
- Modify: `apps/api/src/services/systemPrompts.test.ts` (append tests)
- Modify: `apps/api/src/container.ts:11-49` (imports), `:174-182`, `:297-311`, `:551-575`, `:596-637`
- Test: `apps/api/src/services/systemPrompts.test.ts`; `apps/api/src/container.test.ts` and `container.stubOrder.test.ts` stay green (both spread the real `@recoverysky/memory` module, so the new store import needs no mock)

**Interfaces:**
- Consumes: `ManualVectorStore` (Task 2), `setManualQdrantStore` / `setManualEmbeddingProvider` (Task 3), `deps.appManual` / `deps.getManualMap` (Task 4).
- Produces: `SystemPromptSource.manualMap: string | undefined` and `SystemPromptSource.loadManualMap(): Promise<LoadedPrompt | null>`; the container logs `Qdrant manual collection ready` / `Qdrant manual collection unusable, manual search will fail` and `Manual map loaded from database`.

- [ ] **Step 1: Write the failing source tests**

Append to `apps/api/src/services/systemPrompts.test.ts`, inside `describe('createSystemPromptSource', …)`:

```ts
  describe('manual map', () => {
    const mapRow = (content: string) => ({ id: `map-${content}`, name: 'manual-map', content })

    it('has no manual map until one loads, then caches every successful read', async () => {
      const { findActive, source } = setup()
      expect(source.manualMap).toBeUndefined()
      findActive.mockResolvedValueOnce(ok(mapRow('m1'))).mockResolvedValueOnce(ok(mapRow('m2')))

      await expect(source.loadManualMap()).resolves.toEqual({ id: 'map-m1', name: 'manual-map', content: 'm1' })
      expect(source.manualMap).toBe('m1')
      await source.loadManualMap()
      expect(source.manualMap).toBe('m2')
      expect(findActive).toHaveBeenCalledWith('manual-map')
    })

    it('keeps the last good map and cools down after a failed read, independently of the base identity', async () => {
      vi.useFakeTimers()
      try {
        const { findActive, logger, source } = setup()
        findActive.mockImplementation(async (name: string) =>
          name === 'manual-map' ? dbDown() : ok(row('base')),
        )

        await expect(source.loadManualMap()).resolves.toBeNull()
        await expect(source.loadManualMap()).resolves.toBeNull()
        expect(findActive.mock.calls.filter(([n]) => n === 'manual-map')).toHaveLength(1)
        expect(logger.warn).toHaveBeenCalledWith({ errorKind: 'DatabaseError' }, expect.stringContaining('manual map'))

        // The base identity is not on cooldown
        await expect(source.loadBaseIdentity()).resolves.toEqual({ id: 'id-base', name: 'base-identity', content: 'base' })

        vi.advanceTimersByTime(BASE_IDENTITY_RETRY_COOLDOWN_MS)
        await source.loadManualMap()
        expect(findActive.mock.calls.filter(([n]) => n === 'manual-map')).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('returns null and warns once when no manual-map row is active, without a cooldown', async () => {
      const { findActive, logger, source } = setup()
      findActive.mockResolvedValue(ok(null))

      await expect(source.loadManualMap()).resolves.toBeNull()
      await source.loadManualMap()

      expect(findActive).toHaveBeenCalledTimes(2)
      expect(logger.warn).toHaveBeenCalledTimes(2)
      expect(source.manualMap).toBeUndefined()
    })
  })
```

Run `cd /Users/jenova/projects/recoverysky-org/agent && pnpm vitest run apps/api/src/services/systemPrompts.test.ts`. Expected: the three new tests FAIL (`source.loadManualMap is not a function`).

- [ ] **Step 2: Rewrite the source with one cached-read helper**

Replace `apps/api/src/services/systemPrompts.ts` with:

```ts
/**
 * The base identity, the manual map and the guides, read from the
 * system_prompts table
 *
 * Every successful read of a cached prompt (the base identity, the manual
 * map) is cached, so when a later read fails the pipeline falls back to the
 * newest prompt rather than the one loaded at boot. Failed reads are logged
 * by error kind. After a failed read that prompt is not read again for a
 * cooldown, so during a database outage each request uses the cached or
 * built-in prompt at once instead of waiting out another query timeout.
 * Concurrent callers share one read. Each cached prompt has its own cooldown.
 * A guide name comes from the client, so it is never logged here.
 *
 * CHANGED 2026-10-12: the base-identity read became createCachedPrompt so the
 * manual map (the "## The RecoverySky app" section) gets the same behaviour.
 */

import type { Result } from '@recoverysky/types'

const BASE_IDENTITY = 'base-identity'
const MANUAL_MAP = 'manual-map'

/** How long a failed cached-prompt read waits before the next one */
export const BASE_IDENTITY_RETRY_COOLDOWN_MS = 30_000

export interface LoadedPrompt {
  id: string
  name: string
  content: string
}

interface PromptRepo {
  findActive(name: string): Promise<Result<LoadedPrompt | null, { kind: string }>>
}

interface PromptLogger {
  warn: (obj: object, msg?: string) => void
}

export interface SystemPromptSource {
  /** The last base identity read from the database; undefined until one loads */
  readonly baseIdentity: string | undefined
  /** Read the active base identity and cache it; null when none could be read or a failed read is cooling down */
  loadBaseIdentity(): Promise<LoadedPrompt | null>
  /** The last manual map read from the database; undefined until one loads */
  readonly manualMap: string | undefined
  /** Read the active manual map and cache it; null when none could be read or a failed read is cooling down */
  loadManualMap(): Promise<LoadedPrompt | null>
  /** Read an active guide by name; null when it is missing or the read failed */
  findGuide(name: string): Promise<LoadedPrompt | null>
}

interface CachedPrompt {
  readonly value: string | undefined
  load(): Promise<LoadedPrompt | null>
}

/**
 * One cached, cooled-down read of an active prompt row. `label` names it in
 * log messages ("base identity", "manual map"); `fallback` says what a
 * failed read keeps ("the cached or built-in one" for the base identity,
 * which has a built-in default; "the cached one" for the map, which has none)
 */
function createCachedPrompt(
  { name, label, fallback }: { name: string; label: string; fallback: string },
  repo: PromptRepo,
  logger: PromptLogger,
): CachedPrompt {
  let value: string | undefined
  /** Date.now() before which a read is skipped */
  let retryAt = 0
  /** The read in progress, shared by every caller */
  let reading: Promise<LoadedPrompt | null> | null = null

  async function read(): Promise<LoadedPrompt | null> {
    const result = await repo.findActive(name)
    if (!result.ok) {
      retryAt = Date.now() + BASE_IDENTITY_RETRY_COOLDOWN_MS
      logger.warn({ errorKind: result.error.kind }, `Failed to read the ${label}, keeping ${fallback}`)
      return null
    }
    if (!result.value) {
      logger.warn({}, `No active ${name} prompt in the database, keeping ${fallback}`)
      return null
    }
    value = result.value.content
    return { id: result.value.id, name: result.value.name, content: result.value.content }
  }

  return {
    get value() {
      return value
    },
    load() {
      if (Date.now() < retryAt) return Promise.resolve(null)
      reading ??= read().finally(() => {
        reading = null
      })
      return reading
    },
  }
}

export function createSystemPromptSource({ repo, logger }: { repo: PromptRepo; logger: PromptLogger }): SystemPromptSource {
  const baseIdentity = createCachedPrompt(
    { name: BASE_IDENTITY, label: 'base identity', fallback: 'the cached or built-in one' },
    repo,
    logger,
  )
  const manualMap = createCachedPrompt(
    { name: MANUAL_MAP, label: 'manual map', fallback: 'the cached one' },
    repo,
    logger,
  )

  return {
    get baseIdentity() {
      return baseIdentity.value
    },
    loadBaseIdentity: () => baseIdentity.load(),

    get manualMap() {
      return manualMap.value
    },
    loadManualMap: () => manualMap.load(),

    async findGuide(name) {
      const result = await repo.findActive(name)
      if (!result.ok) {
        logger.warn({ errorKind: result.error.kind }, 'Failed to read a guide, using the default')
        return null
      }
      if (!result.value) return null
      return { id: result.value.id, name: result.value.name, content: result.value.content }
    },
  }
}
```

The base-identity messages are unchanged word for word ("Failed to read the base identity, keeping the cached or built-in one"; "No active base-identity prompt in the database, keeping the cached or built-in one"), and the log fields stay `{ errorKind }` / `{}`, so the existing tests pass untouched.

- [ ] **Step 3: Run the source tests**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm vitest run apps/api/src/services/systemPrompts.test.ts
```

Expected: PASS, all existing tests plus the three new ones.

- [ ] **Step 4: Wire the container**

In `apps/api/src/container.ts`:

1. Add `ManualVectorStore,` to the `@recoverysky/memory` import block (beside `QdrantVectorStore,`), and `setManualQdrantStore, setManualEmbeddingProvider,` to the `@recoverysky/tools` import.

2. Replace the Qdrant block (lines 174–182) with:

```ts
  // L4 Qdrant client for literature search and the user's manual (separate from messages)
  let qdrantVectorStore: QdrantVectorStore | null = null
  let manualStore: ManualVectorStore | null = null
  if (!useStubs && process.env.QDRANT_URL) {
    logger.info('Using QdrantVectorStore for literature search and ManualVectorStore for the manual')
    const qdrant = createQdrantClient({ url: process.env.QDRANT_URL })
    qdrantVectorStore = new QdrantVectorStore(qdrant)
    // ADDED 2026-10-12: the manual collection shares the client and the 5 s timeout
    manualStore = new ManualVectorStore(qdrant)
  } else {
    logger.info('Qdrant not configured - literature semantic search and manual search disabled')
  }
```

3. In the embedding block (lines 297–311), after the literature `if (qdrantVectorStore) { … }`, add:

```ts
    // Wire up the manual tools with the same embedding provider
    if (manualStore) {
      setManualQdrantStore(manualStore)
      setManualEmbeddingProvider(embedding)
      logger.info('Manual search enabled (Qdrant + OpenAI embeddings)')
    }
```

4. In `deps` (lines 551–575), after `getDefaultSystemPrompt`, add:

```ts
    // The last manual map read from the database (undefined until one loads); no row → no app section
    get appManual() { return systemPrompts?.manualMap },
    // getManualMap reads the active manual-map fresh and caches it
    getManualMap: systemPrompts ? () => systemPrompts.loadManualMap() : undefined,
```

5. In `initServices`, after the literature check block (before the base-identity fetch), add:

```ts
    // Check the manual collection the same way: manual search is optional and degrades per call
    if (manualStore) {
      const store = manualStore
      initTasks.push(
        store.checkCollection().then((checked) => {
          if (checked.ok) {
            logger.info('Qdrant manual collection ready')
          } else {
            logger.error(
              { errorKind: checked.error.kind, reason: checked.error.kind === 'ValidationError' ? checked.error.message : undefined },
              'Qdrant manual collection unusable, manual search will fail'
            )
          }
        })
      )
    }
```

and inside the `if (systemPrompts) { … }` block, after the base-identity `initTasks.push(…)`, add:

```ts
      initTasks.push(
        systemPrompts.loadManualMap().then((loaded) => {
          if (loaded) {
            logger.info({ promptId: loaded.id, promptName: loaded.name }, 'Manual map loaded from database')
          }
        })
      )
```

Also update the `Container.init` doc comment to "Initialize async services (literature and manual collection checks, base identity, manual map)".

- [ ] **Step 5: Typecheck and run the api suites**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm --filter api typecheck
pnpm vitest run apps/api
```

Expected: same as the Task 0 baseline plus the new tests. `container.stubOrder.test.ts` spreads `importOriginal()` of `@recoverysky/memory`, so `ManualVectorStore` resolves; if a container test stubs `createQdrantClient` and asserts the exact info log text "Using QdrantVectorStore for literature search only", update that one expectation to the new text.

- [ ] **Step 6: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
git add apps/api/src/services/systemPrompts.ts apps/api/src/services/systemPrompts.test.ts apps/api/src/container.ts
git commit -m "✨ feat(api): load the manual map and wire the manual store at boot

The manual-map row reaches the prompt through createSystemPromptSource with
the base identity's cache-last-good and 30 s cooldown, each prompt on its
own clock. With QDRANT_URL the container builds ManualVectorStore on the
literature client, checks the collection in init and logs a problem without
failing readiness, and hands the tools the same embedding provider.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `SystemPromptRepository.replaceActive` (agent, `packages/db`)

**Files:**
- Modify: `packages/db/src/stores/SystemPromptRepository.ts` (imports; new method after `setActive`)
- Create: `packages/db/tests/integration/systemPrompts.integration.test.ts`

**Interfaces:**
- Produces: `replaceActive(name: string, content: string): Promise<Result<SystemPrompt, SystemPromptError>>`. In one transaction: every active row of that name becomes inactive, then a new active row with a fresh id is inserted and returned. History rows stay.

- [ ] **Step 1: Write the integration test**

`packages/db/tests/integration/systemPrompts.integration.test.ts`:

```ts
/**
 * SystemPromptRepository.replaceActive against a real database: the unique
 * active-per-name index is what makes the transaction necessary.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { SystemPromptRepository } from '../../src/stores/SystemPromptRepository.js'
import { createTestDatabase, describeDb, type TestDatabase } from './harness.js'

describeDb('SystemPromptRepository.replaceActive', () => {
  let t: TestDatabase
  let repo: SystemPromptRepository

  beforeAll(async () => {
    t = await createTestDatabase()
    repo = new SystemPromptRepository(t.db as never)
  })
  afterAll(async () => {
    await t?.drop()
  })

  it('inserts an active row when none exists', async () => {
    const result = await repo.replaceActive('manual-map', 'map v1')

    expect(result.ok).toBe(true)
    const active = await repo.findActive('manual-map')
    expect(active.ok && active.value?.content).toBe('map v1')
    expect(active.ok && active.value?.active).toBe(true)
  })

  it('deactivates the old row, activates the new one and keeps history', async () => {
    const result = await repo.replaceActive('manual-map', 'map v2')

    expect(result.ok && result.value.content).toBe('map v2')
    const active = await repo.findActive('manual-map')
    expect(active.ok && active.value?.content).toBe('map v2')

    const all = await repo.findByName('manual-map')
    expect(all.ok && all.value.map((r) => [r.content, r.active]).sort()).toEqual([
      ['map v1', false],
      ['map v2', true],
    ])
  })

  it('leaves other names alone', async () => {
    await repo.replaceActive('base-identity', 'Sky')

    const map = await repo.findActive('manual-map')
    expect(map.ok && map.value?.content).toBe('map v2')
    const base = await repo.findActive('base-identity')
    expect(base.ok && base.value?.content).toBe('Sky')
  })

  it('answers a DatabaseError, not a half-written state, when the insert fails', async () => {
    // A content column cannot hold null; the insert fails after the deactivate inside the same transaction
    const result = await repo.replaceActive('manual-map', null as unknown as string)

    expect(!result.ok && result.error.kind).toBe('DatabaseError')
    const active = await repo.findActive('manual-map')
    expect(active.ok && active.value?.content).toBe('map v2')
  })
})
```

- [ ] **Step 2: Run it against a throwaway Postgres**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
docker run -d --rm --name rs-db-test -e POSTGRES_PASSWORD=test -p 127.0.0.1:25432:5432 pgvector/pgvector:0.8.7-pg16
sleep 5
DB_TEST_URL=postgres://postgres:test@127.0.0.1:25432/postgres pnpm vitest run packages/db/tests/integration/systemPrompts.integration.test.ts
```

Expected: FAIL, `repo.replaceActive is not a function`. (Without Docker the suite is skipped; then this task's only check is the typecheck, and say so in the task notes.)

- [ ] **Step 3: Add the method**

In `packages/db/src/stores/SystemPromptRepository.ts`, add `import { randomUUID } from 'node:crypto'` at the top, and after `setActive` add:

```ts
  /**
   * Replace the active prompt for a name: deactivate the current active row(s)
   * and insert a new active row with this content, in one transaction. The
   * old rows stay as history (the way base-identity edits are kept). Written
   * for the manual ingest's `manual-map` row (ADDED 2026-10-12); the unique
   * active-per-name index makes the two statements one unit, because an
   * insert before the deactivate would violate it and a deactivate without
   * the insert would leave no active row.
   */
  async replaceActive(name: string, content: string): Promise<Result<SystemPrompt, SystemPromptError>> {
    try {
      const now = new Date().toISOString()
      const row = await this.db.transaction(async (tx) => {
        await tx
          .update(systemPrompts)
          .set({ active: false, updated: now })
          .where(and(eq(systemPrompts.name, name), eq(systemPrompts.active, true)))

        const [inserted] = await tx
          .insert(systemPrompts)
          .values({ id: randomUUID(), name, content, variables: {}, active: true, created: now, updated: now })
          .returning()
        return inserted
      })
      return ok(row)
    } catch (error) {
      return err(createError('DatabaseError', `Failed to replace active prompt: ${name}`, error))
    }
  }
```

- [ ] **Step 4: Run the test again, then stop the container**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm --filter @recoverysky/db typecheck
DB_TEST_URL=postgres://postgres:test@127.0.0.1:25432/postgres pnpm vitest run packages/db/tests/integration
docker stop rs-db-test
```

Expected: PASS (4 new tests; the other integration suites, including the schema drift test, still pass).

- [ ] **Step 5: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm build
git add packages/db/src/stores/SystemPromptRepository.ts packages/db/tests/integration/systemPrompts.integration.test.ts
git commit -m "✨ feat(db): SystemPromptRepository.replaceActive for the manual map

One transaction deactivates the active row of a name and inserts the new
active one, keeping history, because the unique active-per-name index
refuses the insert first and a deactivate alone leaves no row.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The authoring rules, the map and the questions file (app, `docs/manual/`)

**Files:**
- Create: `docs/manual/README.md`, `docs/manual/map.md`, `docs/manual/questions.yml`

**Interfaces:**
- Produces: the README every page writer and reviewer follows (Tasks 8–9); `map.md` that Task 11 stores as the `manual-map` row; `questions.yml` that Task 9 fills and Task 11 runs.

- [ ] **Step 1: Write the README**

`docs/manual/README.md`:

````markdown
# The RecoverySky User's Manual

One Markdown page per feature, written in the voice of a user's manual. The reader is
Sky, the agent in the Agent tab: the pages are chunked into her `manual` search
collection, and `map.md` is pasted into her system prompt, so she can answer "how do
I…", "where is…", "why can't I…", "what's included" and "is it private" about the app.
Nobody browses this folder; its only job is to be true.

Spec: `docs/superpowers/specs/2026-10-12-user-manual-rag-design.md`. Ingest and tools
live in the agent repo (`packages/manual`, `searchManual`, `getManualPage`).

## Layout

```
docs/manual/
  README.md            this file; never ingested
  map.md               "what the app can do": the always-on prompt section; never chunked
  questions.yml        retrieval smoke test: user phrasing → the page that must come back
  <area>/<page>.md     one page per feature; the page id Sky sees is "<area>/<page>"
```

Areas: `getting-started`, `home`, `meetings`, `attendance`, `settings`, `backup-and-devices`,
`account`, `privacy`, `sky`, `status`. A page's `area` in its front-matter must equal its
folder. Page ids are stable identifiers: renaming a page is a content change that
`questions.yml` must follow.

## Page template

```markdown
---
title: Cloud Backup
area: settings
screen: Settings → Cloud Backup        # on-screen labels, verbatim from app/i18n/en.ts
platforms: [ios, android]              # omitted = [ios, android, web]
tier: attendance                       # free | attendance | premium: what you need to use it
aliases: [backup, sync, "new phone"]   # keyword fuel for the search; omitted = none
---
<!-- sources: app/screens/SettingsScreen.tsx, docs/BACKUP.md -->
One paragraph: what it is, in plain words. This is its own chunk.

## How to turn on Cloud Backup
Steps. The first sentence restates where you are, because this section is retrieved alone.

## What you'll see
Statuses, labels, limits.

## Good to know
Tier, platform differences, what it does NOT do.

## If something's wrong
Symptom → what to try → when to contact support.

## Questions people ask
**Q:** Will my favorites move to my new phone?
**A:** No. Only attendance records and the reports you've sent are backed up. …
```

Front-matter rules (the ingest enforces them): `title`, `area` and `screen` are required;
`platforms` is a subset of `[ios, android, web]` and means all three when omitted; `tier` is
`free`, `attendance` or `premium` and means `free` when omitted; `aliases` is a list of
strings. The `<!-- sources: … -->` comment is required, lists repo-relative paths separated
by commas, and every path must exist in this repo. The ingest strips it before chunking.

## Authoring rules

These are the review checklist for every page.

1. **Second person, present tense, plain words.** "Tap Settings, then Cloud Backup."
2. **On-screen labels verbatim, in quotes,** taken from `app/i18n/en.ts`. If the screen
   says "Back up attendance", the manual never says "enable sync".
3. **No internal names.** No "ownership gate", "OTA", "MST", "entitlement", "runtime
   version", "attestation", "RevenueCat", "Auth0". If a concept needs a name, use the one
   the screen uses or describe it.
4. **Platform and tier stated inside the section where they differ**, not only in
   front-matter: "On Android, …", "This needs the Attendance subscription." A retrieved
   section stands alone.
5. **Say where data lives**: "stays on this phone", "in your backup", "never leaves the
   phone". This app's privacy posture is a feature; the manual states it precisely, never
   vaguely.
6. **No roadmap, no "coming soon", no "we plan to".** The manual describes what the
   installed app does today.
7. **Nothing that looks like real data**: no example email addresses that could be real,
   no account ids, no names. `you@example.com` is fine.
8. **Every claim is traceable** to a file in the page's `<!-- sources -->` line. A claim
   the reviewer cannot find in those sources is removed, not softened.
9. **The hand-off sentence is always the same**: "Contact support@recoverysky.app and
   mention [what to mention]." Never a different address, never "reach out to us".
10. **Honest edges.** Where the app cannot do something people expect (delete the cloud
    copy from inside the app, move favorites to a new phone), the manual says so plainly.
11. **A section is one H2 and at most 400 words.** H3s stay inside their H2. The intro
    paragraph before the first H2 is its own chunk. The ingest fails on a longer section;
    split it.
12. **"Questions people ask" is in the user's words**, the way the symptom table in
    `docs/support/README.md` is: "my favorites didn't move", not "favorites are
    device-local".
13. **At least three `questions.yml` entries per page**, in the user's words, and they
    must retrieve the page in the top three.

## How a page is chunked

- One chunk per H2 section; the intro paragraph is chunk 0.
- Chunk id is `<page>#<heading-slug>` (`backup-and-devices/new-phone#before-you-switch`;
  the intro is `<page>#intro`), so re-ingest is an idempotent upsert and two H2s on one
  page must not slug to the same thing.
- The search embeds `"<title> — <screen>\n## <heading>\n<body>"`, so the breadcrumb travels
  with the section; the keyword side also sees the page's `aliases`.
- The whole section text is stored with the chunk; nothing is fetched from anywhere else.

## The map (`map.md`)

About 350 words, never more than 600, written **to Sky** ("you" is Sky), pasted into her
prompt as one section. It must not contain a line starting with `## ` or `# ` (that would
open a new prompt section), and it follows rules 2–10 above. It lists what exists so she
searches only for details: the tabs and what is in each, the subscriptions by their
on-screen names, the ways to sign in, cloud backup in one sentence, where she lives and
what she cannot do, and the support address. Its sources are listed in a sources comment
at the top like any page.

## `questions.yml`

```yaml
- q: how do I email my attendance to my probation officer
  expect: attendance/reports
```

Each `q` runs through the same search Sky uses (no filters, three hits); the run passes
when every `expect` page appears among the three. It needs the embedding API, so the
ingest runs it, not a unit test.

## Validate before committing

From this repo, with the agent repo checked out beside it:

```bash
pnpm --dir ../agent manual:ingest ../app/docs/manual --dry-run
```

It parses every page, lists every problem (front-matter, missing sources paths, sections
over 400 words, a map with headings, questions that name a page that does not exist) and
writes nothing. The same parser runs the real ingest; there is no second implementation.

## When it is ingested

By hand, from the agent repo with the production `.env`, after a release that touched this
folder is live: `pnpm manual:ingest ../app/docs/manual`. See the "User's Manual" section
of `CLAUDE.md` and the release checklists there.
````

- [ ] **Step 2: Write the map**

`docs/manual/map.md` (every claim below was checked on 2026-10-12 against the files in its sources line; the writer re-checks any line they change):

````markdown
<!-- sources: app/navigators/MainNavigator.tsx, app/screens/MeetingsScreen.tsx, app/screens/AttendanceScreen.tsx, app/screens/SettingsScreen.tsx, app/screens/login/LoginSteps.tsx, app/screens/LoginScreen.tsx, app/screens/WrongAccountView.tsx, app/i18n/en.ts, app/i18n/platformStrings.ts, app/services/purchases/config.ts, app/context/SubscriptionContext.tsx, app/components/PermissionsSection.tsx, app/components/SchedulePopup.tsx, app/components/InPersonPopup.tsx, app/components/NinetyInNinetyCard.tsx, app/screens/HomeScreen.tsx, app/models/ProfileStore.ts, docs/BACKUP.md -->
RecoverySky is a free recovery app for iPhone, Android and the web, with four tabs along the bottom:

**Home** shows the user's clean time, money saved, the 90-in-90 challenge, and help cards.

**Meetings** has three segments at the top, "Online", "In-Person" and "Search", with a "Fellowship" and "Lang" filter bar under them. Online meetings open in the Zoom app. In-Person has a list and a map and asks for the Location permission. Hearts (favorites), star ratings and meeting reminders live in a meeting's popup.

**Attendance** has "New", "Archive" and "Reports". The tab appears only when "Enable Attendance" is on in Settings → Attendance; a subscription turns it on by itself. Attendance is logged with a timer when joining an online meeting, or with "I'm Here" at an in-person meeting. Tracking is free.

**Settings** has Recovery (date, fellowship), Attendance, App Settings (language, dark mode, theme), Permissions (Push Notifications, Location), Subscription, Cloud Backup, Account, Import, Legal, and the Rate, Support and Check for Updates buttons.

Subscriptions are in Settings → Subscription; the Status row says "Free", "Attendance" or "Premium".
- "Attendance" unlocks attendance reports ("Report Email" and "Send Report" in the Reports section) and the Cloud Backup section.
- "Premium" unlocks the Agent tab (you), Push Notifications and meeting reminders. "Upgrade to Premium" and "Restore Purchases" are in Settings → Subscription; a subscription belongs to the account, so "Restore Purchases" brings it to a new phone.

Signing in: "Continue with Apple", "Continue with Google", or "Continue with Email" with a 6-digit code. Older accounts can use "Can't get an email code? Sign in with your password". On Android, "Just join meetings" browses and joins meetings with no account (guest mode); iPhone needs an account. One phone holds one account's data: signing in as a different account shows "This device is set up for a different RecoverySky account."

Where data lives: the clean date, profile, favorites, ratings, reminders, settings and attendance stay on the phone, encrypted. "Back up attendance" (Settings → Cloud Backup, off by default, needs the Attendance subscription) backs up attendance records and the reports the user has sent, and syncs them between the user's phones. Nothing else moves between phones. Nothing in the app deletes the cloud copy; "Delete User Data" clears this phone only.

You are Sky, in the Agent tab. You cannot change a setting, log attendance or send a report; you explain how. When something is beyond you, say: "Contact support@recoverysky.app and mention …" with what to mention.
````

Check the count: `wc -w docs/manual/map.md` must be under 600 (it is about 420 with the sources line).

- [ ] **Step 3: Start the questions file**

`docs/manual/questions.yml`:

```yaml
# Retrieval smoke test for the manual: each `q` is run through the same search Sky
# uses (no filters, three hits) and must bring back its `expect` page. At least three
# per page, in the user's words. The ingest runs this after writing; a miss exits 1.
[]
```

Task 9 replaces the `[]` with the entries once the pages are final.

- [ ] **Step 4: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app
git add docs/manual/README.md docs/manual/map.md docs/manual/questions.yml
git commit -m "📝 docs(manual): authoring rules, the map and the questions file

The user's manual is Sky's reference to the app. The README carries the
thirteen rules from the spec and the chunk contract; map.md is the always-on
prompt section, written to Sky and checked claim by claim against the
screens; questions.yml is the retrieval smoke test the ingest runs.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Write the five `backup-and-devices/` pages (app, `docs/manual/backup-and-devices/`)

Every page follows the template and the thirteen rules in `docs/manual/README.md`. Each brief below gives the front-matter, the sources line, the **fact sheet** (every claim the page may make, each checked against the named source on 2026-10-12), the section skeleton with the sentences that must appear, and the "Questions people ask" entries. Write from the fact sheet and the sources only; a sentence that is not backed by the sheet or by something you read in the sources is left out. Keep every H2 under 400 words and use the labels exactly as quoted.

**Files:**
- Create: `docs/manual/backup-and-devices/cloud-backup.md`
- Create: `docs/manual/backup-and-devices/using-more-than-one-device.md`
- Create: `docs/manual/backup-and-devices/new-phone.md`
- Create: `docs/manual/backup-and-devices/one-account-per-phone.md`
- Create: `docs/manual/backup-and-devices/if-backup-isnt-working.md`

**Interfaces:**
- Produces: the five page ids `backup-and-devices/cloud-backup`, `…/using-more-than-one-device`, `…/new-phone`, `…/one-account-per-phone`, `…/if-backup-isnt-working` that `questions.yml` (Task 9) and the hand checklist (Task 14) name.

**On-screen strings used across the pages** (from `app/i18n/en.ts` unless noted; quote them exactly):

| Where | String |
| --- | --- |
| Settings section | "Cloud Backup" |
| The switch | "Back up attendance" |
| Hint under the switch when OFF | "Keep your attendance history safe and synced across devices. Encrypted on your device, in transit, and in the cloud." |
| Status line when ON (checked in this order) | "Paused — offline"; "Backing up…" plus " (N)" when records remain; "Syncing…"; "Backup issue — will retry"; "All backed up ✓ · 3:42 PM" (time of day only); nothing until the first pass of this launch completes |
| Dialog after buying a subscription | "Welcome to Premium!" then "Thank you for supporting RecoverySky. Want to back up your attendance history and keep it synced across your devices? Your attendance is encrypted on your device, in transit, and at rest in the cloud." with "Not now" / "Back up attendance" |
| Dialog after "Restore Purchases" and once per launch pass | "Back up your attendance?" then "Your subscription includes cloud backup, but it isn't turned on for this device. Turn it on to keep your attendance history safe and synced across your devices. Your attendance is encrypted on your device, in transit, and at rest in the cloud." |
| Subscription section | "Subscription", Status "Free" / "Attendance" / "Premium", "Restore Purchases", "Upgrade to Premium", "Manage Subscription" |
| Account section | "Account", "Delete User Data", confirm "Are you sure you want to delete all your user data? This cannot be undone.", buttons "Cancel" / "OK!", "Logout" |
| Attendance settings | "Enable Attendance" |
| Import section | "Import", "Restart Import" |
| Database overlay | "Can't unlock your local data"; "The key that protects this device's local data is missing or no longer matches it. That data can't be recovered without the key. Resetting starts fresh on this device; attendance you backed up to the cloud syncs back after you sign in."; button "Reset local data"; confirm "Reset local data?" / "This deletes the local database on this device. It cannot be undone." |
| Wrong-account screen | "This device is set up for a different RecoverySky account."; "Sign in to that account to continue. Your meetings and records are safe."; "Send code to {{email}}" (the address is shown masked); "Sign in with Google"; "Sign in with Apple"; "Sign in with your password instead"; "Cancel"; "If you can't sign in to that account, contact support@recoverysky.app" |
| Login | "Continue with Apple", "Continue with Google", "Continue with Email", "Send code to {{email}}", "Use a different email", "Just join meetings" (Android only, `app/i18n/platformStrings.ts`) |
| Attendance tab | "Reports", "Report Email", "Send Report", "To produce attendance reports, you must subscribe." |

- [ ] **Step 1: `cloud-backup.md`**

Front-matter and sources:

```markdown
---
title: Cloud Backup
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
tier: attendance
aliases: [backup, sync, "back up attendance", cloud, synced, "all backed up", encrypted]
---
<!-- sources: app/screens/SettingsScreen.tsx, app/i18n/en.ts, docs/BACKUP.md, app/services/sync/enableCloudBackup.ts, app/hooks/useCloudBackupPrompt.ts, app/db/BackupPassRunner.tsx, app/services/sync/index.ts -->
```

Fact sheet:
- Backs up **attendance records and the reports you have sent**. Nothing else. (`docs/BACKUP.md` "Architecture", "Reports": attendance pushed and pulled; reports pull-only.)
- Off by default; the switch is remembered **per phone**, not per account. (`docs/BACKUP.md` "The one-off backup pass": "The toggle is per-device".)
- The "Cloud Backup" section is shown only while the **Attendance subscription** is active on this phone; without it there is no section and no row to tap. (`SettingsScreen.tsx:1293`.) If you have the subscription and the section is missing, "Restore Purchases" in Settings → Subscription brings it back. (`docs/support/problems/data-missing-after-new-phone.md` Solution 2; the Restore handler shows the backup prompt afterwards, `SettingsScreen.tsx:690`.)
- How to turn on: Settings → "Cloud Backup" → switch "Back up attendance" on. Under the switch, before it is on: the hint quoted above.
- The first time it is on, the app first fetches whatever is already in the backup, then backs up every attendance record on this phone, a batch at a time. For a long history that takes minutes; keep the app open and online. (`docs/BACKUP.md` "Toggle semantics": pull both resources, backfill reports, paced push; "Minutes, not seconds".)
- After that, backup runs when you log or edit attendance (a few seconds later), when you open the app, and when you open the Attendance tab. There is no schedule and nothing runs in the background. (`docs/BACKUP.md` "Triggers": "There is no polling and no OS background task".)
- It only runs while you are signed in, online, the subscription is active, and the app is not in maintenance. (`docs/BACKUP.md` "The gate".)
- Status line meanings, in the order the app checks them (`SettingsScreen.tsx:94-119`): "Paused — offline" (no connection; also shown while offline even after a good backup); "Backing up… (12)" (12 records still to send); "Syncing…"; "Backup issue — will retry" (two failures in a row; it retries on its own); "All backed up ✓ · 3:42 PM" (the time of the last completed pass today); blank when nothing has run yet since the app opened.
- Switching it OFF **pauses** backup. Nothing is deleted: not on the phone, not in the backup. Switching it back ON backs everything up again, which is safe. (`docs/BACKUP.md` "Toggle semantics": "OFF is pause-only"; "Re-enabling safely re-enqueues every local record".)
- The app offers to turn it on: right after buying a subscription ("Welcome to Premium!" dialog, "Back up attendance" / "Not now"), after "Restore Purchases", and once on a later launch ("Back up your attendance?"). Answering "Not now" to the launch offer means it is not asked again. (`useCloudBackupPrompt.ts`, `BackupPassRunner.tsx`, `docs/BACKUP.md` "ask once, never again".)
- There is **no "Back up now" button**; the switch is the only control. (`SettingsScreen.tsx:1300-1316`.)
- Encryption: say exactly what the hint says ("Encrypted on your device, in transit, and in the cloud."); say nothing more specific.
- Honest edge: **nothing in the app deletes the cloud copy**, not "Delete User Data", not "Reset local data", not switching backup off. To have it removed: "Contact support@recoverysky.app and mention that you want your cloud backup deleted." (`SettingsScreen.tsx:467-527` makes no server call; `docs/support/reference/device-owner.md:152`.)
- Reports arrive on another phone a few at a time (one every second or so), so a long list takes a little while. (`docs/BACKUP.md` "Reports", `REPORT_BODY_PACE_MS`.)
- Web: the backup offers never appear on the web app; say the feature is for the phone apps (front-matter `platforms: [ios, android]`).

Skeleton:
- Intro: what it backs up, that it is off by default and per phone, and that it needs the Attendance subscription.
- `## How to turn on Cloud Backup`: first sentence "You're in Settings." Then the steps and the hint text. End with: "This needs the Attendance subscription; without it the Cloud Backup section isn't shown."
- `## What you'll see`: the status lines, one per bullet, each with its meaning.
- `## Good to know`: when it runs, what OFF does, the three offers, no "Back up now" button, encryption sentence, and the edge: "There is no way to delete the cloud copy from inside the app. Contact support@recoverysky.app and mention that you want your cloud backup deleted."
- `## If something's wrong`: section missing → "Restore Purchases"; stuck on "Backing up…" → keep the app open and online; "Backup issue — will retry" → see the page "If Cloud Backup isn't working" (name it by title); otherwise the hand-off sentence with "mention what the status line under 'Back up attendance' says".
- `## Questions people ask`: **Q:** Does Cloud Backup save my favorites or my clean date? **A:** No… / **Q:** Is my attendance encrypted? **A:** the hint sentence / **Q:** How do I delete my backup? **A:** the honest edge / **Q:** Why don't I see Cloud Backup in Settings? **A:** subscription.

- [ ] **Step 2: `using-more-than-one-device.md`**

```markdown
---
title: Using RecoverySky on more than one device
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
tier: attendance
aliases: ["two phones", "second device", tablet, "sync between devices", "favorites didn't move", "didn't come over"]
---
<!-- sources: docs/BACKUP.md, app/screens/SettingsScreen.tsx, app/services/sync/attendanceSyncService.ts, app/services/sync/syncLogic.ts, app/db/feedbackCache.ts, app/services/api/index.ts, app/models/ProfileStore.ts, app/context/SubscriptionContext.tsx, app/i18n/en.ts -->
```

Fact sheet:
- Sign in with the **same account** on both devices (the same Apple, Google or email). The subscription belongs to the account: on the second device, Settings → Subscription → "Restore Purchases" if the Status row does not show it. (`SubscriptionContext.tsx`: identity is the signed-in account; `settingsScreen.restorePurchases`.)
- Turn "Back up attendance" on **on each device**; the switch is per phone. (`docs/BACKUP.md`.)
- What moves between devices: attendance records (new ones, edits, archived and deleted ones) and the reports you have sent. (`docs/BACKUP.md` "Push": deletions are pushes with `deleted: true`; "Reports".)
- When the same record is changed on both devices, the **latest change wins**. (`docs/BACKUP.md` "Push": `rejected: "stale"` is last-write-wins.)
- What does **not** move and stays on the device where you made it: your clean date and profile (name, pronouns, fellowship), favorites (hearts) and star ratings, meeting reminders, your settings (theme, language, the Meetings filters), money saved and the 90-in-90 challenge, and attendance records from before backup was on that device. (`ProfileStore.ts` props are per-install MMKV and encrypted SQLite; `feedbackCache.ts` is local SQLite; reminders: the app never fetches another device's reminders, `api.getReminders` has no caller in `app/`; `docs/BACKUP.md` scope.)
- Timing: a change is sent a few seconds after you make it; the other device picks it up when you open the app there or open its Attendance tab; both need to be online. (`docs/BACKUP.md` "Triggers".)
- Reports arrive a few at a time. (`docs/BACKUP.md` "Reports".)
- Guest mode on Android ("Just join meetings") has no account, so there is nothing to sync and nothing of yours is shown to a guest. (`CLAUDE.md` "Guest mode (Android)".)
- Tablets and web: the web app does not offer Cloud Backup (front-matter). A tablet running the app behaves like a second phone.

Skeleton:
- Intro: one paragraph: same account on both, backup on on both, what syncs in one sentence.
- `## How to set up a second device`: "You're on the new device." Sign in the same way; Settings → Subscription → "Restore Purchases" if needed; Settings → "Cloud Backup" → "Back up attendance" on; wait for "All backed up ✓".
- `## What moves between your devices`: the two things that move; the latest-change rule.
- `## What stays on each device`: the list above as bullets, each with "stays on the phone where you made it" phrasing (rule 5).
- `## Good to know`: timing, reports a few at a time, guest mode.
- `## If something's wrong`: a record missing on the other device → check same account, switch on on both, both online, wait a few minutes; then the hand-off: "Contact support@recoverysky.app and mention which device is missing what, and the status line under 'Back up attendance' on each."
- `## Questions people ask`: **Q:** My favorites didn't come over to my new phone. **A:** … / **Q:** Can I use RecoverySky on two phones? **A:** … / **Q:** I edited a meeting on both phones, which one counts? **A:** the latest change.

- [ ] **Step 3: `new-phone.md`**

```markdown
---
title: Moving to a new phone
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
tier: attendance
aliases: ["new phone", transfer, "switch phones", "restored from backup", "lost my records", "data is gone", "records are gone"]
---
<!-- sources: docs/support/problems/data-missing-after-new-phone.md, docs/support/replies/data-missing-after-new-phone.md, docs/BACKUP.md, app/i18n/en.ts, app/db/DatabaseLoadingOverlay.tsx, app/db/resetLocalDatabase.ts, app/screens/SettingsScreen.tsx, app/screens/onboarding/OnboardingImport.tsx -->
```

Fact sheet:
- **Before you switch**, while the old phone still works: if you have the Attendance subscription, open Settings → "Cloud Backup" on the old phone, turn on "Back up attendance" and wait for "All backed up ✓". Without the subscription, or if backup was never on, your records are only on the old phone and **cannot be recovered** from anywhere else once it is gone. (`docs/support/problems/data-missing-after-new-phone.md` Causes 1 and 3; replies `data-was-only-on-old-phone`.)
- **On the new phone**: sign in the same way you did before (the same Apple, Google or email address); the first account to sign in becomes the phone's account. Then Settings → Subscription → "Restore Purchases" if the "Cloud Backup" section is missing; then Settings → "Cloud Backup" → "Back up attendance" on; keep the app open and online; the first pass fetches your backup before it sends anything. Reports come a few at a time. (replies `turn-on-backup-and-sign-in`.)
- What comes back: attendance records and the reports you sent. What does not: favorites, ratings, reminders, your clean date and profile (enter them again in Settings → Recovery), settings. (`docs/BACKUP.md`; the multi-device page.)
- Data from the **older RecoverySky app** is not in Cloud Backup: Settings → "Import" → "Restart Import" (or the import step during first-time setup). (`settingsScreen.importSection`, `restartImport`; `OnboardingImport.tsx`.)
- **Signed in with a different account by mistake** (a different method, a different address, Apple's hidden address): your records are under the account you used before, and the new phone now belongs to the account you just used. If the Attendance tab and Settings hold nothing you made on this phone: Settings → "Delete User Data" → "OK!" (this clears this phone only, nothing in the cloud), then sign in the way you did on the old phone, then turn on "Back up attendance". On iPhone a "Sign In" system message may appear for a Google or Apple account; go through it. If you see records you made on this phone, stop and contact support first. (replies `sign-in-the-original-way`; problem Solution 3.)
- **Restored the new phone from a phone backup or transfer** and it says "Can't unlock your local data": the database came across but its key did not, and that local data cannot be read. Tap "Reset local data", confirm "Reset local data?" → "This deletes the local database on this device. It cannot be undone.", sign in, and anything in Cloud Backup returns once "Back up attendance" is on. (`DatabaseLoadingOverlay.tsx`, `database.*` strings; problem Cause 6.)
- Hand-off when backup was on and records are still missing: "Contact support@recoverysky.app and mention how you signed in on the old phone (Apple, Google, an email code or a password), the email address you used, and roughly when you last saw your records. Don't delete anything or uninstall the app first." (replies `checking-your-data`.)

Skeleton:
- Intro: your records live on the phone unless Cloud Backup is on; two steps: back up on the old phone, sign in and turn on backup on the new one.
- `## Before you switch`: "You're still on your old phone." The steps; the honest no-subscription sentence.
- `## On the new phone`: "You're on the new phone." The numbered steps including "Restore Purchases"; the first-pass sentence; reports a few at a time.
- `## What comes back and what doesn't`: two short lists; the Import sentence for the older app.
- `## If you signed in with a different account`: the "Delete User Data" route with its conditions and the iPhone "Sign In" note.
- `## If the new phone can't unlock your local data`: the overlay text, "Reset local data", what returns.
- `## If something's wrong`: the hand-off sentence above, plus "Don't delete anything first."
- `## Questions people ask`: **Q:** I got a new phone and my attendance is gone. **A:** … / **Q:** Will my favorites and reminders move? **A:** no… / **Q:** Can you restore records from my old phone? **A:** only what was backed up…

- [ ] **Step 4: `one-account-per-phone.md`**

```markdown
---
title: One account per phone
area: backup-and-devices
screen: Settings → Account
tier: free
aliases: ["different account", "wrong account", "share a phone", "switch accounts", family, partner, "set up for a different account"]
---
<!-- sources: docs/support/reference/device-owner.md, app/i18n/en.ts, app/i18n/platformStrings.ts, app/screens/WrongAccountView.tsx, app/screens/WrongAccountScreen.tsx, app/screens/SettingsScreen.tsx, app/screens/login/guestEntryLogic.ts, docs/BACKUP.md -->
```

Fact sheet:
- Each install of the app holds the data of **one account**: the first account that signs in on that phone. Logging out does not change that; your records stay on the phone, protected, until that account signs back in. (`device-owner.md` "The owner record", "Logout never clears the owner".)
- Signing in as a **different account** shows "This device is set up for a different RecoverySky account." with "Sign in to that account to continue. Your meetings and records are safe." Nothing is deleted or changed. (`wrongAccountScreen.*`; `WrongAccountScreen.tsx` header comment.)
- That screen offers the way the phone's account signed in: "Send code to …" with the address shown masked (email accounts), "Sign in with Google" or "Sign in with Apple", "Sign in with your password instead" (older password accounts), and "Cancel" back to the login screen. (`device-owner.md` "Which buttons show".)
- Why: it keeps one person's attendance and reports from mixing with another person's, on the phone and in Cloud Backup. (`docs/BACKUP.md` "The one invariant".)
- **Sharing a phone**: a second person needs their own phone for their own account. On Android, someone else can tap "Just join meetings" on the login screen to browse and join meetings as a guest with no account; a guest sees none of your records, settings or favorites, and nothing personal is recorded for them. On iPhone there is no guest mode. (`guestEntryLogic.ts`: Android only; `CLAUDE.md` "Guest mode (Android)".)
- **Handing the phone to a different account on purpose**: sign in as the phone's current account, open Settings → Account → "Delete User Data" → "OK!". That removes everything on this phone (attendance that was never backed up, favorites, ratings, reminders, settings, your profile) and leaves the cloud copy untouched; the next account to sign in becomes the phone's account. (`SettingsScreen.tsx:467-527`; `device-owner.md` "Delete User Data".)
- Same person, two ways in (say Google and an email code): after you prove it is you with the phone's original method, the other method may be joined to your account; the app does not say either way. (`device-owner.md` "Linking from the rescue".)
- Hand-off: can't sign in to the account the phone is set up for → "Contact support@recoverysky.app and mention that your phone shows 'This device is set up for a different RecoverySky account' and how you used to sign in." The screen itself shows "If you can't sign in to that account, contact support@recoverysky.app".

Skeleton:
- Intro: one phone, one account, and what the different-account screen means.
- `## What the "different account" screen means`: "You just signed in and the app shows 'This device is set up for a different RecoverySky account.'" The buttons and what each does; "Cancel" returns to login; nothing is deleted.
- `## Sharing a phone`: the Android guest sentence with "Just join meetings"; iPhone needs an account; two people cannot both keep records on one phone.
- `## Switching this phone to a different account`: the "Delete User Data" route, what it removes, what it keeps.
- `## Good to know`: logout keeps the phone's account; why the rule exists (privacy, Cloud Backup); the two-methods note.
- `## If something's wrong`: the hand-off sentence.
- `## Questions people ask`: **Q:** It says this phone is set up for a different account. **A:** … / **Q:** Can my partner use the app on my phone? **A:** … / **Q:** How do I switch accounts on this phone? **A:** …

- [ ] **Step 5: `if-backup-isnt-working.md`**

```markdown
---
title: If Cloud Backup isn't working
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
tier: attendance
aliases: ["backup stuck", "paused offline", "backup issue", "will retry", "not syncing", "not backing up", "missing on other phone"]
---
<!-- sources: app/screens/SettingsScreen.tsx, app/i18n/en.ts, docs/BACKUP.md, app/services/sync/attendanceSyncService.ts, app/services/sync/index.ts, docs/support/problems/data-missing-after-new-phone.md, app/components/MaintenanceBanner.tsx -->
```

Fact sheet (symptom → meaning → what to try):
- "Paused — offline": the phone has no connection; backup resumes by itself when it is back. It shows whenever you are offline, even right after a good backup. (`SettingsScreen.tsx:100`; `docs/BACKUP.md` Known issue 4.)
- "Backing up… (37)": 37 records still to send; the first backup of a long history takes minutes; keep the app open and online. Records go in batches with a pause between them. (`docs/BACKUP.md` "Push": batches of 200, 7 s apart.)
- "Syncing…": fetching changes from your backup.
- "Backup issue — will retry": two attempts in a row failed; the app waits (half a minute, then a minute, then five) and tries again on its own. Check the connection, then reopen the app or open the Attendance tab to try sooner. If it stays for a day, contact support. (`attendanceSyncService.ts`: backoff 30 s → 60 s → 5 min; two consecutive failures.)
- Nothing under "Back up attendance" after the switch is on: nothing has run since the app opened. Open the Attendance tab, or close and reopen the app. (`SyncStatusLine` returns null until a pass completes.)
- The "Cloud Backup" section is missing: the Attendance subscription is not active on this phone. Settings → Subscription → "Restore Purchases"; if you never subscribed, backup needs the Attendance subscription. (`SettingsScreen.tsx:1293`.)
- A banner at the top says the app is in maintenance or has network issues: backup waits until it clears. (`docs/BACKUP.md` "The gate": not in maintenance; `MaintenanceBanner.tsx`.)
- Records missing on your other phone: same account on both? "Back up attendance" on on both? Both online? Give it a few minutes and open the Attendance tab on the phone that is missing them. Reports arrive a few at a time. A record edited on both phones keeps the latest change. (The multi-device page's facts.)
- Honest edge: a single old record that never backs up is rare and is something support has to look at. (`docs/BACKUP.md` "A 5xx on a batch is bisected": a poison record drops out after three tries.)
- Hand-off: "Contact support@recoverysky.app and mention what the status line under 'Back up attendance' says, whether you have the Attendance subscription, and which records are missing where."

Skeleton:
- Intro: the status line under "Back up attendance" in Settings → Cloud Backup says what is happening; this page reads it.
- `## What the status line means`: "You're in Settings → Cloud Backup." One bullet per status, with the fix.
- `## If the Cloud Backup section is missing`: the subscription sentence and "Restore Purchases".
- `## If records are missing on your other phone`: the checklist.
- `## Good to know`: maintenance banner; no background backup (it runs while the app is open); OFF pauses, nothing is lost.
- `## If something's wrong`: the hand-off sentence; "Don't delete anything first."
- `## Questions people ask`: **Q:** What does "Paused — offline" mean? **A:** … / **Q:** It says "Backup issue — will retry". **A:** … / **Q:** Why don't I see Cloud Backup in Settings? **A:** …

- [ ] **Step 6: Check the word caps and the labels**

```bash
cd /Users/jenova/projects/recoverysky-org/app
for f in docs/manual/backup-and-devices/*.md; do echo "== $f"; awk '/^## /{if (n) print h": "n" words"; h=$0; n=0; next} {n+=NF} END{print h": "n" words"}' "$f"; done
grep -n "recoverysky.org\|entitlement\|RevenueCat\|Auth0\|OTA\|coming soon" docs/manual/backup-and-devices/*.md
```

Expected: every section under 400 words; the grep prints nothing.

- [ ] **Step 7: Commit the draft**

```bash
cd /Users/jenova/projects/recoverysky-org/app
git add docs/manual/backup-and-devices/
git commit -m "📝 docs(manual): first drafts of the backup-and-devices pages

Cloud Backup, more than one device, a new phone, one account per phone, and
what to do when backup isn't working, written from docs/BACKUP.md, the
Settings screen and the support KB. Fact-check review follows.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Fact-check review and the questions (app, `docs/manual/`)

The reviewer is a different reader than the writer of Task 8 (a fresh subagent when the writer was one). The review is the real gate: an invented setting in this corpus is repeated by Sky with confidence.

**Files:**
- Modify: the five pages from Task 8 (fixes only)
- Modify: `docs/manual/questions.yml` (replace `[]`)

- [ ] **Step 1: Dispatch the reviewer with this brief**

Give the reviewer the five page paths, `docs/manual/README.md`, and this checklist; they read the sources named in each page's `<!-- sources -->` line and report, per page, a list of `line: claim → verdict (source or REMOVE)`:

1. Every sentence that states a fact about the app is traced to one of the page's sources (rule 8). A claim with no source is marked REMOVE; the reviewer does not soften it.
2. Every quoted label exists verbatim in `app/i18n/en.ts` (or `app/i18n/platformStrings.ts` for "Just join meetings") (rule 2). The reviewer greps each quoted string.
3. No internal name: grep each page for `entitlement`, `RevenueCat`, `Auth0`, `OTA`, `MST`, `attestation`, `sub`, `uid`, `MMKV`, `SQLite`, `queue`, `outbox`, `gate` (rule 3).
4. Every section under 400 words; the intro paragraph exists; no two H2s slug alike (rule 11).
5. The tier or platform is stated inside every section whose behaviour depends on it (rule 4): the Attendance subscription for the Cloud Backup section, Android for "Just join meetings", iPhone for the "Sign In" system message.
6. Every hand-off sentence starts "Contact support@recoverysky.app and mention" (rule 9); grep for `recoverysky.org` and `reach out`.
7. The two honest edges are present: the cloud copy cannot be deleted from the app (`cloud-backup.md`), and favorites, reminders and the profile do not move to another phone (`using-more-than-one-device.md`, `new-phone.md`) (rule 10).
8. No "coming soon", "soon", "plan to", "future" (rule 6); no example address other than `you@example.com` (rule 7).

- [ ] **Step 2: Apply the verdicts**

Remove or fix every flagged line; re-run the Task 8 Step 6 commands. Re-dispatch the reviewer on the changed pages until the report has no REMOVE and no label mismatch.

- [ ] **Step 3: Write the questions**

Replace the `[]` in `docs/manual/questions.yml` with:

```yaml
- q: how do I turn on cloud backup
  expect: backup-and-devices/cloud-backup
- q: what does back up attendance actually save
  expect: backup-and-devices/cloud-backup
- q: is my attendance encrypted in the cloud
  expect: backup-and-devices/cloud-backup
- q: how do I delete my cloud backup
  expect: backup-and-devices/cloud-backup
- q: can I use RecoverySky on two phones
  expect: backup-and-devices/using-more-than-one-device
- q: my favorites didn't come over to my new phone
  expect: backup-and-devices/using-more-than-one-device
- q: will my attendance show up on my tablet too
  expect: backup-and-devices/using-more-than-one-device
- q: I got a new phone and my attendance is gone
  expect: backup-and-devices/new-phone
- q: how do I move my records to a new phone
  expect: backup-and-devices/new-phone
- q: it says can't unlock your local data after I restored my phone
  expect: backup-and-devices/new-phone
- q: it says this phone is set up for a different account
  expect: backup-and-devices/one-account-per-phone
- q: can my partner use my phone with their own account
  expect: backup-and-devices/one-account-per-phone
- q: how do I switch to a different account on this phone
  expect: backup-and-devices/one-account-per-phone
- q: what does paused offline mean
  expect: backup-and-devices/if-backup-isnt-working
- q: backup says backup issue will retry
  expect: backup-and-devices/if-backup-isnt-working
- q: why don't I see the cloud backup section in settings
  expect: backup-and-devices/if-backup-isnt-working
```

("my favorites didn't come over to my new phone" is expected on the multi-device page, as the spec's example has it; if Task 14's run brings `new-phone` first instead, that is acceptable too: change the `expect`, both pages answer it.)

- [ ] **Step 4: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app
git add docs/manual/backup-and-devices/ docs/manual/questions.yml
git commit -m "📝 docs(manual): fact-checked backup-and-devices pages and their questions

Every claim traced to the page's sources by a second reader; unsourced
sentences removed, labels matched to en.ts. Sixteen retrieval questions in
the user's words, at least three per page.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `@recoverysky/manual`: the package and the pure parser (agent, `packages/manual`)

**Files:**
- Create: `packages/manual/package.json`, `packages/manual/tsconfig.json`, `packages/manual/vitest.config.ts`, `packages/manual/src/index.ts`, `packages/manual/src/parse.ts`
- Modify: `tsconfig.json` (root references), `pnpm-lock.yaml` (via `pnpm install`)
- Test: `packages/manual/tests/parse.test.ts`

**Interfaces:**
- Consumes: `MANUAL_AREAS`, `MANUAL_PLATFORMS`, `MANUAL_TIERS` and the types from `@recoverysky/types` (Task 2).
- Produces (all pure, from `parse.ts`): `parsePage(pageId, markdown): { page: ParsedPage | null; problems: ParseProblem[] }`, `chunkPage(parsed): ManualChunk[]`, `validateMap(markdown): ParseProblem[]`, `parseQuestions(yamlText, pageIds): { questions: ManualQuestion[]; problems: ParseProblem[] }`, `pageIdFromPath(relativePath)`, `slugify(heading)`, `chunkPointId(chunkId)`, `countWords(text)`, constants `MAX_SECTION_WORDS = 400`, `MAX_MAP_WORDS = 600`, `PAGE_ID_PATTERN`. Types `ParsedPage { page, frontMatter: ManualFrontMatter, sources: string[], sections: ParsedSection[], words }`, `ParsedSection { order, heading, slug, content, words }`, `ManualChunk { id, pointId, page, order, heading, title, area, screen, platforms, tier, aliases, content, embedText, sparseText, contentHash }`, `ParseProblem { page, message }`, `ManualQuestion { q, expect }`.

- [ ] **Step 1: Scaffold the package**

`packages/manual/package.json`:

```json
{
  "name": "@recoverysky/manual",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "bin": {
    "manual": "./dist/bin/manual.js"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@recoverysky/db": "workspace:*",
    "@recoverysky/memory": "workspace:*",
    "@recoverysky/observability": "workspace:*",
    "@recoverysky/types": "workspace:*",
    "commander": "^12.1.0",
    "dotenv": "^16.4.5",
    "yaml": "^2.8.3",
    "zod": "^4.1.13"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^2.1.9"
  }
}
```

`packages/manual/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"],
  "references": [
    { "path": "../types" },
    { "path": "../observability" },
    { "path": "../memory" },
    { "path": "../db" }
  ]
}
```

`packages/manual/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

`packages/manual/src/index.ts` (grows in Task 11):

```ts
export * from './parse.js'
```

In the root `tsconfig.json`, add `{ "path": "packages/manual" }` to `references` after the `packages/pipeline` entry. Then:

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm install
```

(`yaml`, `commander` and `dotenv` are already in the lockfile as transitive or api dependencies; this adds the importer.)

- [ ] **Step 2: Write the failing parser tests**

`packages/manual/tests/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  parsePage,
  chunkPage,
  validateMap,
  parseQuestions,
  pageIdFromPath,
  slugify,
  chunkPointId,
  MAX_SECTION_WORDS,
} from '../src/parse.js'

const PAGE = `---
title: Moving to a new phone
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
tier: attendance
aliases: ["new phone", transfer]
---
<!-- sources: docs/BACKUP.md, app/screens/SettingsScreen.tsx -->
Your records live on the phone unless Cloud Backup is on.

## Before you switch
You're still on your old phone. Turn on "Back up attendance".

### A sub-heading stays inside
Still part of the section.

## On the new phone
Sign in the same way.

## Questions people ask
**Q:** Will my favorites move?
**A:** No.
`

const MINIMAL = `---
title: T
area: settings
screen: Settings
---
<!-- sources: docs/BACKUP.md -->
Intro.

## One
Body.
`

describe('parsePage', () => {
  it('parses front-matter, sources and sections, keeping H3s inside their H2', () => {
    const { page, problems } = parsePage('backup-and-devices/new-phone', PAGE)

    expect(problems).toEqual([])
    expect(page?.frontMatter).toEqual({
      title: 'Moving to a new phone',
      area: 'backup-and-devices',
      screen: 'Settings → Cloud Backup',
      platforms: ['ios', 'android'],
      tier: 'attendance',
      aliases: ['new phone', 'transfer'],
    })
    expect(page?.sources).toEqual(['docs/BACKUP.md', 'app/screens/SettingsScreen.tsx'])
    expect(page?.sections.map((s) => [s.order, s.heading, s.slug])).toEqual([
      [0, '', 'intro'],
      [1, 'Before you switch', 'before-you-switch'],
      [2, 'On the new phone', 'on-the-new-phone'],
      [3, 'Questions people ask', 'questions-people-ask'],
    ])
    expect(page?.sections[1].content).toBe(
      'You\'re still on your old phone. Turn on "Back up attendance".\n\n### A sub-heading stays inside\nStill part of the section.',
    )
    expect(page?.sections[0].content).toBe('Your records live on the phone unless Cloud Backup is on.')
  })

  it('fills the defaults: all platforms, free tier, no aliases', () => {
    const { page } = parsePage('settings/t', MINIMAL)
    expect(page?.frontMatter.platforms).toEqual(['ios', 'android', 'web'])
    expect(page?.frontMatter.tier).toBe('free')
    expect(page?.frontMatter.aliases).toEqual([])
  })

  it('strips the sources comment from the intro', () => {
    const { page } = parsePage('settings/t', MINIMAL)
    expect(page?.sections[0].content).toBe('Intro.')
  })

  it('reports every problem of a page at once', () => {
    const long = Array(MAX_SECTION_WORDS + 1).fill('word').join(' ')
    const bad = `---
title: T
area: home
screen: Settings
tier: gold
platforms: [ios, desktop]
---
<!-- sources: -->
Intro.

## Same
${long}

## Same
Body.

## Empty
`
    const { page, problems } = parsePage('settings/bad', bad)

    expect(page).toBeNull()
    const messages = problems.map((p) => p.message)
    expect(messages.some((m) => m.includes('tier'))).toBe(true)
    expect(messages.some((m) => m.includes('platforms'))).toBe(true)
    expect(problems.every((p) => p.page === 'settings/bad')).toBe(true)
  })

  it('reports a folder/area mismatch, a long section, a duplicate slug and an empty section', () => {
    const long = Array(MAX_SECTION_WORDS + 1).fill('word').join(' ')
    const bad = `---
title: T
area: home
screen: Home
---
<!-- sources: docs/BACKUP.md -->
Intro.

## Same
${long}

## Same
Body.

## Empty
`
    const { problems } = parsePage('settings/bad', bad)
    const messages = problems.map((p) => p.message).join('\n')

    expect(messages).toMatch(/area "home" does not match the folder "settings"/)
    expect(messages).toMatch(/section "Same" has 401 words; the cap is 400/)
    expect(messages).toMatch(/two sections slug to "same"/)
    expect(messages).toMatch(/section "Empty" is empty/)
  })

  it('refuses a page without front-matter, without a sources comment, or without an intro', () => {
    expect(parsePage('a/b', 'no front matter').problems[0].message).toMatch(/front-matter/)
    expect(parsePage('a/b', MINIMAL.replace(/<!--.*-->\n/, '')).problems[0].message).toMatch(/sources/)
    expect(parsePage('a/b', MINIMAL.replace('Intro.\n', '')).problems.map((p) => p.message).join()).toMatch(/intro paragraph/)
  })

  it('refuses a page id outside <area>/<name>', () => {
    expect(parsePage('Settings/T', MINIMAL).problems[0].message).toMatch(/page id/)
  })
})

describe('chunkPage', () => {
  it('builds ids, point ids, embed and sparse texts and a hash per section', () => {
    const { page } = parsePage('backup-and-devices/new-phone', PAGE)
    const chunks = chunkPage(page!)

    expect(chunks.map((c) => c.id)).toEqual([
      'backup-and-devices/new-phone#intro',
      'backup-and-devices/new-phone#before-you-switch',
      'backup-and-devices/new-phone#on-the-new-phone',
      'backup-and-devices/new-phone#questions-people-ask',
    ])
    expect(chunks[0].embedText).toBe(
      'Moving to a new phone — Settings → Cloud Backup\nYour records live on the phone unless Cloud Backup is on.',
    )
    expect(chunks[1].embedText).toBe(
      'Moving to a new phone — Settings → Cloud Backup\n## Before you switch\n' + page!.sections[1].content,
    )
    expect(chunks[1].sparseText).toBe(chunks[1].embedText + '\nnew phone transfer')
    expect(chunks[1]).toMatchObject({
      page: 'backup-and-devices/new-phone',
      order: 1,
      heading: 'Before you switch',
      title: 'Moving to a new phone',
      area: 'backup-and-devices',
      screen: 'Settings → Cloud Backup',
      platforms: ['ios', 'android'],
      tier: 'attendance',
      aliases: ['new phone', 'transfer'],
    })
    expect(chunks[1].contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashes the embed text with the filter fields, so a tier or alias change re-embeds', () => {
    const { page } = parsePage('settings/t', MINIMAL)
    const a = chunkPage(page!)[1].contentHash
    const { page: page2 } = parsePage('settings/t', MINIMAL.replace('screen: Settings', 'screen: Settings\ntier: premium'))
    const b = chunkPage(page2!)[1].contentHash
    expect(a).not.toBe(b)
    expect(chunkPage(page!)[1].contentHash).toBe(a)
  })
})

describe('ids', () => {
  it('pageIdFromPath drops the extension and normalises slashes', () => {
    expect(pageIdFromPath('backup-and-devices/new-phone.md')).toBe('backup-and-devices/new-phone')
    expect(pageIdFromPath('backup-and-devices\\new-phone.md')).toBe('backup-and-devices/new-phone')
  })

  it('slugify lower-cases, drops punctuation and joins with dashes', () => {
    expect(slugify("If something's wrong")).toBe('if-somethings-wrong')
    expect(slugify('What you’ll see')).toBe('what-youll-see')
    expect(slugify('  Two   words ')).toBe('two-words')
  })

  it('chunkPointId is the sha256 of the id laid out as a UUID, the messageIdToPointId layout', () => {
    const id = 'backup-and-devices/new-phone#intro'
    const hash = createHash('sha256').update(id).digest('hex')
    expect(chunkPointId(id)).toBe(
      [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-'),
    )
    expect(chunkPointId(id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('validateMap', () => {
  it('accepts a short map with a sources line and no headings', () => {
    expect(validateMap('<!-- sources: app/i18n/en.ts -->\nFour tabs. **Home** shows clean time.')).toEqual([])
  })

  it('refuses a map with headings, without sources, or over the word cap', () => {
    const problems = (text: string) => validateMap(text).map((p) => p.message).join('\n')
    expect(problems('<!-- sources: a -->\nText\n## Tabs\nmore')).toMatch(/heading/)
    expect(problems('<!-- sources: a -->\n# Title\nmore')).toMatch(/heading/)
    expect(problems('No sources here')).toMatch(/sources/)
    expect(problems('<!-- sources: a -->\n' + Array(601).fill('w').join(' '))).toMatch(/601 words; the cap is 600/)
    expect(problems('<!-- sources: a -->\n   ')).toMatch(/empty/)
  })
})

describe('parseQuestions', () => {
  const pages = ['backup-and-devices/new-phone', 'backup-and-devices/cloud-backup']

  it('parses entries and checks every expect names a page', () => {
    const { questions, problems } = parseQuestions(
      '- q: new phone\n  expect: backup-and-devices/new-phone\n- q: backup\n  expect: backup-and-devices/cloud-backup\n',
      pages,
    )
    expect(problems).toEqual([])
    expect(questions).toEqual([
      { q: 'new phone', expect: 'backup-and-devices/new-phone' },
      { q: 'backup', expect: 'backup-and-devices/cloud-backup' },
    ])
  })

  it('reports an unknown page, a missing field and a non-list', () => {
    expect(parseQuestions('- q: x\n  expect: account/nope\n', pages).problems[0].message).toMatch(/account\/nope/)
    expect(parseQuestions('- q: x\n', pages).problems[0].message).toMatch(/expect/)
    expect(parseQuestions('q: x\n', pages).problems[0].message).toMatch(/list/)
  })

  it('accepts an empty list', () => {
    expect(parseQuestions('[]\n', pages)).toEqual({ questions: [], problems: [] })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm vitest run packages/manual/tests/parse.test.ts
```

Expected: FAIL, `Cannot find module '../src/parse.js'`.

- [ ] **Step 4: Write the parser**

`packages/manual/src/parse.ts`:

```ts
/**
 * Pure parsing of the manual: a page's front-matter, its sources comment,
 * H2 chunking, the word caps, chunk ids and the texts the ingest embeds; the
 * map's rules; the questions file. No I/O: files.ts reads, this decides.
 * Spec: app repo docs/superpowers/specs/2026-10-12-user-manual-rag-design.md §1
 */

import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  MANUAL_AREAS,
  MANUAL_PLATFORMS,
  MANUAL_TIERS,
  type ManualArea,
  type ManualPlatform,
  type ManualTier,
} from '@recoverysky/types'

/** One H2 is one chunk; a longer section must be split by the writer (rule 11) */
export const MAX_SECTION_WORDS = 400
/** The map is pasted into the prompt on every turn */
export const MAX_MAP_WORDS = 600
export const PAGE_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+$/

export interface ManualFrontMatter {
  title: string
  area: ManualArea
  screen: string
  platforms: ManualPlatform[]
  tier: ManualTier
  aliases: string[]
}

export interface ParsedSection {
  /** 0 = intro */
  order: number
  /** '' for the intro */
  heading: string
  /** 'intro' for the intro */
  slug: string
  content: string
  words: number
}

export interface ParsedPage {
  page: string
  frontMatter: ManualFrontMatter
  sources: string[]
  sections: ParsedSection[]
  words: number
}

export interface ManualChunk {
  /** `<page>#<slug>` */
  id: string
  /** The Qdrant point id */
  pointId: string
  page: string
  order: number
  heading: string
  title: string
  area: ManualArea
  screen: string
  platforms: ManualPlatform[]
  tier: ManualTier
  aliases: string[]
  content: string
  /** What the dense vector embeds */
  embedText: string
  /** What the sparse (BM25) vector sees: the embed text plus the aliases */
  sparseText: string
  /** sha256 over the embed text and the filter fields; unchanged → not re-embedded */
  contentHash: string
}

export interface ParseProblem {
  page: string
  message: string
}

export interface ManualQuestion {
  q: string
  expect: string
}

const frontMatterSchema = z
  .object({
    title: z.string().min(1),
    area: z.enum(MANUAL_AREAS),
    screen: z.string().min(1),
    platforms: z.array(z.enum(MANUAL_PLATFORMS)).min(1).default([...MANUAL_PLATFORMS]),
    tier: z.enum(MANUAL_TIERS).default('free'),
    aliases: z.array(z.string().min(1)).default([]),
  })
  .strict()

const questionsSchema = z.array(z.object({ q: z.string().min(1), expect: z.string().min(1) }).strict())

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
const SOURCES = /^<!--\s*sources:\s*([^>]*?)\s*-->[ \t]*\r?\n?/m
const H2 = /^## (.+?)\s*$/

export function pageIdFromPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/\.md$/, '')
}

export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/[\s-]+/g, '-')
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** The sha256 of a chunk id laid out as a UUID, the same layout as messageIdToPointId */
export function chunkPointId(chunkId: string): string {
  const hash = createHash('sha256').update(chunkId).digest('hex')
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-')
}

function splitSources(list: string): string[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function splitSections(body: string): ParsedSection[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const sections: ParsedSection[] = []
  let heading = ''
  let buffer: string[] = []
  const push = () => {
    const content = buffer.join('\n').trim()
    sections.push({
      order: sections.length,
      heading,
      slug: heading ? slugify(heading) : 'intro',
      content,
      words: countWords(content),
    })
  }
  for (const line of lines) {
    const match = H2.exec(line)
    if (match) {
      push()
      heading = match[1].trim()
      buffer = []
    } else {
      buffer.push(line)
    }
  }
  push()
  return sections
}

/**
 * Parse one page. Every problem found is reported, so one run lists them all.
 * `page` is null whenever there is at least one problem.
 */
export function parsePage(page: string, markdown: string): { page: ParsedPage | null; problems: ParseProblem[] } {
  const problems: ParseProblem[] = []
  const problem = (message: string) => problems.push({ page, message })

  if (!PAGE_ID_PATTERN.test(page)) {
    problem(`page id "${page}" must be <area>/<name> in lower-case letters, digits and dashes`)
  }

  const fm = FRONT_MATTER.exec(markdown)
  if (!fm) {
    problem('missing front-matter (--- … --- at the top of the file)')
    return { page: null, problems }
  }

  let raw: unknown
  try {
    raw = parseYaml(fm[1])
  } catch (error) {
    problem(`front-matter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
    return { page: null, problems }
  }
  const parsed = frontMatterSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problem(`front-matter ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    }
    return { page: null, problems }
  }
  const frontMatter = parsed.data
  const folder = page.split('/')[0]
  if (frontMatter.area !== folder) {
    problem(`front-matter area "${frontMatter.area}" does not match the folder "${folder}"`)
  }

  let body = markdown.slice(fm[0].length)
  const src = SOURCES.exec(body)
  if (!src) {
    problem('missing <!-- sources: … --> comment after the front-matter')
    return { page: null, problems }
  }
  const sources = splitSources(src[1])
  if (sources.length === 0) problem('the sources comment lists no paths')
  body = body.replace(SOURCES, '')

  const sections = splitSections(body)
  if (sections[0].content === '') problem('missing the intro paragraph before the first "## " heading')
  const slugs = new Set<string>()
  for (const section of sections) {
    const name = section.heading || 'intro'
    if (section.order > 0 && section.content === '') problem(`section "${name}" is empty`)
    if (section.words > MAX_SECTION_WORDS) {
      problem(`section "${name}" has ${section.words} words; the cap is ${MAX_SECTION_WORDS}`)
    }
    if (section.order > 0) {
      if (!section.slug) problem(`heading "${section.heading}" has no letters or digits to slug`)
      if (slugs.has(section.slug)) problem(`two sections slug to "${section.slug}"`)
      slugs.add(section.slug)
    }
  }

  if (problems.length > 0) return { page: null, problems }
  return {
    page: { page, frontMatter, sources, sections, words: sections.reduce((n, s) => n + s.words, 0) },
    problems,
  }
}

/** The points a page becomes; stable ids, so re-ingest is an upsert */
export function chunkPage(parsed: ParsedPage): ManualChunk[] {
  const { page, frontMatter: fm } = parsed
  const crumb = `${fm.title} — ${fm.screen}`
  return parsed.sections.map((section) => {
    const id = `${page}#${section.slug}`
    const embedText = section.heading
      ? `${crumb}\n## ${section.heading}\n${section.content}`
      : `${crumb}\n${section.content}`
    const sparseText = fm.aliases.length > 0 ? `${embedText}\n${fm.aliases.join(' ')}` : embedText
    // The hash covers everything a changed page must rewrite on the point: the
    // embedded text and the filter fields. Changing an alias or the tier
    // re-embeds the page (a few cents) rather than leaving a stale payload.
    const contentHash = createHash('sha256')
      .update(embedText)
      .update('\n')
      .update(JSON.stringify({ aliases: fm.aliases, platforms: fm.platforms, tier: fm.tier }))
      .digest('hex')
    return {
      id,
      pointId: chunkPointId(id),
      page,
      order: section.order,
      heading: section.heading,
      title: fm.title,
      area: fm.area,
      screen: fm.screen,
      platforms: fm.platforms,
      tier: fm.tier,
      aliases: fm.aliases,
      content: section.content,
      embedText,
      sparseText,
      contentHash,
    }
  })
}

/**
 * The map is pasted into the prompt as one section: no headings (they would
 * open new prompt sections), a sources line like any page, and a word cap.
 */
export function validateMap(markdown: string): ParseProblem[] {
  const problems: ParseProblem[] = []
  const problem = (message: string) => problems.push({ page: 'map', message })
  if (!SOURCES.test(markdown)) problem('missing <!-- sources: … --> comment at the top of map.md')
  const body = markdown.replace(SOURCES, '')
  const headings = body.split('\n').filter((line) => /^#{1,6} /.test(line))
  if (headings.length > 0) problem(`map.md must not contain a heading line (found ${headings.length}): it is one prompt section`)
  const words = countWords(body)
  if (words === 0) problem('map.md is empty')
  if (words > MAX_MAP_WORDS) problem(`map.md has ${words} words; the cap is ${MAX_MAP_WORDS}`)
  return problems
}

/** The map text as stored in the manual-map row: the sources comment stripped */
export function mapContent(markdown: string): string {
  return markdown.replace(SOURCES, '').trim()
}

export function parseQuestions(yamlText: string, pageIds: readonly string[]): { questions: ManualQuestion[]; problems: ParseProblem[] } {
  const problems: ParseProblem[] = []
  const problem = (message: string) => problems.push({ page: 'questions.yml', message })
  let raw: unknown
  try {
    raw = parseYaml(yamlText)
  } catch (error) {
    problem(`questions.yml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
    return { questions: [], problems }
  }
  if (raw === null || raw === undefined) return { questions: [], problems }
  if (!Array.isArray(raw)) {
    problem('questions.yml must be a list of { q, expect } entries')
    return { questions: [], problems }
  }
  const parsed = questionsSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problem(`questions.yml ${issue.path.join('.')}: ${issue.message}`)
    return { questions: [], problems }
  }
  const known = new Set(pageIds)
  for (const entry of parsed.data) {
    if (!known.has(entry.expect)) problem(`questions.yml: "${entry.q}" expects "${entry.expect}", which is not a page`)
  }
  return { questions: parsed.data, problems }
}
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm --filter @recoverysky/manual typecheck
pnpm vitest run packages/manual
```

Expected: PASS, 17 tests. If zod reports the enum message differently from what a test greps (`tier`, `platforms`), the test greps the path, which zod always includes; keep the test.

- [ ] **Step 6: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
git add packages/manual/package.json packages/manual/tsconfig.json packages/manual/vitest.config.ts packages/manual/src/index.ts packages/manual/src/parse.ts packages/manual/tests/parse.test.ts tsconfig.json pnpm-lock.yaml
git commit -m "✨ feat(manual): the manual package and its pure parser

Front-matter (zod, defaults filled), the sources comment, one chunk per H2
with the intro as chunk 0, the 400-word cap, stable chunk and point ids,
the embed and sparse texts, a content hash over text plus filter fields,
and the rules for map.md and questions.yml. Every problem of a page is
reported at once.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The ingest, the check and the CLI (agent, `packages/manual`)

**Files:**
- Create: `packages/manual/src/files.ts`, `src/env.ts`, `src/ingest.ts`, `src/check.ts`, `src/bin/manual.ts`
- Modify: `packages/manual/src/index.ts`, root `package.json` (scripts)
- Test: `packages/manual/tests/env.test.ts`, `tests/check.test.ts`, `tests/ingest.test.ts`, fixture corpus `packages/manual/tests/fixtures/manual/**`

**Interfaces:**
- Consumes: `parse.ts` (Task 10); `ManualVectorStore`, `ManualPoint`, `ManualRunFields` (Task 2); `getBM25Embedder`, `createQdrantClient`, `OpenAIEmbeddingProvider` from `@recoverysky/memory`; `createDatabaseClient`, `closeDatabaseClient`, `SystemPromptRepository` from `@recoverysky/db`; `replaceActive` (Task 6).
- Produces: `readManualDir(dir): ManualFiles`; `describeHosts(env)`, `isLocalHost(name)`; `runIngest(options, deps): Promise<number>` (an exit code); `runQuestions(questions, deps, ctx): Promise<QuestionMiss[]>`; root scripts `manual:ingest` and `manual:check`.

- [ ] **Step 1: The fixture corpus**

Create `packages/manual/tests/fixtures/manual/` with:

`map.md`:

```markdown
<!-- sources: app/i18n/en.ts -->
RecoverySky has four tabs. **Settings** has Cloud Backup.
```

`questions.yml`:

```yaml
- q: how do I turn on backup
  expect: backup-and-devices/cloud-backup
- q: new phone
  expect: backup-and-devices/new-phone
```

`README.md` (must be skipped): `# not a page`.

`backup-and-devices/cloud-backup.md`:

```markdown
---
title: Cloud Backup
area: backup-and-devices
screen: Settings → Cloud Backup
tier: attendance
aliases: [backup]
---
<!-- sources: docs/BACKUP.md -->
Backs up attendance.

## How to turn on Cloud Backup
Tap "Back up attendance".
```

`backup-and-devices/new-phone.md`:

```markdown
---
title: Moving to a new phone
area: backup-and-devices
screen: Settings → Cloud Backup
platforms: [ios, android]
---
<!-- sources: docs/BACKUP.md, app/screens/SettingsScreen.tsx -->
Your records live on the phone.

## Before you switch
Back up first.
```

Also create `packages/manual/tests/fixtures/app/docs/BACKUP.md` and `packages/manual/tests/fixtures/app/docs/manual/.keep` and `packages/manual/tests/fixtures/app/app/screens/SettingsScreen.tsx` as empty files: the ingest checks that every sources path exists under the app root, which is `<manualDir>/../..`. So the fixture manual must live at `tests/fixtures/app/docs/manual/`: **move the files above there** (`packages/manual/tests/fixtures/app/docs/manual/{map.md,questions.yml,README.md,backup-and-devices/*.md}`) and keep `tests/fixtures/app/docs/BACKUP.md` and `tests/fixtures/app/app/screens/SettingsScreen.tsx` as the existing sources.

- [ ] **Step 2: Write the failing tests**

`packages/manual/tests/env.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { describeHosts, isLocalHost } from '../src/env.js'

describe('describeHosts', () => {
  it('names the Qdrant and database hosts from the env, with the Qdrant default', () => {
    expect(describeHosts({ DATABASE_URL: 'postgres://u:p@db.internal:5432/agent' })).toEqual({
      qdrant: 'localhost',
      database: 'db.internal',
    })
    expect(describeHosts({ QDRANT_URL: 'https://qdrant.example.com:6333', DATABASE_URL: 'postgres://localhost/agent' })).toEqual({
      qdrant: 'qdrant.example.com',
      database: 'localhost',
    })
  })

  it('reports a missing or unparsable database url', () => {
    expect(describeHosts({})).toEqual({ qdrant: 'localhost', database: null })
    expect(describeHosts({ DATABASE_URL: 'not a url' })).toEqual({ qdrant: 'localhost', database: null })
  })
})

describe('isLocalHost', () => {
  it('accepts localhost, 127.0.0.1 and ::1 only', () => {
    expect(isLocalHost('localhost')).toBe(true)
    expect(isLocalHost('127.0.0.1')).toBe(true)
    expect(isLocalHost('::1')).toBe(true)
    expect(isLocalHost('[::1]')).toBe(true)
    expect(isLocalHost('db.internal')).toBe(false)
    expect(isLocalHost(null)).toBe(false)
  })
})
```

`packages/manual/tests/check.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { ok, err } from '@recoverysky/types'
import { runQuestions } from '../src/check.js'

const ctx = { traceId: 't', spanId: 's', requestId: 'manual', startTime: 0 }
const hit = (page: string) => ({ page, title: '', screen: '', heading: '', tier: 'free' as const, platforms: [], content: '', score: 1 })

describe('runQuestions', () => {
  it('passes a question whose page is among the three hits and reports the others', async () => {
    const embedding = { embed: vi.fn(async () => ok([0.1])) }
    const store = {
      search: vi.fn(async (_e: number[], text: string) =>
        ok(text === 'new phone' ? [hit('a/x'), hit('a/y'), hit('backup-and-devices/new-phone')] : [hit('a/x')]),
      ),
    }

    const misses = await runQuestions(
      [
        { q: 'new phone', expect: 'backup-and-devices/new-phone' },
        { q: 'backup', expect: 'backup-and-devices/cloud-backup' },
      ],
      { store: store as never, embedding: embedding as never },
      ctx,
    )

    expect(store.search).toHaveBeenCalledWith([0.1], 'new phone', { limit: 3 }, ctx)
    expect(misses).toEqual([{ q: 'backup', expect: 'backup-and-devices/cloud-backup', got: ['a/x'] }])
  })

  it('counts an embedding or search failure as a miss with the reason', async () => {
    const embedding = { embed: vi.fn(async () => err({ kind: 'RateLimitError', message: 'x', context: {} })) }
    const store = { search: vi.fn() }

    const misses = await runQuestions([{ q: 'q', expect: 'a/b' }], { store: store as never, embedding: embedding as never }, ctx)

    expect(misses).toEqual([{ q: 'q', expect: 'a/b', got: [], error: 'RateLimitError' }])
  })
})
```

`packages/manual/tests/ingest.test.ts`:

```ts
/**
 * runIngest with fakes for the store, the embedding provider and the prompt
 * repository: the diff by hash, the sweep, the map row, the check's exit
 * code, and that nothing is written when a page fails to parse or on --dry-run.
 */
import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { ok } from '@recoverysky/types'
import { runIngest, type IngestDeps, type IngestOptions } from '../src/ingest.js'
import { readManualDir } from '../src/files.js'
import { chunkPointId } from '../src/parse.js'

const fixtureManual = fileURLToPath(new URL('./fixtures/app/docs/manual', import.meta.url))

function fakeDeps(overrides: Partial<IngestDeps> = {}) {
  const lines: string[] = []
  const store = {
    ensureCollection: vi.fn(async () => {}),
    findByIds: vi.fn(async () => new Map<string, string>()),
    upsert: vi.fn(async () => {}),
    refreshRun: vi.fn(async () => {}),
    deleteWhereRunIdNot: vi.fn(async () => 0),
    search: vi.fn(async (_e: number[], text: string) =>
      ok([{ page: text.includes('backup') ? 'backup-and-devices/cloud-backup' : 'backup-and-devices/new-phone', title: '', screen: '', heading: '', tier: 'free' as const, platforms: [], content: '', score: 1 }]),
    ),
  }
  const embedding = {
    embed: vi.fn(async () => ok([0.5])),
    embedBatch: vi.fn(async (texts: string[]) => ok(texts.map(() => [0.5]))),
  }
  const prompts = { replaceActive: vi.fn(async (name: string, content: string) => ok({ id: 'row-1', name, content })) }
  const deps: IngestDeps = {
    readManual: readManualDir,
    fileExists: () => true,
    gitDescribe: () => 'v4.11.0-4-3-gabc1234',
    now: () => new Date('2026-10-12T19:04:11.000Z'),
    runSuffix: () => '7f3a',
    out: (line) => lines.push(line),
    store: store as never,
    embedding: embedding as never,
    prompts: prompts as never,
    ...overrides,
  }
  return { deps, store, embedding, prompts, lines }
}

const options = (overrides: Partial<IngestOptions> = {}): IngestOptions => ({
  manualDir: fixtureManual,
  dryRun: false,
  checkOnly: false,
  version: undefined,
  ...overrides,
})

describe('runIngest', () => {
  it('parses, embeds every chunk the first time, upserts, sweeps, replaces the map and runs the questions', async () => {
    const { deps, store, embedding, prompts, lines } = fakeDeps()

    const code = await runIngest(options(), deps)

    expect(code).toBe(0)
    expect(store.ensureCollection).toHaveBeenCalledTimes(1)
    expect(embedding.embedBatch).toHaveBeenCalledTimes(1)
    expect(embedding.embedBatch.mock.calls[0][0]).toHaveLength(4) // two pages × (intro + one H2)
    const upserted = store.upsert.mock.calls[0][0] as Array<{ id: string; payload: Record<string, unknown> }>
    expect(upserted.map((p) => p.payload.page).sort()).toEqual([
      'backup-and-devices/cloud-backup', 'backup-and-devices/cloud-backup',
      'backup-and-devices/new-phone', 'backup-and-devices/new-phone',
    ])
    expect(upserted[0].payload).toMatchObject({
      corpus: 'manual',
      runId: '2026-10-12T19:04:11Z-7f3a',
      manualVersion: 'v4.11.0-4-3-gabc1234',
      ingestedAt: Date.parse('2026-10-12T19:04:11.000Z'),
    })
    expect(upserted.find((p) => p.payload.page === 'backup-and-devices/cloud-backup' && p.payload.order === 0)?.payload.platforms)
      .toEqual(['ios', 'android', 'web'])
    expect(store.deleteWhereRunIdNot).toHaveBeenCalledWith('2026-10-12T19:04:11Z-7f3a')
    expect(prompts.replaceActive).toHaveBeenCalledWith('manual-map', 'RecoverySky has four tabs. **Settings** has Cloud Backup.')
    expect(lines.join('\n')).toMatch(/pages: 2/)
    expect(lines.join('\n')).toMatch(/chunks: 4 \(embedded 4, unchanged 0\)/)
    expect(lines.join('\n')).toMatch(/questions: 2 passed, 0 missed/)
  })

  it('embeds only changed chunks and refreshes the rest', async () => {
    const { deps, store, embedding } = fakeDeps()
    // Pretend the new-phone intro is already stored with its current hash
    const firstRun = fakeDeps()
    await runIngest(options(), firstRun.deps)
    const stored = (firstRun.store.upsert.mock.calls[0][0] as Array<{ id: string; payload: { contentHash: string; page: string; order: number } }>)
      .find((p) => p.payload.page === 'backup-and-devices/new-phone' && p.payload.order === 0)!
    store.findByIds.mockResolvedValue(new Map([[stored.id, stored.payload.contentHash]]))

    const code = await runIngest(options(), deps)

    expect(code).toBe(0)
    expect(embedding.embedBatch.mock.calls[0][0]).toHaveLength(3)
    expect(store.refreshRun).toHaveBeenCalledWith([chunkPointId('backup-and-devices/new-phone#intro')], {
      runId: '2026-10-12T19:04:11Z-7f3a',
      manualVersion: 'v4.11.0-4-3-gabc1234',
      ingestedAt: Date.parse('2026-10-12T19:04:11.000Z'),
    })
    expect((store.upsert.mock.calls[0][0] as unknown[]).length).toBe(3)
  })

  it('sweeps points from earlier runs and reports how many', async () => {
    const { deps, store, lines } = fakeDeps()
    store.deleteWhereRunIdNot.mockResolvedValue(5)

    await runIngest(options(), deps)

    expect(lines.join('\n')).toMatch(/swept 5 point/)
  })

  it('writes nothing when any page fails to parse, listing every problem', async () => {
    const { deps, store, embedding, prompts, lines } = fakeDeps({
      readManual: (dir) => {
        const files = readManualDir(dir)
        files.pages.push({ page: 'backup-and-devices/broken', text: '---\ntitle: X\narea: backup-and-devices\nscreen: S\n---\nno sources\n' })
        files.pages.push({ page: 'backup-and-devices/broken-too', text: 'no front matter' })
        return files
      },
    })

    const code = await runIngest(options(), deps)

    expect(code).toBe(1)
    expect(store.ensureCollection).not.toHaveBeenCalled()
    expect(store.upsert).not.toHaveBeenCalled()
    expect(embedding.embedBatch).not.toHaveBeenCalled()
    expect(prompts.replaceActive).not.toHaveBeenCalled()
    expect(lines.join('\n')).toMatch(/backup-and-devices\/broken: missing <!-- sources/)
    expect(lines.join('\n')).toMatch(/backup-and-devices\/broken-too: missing front-matter/)
  })

  it('fails on a sources path that does not exist in the app checkout', async () => {
    const { deps, store, lines } = fakeDeps({ fileExists: (_root, rel) => rel !== 'app/screens/SettingsScreen.tsx' })

    const code = await runIngest(options(), deps)

    expect(code).toBe(1)
    expect(store.upsert).not.toHaveBeenCalled()
    expect(lines.join('\n')).toMatch(/new-phone: source "app\/screens\/SettingsScreen.tsx" does not exist/)
  })

  it('fails on a map with a heading and on a question that names no page', async () => {
    const { deps, store, lines } = fakeDeps({
      readManual: (dir) => ({ ...readManualDir(dir), map: '<!-- sources: a -->\n## Tabs\nx', questions: '- q: x\n  expect: a/nope\n' }),
    })

    expect(await runIngest(options(), deps)).toBe(1)
    expect(store.upsert).not.toHaveBeenCalled()
    expect(lines.join('\n')).toMatch(/map: map.md must not contain a heading/)
    expect(lines.join('\n')).toMatch(/questions.yml: "x" expects "a\/nope"/)
  })

  it('--dry-run parses and reports the would-embed count without touching anything', async () => {
    const { deps, store, embedding, prompts, lines } = fakeDeps()

    const code = await runIngest(options({ dryRun: true }), deps)

    expect(code).toBe(0)
    expect(store.ensureCollection).not.toHaveBeenCalled()
    expect(store.findByIds).not.toHaveBeenCalled()
    expect(embedding.embedBatch).not.toHaveBeenCalled()
    expect(prompts.replaceActive).not.toHaveBeenCalled()
    expect(lines.join('\n')).toMatch(/dry run: would embed up to 4 chunks/)
  })

  it('--dry-run needs no store, embedding or database', async () => {
    const { deps } = fakeDeps({ store: null, embedding: null, prompts: null })
    expect(await runIngest(options({ dryRun: true }), deps)).toBe(0)
  })

  it('--check-only runs the questions against the live collection and exits 1 on a miss', async () => {
    const { deps, store, embedding, prompts, lines } = fakeDeps()
    store.search.mockResolvedValue(ok([]))

    const code = await runIngest(options({ checkOnly: true }), deps)

    expect(code).toBe(1)
    expect(store.upsert).not.toHaveBeenCalled()
    expect(prompts.replaceActive).not.toHaveBeenCalled()
    expect(embedding.embed).toHaveBeenCalledTimes(2)
    expect(lines.join('\n')).toMatch(/MISS "how do I turn on backup" → expected backup-and-devices\/cloud-backup, got \(nothing\)/)
  })

  it('exits 1 after the writes when a question misses', async () => {
    const { deps, store, prompts } = fakeDeps()
    store.search.mockResolvedValue(ok([]))

    const code = await runIngest(options(), deps)

    expect(code).toBe(1)
    expect(store.upsert).toHaveBeenCalled()
    expect(prompts.replaceActive).toHaveBeenCalled()
  })

  it('refuses to write without a store, embedding or database, and says which', async () => {
    const { deps, lines } = fakeDeps({ prompts: null })
    expect(await runIngest(options(), deps)).toBe(2)
    expect(lines.join('\n')).toMatch(/DATABASE_URL/)
  })

  it('uses --version over git describe', async () => {
    const { deps, store } = fakeDeps()
    await runIngest(options({ version: 'manual-test' }), deps)
    const upserted = store.upsert.mock.calls[0][0] as Array<{ payload: { manualVersion: string } }>
    expect(upserted[0].payload.manualVersion).toBe('manual-test')
  })
})
```

Run `cd /Users/jenova/projects/recoverysky-org/agent && pnpm vitest run packages/manual`. Expected: the three new files FAIL on missing modules.

- [ ] **Step 3: Write `files.ts` and `env.ts`**

`packages/manual/src/files.ts`:

```ts
/**
 * Read a manual directory: every <area>/<page>.md (README.md skipped),
 * map.md and questions.yml. The only file I/O of the ingest besides the
 * sources-exist check.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pageIdFromPath } from './parse.js'

export interface ManualFiles {
  /** The app checkout the manual lives in: <manualDir>/../.. */
  appRoot: string
  pages: Array<{ page: string; text: string }>
  map: string | null
  questions: string | null
}

export function readManualDir(manualDir: string): ManualFiles {
  const dir = resolve(manualDir)
  const pages: ManualFiles['pages'] = []
  for (const area of readdirSync(dir).sort()) {
    const areaPath = join(dir, area)
    if (!statSync(areaPath).isDirectory()) continue
    for (const file of readdirSync(areaPath).sort()) {
      if (!file.endsWith('.md')) continue
      pages.push({ page: pageIdFromPath(`${area}/${file}`), text: readFileSync(join(areaPath, file), 'utf8') })
    }
  }
  const mapPath = join(dir, 'map.md')
  const questionsPath = join(dir, 'questions.yml')
  return {
    appRoot: resolve(dir, '..', '..'),
    pages,
    map: existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : null,
    questions: existsSync(questionsPath) ? readFileSync(questionsPath, 'utf8') : null,
  }
}

export function fileExistsUnder(root: string, relative: string): boolean {
  return existsSync(join(root, relative))
}
```

`packages/manual/src/env.ts`:

```ts
/**
 * Where a run would write, from the root .env, so the CLI can print it and
 * refuse a non-local target without --yes.
 */

const QDRANT_DEFAULT = 'http://localhost:6333'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export interface Hosts {
  qdrant: string
  /** null when DATABASE_URL is missing or not a URL */
  database: string | null
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export function describeHosts(env: NodeJS.ProcessEnv): Hosts {
  return {
    qdrant: hostOf(env.QDRANT_URL ?? QDRANT_DEFAULT) ?? 'localhost',
    database: hostOf(env.DATABASE_URL),
  }
}

export function isLocalHost(name: string | null): boolean {
  return name !== null && LOCAL_HOSTS.has(name)
}
```

- [ ] **Step 4: Write `check.ts`**

`packages/manual/src/check.ts`:

```ts
/**
 * questions.yml against the live collection, through the same search the
 * searchManual tool runs (no filters, three hits).
 */

import type { ManualSearchHit, Result, StoreError, TraceContext } from '@recoverysky/types'
import type { ManualQuestion } from './parse.js'

export interface QuestionMiss {
  q: string
  expect: string
  got: string[]
  /** The error kind when the embedding or the search failed */
  error?: string
}

/** The subset of ManualVectorStore and IEmbeddingProvider the check needs */
export interface CheckDeps {
  store: { search(e: number[], text: string, options: { limit: number }, ctx: TraceContext): Promise<Result<ManualSearchHit[], StoreError>> }
  embedding: { embed(text: string, ctx: TraceContext, options?: { label?: string }): Promise<Result<number[], { kind: string }>> }
}

export const QUESTION_HITS = 3

export async function runQuestions(questions: ManualQuestion[], deps: CheckDeps, ctx: TraceContext): Promise<QuestionMiss[]> {
  const misses: QuestionMiss[] = []
  for (const { q, expect } of questions) {
    const embedded = await deps.embedding.embed(q, ctx, { label: 'manual-check' })
    if (!embedded.ok) {
      misses.push({ q, expect, got: [], error: embedded.error.kind })
      continue
    }
    const result = await deps.store.search(embedded.value, q, { limit: QUESTION_HITS }, ctx)
    if (!result.ok) {
      misses.push({ q, expect, got: [], error: result.error.kind })
      continue
    }
    const got = result.value.map((hit) => hit.page)
    if (!got.includes(expect)) misses.push({ q, expect, got })
  }
  return misses
}
```

- [ ] **Step 5: Write `ingest.ts`**

`packages/manual/src/ingest.ts`:

```ts
/**
 * One ingest run, in the order the spec gives (§3.2): parse and validate
 * everything (fail listing every problem before any write), diff by hash,
 * embed what changed, ensure the collection, upsert, sweep other runs,
 * replace the manual-map row, run the questions, print a summary.
 *
 * Everything that touches the network is injected (IngestDeps) so the run
 * is unit-tested with fakes; bin/manual.ts builds the real ones.
 */

import { getBM25Embedder } from '@recoverysky/memory'
import type { ManualPoint, ManualRunFields } from '@recoverysky/memory'
import type { ManualChunkPayload, Result, TraceContext } from '@recoverysky/types'
import type { ManualFiles } from './files.js'
import { chunkPage, mapContent, parsePage, parseQuestions, validateMap, type ManualChunk, type ParseProblem, type ManualQuestion } from './parse.js'
import { runQuestions, type CheckDeps } from './check.js'

export interface IngestOptions {
  manualDir: string
  /** Parse, validate and report only */
  dryRun: boolean
  /** Only run questions.yml against the live collection */
  checkOnly: boolean
  /** Overrides manualVersion (otherwise git describe of the app checkout) */
  version: string | undefined
}

export interface IngestStore {
  ensureCollection(): Promise<void>
  findByIds(pointIds: string[]): Promise<Map<string, string>>
  upsert(points: ManualPoint[]): Promise<void>
  refreshRun(pointIds: string[], run: ManualRunFields): Promise<void>
  deleteWhereRunIdNot(runId: string): Promise<number>
  search: CheckDeps['store']['search']
}

export interface IngestEmbedding extends CheckDeps['embedding'] {
  embedBatch(texts: string[], ctx: TraceContext): Promise<Result<number[][], { kind: string; message: string }>>
}

export interface IngestPrompts {
  replaceActive(name: string, content: string): Promise<Result<unknown, { kind: string; message: string }>>
}

export interface IngestDeps {
  readManual: (dir: string) => ManualFiles
  fileExists: (root: string, relative: string) => boolean
  gitDescribe: (appRoot: string) => string
  now: () => Date
  /** Four hex chars that make the runId unique within a second */
  runSuffix: () => string
  out: (line: string) => void
  /** null when QDRANT_URL / OPENAI_API_KEY / DATABASE_URL is not configured */
  store: IngestStore | null
  embedding: IngestEmbedding | null
  prompts: IngestPrompts | null
}

export const MANUAL_MAP_PROMPT = 'manual-map'
/** text-embedding-3-small list price per million tokens, for the summary only */
const USD_PER_MILLION_TOKENS = 0.02
const EMBED_BATCH = 100

const ctx: TraceContext = { traceId: 'manual-ingest', spanId: 'manual-ingest', requestId: 'manual-ingest', startTime: 0 }

interface Parsed {
  chunks: ManualChunk[]
  pages: number
  words: number
  map: string
  questions: ManualQuestion[]
}

/** Steps 1 of the run: everything that can be wrong, all at once */
function parseAll(files: ManualFiles, deps: IngestDeps): { parsed: Parsed | null; problems: ParseProblem[] } {
  const problems: ParseProblem[] = []
  const chunks: ManualChunk[] = []
  let words = 0
  const pageIds: string[] = []
  for (const { page, text } of files.pages) {
    const result = parsePage(page, text)
    problems.push(...result.problems)
    if (!result.page) continue
    for (const source of result.page.sources) {
      if (!deps.fileExists(files.appRoot, source)) {
        problems.push({ page, message: `source "${source}" does not exist in the app checkout (${files.appRoot})` })
      }
    }
    pageIds.push(page)
    words += result.page.words
    chunks.push(...chunkPage(result.page))
  }
  if (files.map === null) problems.push({ page: 'map', message: 'map.md is missing' })
  else problems.push(...validateMap(files.map))
  const questions = files.questions === null ? { questions: [], problems: [] } : parseQuestions(files.questions, pageIds)
  problems.push(...questions.problems)
  if (problems.length > 0) return { parsed: null, problems }
  return {
    parsed: { chunks, pages: pageIds.length, words, map: mapContent(files.map ?? ''), questions: questions.questions },
    problems,
  }
}

function toPayload(chunk: ManualChunk, run: ManualRunFields): ManualChunkPayload {
  return {
    corpus: 'manual',
    page: chunk.page,
    order: chunk.order,
    heading: chunk.heading,
    title: chunk.title,
    area: chunk.area,
    screen: chunk.screen,
    platforms: chunk.platforms,
    tier: chunk.tier,
    aliases: chunk.aliases,
    content: chunk.content,
    contentHash: chunk.contentHash,
    ...run,
  }
}

function estimatedCost(chunks: ManualChunk[]): string {
  const tokens = chunks.reduce((n, c) => n + Math.ceil(c.embedText.length / 4), 0)
  return `~${tokens} tokens, ~$${((tokens / 1_000_000) * USD_PER_MILLION_TOKENS).toFixed(4)}`
}

function reportMisses(misses: Awaited<ReturnType<typeof runQuestions>>, total: number, out: IngestDeps['out']): void {
  for (const miss of misses) {
    const got = miss.got.length > 0 ? miss.got.join(', ') : '(nothing)'
    out(`MISS "${miss.q}" → expected ${miss.expect}, got ${got}${miss.error ? ` [${miss.error}]` : ''}`)
  }
  out(`questions: ${total - misses.length} passed, ${misses.length} missed`)
}

/** Returns the exit code: 0 ok, 1 problems or misses, 2 not configured */
export async function runIngest(options: IngestOptions, deps: IngestDeps): Promise<number> {
  const { out } = deps
  const files = deps.readManual(options.manualDir)
  const { parsed, problems } = parseAll(files, deps)
  if (!parsed) {
    out(`${problems.length} problem${problems.length === 1 ? '' : 's'}:`)
    for (const p of problems) out(`  ${p.page}: ${p.message}`)
    return 1
  }
  out(`pages: ${parsed.pages}, chunks: ${parsed.chunks.length}, words: ${parsed.words}, questions: ${parsed.questions.length}`)

  if (options.dryRun) {
    out(`dry run: would embed up to ${parsed.chunks.length} chunks (${estimatedCost(parsed.chunks)}); nothing written`)
    return 0
  }

  const missing: string[] = []
  if (!deps.store) missing.push('QDRANT_URL')
  if (!deps.embedding) missing.push('OPENAI_API_KEY')
  if (!deps.prompts && !options.checkOnly) missing.push('DATABASE_URL')
  if (missing.length > 0) {
    out(`not configured: ${missing.join(', ')} (set them in the agent repo's root .env)`)
    return 2
  }
  const store = deps.store!
  const embedding = deps.embedding!

  if (options.checkOnly) {
    const misses = await runQuestions(parsed.questions, { store, embedding }, ctx)
    reportMisses(misses, parsed.questions.length, out)
    return misses.length === 0 ? 0 : 1
  }

  const now = deps.now()
  const run: ManualRunFields = {
    runId: `${now.toISOString().replace(/\.\d{3}Z$/, 'Z')}-${deps.runSuffix()}`,
    manualVersion: options.version ?? deps.gitDescribe(files.appRoot),
    ingestedAt: now.getTime(),
  }

  // Step 2: diff by hash
  const existing = await store.findByIds(parsed.chunks.map((c) => c.pointId))
  const unchanged = parsed.chunks.filter((c) => existing.get(c.pointId) === c.contentHash)
  const changed = parsed.chunks.filter((c) => existing.get(c.pointId) !== c.contentHash)

  // Step 3: embed the rest, in batches
  const points: ManualPoint[] = []
  const bm25 = getBM25Embedder()
  for (let i = 0; i < changed.length; i += EMBED_BATCH) {
    const batch = changed.slice(i, i + EMBED_BATCH)
    const vectors = await embedding.embedBatch(batch.map((c) => c.embedText), ctx)
    if (!vectors.ok) {
      out(`embedding failed: ${vectors.error.kind} ${vectors.error.message}; nothing written`)
      return 1
    }
    batch.forEach((chunk, j) => {
      points.push({ id: chunk.pointId, dense: vectors.value[j], sparse: bm25.embed(chunk.sparseText), payload: toPayload(chunk, run) })
    })
  }

  // Steps 4–6: ensure, upsert, refresh, sweep
  await store.ensureCollection()
  if (points.length > 0) await store.upsert(points)
  if (unchanged.length > 0) await store.refreshRun(unchanged.map((c) => c.pointId), run)
  const swept = await store.deleteWhereRunIdNot(run.runId)

  // Step 7: the map
  const replaced = await deps.prompts!.replaceActive(MANUAL_MAP_PROMPT, parsed.map)
  if (!replaced.ok) {
    out(`manual-map row not replaced: ${replaced.error.kind} ${replaced.error.message}`)
    return 1
  }

  // Step 8: the questions, after the writes
  const misses = await runQuestions(parsed.questions, { store, embedding }, ctx)

  // Step 9: summary
  out(`chunks: ${parsed.chunks.length} (embedded ${changed.length}, unchanged ${unchanged.length}); ${estimatedCost(changed)}`)
  out(`swept ${swept} point${swept === 1 ? '' : 's'} from earlier runs`)
  out(`manual-map replaced; manualVersion ${run.manualVersion}; runId ${run.runId}`)
  reportMisses(misses, parsed.questions.length, out)
  return misses.length === 0 ? 0 : 1
}
```

- [ ] **Step 6: Write the CLI**

`packages/manual/src/bin/manual.ts`:

```ts
#!/usr/bin/env node
/**
 * manual ingest <dir> [--dry-run] [--check-only] [--version <v>] [--yes]
 * manual check <dir> [--yes]
 *
 * Reads the monorepo root .env like the api (QDRANT_URL, QDRANT_API_KEY,
 * DATABASE_URL, DATABASE_SSL, OPENAI_API_KEY), prints the hosts a run would
 * write to, and refuses a non-localhost target without --yes.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { config as dotenvConfig } from 'dotenv'
import { Command } from 'commander'

function findMonorepoRoot(): string | null {
  let dir = resolve(process.cwd())
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    dir = dirname(dir)
  }
  return null
}

const monorepoRoot = findMonorepoRoot()
if (monorepoRoot) dotenvConfig({ path: join(monorepoRoot, '.env') })

// Imported after dotenv so the Qdrant client and the embedding provider see the env
const [{ createQdrantClient, ManualVectorStore, OpenAIEmbeddingProvider }, { createDatabaseClient, closeDatabaseClient, SystemPromptRepository }, { runIngest }, { readManualDir, fileExistsUnder }, { describeHosts, isLocalHost }] =
  await Promise.all([
    import('@recoverysky/memory'),
    import('@recoverysky/db'),
    import('../ingest.js'),
    import('../files.js'),
    import('../env.js'),
  ])

interface Flags {
  dryRun?: boolean
  checkOnly?: boolean
  version?: string
  yes?: boolean
}

async function run(manualDir: string, flags: Flags): Promise<number> {
  const out = (line: string) => console.log(line)
  const env = process.env
  const hosts = describeHosts(env)
  out(`manual: ${resolve(manualDir)}`)
  out(`qdrant: ${hosts.qdrant}; database: ${hosts.database ?? '(not set)'}`)

  if (!flags.dryRun && !(isLocalHost(hosts.qdrant) && (isLocalHost(hosts.database) || (flags.checkOnly && hosts.database === null)))) {
    if (!flags.yes) {
      out('a target is not localhost: re-run with --yes to write there')
      return 2
    }
  }

  const useNetwork = !flags.dryRun
  const store = useNetwork && env.QDRANT_URL ? new ManualVectorStore(createQdrantClient({ url: env.QDRANT_URL, timeout: 30_000 })) : null
  // A batch job: a longer timeout and retries, unlike the api's 5 s / 0
  const embedding = useNetwork && env.OPENAI_API_KEY ? new OpenAIEmbeddingProvider({ timeout: 60_000, maxRetries: 3 }) : null
  let prompts: InstanceType<typeof SystemPromptRepository> | null = null
  let databaseOpen = false
  if (useNetwork && !flags.checkOnly && env.DATABASE_URL) {
    const ssl = env.DATABASE_SSL === 'false' ? false : env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
    prompts = new SystemPromptRepository(createDatabaseClient({ connectionString: env.DATABASE_URL, ssl }))
    databaseOpen = true
  }

  try {
    return await runIngest(
      { manualDir, dryRun: !!flags.dryRun, checkOnly: !!flags.checkOnly, version: flags.version },
      {
        readManual: readManualDir,
        fileExists: fileExistsUnder,
        gitDescribe: (appRoot) =>
          execFileSync('git', ['-C', appRoot, 'describe', '--tags', '--always', '--dirty'], { encoding: 'utf8' }).trim(),
        now: () => new Date(),
        runSuffix: () => randomBytes(2).toString('hex'),
        out,
        store,
        embedding,
        prompts,
      },
    )
  } finally {
    if (databaseOpen) await closeDatabaseClient()
  }
}

const program = new Command().name('manual').description("Ingest the RecoverySky user's manual into Qdrant and the manual-map prompt row")

program
  .command('ingest')
  .argument('<dir>', 'the app repo docs/manual directory')
  .option('--dry-run', 'parse, validate and report; write nothing')
  .option('--check-only', 'run questions.yml against the live collection only')
  .option('--version <string>', 'override manualVersion (default: git describe of the app checkout)')
  .option('--yes', 'write to a non-localhost Qdrant or database')
  .action(async (dir: string, flags: Flags) => {
    process.exitCode = await run(dir, flags)
  })

program
  .command('check')
  .argument('<dir>', 'the app repo docs/manual directory')
  .option('--yes', 'read from a non-localhost Qdrant')
  .action(async (dir: string, flags: Flags) => {
    process.exitCode = await run(dir, { ...flags, checkOnly: true })
  })

await program.parseAsync(process.argv)
```

`packages/manual/src/index.ts`:

```ts
export * from './parse.js'
export * from './files.js'
export * from './env.js'
export * from './check.js'
export * from './ingest.js'
```

Root `package.json` scripts, after `"typecheck"`:

```json
    "manual:ingest": "pnpm --filter @recoverysky/manual build && node packages/manual/dist/bin/manual.js ingest",
    "manual:check": "pnpm --filter @recoverysky/manual build && node packages/manual/dist/bin/manual.js check"
```

- [ ] **Step 7: Run the package tests, then the dry-run against the real pages**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm --filter @recoverysky/manual typecheck
pnpm vitest run packages/manual
pnpm manual:ingest ../app/docs/manual --dry-run
```

Expected: all `packages/manual` tests pass (parse 17, env 3, check 2, ingest 12). The dry-run prints the hosts, then `pages: 5, chunks: N, words: W, questions: 16` and `dry run: would embed up to N chunks (...); nothing written`, exit 0. A problem list means a page or the map breaks a rule: fix the page in the app repo (Task 9's reviewer rules), not the parser. Note: `--dry-run` never contacts Qdrant, OpenAI or Postgres, and needs no `--yes`.

- [ ] **Step 8: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
git add packages/manual/src packages/manual/tests package.json
git commit -m "✨ feat(manual): the ingest run, the questions check and the CLI

pnpm manual:ingest <dir> parses and validates everything first (every
problem at once, nothing written), diffs by contentHash so a one-page edit
embeds one page, upserts with named dense and sparse vectors, sweeps points
from earlier runs, replaces the manual-map row in a transaction and runs
questions.yml (a miss exits 1 after the writes). It prints the Qdrant and
database hosts and refuses a non-localhost target without --yes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: The discipline in the app repo (app, `CLAUDE.md`, `CHANGELOG.md`)

**Files:**
- Modify: `CLAUDE.md` (a new section after "## Repo Docs Map"'s preceding section, i.e. before `## Repo Docs Map`; one bullet inside the map; one bullet in the OTA "Before you run it" list; one paragraph after the native-release bash block)
- Modify: `CHANGELOG.md` (`[Unreleased]` gains `### Docs`)

- [ ] **Step 1: Add the section to `CLAUDE.md`**

Insert before the `## Repo Docs Map` heading:

```markdown
## User's Manual (`docs/manual/`)

The user-facing manual: one Markdown page per feature, written in the voice of
a user's manual and ingested into the Sky agent's `manual` search collection so
she can answer "how do I…", "where is…", "why can't I…" and "is it private"
about the app (spec `docs/superpowers/specs/2026-10-12-user-manual-rag-design.md`;
the ingest, store, tools and prompt section live in `../agent`). Sky is the only
reader. The rules are in `docs/manual/README.md`; the ones that bite:

- **Same-commit rule.** A user-visible behaviour change updates the matching
  page under `docs/manual/` in the same commit, the way `docs/support/` follows
  auth changes. A renamed label is a changed quote; a new feature is a new page
  or section; a removed feature is removed text (the manual never carries a
  roadmap). Pages that do not exist yet are listed in the spec's layout.
- **Labels verbatim, no internal names, every claim traceable** to the page's
  `<!-- sources -->` line, one H2 under 400 words, and the hand-off is always
  "Contact support@recoverysky.app and mention […]".
- **Validate before committing:** `pnpm --dir ../agent manual:ingest ../app/docs/manual --dry-run`
  parses every page with the real ingest's parser and lists every problem,
  writing nothing.
- **CHANGELOG:** manual edits go under `Docs` with a `(manual)` tag.
- **Ingest is by hand, after the release is live** (see the release sections):
  from the agent repo with the production `.env`,
  `pnpm manual:ingest ../app/docs/manual`.

```

In `## Repo Docs Map`, after the `docs/support/` bullet, add:

```markdown
- `docs/manual/` — the user's manual Sky searches (one page per feature,
  `map.md` in her prompt). Update the matching page in the same commit as any
  user-visible change; rules in its README and in "User's Manual" above.
```

In "### OTA release (JS-only changes)", after the `Re-confirm you genuinely did not need a runtimeVersion bump` bullet, add:

```markdown
- Did this release touch `docs/manual/`? Then, once the OTA is live, run the
  manual ingest from the agent repo with the production `.env`:
  `pnpm manual:ingest ../app/docs/manual` (it refuses a non-localhost target
  without `--yes`; see "User's Manual").
```

In "### Native release", after the paragraph that starts "These production build scripts", add:

```markdown
Did this release touch `docs/manual/`? Then, once the store build is live, run
the manual ingest from the agent repo with the production `.env`:
`pnpm manual:ingest ../app/docs/manual` (see "User's Manual").
```

- [ ] **Step 2: Add the changelog entry**

In `CHANGELOG.md` under `## [Unreleased]`, after the `### Fixed` block, add:

```markdown
### Docs
- **(manual) The user's manual begins.** `docs/manual/` is Sky's reference to
  the app: a map of what the app can do for her prompt, the authoring rules,
  and the first area, `backup-and-devices/` (Cloud Backup, more than one
  device, a new phone, one account per phone, when backup isn't working),
  every claim traced to the screens and `docs/BACKUP.md`. It is ingested into
  the agent's manual search by hand after a release (CLAUDE.md "User's
  Manual"); nothing in the app changes.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app
git add CLAUDE.md CHANGELOG.md
git commit -m "📝 docs(manual): the same-commit rule, the validate command and the release step

CLAUDE.md gains the User's Manual section, a Repo Docs Map bullet and the
post-release ingest line on both release paths; the CHANGELOG records the
first area under Docs (manual).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: The discipline in the agent repo (agent, `CLAUDE.md`, `docs/QDRANT.md`, `.env.example`)

**Files:**
- Modify: `CLAUDE.md` (commands block; "Memory Tiers" L4 line; "Dependency Injection" `QDRANT_URL` line; a new `## App Manual` section after `## Literature Search`; the dependency graph line for `manual`)
- Modify: `docs/QDRANT.md` (a new `## The manual collection` section before `## Troubleshooting`)
- Modify: `.env.example` (a comment under Literature Search)

- [ ] **Step 1: `CLAUDE.md`**

In the `## Build & Development Commands` bash block, after the `pnpm typecheck` line (or the last script line), add:

```bash
pnpm manual:ingest ../app/docs/manual [--dry-run] [--check-only] [--version <v>] [--yes]   # the user's manual → Qdrant + manual-map (see "App Manual")
```

Change the L4 line under `### Memory Tiers` to:

```markdown
- **L4 (Qdrant)**: Semantic similarity search. Message vectors are off: the api always uses the in-memory stub for messages, and Qdrant serves literature search and the user's manual only
```

Change the `QDRANT_URL` line under `### Dependency Injection` to:

```markdown
- `QDRANT_URL` → Real Qdrant for literature search and the manual (5 s timeout); the boot checks the `literature` and `manual` collections and logs "Qdrant literature collection unusable" / "Qdrant manual collection unusable" on a problem, without failing readiness
```

In the `### Package Dependency Graph` list, add `@recoverysky/manual ── types, observability, memory, db` beside the cli line, and add `| `manual` | The user's manual ingest CLI (`packages/manual`) |` to the `### Core Packages` table.

After the `## Literature Search` section, add:

```markdown
## App Manual (Sky's reference to the RecoverySky app)

The app repo's `docs/manual/` (spec: app `docs/superpowers/specs/2026-10-12-user-manual-rag-design.md`, rules in its README) is chunked, one H2 per point, into the Qdrant **`manual`** collection (hybrid layout: named `dense` 1536/Cosine + named `sparse` BM25; payload indexes `page`, `area`, `platforms`, `tier`, `runId` keyword and `order` integer; the section text is in the payload, nothing is hydrated from Postgres), and its `map.md` becomes the active **`manual-map`** row of `system_prompts`. It is the **manual**, never a "guide" (guides are the selectable system prompts).

- **Ingest:** `pnpm manual:ingest ../app/docs/manual [--dry-run] [--check-only] [--version <v>] [--yes]` (`packages/manual`, `runIngest` with injected deps, tested with fakes). It reads the root `.env` (`QDRANT_URL`, `QDRANT_API_KEY`, `DATABASE_URL`, `DATABASE_SSL`, `OPENAI_API_KEY`), prints the Qdrant and database hosts and refuses a non-localhost target without `--yes`. One run: parse and validate every page (every problem listed, nothing written on any), diff by `contentHash` (unchanged points only get their `runId` refreshed), embed the rest with `text-embedding-3-small`, ensure the collection, upsert, sweep every point whose `runId` is not this run's, `SystemPromptRepository.replaceActive('manual-map', …)` in one transaction (history rows kept), then `questions.yml` through the same search the tool runs (a miss exits 1 after the writes). Run it by hand after an app release that touched the manual is live; `--dry-run` is the app repo's pre-commit check and needs no services.
- **Tools:** `searchManual({ query, area?, platform? })` (hybrid search, 5 hits, each section ≤ 3,000 chars, score threshold 0) and `getManualPage({ page })` (one page ≤ 8,000 chars, id must match `^[a-z0-9-]+/[a-z0-9-]+$`), built per request by `createManualTools` and always offered by `createChatTools`; without a store they answer `unavailable` instead of throwing. They are tools 7 and 8 in the prompt's list; memory tools start at 9. The query is logged as `queryChars` only.
- **Prompt:** `buildSystemPrompt({ appManual })` adds `## The RecoverySky app` (the map plus fixed instructions: search before answering app questions, use on-screen labels, hand off to support@recoverysky.app, never invent a screen, ask iPhone/Android or subscription when unknown, never mention the manual) after the crisis sections and before the recovery guidelines. The map comes from `createSystemPromptSource().loadManualMap()` with the base identity's cache-last-good and 30 s cooldown on its own clock; `PROMPT_REFRESH_ALWAYS` refreshes it per request. No active row means no section.
- **Boot:** with `QDRANT_URL`, the container builds `ManualVectorStore` on the literature client, checks the collection in `init` and logs "Qdrant manual collection unusable, manual search will fail" on a problem without failing readiness; with `OPENAI_API_KEY` it hands the tools the literature embedding provider.
- **Shared Qdrant code:** `ManualVectorStore` and `QdrantVectorStore` both call `qdrant/hybridQuery.ts` (prefetch dense + sparse, RRF, raw points back) and `mapQdrantError` / `CollectionConfigError` from `qdrant/errors.ts`.
```

Update the "Last Updated" line at the top of `CLAUDE.md` to `2026/10/12`.

- [ ] **Step 2: `docs/QDRANT.md`**

Before `## Troubleshooting`, add:

````markdown
## The manual collection

`manual` holds the RecoverySky user's manual (app repo `docs/manual/`), one point per H2 section, written only by `pnpm manual:ingest` (`packages/manual`) and read by the `searchManual` / `getManualPage` tools through `ManualVectorStore`. It uses the hybrid layout above (named `dense` 1536/Cosine, named `sparse` BM25) with these payload indexes:

| Field | Type | Used by |
| --- | --- | --- |
| `page` | keyword | `getManualPage` scroll; the questions check |
| `area` | keyword | `searchManual` filter |
| `platforms` | keyword (array; a match hits any element) | `searchManual` filter |
| `tier` | keyword | reporting |
| `runId` | keyword | the sweep: `must_not runId = <this run>` deletes stale points |
| `order` | integer | section order inside a page |

Payload: `corpus`, `page`, `order`, `heading`, `title`, `area`, `screen`, `platforms`, `tier`, `aliases`, `content`, `contentHash`, `manualVersion`, `runId`, `ingestedAt`. Point ids are the sha256 of `<page>#<heading-slug>` laid out as a UUID (the `messageIdToPointId` layout), so a re-ingest is an upsert; `contentHash` decides whether a point is re-embedded.

The `literature` collection, by contrast, is a **simple** layout (one unnamed 1536-dim Cosine vector) with snake_case payload keys and text hydrated from Postgres; it is written by an ingest outside this repo.
````

- [ ] **Step 3: `.env.example`**

Under the Literature Search lines, add:

```
# User's manual (packages/manual, see CLAUDE.md "App Manual"): the ingest reads QDRANT_URL, QDRANT_API_KEY,
# DATABASE_URL and OPENAI_API_KEY from this file; the api reads the `manual` collection and the manual-map row.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
git add CLAUDE.md docs/QDRANT.md .env.example
git commit -m "📝 docs(manual): document the manual collection, the ingest, the tools and the prompt section

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Ingest to dev and run the hand checklist (both repos; no commit unless a page changes)

**Files:** none changed unless the checklist finds an invented detail (then the page and `questions.yml` in the app repo, with the same review as Task 9).

- [ ] **Step 1: A local Qdrant and the root `.env`**

The agent repo's root `.env` has `OPENAI_API_KEY`, `DATABASE_URL`, `DATABASE_SSL` but no `QDRANT_URL` (checked 2026-10-12). Start a local Qdrant and point the env at it for this session only:

```bash
docker run -d --rm --name rs-qdrant-dev -p 127.0.0.1:6333:6333 qdrant/qdrant:v1.17.1
cd /Users/jenova/projects/recoverysky-org/agent
export QDRANT_URL=http://127.0.0.1:6333
```

The database in `DATABASE_URL` must be reachable and migrated (`pnpm --filter @recoverysky/db db:migrate:local` for the docker-compose Postgres; see CLAUDE.md "Database Migrations"). If `DATABASE_URL` points at a non-local host, stop and ask Jenova before writing the `manual-map` row there; `--yes` is her call.

- [ ] **Step 2: Ingest**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm manual:ingest ../app/docs/manual
```

Expected: hosts printed; `pages: 5, chunks: N, …`; `chunks: N (embedded N, unchanged 0)`; `swept 0 points from earlier runs`; `manual-map replaced; …`; `questions: 16 passed, 0 missed`; exit 0. A MISS means the question's words do not reach its page: add the words as an alias or to the page's "Questions people ask", re-run (`--check-only` after a page-only change still needs a full run, because the page changed), and keep the change through Task 9's review.

Run it a second time: expected `embedded 0, unchanged N`.

- [ ] **Step 3: Boot the api against it and ask Sky**

```bash
cd /Users/jenova/projects/recoverysky-org/agent
DISABLE_AUTH=true DISABLE_DEVICE_AUTH=true QDRANT_URL=http://127.0.0.1:6333 pnpm dev
```

Watch the boot log for `Qdrant manual collection ready`, `Manual map loaded from database` and `Manual search enabled (Qdrant + OpenAI embeddings)`. In a second shell:

```bash
cd /Users/jenova/projects/recoverysky-org/agent
pnpm --filter @recoverysky/cli build
node packages/cli/dist/index.js chat "How do I send my PO a report?"
```

Ask the ten questions of the spec's hand checklist (§6), one `chat` each:

1. "How do I send my PO a report?"
2. "My favorites didn't move to my new phone."
3. "Why don't I see the Attendance tab?"
4. "Is my clean date private?"
5. "I'm on Android and don't want an account."
6. "How do I delete my data?"
7. "What does Premium get me?"
8. "The app says this phone is set up for a different account."
9. "Can I use RecoverySky on two phones?"
10. "What does 'Paused — offline' mean?"

For each, record in the task notes: did she search (the api log shows `Searching the manual` with `queryChars`); did she use the on-screen labels; did she invent anything (compare every label and step against the page); did she hand off with "Contact support@recoverysky.app and mention …" where the manual says to; did she keep the manual invisible (no "according to the manual"). Questions 1, 3, 4 and 7 have no page yet (areas 1–5): the correct answer uses the map (tabs, tiers, "Enable Attendance", where data lives) and, for anything deeper, says she is not sure and gives the support address; an invented screen there is a failure of the prompt instructions, not of a missing page.

- [ ] **Step 4: Fix and record**

An invented detail in questions 2, 5, 6, 8, 9 or 10 is a page problem: add the missing fact (sourced) or the missing honest edge to the page, re-run Task 9's review on it, re-ingest, re-ask. An invented detail in 1, 3, 4 or 7 is a prompt-instruction problem: note it for the writing of that area; do not patch the map with unverified claims.

Stop the services:

```bash
docker stop rs-qdrant-dev
```

Write the ten results into `.superpowers/sdd/<plan>/ledger.md` (or the final report) as the skeleton's acceptance record.

---

## After the skeleton

Sub-projects 1–5 (the spec's roadmap table) are each a bounded writing job: a brief of pages and sources, write to the template, a fact-check reviewer, three questions per page, dry-run, commit, ingest to dev, ask Sky. They need no new code. Two follow-ups are code and get their own small plans: the chat body's `platform` / `appVersion` (app `AgentScreen.tsx`, agent `chatBodySchema` and a prompt line), and the `docs/support/replies/` → pointers change after area 1.
