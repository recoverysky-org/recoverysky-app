# Device Attestation Public Key + Assertion Counter (common) Implementation Plan

> This plan targets the **common** repo (`/Users/jenova/projects/recoverysky-org/common`) but lives here because that repo git-ignores `docs/`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `device_attestations` the two columns the App Attest assertion flow needs and replace the first-writer-wins `claim()` with an unconditional `bind()` plus `recordAssertion()`, released as `@recoverysky-org/common` 2.9.0.

**Architecture:** The TypeScript class in `src/models/device_attestation.ts` is the source of truth; `pnpm make` regenerates the JSON schema, the Drizzle PG table, and a new SQL migration from it. The repository is the only consumer that changes. Nothing here touches the SQLite side (`@sqlite skip`).

**Tech Stack:** TypeScript, Drizzle ORM (postgres-js), vitest integration tests against a real Postgres (`createTestDb`), pnpm 10.

**Spec:** `docs/superpowers/specs/2026-09-09-app-attest-assertions-and-jwt-persistence-design.md` (in the app repo; Section 1 "Storage" is the part this plan implements).

## Global Constraints

- Work in `/Users/jenova/projects/recoverysky-org/common` on the default branch. Run `git status` first; stage only the paths named in each task, never `git add -A`.
- New columns and defaults exactly: `public_key` text default `''`, `assert_counter` integer default `0`. Both NOT NULL via the defaults, as the generator emits for every other column.
- Rebind is unconditional (spec decision A). `bind()` never reports a conflict.
- Do not hand-edit anything under `src/models/json/`, `src/models/drizzle/`, or `src/models/migrations/` — regenerate with `pnpm make`.
- Release version is **2.9.0**. Tag `v2.9.0` after the version commit, matching how `v2.8.0` was cut (`git log --oneline -3` shows the shape).

---

### Task 1: Add the two columns to the model and regenerate

**Files:**
- Modify: `src/models/device_attestation.ts`
- Regenerated (do not hand-edit): `src/models/json/device_attestation.json`, `src/models/drizzle/pg/device_attestations.drizzle.ts`, `src/models/migrations/0063_*.sql`, `src/models/migrations/meta/*`

**Interfaces:**
- Produces: `device_attestation` class with `public_key: string` and `assert_counter: number`; Drizzle table `device_attestations` with `public_key` (text) and `assert_counter` (integer) columns.

- [ ] **Step 1: Edit the model class**

Replace the class body and its doc comment in `src/models/device_attestation.ts` with:

```ts
/**
 * Binds a deviceId to the App Attest key that most recently attested it.
 *
 * POST /attest takes deviceId from the request body and signs it into the
 * device JWT. App Attest proves "a genuine instance of this app on real Apple
 * hardware" — it does NOT bind that proof to a particular deviceId. This row
 * is what lets POST /attest/assert verify a later assertion: the stored
 * public key checks the signature, the stored counter defeats replay.
 *
 * CHANGED 2026-09-09: was first-writer-wins ("claim"). A valid full
 * attestation now rebinds unconditionally — attestation already proves a
 * genuine app on genuine hardware, and a reinstall legitimately arrives with
 * a new key. Assertions with a key other than the bound one are rejected;
 * that is the property that matters. Spec:
 * app/docs/superpowers/specs/2026-09-09-app-attest-assertions-and-jwt-persistence-design.md
 *
 * iOS: `key_id` and `public_key` come from the App Attest attestation
 * object; `assert_counter` is the last accepted assertion counter.
 *
 * Android: Play Integrity returns verdicts and no per-install key, so
 * `key_id` and `public_key` are empty and these rows carry NO cryptographic
 * guarantee. They exist for observability only.
 *
 * @index platform
 * @sqlite skip
 */
export class device_attestation {
  /** The deviceId the client presented — the primary key */
  device_id: string = "";

  /** "ios" | "android" */
  platform: string = "";

  /** iOS App Attest key id. Empty on Android — see the class doc. */
  key_id: string = "";

  /**
   * PEM (SPKI) public key extracted from the App Attest attestation
   * certificate. Empty on Android. Used by POST /attest/assert.
   */
  public_key: string = "";

  /**
   * Last accepted App Attest assertion counter. Reset to 0 on every full
   * attestation; each accepted assertion must present a strictly greater
   * value (Apple's replay protection).
   */
  assert_counter: number = 0;

  /** UTC millis of the first successful attestation for this device_id */
  /** @format bigint */
  first_seen: number = 0;

  /** UTC millis of the most recent successful attestation or assertion */
  /** @format bigint */
  last_seen: number = 0;

  /** Successful full attestations recorded for this device_id */
  attest_count: number = 0;
}
```

- [ ] **Step 2: Regenerate the pipeline**

Run: `pnpm make`
Expected: exits 0; `git status --short` shows the JSON schema, the PG drizzle file, a new `src/models/migrations/0063_<words>.sql`, and `src/models/migrations/meta/` updates. If `drizzle:generate` prompts, answer that the columns are new (not renames).

- [ ] **Step 3: Verify the generated migration**

Run: `cat src/models/migrations/0063_*.sql`
Expected: exactly two statements of the form

```sql
ALTER TABLE "device_attestations" ADD COLUMN "assert_counter" integer DEFAULT 0 NOT NULL;
ALTER TABLE "device_attestations" ADD COLUMN "public_key" text DEFAULT '' NOT NULL;
```

and `grep -n "public_key\|assert_counter" src/models/drizzle/pg/device_attestations.drizzle.ts` shows `public_key: text('public_key').notNull().default('')` and `assert_counter: integer('assert_counter').notNull().default(0)`. No SQLite migration should appear (`@sqlite skip`).

- [ ] **Step 4: Type-check**

Run: `pnpm build`
Expected: exits 0 (the repository still compiles because it does not yet reference the new columns).

- [ ] **Step 5: Commit**

```bash
git add src/models/device_attestation.ts src/models/json/device_attestation.json \
        src/models/drizzle/pg/device_attestations.drizzle.ts src/models/migrations/
git commit -m "✨ feat(models): device_attestations gains public_key + assert_counter for App Attest assertions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 2: Replace `claim()` with `bind()` and add `recordAssertion()`

**Files:**
- Modify: `src/repositories/DeviceAttestationRepository.ts`
- Modify: `src/repositories/index.ts:37`
- Test: `src/repositories/__tests__/DeviceAttestationRepository.integration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BindOutcome = { changed: boolean; previousKeyId: string | null; row: device_attestation }
  class DeviceAttestationRepository {
    bind(deviceId: string, platform: string, keyId: string, publicKey: string, nowMs: number): Promise<RecoverySkyResult<BindOutcome>>
    recordAssertion(deviceId: string, counter: number, nowMs: number): Promise<RecoverySkyResult<device_attestation | null>>
    findByDeviceId(deviceId: string): Promise<RecoverySkyResult<device_attestation | null>>  // unchanged
    findByKeyId(keyId: string): Promise<RecoverySkyResult<device_attestation[]>>            // unchanged
  }
  ```
  `ClaimOutcome` and `claim()` are removed. The API plan consumes `bind`, `recordAssertion`, `findByDeviceId`.

- [ ] **Step 1: Rewrite the integration tests**

Replace the `it(...)` blocks in `src/repositories/__tests__/DeviceAttestationRepository.integration.test.ts` (keep the file header, `describe.skipIf`, `deviceId()` helper, `beforeAll`/`afterEach`/`afterAll` exactly as they are) with:

```ts
  const PEM_A = "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n";
  const PEM_B = "-----BEGIN PUBLIC KEY-----\nBBBB\n-----END PUBLIC KEY-----\n";

  it("binds an unseen device_id", async () => {
    const did = deviceId();
    const res = await repo.bind(did, "ios", "key-a", PEM_A, 1_000);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.changed).toBe(false);
    expect(res.value.previousKeyId).toBeNull();
    expect(res.value.row.first_seen).toBe(1_000);
    expect(res.value.row.last_seen).toBe(1_000);
    expect(res.value.row.attest_count).toBe(1);
    expect(res.value.row.public_key).toBe(PEM_A);
    expect(res.value.row.assert_counter).toBe(0);
  });

  it("re-binding the same key is not a change and advances last_seen + attest_count", async () => {
    const did = deviceId();
    await repo.bind(did, "ios", "key-a", PEM_A, 1_000);
    const res = await repo.bind(did, "ios", "key-a", PEM_A, 2_000);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.changed).toBe(false);
    expect(res.value.previousKeyId).toBe("key-a");
    expect(res.value.row.first_seen).toBe(1_000);
    expect(res.value.row.last_seen).toBe(2_000);
    expect(res.value.row.attest_count).toBe(2);
  });

  it("re-binding a different key rebinds, reports the swap, and resets the counter", async () => {
    const did = deviceId();
    await repo.bind(did, "ios", "key-a", PEM_A, 1_000);
    await repo.recordAssertion(did, 7, 1_500);
    const res = await repo.bind(did, "ios", "key-b", PEM_B, 2_000);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.changed).toBe(true);
    expect(res.value.previousKeyId).toBe("key-a");
    expect(res.value.row.key_id).toBe("key-b");
    expect(res.value.row.public_key).toBe(PEM_B);
    expect(res.value.row.assert_counter).toBe(0);
    expect(res.value.row.first_seen).toBe(1_000);
    expect(res.value.row.attest_count).toBe(2);
  });

  it("recordAssertion stores the counter and last_seen", async () => {
    const did = deviceId();
    await repo.bind(did, "ios", "key-a", PEM_A, 1_000);
    const res = await repo.recordAssertion(did, 3, 5_000);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.assert_counter).toBe(3);
    expect(res.value?.last_seen).toBe(5_000);
    expect(res.value?.attest_count).toBe(1);
  });

  it("recordAssertion on an unknown device_id returns null, not an error", async () => {
    const res = await repo.recordAssertion(`never-bound-${crypto.randomUUID()}`, 1, 1_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBeNull();
  });

  it("android rows bind with empty key material", async () => {
    const did = deviceId();
    const res = await repo.bind(did, "android", "", "", 1_000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.row.key_id).toBe("");
    expect(res.value.row.public_key).toBe("");
  });

  it("findByDeviceId returns the bound row, and null for an unknown id", async () => {
    const did = deviceId();
    await repo.bind(did, "ios", "key-a", PEM_A, 1_000);
    const hit = await repo.findByDeviceId(did);
    const miss = await repo.findByDeviceId(`never-bound-${crypto.randomUUID()}`);
    expect(hit.ok && hit.value?.key_id).toBe("key-a");
    expect(miss.ok && miss.value).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:repos -- DeviceAttestationRepository`
Expected: FAIL with `repo.bind is not a function` (or the suite is skipped if `shouldSkipIntegrationTests()` is true — in that case the DB env for integration tests must be set up per `src/repositories/__tests__/testHelpers.ts` before continuing; do not proceed on a skipped suite).

- [ ] **Step 3: Implement `bind()` and `recordAssertion()`**

Replace everything in `src/repositories/DeviceAttestationRepository.ts` from the file doc comment through the end of `claim()` (keep `findByDeviceId` and `findByKeyId` as they are) with:

```ts
/**
 * DeviceAttestationRepository — the App Attest key currently bound to a deviceId.
 *
 * POST /attest signs a client-chosen deviceId into the device JWT. App Attest
 * proves "a genuine instance of this app on real Apple hardware", not "this
 * deviceId". This table stores the public key and assertion counter that let
 * POST /attest/assert verify later, cheap re-authentications without a fresh
 * Apple round trip.
 *
 * CHANGED 2026-09-09: `claim()` (first-writer-wins, conflict outcome) became
 * `bind()` (unconditional upsert). A valid full attestation always wins:
 * a reinstall legitimately shows up with a new key, and attestation already
 * proves genuine app + genuine hardware. Callers log `changed` swaps.
 *
 * @example
 * import { DeviceAttestationRepository } from '@recoverysky-org/common';
 *
 * const repo = new DeviceAttestationRepository(db);
 * const res = await repo.bind(deviceId, 'ios', keyId, publicKeyPem, Date.now());
 * if (res.ok && res.value.changed) {
 *   // A different key previously owned this deviceId — log it.
 * }
 */

import type { DrizzleDatabase } from "../types/database.js";
import { eq, sql } from "drizzle-orm";
import { device_attestations } from "../models/drizzle/pg/device_attestations.drizzle.js";
import { device_attestation } from "../models/device_attestation.js";
import { ok, err, type RecoverySkyResult } from "../errors/results.js";
import { unexpected } from "@jenova-marie/ts-rust-result/errors";
import { extractDatabaseErrorDetails } from "../errors/database-error-extractor.js";

export interface BindOutcome {
  /** True when the row existed with a different key_id before this call. */
  changed: boolean;
  /** The key_id that was bound before this call, or null for a new row. */
  previousKeyId: string | null;
  row: device_attestation;
}

export class DeviceAttestationRepository {
  public readonly db: DrizzleDatabase;
  public readonly table = device_attestations;

  constructor(db: DrizzleDatabase) {
    this.db = db;
  }

  /**
   * Record a successful full attestation, rebinding unconditionally.
   *
   * Two statements, not one: the read tells the caller whether the key
   * changed, which the single upsert cannot report. Losing the race between
   * two simultaneous full attestations for one deviceId is harmless — the
   * later one wins, exactly as it would have sequentially.
   *
   * `assert_counter` resets to 0 on every bind: a new key starts a new
   * Apple counter sequence, and re-attesting the same key restarts it too.
   */
  async bind(
    deviceId: string,
    platform: string,
    keyId: string,
    publicKey: string,
    nowMs: number,
  ): Promise<RecoverySkyResult<BindOutcome>> {
    try {
      const existing = await this.findByDeviceId(deviceId);
      if (!existing.ok) return existing;
      const previousKeyId = existing.value?.key_id ?? null;

      const rows = await this.db
        .insert(device_attestations)
        .values({
          device_id: deviceId,
          platform,
          key_id: keyId,
          public_key: publicKey,
          assert_counter: 0,
          first_seen: nowMs,
          last_seen: nowMs,
          attest_count: 1,
        } as never)
        .onConflictDoUpdate({
          target: device_attestations.device_id,
          set: {
            platform,
            key_id: keyId,
            public_key: publicKey,
            assert_counter: 0,
            last_seen: nowMs,
            attest_count: sql`${device_attestations.attest_count} + 1`,
          },
        })
        .returning();

      const row = rows[0] as device_attestation | undefined;
      if (!row) {
        return err(unexpected(`device_attestation upsert returned no row: ${deviceId}`));
      }
      return ok({
        changed: previousKeyId !== null && previousKeyId !== keyId,
        previousKeyId,
        row,
      });
    } catch (error) {
      const details = extractDatabaseErrorDetails(error, "bind");
      return err(unexpected(details.message, error));
    }
  }

  /**
   * Store the counter from an accepted assertion. The caller has already
   * verified that `counter` is strictly greater than the stored value; this
   * just persists it. Returns null when no row is bound to the deviceId.
   */
  async recordAssertion(
    deviceId: string,
    counter: number,
    nowMs: number,
  ): Promise<RecoverySkyResult<device_attestation | null>> {
    try {
      const rows = await this.db
        .update(device_attestations)
        .set({ assert_counter: counter, last_seen: nowMs })
        .where(eq(device_attestations.device_id, deviceId))
        .returning();
      return ok((rows[0] as device_attestation) ?? null);
    } catch (error) {
      const details = extractDatabaseErrorDetails(error, "recordAssertion");
      return err(unexpected(details.message, error));
    }
  }
```

- [ ] **Step 4: Update the barrel export**

In `src/repositories/index.ts` line 37 change

```ts
export { DeviceAttestationRepository, type ClaimOutcome } from './DeviceAttestationRepository.js';
```

to

```ts
export { DeviceAttestationRepository, type BindOutcome } from './DeviceAttestationRepository.js';
```

Run: `grep -rn "ClaimOutcome\|\.claim(" src` — expected: no matches.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:repos -- DeviceAttestationRepository`
Expected: 7 passed. Then `pnpm test:unit` — expected: all pass (nothing else references the repository).

- [ ] **Step 6: Build and commit**

Run: `pnpm build` — expected exit 0.

```bash
git add src/repositories/DeviceAttestationRepository.ts src/repositories/index.ts \
        src/repositories/__tests__/DeviceAttestationRepository.integration.test.ts
git commit -m "♻️ refactor(repositories): DeviceAttestationRepository.bind() replaces first-writer-wins claim(); add recordAssertion()

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 3: Release 2.9.0

**Files:**
- Modify: `package.json:3`

- [ ] **Step 1: Bump the version**

Run: `pnpm version minor --no-git-tag-version`
Expected: `package.json` now reads `"version": "2.9.0"`.

- [ ] **Step 2: Full build**

Run: `pnpm make`
Expected: exit 0, no new files under `src/models/` (the generation is idempotent after Task 1).

- [ ] **Step 3: Commit and tag, matching the v2.8.0 shape**

```bash
git add package.json
git commit -m "v2.9.0"
git tag v2.9.0
git push && git push --tags
```

- [ ] **Step 4: Publish the way 2.8.0 was published**

Run: `npm view @recoverysky-org/common version` — this tells you which registry serves the package (the number printed must be `2.8.0` before you publish). Then run `pnpm publish` from the repo root. Re-run `npm view @recoverysky-org/common version` — expected: `2.9.0`. If `npm view` fails to resolve the package at all, stop and ask Jenova how 2.8.0 reached the API (`pnpm add @recoverysky-org/common@^2.8.0` in `../api` resolved it somewhere); do not guess a registry.
