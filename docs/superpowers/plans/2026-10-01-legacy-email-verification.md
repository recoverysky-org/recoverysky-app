# Legacy Email Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in legacy password user confirm or correct their account email with a code, so passwordless sign-in can find their account, and give locked-out users a password sign-in link.

**Architecture:** The API sends its own 6-digit code (Postmark) and, on a match, sets the Auth0 account's email and marks it verified. The app shows a full-screen modal gate (`VerifyEmailGate`, the `AnnouncementGate` pattern) to unverified password accounts at app start, on foreground and after sign-in, skippable six times (a full week: mandatory on the seventh day of use). All decisions live in pure modules; the gate and the routes only do I/O.

**Tech Stack:** App: React Native / Expo, MobX-State-Tree, MMKV, vitest (pure `.ts`), jest-expo (`.tsx`). API (`../api`): Express, zod, ioredis, Postmark, vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md` (read it first; §10 records the dev-tenant check that one Management `PATCH` can set `email` + `email_verified`).

## Global Constraints

- **Two repos.** Tasks 1–2 are in `/Users/jenova/projects/recoverysky-org/api` (pnpm, branch from `prod`). Tasks 3–9 are in `/Users/jenova/projects/recoverysky-org/app` (npm, branch from `root`). Create branch `feat/email-verify` in each before the first commit there. Every command names its repo.
- **Never log** an email address, a verification code, or a raw Auth0 sub. Logs carry `hashUserId(sub)` only.
- **Skips:** `MAX_SKIPS = 6`. Showings 1–6 are skippable and show "Skips left: N" (6 on the first, 1 on the sixth). Showing 7 and later are mandatory.
- **One showing per local day** (`todayLocalISODate()`), counted when the screen is displayed.
- **Resend wait:** 60 s on this screen (Login keeps its 30 s).
- **Code:** 6 digits, 10-minute life, 5 wrong tries kill it.
- **"Why" link URL, verbatim:** `https://www.recoverysky.org/post/8/recoverysky-required-email-verification`
- **Support address, verbatim:** `support@recoverysky.app`
- **Heading copy, verbatim:** `Please review and verify your email address`
- **App lint:** never `npm run lint`. Use `npx eslint --fix <files you touched>`.
- **App tests:** `*.test.ts` → vitest (no `@/` runtime imports in the module under test); `*.test.tsx` → jest.
- **Git:** stage named paths only. Never `git add -A`, never `git stash`. End commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **i18n:** a new key goes in all nine locale files (`en es ar de fr pt ru th uk`); the other eight may carry the English text.
- **Comments:** this repo wants liberal "why" comments; keep the ones in the code below.

## Review Focus

1. **Stale ID token after verifying.** A cold start can restore a cached token that still says `email_verified: false`. The user must not be asked again. Pinned in Task 3 (`needsEmailVerification` with `locallyVerified: true`).
2. **Code sign-in into an unverified password account.** The token still carries the password identity's unverified flag. The user must not see the screen. Pinned in Task 3 (`loginMethod: "email"`).
3. **Address spelling.** `" Me@Example.com "` and `me@example.com` are the same address everywhere: the code record, the conflict check, the same-address test. Pinned in Tasks 1 and 2.
4. **Repeat and stale requests.** Verify twice, verify with no start, verify after the code was replaced by a second start. Each must answer a clean 400, never a 500, and never change the account. Pinned in Task 2.
5. **Mandatory showing with no way to pass.** Offline, maintenance, outage, a running timer or onboarding must hide the screen and not count the day. Pinned in Task 3 (`verifyGateBlocked`) and Task 7 (mandatory view has no "Not now").

---

### Task 1 (api): code logic and store

**Files:**
- Create: `../api/src/services/emailVerifyCode.ts`
- Test: `../api/src/services/emailVerifyCode.test.ts`

**Interfaces:**
- Produces: `CODE_TTL_MS`, `MAX_WRONG_ATTEMPTS`, `CodeRecord`, `normalizeEmail(email)`, `generateCode(pick?)`, `hashCode(sub, code)`, `checkCode(record, input)` → `CodeCheck`, `codeKey(sub)`, `CodeStore`, `createMemoryCodeStore(nowMs?)`, `createRedisCodeStore(redis, nowMs?)`.

- [ ] **Step 1: Branch**

```bash
cd /Users/jenova/projects/recoverysky-org/api && git checkout -b feat/email-verify
```

- [ ] **Step 2: Write the failing test** — `src/services/emailVerifyCode.test.ts`

```ts
import {
  CODE_TTL_MS,
  MAX_WRONG_ATTEMPTS,
  checkCode,
  codeKey,
  createMemoryCodeStore,
  createRedisCodeStore,
  generateCode,
  hashCode,
  normalizeEmail,
  type CodeRecord,
} from "./emailVerifyCode.js";

const SUB = "auth0|abc";
const record = (over: Partial<CodeRecord> = {}): CodeRecord => ({
  email: "me@example.com",
  hash: hashCode(SUB, "123456"),
  attempts: 0,
  expiresAt: 10_000,
  ...over,
});

describe("normalizeEmail", () => {
  it("trims and lowercases, so two spellings are one address", () => {
    expect(normalizeEmail("  Me@Example.COM ")).toBe("me@example.com");
  });
});

describe("generateCode", () => {
  it("is always six digits, zero-padded", () => {
    expect(generateCode(() => 7)).toBe("000007");
    expect(generateCode(() => 999_999)).toBe("999999");
    expect(generateCode()).toMatch(/^\d{6}$/);
  });
});

describe("hashCode", () => {
  it("depends on both the user and the code", () => {
    expect(hashCode(SUB, "123456")).not.toBe(hashCode("auth0|other", "123456"));
    expect(hashCode(SUB, "123456")).not.toBe(hashCode(SUB, "123457"));
    expect(hashCode(SUB, "123456")).not.toContain("123456");
  });
});

describe("checkCode", () => {
  const input = { sub: SUB, email: "me@example.com", code: "123456", nowMs: 5_000 };

  it("accepts the right code for the right address", () => {
    expect(checkCode(record(), input)).toEqual({ outcome: "ok" });
  });
  it("accepts a differently spelled address", () => {
    expect(checkCode(record(), { ...input, email: " ME@example.com" })).toEqual({ outcome: "ok" });
  });
  it("reports a missing record as expired", () => {
    expect(checkCode(null, input)).toEqual({ outcome: "expired" });
  });
  it("reports a record past its time as expired", () => {
    expect(checkCode(record(), { ...input, nowMs: 10_000 })).toEqual({ outcome: "expired" });
  });
  it("counts a wrong code and hands back the record to save", () => {
    expect(checkCode(record(), { ...input, code: "000000" })).toEqual({
      outcome: "wrong",
      record: record({ attempts: 1 }),
    });
  });
  it("counts a right code for a different address as wrong", () => {
    expect(checkCode(record(), { ...input, email: "other@example.com" }).outcome).toBe("wrong");
  });
  it("locks on the last allowed wrong try", () => {
    const almost = record({ attempts: MAX_WRONG_ATTEMPTS - 1 });
    expect(checkCode(almost, { ...input, code: "000000" })).toEqual({ outcome: "locked" });
  });
});

describe("codeKey", () => {
  it("never contains the raw sub", () => {
    expect(codeKey(SUB)).toMatch(/^emailverify:[0-9a-f]{32}$/);
    expect(codeKey(SUB)).not.toContain("abc");
  });
});

describe("createMemoryCodeStore", () => {
  it("returns what was set, forgets it after expiry, and deletes", async () => {
    let now = 0;
    const store = createMemoryCodeStore(() => now);
    await store.set("k", record({ expiresAt: 100 }));
    expect(await store.get("k")).toEqual(record({ expiresAt: 100 }));
    now = 100;
    expect(await store.get("k")).toBeNull();
    await store.set("k", record({ expiresAt: 500 }));
    await store.del("k");
    expect(await store.get("k")).toBeNull();
  });
});

describe("createRedisCodeStore", () => {
  it("stores JSON with the remaining life as PX", async () => {
    const calls: unknown[][] = [];
    const data = new Map<string, string>();
    const redis = {
      get: async (k: string) => data.get(k) ?? null,
      set: async (...args: unknown[]) => {
        calls.push(args);
        data.set(args[0] as string, args[1] as string);
        return "OK";
      },
      del: async (k: string) => {
        data.delete(k);
        return 1;
      },
    };
    const store = createRedisCodeStore(redis, () => 1_000);
    await store.set("k", record({ expiresAt: 1_000 + CODE_TTL_MS }));
    expect(calls[0]).toEqual(["k", JSON.stringify(record({ expiresAt: 1_000 + CODE_TTL_MS })), "PX", CODE_TTL_MS]);
    expect(await store.get("k")).toEqual(record({ expiresAt: 1_000 + CODE_TTL_MS }));
    await store.del("k");
    expect(await store.get("k")).toBeNull();
  });
  it("treats unparseable data as no record", async () => {
    const redis = { get: async () => "not json", set: async () => "OK", del: async () => 1 };
    expect(await createRedisCodeStore(redis).get("k")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it; expect failure**

Run: `cd /Users/jenova/projects/recoverysky-org/api && pnpm vitest run src/services/emailVerifyCode.test.ts`
Expected: FAIL, cannot find module `./emailVerifyCode.js`.

- [ ] **Step 4: Implement** — `src/services/emailVerifyCode.ts`

```ts
/**
 * Email verification codes for POST /auth0/email/start and /verify (app spec
 * docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md §6).
 *
 * PURE except for the two stores at the bottom. The routes own the HTTP and
 * Auth0 half. Nothing here logs: an address or a code must never reach Loki.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/** A code lives ten minutes. Long enough for a slow mailbox, short enough to be useless later. */
export const CODE_TTL_MS = 10 * 60_000;
/** The fifth wrong try deletes the code: 5 guesses at 1 in 1,000,000. */
export const MAX_WRONG_ATTEMPTS = 5;

export interface CodeRecord {
  /** Normalized address the code was sent to. */
  email: string;
  /** sha256 of sub + code. The code itself is never stored. */
  hash: string;
  attempts: number;
  expiresAt: number;
}

/** One spelling per address: Auth0 stores database emails lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `pick(max)` returns an integer in [0, max). Injected so tests are deterministic. */
export function generateCode(pick: (max: number) => number = randomInt): string {
  return String(pick(1_000_000)).padStart(6, "0");
}

/** Bound to the user, so a leaked hash is useless for any other account. */
export function hashCode(sub: string, code: string): string {
  return createHash("sha256").update(`${sub}:${code}`).digest("hex");
}

export type CodeCheck =
  | { outcome: "ok" }
  /** No record, or past its time. */
  | { outcome: "expired" }
  /** Wrong code or wrong address: save `record` back (attempts already counted). */
  | { outcome: "wrong"; record: CodeRecord }
  /** That was the last allowed wrong try: delete the record. */
  | { outcome: "locked" };

export function checkCode(
  record: CodeRecord | null,
  input: { sub: string; email: string; code: string; nowMs: number },
): CodeCheck {
  if (!record || record.expiresAt <= input.nowMs) return { outcome: "expired" };
  const stored = Buffer.from(record.hash, "hex");
  const given = Buffer.from(hashCode(input.sub, input.code), "hex");
  const sameCode = stored.length === given.length && timingSafeEqual(stored, given);
  // A right code for a different address is a wrong try too: the code proves
  // one mailbox only.
  if (sameCode && record.email === normalizeEmail(input.email)) return { outcome: "ok" };
  const attempts = record.attempts + 1;
  if (attempts >= MAX_WRONG_ATTEMPTS) return { outcome: "locked" };
  return { outcome: "wrong", record: { ...record, attempts } };
}

/** Store key. Hashed so a raw Auth0 sub never sits in Redis key space. */
export function codeKey(sub: string): string {
  return `emailverify:${createHash("sha256").update(sub).digest("hex").slice(0, 32)}`;
}

export interface CodeStore {
  get(key: string): Promise<CodeRecord | null>;
  set(key: string, record: CodeRecord): Promise<void>;
  del(key: string): Promise<void>;
}

/** Used when REDIS_URL is unset (a single replica, per services/redis.ts) and in tests. */
export function createMemoryCodeStore(nowMs: () => number = Date.now): CodeStore {
  const data = new Map<string, CodeRecord>();
  return {
    async get(key) {
      const record = data.get(key);
      if (!record) return null;
      if (record.expiresAt <= nowMs()) {
        data.delete(key);
        return null;
      }
      return record;
    },
    async set(key, record) {
      data.set(key, record);
    },
    async del(key) {
      data.delete(key);
    },
  };
}

/** The three ioredis commands this store needs. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ms: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** A Redis failure rejects; the route turns that into a 503. */
export function createRedisCodeStore(redis: RedisLike, nowMs: () => number = Date.now): CodeStore {
  return {
    async get(key) {
      const raw = await redis.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as CodeRecord;
      } catch {
        return null;
      }
    },
    async set(key, record) {
      await redis.set(key, JSON.stringify(record), "PX", Math.max(1, record.expiresAt - nowMs()));
    },
    async del(key) {
      await redis.del(key);
    },
  };
}
```

- [ ] **Step 5: Run it; expect pass**

Run: `cd /Users/jenova/projects/recoverysky-org/api && pnpm vitest run src/services/emailVerifyCode.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/api && git add src/services/emailVerifyCode.ts src/services/emailVerifyCode.test.ts && git commit -m "✨ feat(auth0): email verification code logic and store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 (api): `POST /auth0/email/start` and `/verify`

**Files:**
- Create: `../api/src/routes/auth0Email.ts`
- Test: `../api/src/routes/auth0Email.test.ts`
- Modify: `../api/src/routes/auth0.ts` (export the management client and domain), `../api/src/app.ts:320` (mount), `../api/src/openapi.ts` (two paths), `../api/CHANGELOG.md` if the repo has one

**Interfaces:**
- Consumes: everything Task 1 produces; `sendEmail(to, subject, html)` and `isEmailAvailable()` from `services/email.ts`; `getRedis()` from `services/redis.ts`.
- Produces (HTTP, used by app Task 5):
  - `POST /auth0/email/start` body `{ email }` → `200 { sent: true }`.
  - `POST /auth0/email/verify` body `{ email, code }` → `200 { email }` (normalized address).
  - Errors are `{ error, code, message }`. Codes: `not_password_account` (400), `email_in_use` (409), `inactive_recipient` (400), `invalid_code` (400), `code_expired` (400), `too_many_attempts` (400), `unavailable` (503), `update_failed` (502).

- [ ] **Step 1: Export the shared Auth0 client** — in `src/routes/auth0.ts`, directly under `resetManagementTokenCache`:

```ts
// ADDED 2026-10-01: routes/auth0Email.ts shares this client so both route
// files use one management-token cache.
export { management as auth0Management, getDomain as auth0Domain };
```

- [ ] **Step 2: Write the failing test** — `src/routes/auth0Email.test.ts`

```ts
/**
 * POST /auth0/email/start and /verify. The Auth0 Management client and the
 * mailer are mocked at their module boundary; the code store is the in-memory
 * one (getRedis() → null), so start and verify share real state.
 */
import express from "express";
import request from "supertest";

const mockConfig = vi.hoisted(() => ({
  rateLimit: { enabled: false, perMinute: 10, perHour: 100, maxConcurrent: 3 },
}));
vi.mock("../config/index.js", () => ({ config: mockConfig }));

const logCalls = vi.hoisted(() => [] as unknown[]);
vi.mock("../app.js", () => {
  const at = () => (fields: unknown, msg?: unknown) => {
    logCalls.push(fields, msg);
  };
  return { getLogger: () => ({ debug: at(), info: at(), warn: at(), error: at() }) };
});

const caller = vi.hoisted(() => ({ sub: "auth0|tester" }));
vi.mock("../middleware/auth.js", () => ({
  authenticateSignedIn: (req: any, _res: any, next: any) => {
    req.user = { sub: caller.sub, isAnonymous: false };
    next();
  },
}));
vi.mock("../middleware/rate-limit.js", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../services/redis.js", () => ({ getRedis: () => null }));

const mail = vi.hoisted(() => ({
  available: true,
  sent: [] as { to: string; subject: string; html: string }[],
  result: { ok: true, value: { messageId: "m", status: "OK" } } as unknown,
}));
vi.mock("../services/email.js", () => ({
  isEmailAvailable: () => mail.available,
  sendEmail: async (to: string, subject: string, html: string) => {
    mail.sent.push({ to, subject, html });
    return mail.result;
  },
}));

const auth0 = vi.hoisted(() => ({
  /** user_ids Auth0 says hold the looked-up address. */
  byEmail: [] as string[],
  current: { kind: "ok", email: "old@example.com", emailVerified: false } as unknown,
  patchStatus: 200,
  patches: [] as unknown[],
}));
vi.mock("./auth0.js", () => ({
  auth0Domain: () => "test.auth0.local",
  auth0Management: () => ({
    getManagementToken: async () => "mgmt-token",
    getUser: async () => auth0.current,
    fetchAuth0: async (what: string, _url: string, init: RequestInit) => {
      if (what === "users-by-email") {
        return new Response(JSON.stringify(auth0.byEmail.map((user_id) => ({ user_id }))), { status: 200 });
      }
      auth0.patches.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({}), { status: auth0.patchStatus });
    },
  }),
}));

import router, { resetEmailCodeStore } from "./auth0Email.js";

const app = express();
app.use(express.json());
app.use("/auth0/email", router);

const start = (email: string) => request(app).post("/auth0/email/start").send({ email });
const verify = (email: string, code: string) => request(app).post("/auth0/email/verify").send({ email, code });
const sentCode = () => mail.sent.at(-1)!.subject.match(/\d{6}/)![0];
const wrongCode = () => (sentCode() === "000000" ? "111111" : "000000");

beforeEach(() => {
  caller.sub = "auth0|tester";
  mail.available = true;
  mail.sent.length = 0;
  mail.result = { ok: true, value: { messageId: "m", status: "OK" } };
  auth0.byEmail = [];
  auth0.current = { kind: "ok", email: "old@example.com", emailVerified: false };
  auth0.patchStatus = 200;
  auth0.patches.length = 0;
  logCalls.length = 0;
  resetEmailCodeStore();
});

describe("POST /auth0/email/start", () => {
  it("emails a six-digit code to the normalized address", async () => {
    const res = await start("  New@Example.com ");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("new@example.com");
    expect(mail.sent[0].subject).toMatch(/^\d{6} is your RecoverySky verification code$/);
    expect(mail.sent[0].html).toContain(sentCode());
  });

  it("never logs the address or the code", async () => {
    await start("new@example.com");
    const logged = JSON.stringify(logCalls);
    expect(logged).not.toContain("new@example.com");
    expect(logged).not.toContain(sentCode());
    expect(logged).not.toContain("auth0|tester");
  });

  it("refuses an account that is not a password account", async () => {
    caller.sub = "google-oauth2|123";
    const res = await start("new@example.com");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_password_account");
    expect(mail.sent).toHaveLength(0);
  });

  it("refuses a malformed address", async () => {
    expect((await start("not-an-email")).status).toBe(400);
    expect(mail.sent).toHaveLength(0);
  });

  it("refuses an address another account holds, and sends nothing", async () => {
    auth0.byEmail = ["google-oauth2|someone-else"];
    const res = await start("taken@example.com");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("email_in_use");
    expect(mail.sent).toHaveLength(0);
  });

  it("allows the caller's own current address", async () => {
    auth0.byEmail = ["auth0|tester"];
    expect((await start("old@example.com")).status).toBe(200);
  });

  it("answers 503 when the mailer is not configured", async () => {
    mail.available = false;
    const res = await start("new@example.com");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("unavailable");
  });

  it("answers 503 when the send fails, and leaves no usable code", async () => {
    mail.result = { ok: false, error: { kind: "InternalError", statusCode: 500, message: "boom" } };
    const res = await start("new@example.com");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("unavailable");
    expect((await verify("new@example.com", "123456")).body.code).toBe("code_expired");
  });

  it("passes on an inactive-recipient refusal", async () => {
    mail.result = {
      ok: false,
      error: { kind: "BadRequest", statusCode: 400, message: "inactive", context: { code: "inactive_recipient" } },
    };
    const res = await start("bounced@example.com");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("inactive_recipient");
  });
});

describe("POST /auth0/email/verify", () => {
  it("changes the account's email and marks it verified", async () => {
    await start("New@Example.com");
    const res = await verify("new@example.com", sentCode());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: "new@example.com" });
    expect(auth0.patches).toEqual([
      {
        email: "new@example.com",
        email_verified: true,
        verify_email: false,
        connection: "Username-Password-Authentication",
      },
    ]);
  });

  it("only sets the flag when the address is the one already on the account", async () => {
    await start("OLD@example.com");
    const res = await verify("old@example.com", sentCode());
    expect(res.status).toBe(200);
    expect(auth0.patches).toEqual([{ email_verified: true }]);
  });

  it("answers code_expired when no code was ever sent", async () => {
    const res = await verify("new@example.com", "123456");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("code_expired");
    expect(auth0.patches).toHaveLength(0);
  });

  it("uses a code only once", async () => {
    await start("new@example.com");
    const code = sentCode();
    expect((await verify("new@example.com", code)).status).toBe(200);
    const again = await verify("new@example.com", code);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("code_expired");
    expect(auth0.patches).toHaveLength(1);
  });

  it("rejects a wrong code without touching the account", async () => {
    await start("new@example.com");
    const res = await verify("new@example.com", wrongCode());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_code");
    expect(auth0.patches).toHaveLength(0);
  });

  it("rejects the right code for a different address", async () => {
    await start("new@example.com");
    const res = await verify("other@example.com", sentCode());
    expect(res.body.code).toBe("invalid_code");
    expect(auth0.patches).toHaveLength(0);
  });

  it("kills the code on the fifth wrong try", async () => {
    await start("new@example.com");
    const code = sentCode();
    const bad = wrongCode();
    for (let i = 0; i < 4; i++) expect((await verify("new@example.com", bad)).body.code).toBe("invalid_code");
    expect((await verify("new@example.com", bad)).body.code).toBe("too_many_attempts");
    expect((await verify("new@example.com", code)).body.code).toBe("code_expired");
    expect(auth0.patches).toHaveLength(0);
  });

  it("lets a second start replace the first code", async () => {
    await start("new@example.com");
    const first = sentCode();
    await start("new@example.com");
    const second = sentCode();
    if (first !== second) expect((await verify("new@example.com", first)).body.code).toBe("invalid_code");
    expect((await verify("new@example.com", second)).status).toBe(200);
  });

  it("refuses when the address was taken between start and verify", async () => {
    await start("new@example.com");
    auth0.byEmail = ["email|someone-else"];
    const res = await verify("new@example.com", sentCode());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("email_in_use");
    expect(auth0.patches).toHaveLength(0);
  });

  it("keeps the code when Auth0 refuses the update, so a retry works", async () => {
    await start("new@example.com");
    const code = sentCode();
    auth0.patchStatus = 500;
    const failed = await verify("new@example.com", code);
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe("update_failed");
    auth0.patchStatus = 200;
    expect((await verify("new@example.com", code)).status).toBe(200);
  });

  it("rejects a code that is not six digits", async () => {
    await start("new@example.com");
    expect((await verify("new@example.com", "12345")).status).toBe(400);
    expect((await verify("new@example.com", "abcdef")).status).toBe(400);
  });
});
```

- [ ] **Step 3: Run it; expect failure**

Run: `cd /Users/jenova/projects/recoverysky-org/api && pnpm vitest run src/routes/auth0Email.test.ts`
Expected: FAIL, cannot find module `./auth0Email.js`.

- [ ] **Step 4: Implement** — `src/routes/auth0Email.ts`

```ts
/**
 * Email verification for legacy password accounts (app spec
 * docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md §6).
 *
 * A password account whose address is a typo or a dead mailbox can't be found
 * by passwordless sign-in. The signed-in owner proves a mailbox here with a
 * code WE send (not Auth0's passwordless code: that would sign the device into
 * a second account), and the account's email is set to it.
 *
 * Password accounts only: Auth0 cannot change a Google or Apple address.
 * NEVER log the address, the code, or the raw sub.
 */
import { Router, type Response } from "express";
import type { Router as IRouter } from "express";
import { z } from "zod";
import { authenticateSignedIn, type AuthenticatedRequest } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rate-limit.js";
import { getLogger } from "../app.js";
import { hashUserId } from "../services/hashUserId.js";
import { isEmailAvailable, sendEmail } from "../services/email.js";
import { getRedis } from "../services/redis.js";
import {
  CODE_TTL_MS,
  checkCode,
  codeKey,
  createMemoryCodeStore,
  createRedisCodeStore,
  generateCode,
  hashCode,
  normalizeEmail,
  type CodeStore,
} from "../services/emailVerifyCode.js";
import { auth0Domain, auth0Management } from "./auth0.js";

const router: IRouter = Router();

const PASSWORD_CONNECTION = "Username-Password-Authentication";

// A code email costs money and can be aimed at any address, so sends get a
// tight budget of their own. Verify is cheap but is the guessing surface.
const startLimiter = createRateLimiter({ name: "auth0-email-start", perMinute: 3, perHour: 10, maxConcurrent: 1 });
const verifyLimiter = createRateLimiter({ name: "auth0-email-verify", perMinute: 10, perHour: 40, maxConcurrent: 1 });

const startSchema = z.object({ email: z.string().trim().email().max(254) });
const verifySchema = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

let memoryStore: CodeStore | null = null;
/** Redis when configured (several replicas share it), otherwise in-process. */
function codeStore(): CodeStore {
  const redis = getRedis();
  if (redis) return createRedisCodeStore(redis);
  if (!memoryStore) memoryStore = createMemoryCodeStore();
  return memoryStore;
}
/** Drop the in-process store. Tests only. */
export function resetEmailCodeStore(): void {
  memoryStore = null;
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: code, code, message });
}

function codeEmailHtml(code: string): string {
  return (
    `<html><body><p>Your RecoverySky verification code is:</p>` +
    `<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>` +
    `<p>It expires in 10 minutes. If you did not ask for it, you can ignore this email.</p></body></html>`
  );
}

/** Does any OTHER Auth0 user hold this address? `null` = Auth0 could not say. */
async function heldByAnotherUser(email: string, sub: string): Promise<boolean | null> {
  const token = await auth0Management().getManagementToken();
  const res = await auth0Management().fetchAuth0(
    "users-by-email",
    `https://${auth0Domain()}/api/v2/users-by-email?email=${encodeURIComponent(email)}&fields=user_id&include_fields=true`,
    { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const users = (await res.json()) as { user_id?: string }[];
  return users.some((u) => u.user_id !== sub);
}

router.post("/start", authenticateSignedIn, startLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const logger = getLogger();
  const sub = req.user!.sub;
  const userId = hashUserId(sub);

  if (!sub.startsWith("auth0|")) {
    fail(res, 400, "not_password_account", "Only password accounts verify their email here");
    return;
  }
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid_email", "Enter a valid email address");
    return;
  }
  if (!isEmailAvailable()) {
    logger.error({ userId }, "POST /auth0/email/start: mailer not configured");
    fail(res, 503, "unavailable", "Email is not available right now");
    return;
  }
  const email = normalizeEmail(parsed.data.email);

  try {
    const taken = await heldByAnotherUser(email, sub);
    if (taken === null) {
      logger.error({ userId }, "POST /auth0/email/start: address lookup failed");
      fail(res, 503, "unavailable", "Could not check that address right now");
      return;
    }
    if (taken) {
      logger.info({ userId }, "POST /auth0/email/start: address belongs to another account");
      fail(res, 409, "email_in_use", "That email already belongs to another account");
      return;
    }

    const code = generateCode();
    const key = codeKey(sub);
    // A new start replaces any earlier code: only the latest email works.
    await codeStore().set(key, {
      email,
      hash: hashCode(sub, code),
      attempts: 0,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    const sent = await sendEmail(email, `${code} is your RecoverySky verification code`, codeEmailHtml(code));
    if (!sent.ok) {
      await codeStore().del(key);
      const reason = sent.error.context?.code as string | undefined;
      if (reason === "inactive_recipient") {
        logger.info({ userId }, "POST /auth0/email/start: provider refuses that recipient");
        fail(res, 400, "inactive_recipient", "We cannot deliver email to that address");
        return;
      }
      logger.error({ userId, kind: sent.error.kind }, "POST /auth0/email/start: send failed");
      fail(res, 503, "unavailable", "Could not send the code right now");
      return;
    }

    logger.info({ userId }, "POST /auth0/email/start: code sent");
    res.status(200).json({ sent: true });
  } catch (error) {
    logger.error(
      { userId, errorName: error instanceof Error ? error.name : typeof error },
      "POST /auth0/email/start: failed",
    );
    fail(res, 503, "unavailable", "Could not send the code right now");
  }
});

router.post("/verify", authenticateSignedIn, verifyLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const logger = getLogger();
  const sub = req.user!.sub;
  const userId = hashUserId(sub);

  if (!sub.startsWith("auth0|")) {
    fail(res, 400, "not_password_account", "Only password accounts verify their email here");
    return;
  }
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, "invalid_code", "Enter the six-digit code");
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const key = codeKey(sub);

  try {
    const check = checkCode(await codeStore().get(key), { sub, email, code: parsed.data.code, nowMs: Date.now() });
    if (check.outcome === "expired") {
      fail(res, 400, "code_expired", "That code has expired. Send a new one.");
      return;
    }
    if (check.outcome === "locked") {
      await codeStore().del(key);
      logger.warn({ userId }, "POST /auth0/email/verify: too many wrong codes");
      fail(res, 400, "too_many_attempts", "Too many wrong codes. Send a new one.");
      return;
    }
    if (check.outcome === "wrong") {
      await codeStore().set(key, check.record);
      fail(res, 400, "invalid_code", "That code is not right");
      return;
    }

    // The address could have been taken since /start.
    const taken = await heldByAnotherUser(email, sub);
    if (taken) {
      fail(res, 409, "email_in_use", "That email already belongs to another account");
      return;
    }

    // Same address → only the flag. Sending `email` unchanged is pointless and
    // gives Auth0 a reason to refuse.
    const current = await auth0Management().getUser(sub);
    const changed = !(current.kind === "ok" && current.email !== null && normalizeEmail(current.email) === email);
    const body = changed
      ? { email, email_verified: true, verify_email: false, connection: PASSWORD_CONNECTION }
      : { email_verified: true };

    const token = await auth0Management().getManagementToken();
    const patch = await auth0Management().fetchAuth0(
      "patch-user-email",
      `https://${auth0Domain()}/api/v2/users/${encodeURIComponent(sub)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!patch.ok) {
      // The code is kept: the user proved the mailbox, so a retry should not
      // cost them a second email. Auth0's error text can echo the address, so
      // only the status is logged.
      logger.error({ userId, status: patch.status }, "POST /auth0/email/verify: Auth0 refused the update");
      fail(res, 502, "update_failed", "Could not update the account right now");
      return;
    }

    await codeStore().del(key);
    logger.info({ userId, changed }, "POST /auth0/email/verify: email verified");
    res.status(200).json({ email });
  } catch (error) {
    logger.error(
      { userId, errorName: error instanceof Error ? error.name : typeof error },
      "POST /auth0/email/verify: failed",
    );
    fail(res, 503, "unavailable", "Could not verify right now");
  }
});

export default router;
```

- [ ] **Step 5: Run it; expect pass**

Run: `cd /Users/jenova/projects/recoverysky-org/api && pnpm vitest run src/routes/auth0Email.test.ts src/routes/auth0.test.ts`
Expected: PASS for both files (the second proves the new export broke nothing).

- [ ] **Step 6: Mount the router** — in `src/app.ts`, add the import next to `import auth0Router from "./routes/auth0.js";`:

```ts
import auth0EmailRouter from "./routes/auth0Email.js";
```

and directly ABOVE `app.use("/auth0", auth0Router);` (line 320):

```ts
  // ADDED 2026-10-01: before the /auth0 router so the longer prefix matches first.
  app.use("/auth0/email", auth0EmailRouter);
```

- [ ] **Step 7: Document the two paths** — in `src/openapi.ts`, next to the `'/auth0/link'` entry and in the same object shape, add `'/auth0/email/start'` (request `{ email: string }`, 200 `{ sent: true }`) and `'/auth0/email/verify'` (request `{ email: string, code: string }` with pattern `^\d{6}$`, 200 `{ email: string }`). In both, list the error codes from this task's Interfaces block with their statuses, and state "Password (`auth0|`) accounts only. Requires the user bearer."

- [ ] **Step 8: Type-check and run the whole suite**

Run: `cd /Users/jenova/projects/recoverysky-org/api && pnpm tsc --noEmit && pnpm test`
Expected: no type errors; every test passes.

- [ ] **Step 9: Try it against the dev tenant** (the local API uses the dev tenant; Postmark must be configured in `.env`)

Run `pnpm dev-log`, sign in on a dev build with the 🔑 DEV password button, then from the app's token (or after Task 6, from the screen itself) call `/auth0/email/start`. Expected in `/tmp/rs-api.log`: `POST /auth0/email/start: code sent` with a `userId` hash and no address. If the local `.env` has no Postmark token, expect a 503 `unavailable`; note that and leave the live check to Task 9.

- [ ] **Step 10: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/api && git add src/routes/auth0Email.ts src/routes/auth0Email.test.ts src/routes/auth0.ts src/app.ts src/openapi.ts && git commit -m "✨ feat(auth0): verify or change a password account's email by code

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 (app): the decisions — `emailVerifyLogic.ts`

**Files:**
- Create: `app/services/auth/emailVerifyLogic.ts`
- Test: `app/services/auth/emailVerifyLogic.test.ts`
- Modify: `app/services/auth/loginFlowLogic.ts` (`resendWaitSeconds` takes a cooldown), `app/services/auth/loginFlowLogic.test.ts`

**Interfaces:**
- Produces:
  - `MAX_SKIPS = 6`, `VERIFY_RESEND_COOLDOWN_MS = 60_000`, `WHY_VERIFY_URL`, `SUPPORT_EMAIL`
  - `interface VerifyState { count: number; lastDay: string | null; verified: boolean }`, `EMPTY_VERIFY_STATE`
  - `needsEmailVerification(input: { sub: string | undefined; emailVerifiedClaim: boolean | undefined; loginMethod: "email" | "apple" | "google" | undefined; locallyVerified: boolean }): boolean`
  - `type VerifyPrompt = { mode: "hidden" } | { mode: "skippable"; skipsLeft: number } | { mode: "mandatory" }`
  - `decideVerifyPrompt(state: VerifyState, today: string): VerifyPrompt`
  - `recordShowing(state: VerifyState, today: string): VerifyState`
  - `verifyGateBlocked(input: { isAuthenticated: boolean; isAnonymous: boolean; onboardingCompleted: boolean; offline: boolean; maintenanceMode: boolean; outageMode: boolean; timerSessionActive: boolean }): boolean`
  - `resendWaitSeconds(lastSentAt, now, cooldownMs = RESEND_COOLDOWN_MS)` (changed signature, in `loginFlowLogic.ts`)

- [ ] **Step 1: Branch**

```bash
cd /Users/jenova/projects/recoverysky-org/app && git checkout -b feat/email-verify
```

- [ ] **Step 2: Write the failing test** — `app/services/auth/emailVerifyLogic.test.ts`

```ts
import { describe, expect, it } from "vitest"

import {
  EMPTY_VERIFY_STATE,
  MAX_SKIPS,
  decideVerifyPrompt,
  needsEmailVerification,
  recordShowing,
  verifyGateBlocked,
} from "./emailVerifyLogic"

describe("needsEmailVerification", () => {
  const base = {
    sub: "auth0|abc",
    emailVerifiedClaim: false as boolean | undefined,
    loginMethod: undefined as "email" | "apple" | "google" | undefined,
    locallyVerified: false,
  }
  it("asks an unverified password account", () => {
    expect(needsEmailVerification(base)).toBe(true)
  })
  it("asks when the claim is missing altogether", () => {
    expect(needsEmailVerification({ ...base, emailVerifiedClaim: undefined })).toBe(true)
  })
  it("leaves a verified password account alone", () => {
    expect(needsEmailVerification({ ...base, emailVerifiedClaim: true })).toBe(false)
  })
  it("never asks Google, Apple or email-code accounts", () => {
    for (const sub of ["google-oauth2|1", "apple|1", "email|1", undefined]) {
      expect(needsEmailVerification({ ...base, sub })).toBe(false)
    }
  })
  it("trusts this install's own record over a stale token (Review Focus 1)", () => {
    expect(needsEmailVerification({ ...base, locallyVerified: true })).toBe(false)
  })
  it("does not ask a session started by an email code (Review Focus 2)", () => {
    expect(needsEmailVerification({ ...base, loginMethod: "email" })).toBe(false)
  })
})

describe("decideVerifyPrompt", () => {
  const state = (count: number, lastDay: string | null) => ({ ...EMPTY_VERIFY_STATE, count, lastDay })

  it("first showing is skippable with all six skips left", () => {
    expect(decideVerifyPrompt(state(0, null), "2026-10-01")).toEqual({ mode: "skippable", skipsLeft: 6 })
  })
  it("counts the skips down, one showing a day", () => {
    expect(decideVerifyPrompt(state(1, "2026-10-01"), "2026-10-02")).toEqual({ mode: "skippable", skipsLeft: 5 })
    expect(decideVerifyPrompt(state(5, "2026-10-05"), "2026-10-06")).toEqual({ mode: "skippable", skipsLeft: 1 })
  })
  it("hides for the rest of a day already shown", () => {
    expect(decideVerifyPrompt(state(1, "2026-10-01"), "2026-10-01")).toEqual({ mode: "hidden" })
    expect(decideVerifyPrompt(state(MAX_SKIPS, "2026-10-06"), "2026-10-06")).toEqual({ mode: "hidden" })
  })
  it("is mandatory on the seventh showing", () => {
    expect(decideVerifyPrompt(state(MAX_SKIPS, "2026-10-06"), "2026-10-07")).toEqual({ mode: "mandatory" })
  })
  it("stays mandatory on every later launch, even the same day", () => {
    expect(decideVerifyPrompt(state(MAX_SKIPS + 1, "2026-10-07"), "2026-10-07")).toEqual({ mode: "mandatory" })
    expect(decideVerifyPrompt(state(MAX_SKIPS + 1, "2026-10-07"), "2026-11-01")).toEqual({ mode: "mandatory" })
  })
  it("treats a clock set backwards as a new day, not as hidden forever", () => {
    expect(decideVerifyPrompt(state(1, "2026-10-09"), "2026-10-02")).toEqual({ mode: "skippable", skipsLeft: 5 })
  })
})

describe("recordShowing", () => {
  it("counts a showing and stamps the day", () => {
    expect(recordShowing(EMPTY_VERIFY_STATE, "2026-10-01")).toEqual({ count: 1, lastDay: "2026-10-01", verified: false })
  })
  it("stops counting once mandatory", () => {
    const latched = { count: MAX_SKIPS + 1, lastDay: "2026-10-07", verified: false }
    expect(recordShowing(latched, "2026-10-08")).toEqual({ ...latched, lastDay: "2026-10-08" })
  })
})

describe("verifyGateBlocked (Review Focus 5)", () => {
  const clear = {
    isAuthenticated: true,
    isAnonymous: false,
    onboardingCompleted: true,
    offline: false,
    maintenanceMode: false,
    outageMode: false,
    timerSessionActive: false,
  }
  it("is open for a signed-in user with nothing in the way", () => {
    expect(verifyGateBlocked(clear)).toBe(false)
  })
  it.each([
    ["signed out", { isAuthenticated: false }],
    ["anonymous", { isAnonymous: true }],
    ["mid-onboarding", { onboardingCompleted: false }],
    ["offline", { offline: true }],
    ["maintenance", { maintenanceMode: true }],
    ["outage", { outageMode: true }],
    ["a running timer", { timerSessionActive: true }],
  ])("is blocked when %s", (_name, over) => {
    expect(verifyGateBlocked({ ...clear, ...over })).toBe(true)
  })
})
```

Also add to `app/services/auth/loginFlowLogic.test.ts`, inside its existing `resendWaitSeconds` describe (create the describe if there is none):

```ts
  it("takes a longer cooldown when one is passed", () => {
    expect(resendWaitSeconds(1_000, 31_000)).toBe(0)
    expect(resendWaitSeconds(1_000, 31_000, 60_000)).toBe(30)
    expect(resendWaitSeconds(1_000, 61_000, 60_000)).toBe(0)
  })
```

- [ ] **Step 3: Run; expect failure**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npx vitest run app/services/auth/emailVerifyLogic.test.ts app/services/auth/loginFlowLogic.test.ts`
Expected: FAIL (module not found; the cooldown test fails with 0 instead of 30).

- [ ] **Step 4: Implement** — `app/services/auth/emailVerifyLogic.ts`

```ts
/**
 * Decisions for the legacy email verification gate (spec:
 * docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md §3–4).
 *
 * PURE MODULE — no `@/` runtime imports so vitest can load it. The I/O half is
 * emailVerifyState.ts (MMKV) and components/VerifyEmailGate.tsx.
 *
 * Why this exists: passwordless sign-in finds an account by its email. A
 * legacy password account whose address is a typo or a dead mailbox cannot be
 * found, so its owner must fix the address while still signed in.
 */

/**
 * Six skippable showings; the seventh is mandatory (decided 2026-10-01). One
 * showing a day, so a user gets a full week of use before it is required.
 */
export const MAX_SKIPS = 6
/** Our code email can be slower than Auth0's; Login keeps its own 30 s. */
export const VERIFY_RESEND_COOLDOWN_MS = 60_000
export const WHY_VERIFY_URL =
  "https://www.recoverysky.org/post/8/recoverysky-required-email-verification"
export const SUPPORT_EMAIL = "support@recoverysky.app"

/** Per install, per account. `count` = showings so far. */
export interface VerifyState {
  count: number
  /** Local calendar day (YYYY-MM-DD) of the last showing. */
  lastDay: string | null
  /** Set once the API confirmed a code. Wins over the ID token's claim. */
  verified: boolean
}

export const EMPTY_VERIFY_STATE: VerifyState = { count: 0, lastDay: null, verified: false }

/**
 * Only an unverified PASSWORD account is asked.
 *
 * - `locallyVerified` wins over the claim: a cold start can restore a cached
 *   ID token that still says unverified after the API already fixed it.
 * - A session started by an email code is never asked: entering the code
 *   proved the mailbox. The token for a linked password account still carries
 *   the password identity's unverified flag, so the claim alone would ask
 *   someone who verified seconds ago.
 * - A missing claim counts as unverified: asking once too often is cheap, and
 *   never asking a locked-out-to-be user is not.
 */
export function needsEmailVerification(input: {
  sub: string | undefined
  emailVerifiedClaim: boolean | undefined
  loginMethod: "email" | "apple" | "google" | undefined
  locallyVerified: boolean
}): boolean {
  if (!input.sub?.startsWith("auth0|")) return false
  if (input.locallyVerified) return false
  if (input.loginMethod === "email") return false
  return input.emailVerifiedClaim !== true
}

export type VerifyPrompt =
  | { mode: "hidden" }
  | { mode: "skippable"; skipsLeft: number }
  | { mode: "mandatory" }

/**
 * One showing per local day. Showings 1–MAX_SKIPS are skippable; after that it
 * is mandatory and latches (shown on every check, whatever the day).
 * `lastDay !== today` rather than `<`: a clock set backwards must not hide the
 * screen until the old date comes round again.
 */
export function decideVerifyPrompt(state: VerifyState, today: string): VerifyPrompt {
  if (state.count > MAX_SKIPS) return { mode: "mandatory" }
  if (state.lastDay === today) return { mode: "hidden" }
  if (state.count === MAX_SKIPS) return { mode: "mandatory" }
  return { mode: "skippable", skipsLeft: MAX_SKIPS - state.count }
}

/**
 * Call when the screen is displayed, not when "Not now" is tapped — killing
 * the app must not dodge the count. Capped one past MAX_SKIPS (the latch).
 */
export function recordShowing(state: VerifyState, today: string): VerifyState {
  return { ...state, count: Math.min(state.count + 1, MAX_SKIPS + 1), lastDay: today }
}

/**
 * Times the screen must not appear at all (and so must not count a day):
 * the API can't send a code offline or in maintenance, and a mandatory screen
 * with no way to pass would lock a user out of meetings. A running attendance
 * timer and onboarding are work in progress we never interrupt.
 */
export function verifyGateBlocked(input: {
  isAuthenticated: boolean
  isAnonymous: boolean
  onboardingCompleted: boolean
  offline: boolean
  maintenanceMode: boolean
  outageMode: boolean
  timerSessionActive: boolean
}): boolean {
  return (
    !input.isAuthenticated ||
    input.isAnonymous ||
    !input.onboardingCompleted ||
    input.offline ||
    input.maintenanceMode ||
    input.outageMode ||
    input.timerSessionActive
  )
}
```

In `app/services/auth/loginFlowLogic.ts`, replace `resendWaitSeconds`:

```ts
/**
 * Seconds left before Resend is allowed again; 0 means allowed now.
 * CHANGED 2026-10-01: the cooldown is a parameter (default unchanged) so the
 * verify-email screen can use 60 s without a second copy of this function.
 */
export function resendWaitSeconds(
  lastSentAt: number | null,
  now: number,
  cooldownMs: number = RESEND_COOLDOWN_MS,
): number {
  if (lastSentAt === null) return 0
  const remainingMs = lastSentAt + cooldownMs - now
  if (remainingMs <= 0) return 0
  return Math.ceil(remainingMs / 1000)
}
```

- [ ] **Step 5: Run; expect pass**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npx vitest run app/services/auth/emailVerifyLogic.test.ts app/services/auth/loginFlowLogic.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app && npx eslint --fix app/services/auth/emailVerifyLogic.ts app/services/auth/emailVerifyLogic.test.ts app/services/auth/loginFlowLogic.ts app/services/auth/loginFlowLogic.test.ts && git add app/services/auth/emailVerifyLogic.ts app/services/auth/emailVerifyLogic.test.ts app/services/auth/loginFlowLogic.ts app/services/auth/loginFlowLogic.test.ts && git commit -m "✨ feat(auth): decisions for the legacy email verification gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 (app): state — the claim, the MMKV record, the overlay lock

**Files:**
- Create: `app/services/auth/emailVerifyState.ts`, `app/utils/overlayGate.ts`
- Test: `app/utils/overlayGate.test.ts`
- Modify: `app/models/AuthenticationStore.ts`, `app/services/auth/useAuth0Wrapper.ts` (the `[user]` sync effect, just above `authStore.setTokens(`), `app/components/AnnouncementGate.tsx`

**Interfaces:**
- Consumes: `VerifyState`, `EMPTY_VERIFY_STATE` (Task 3).
- Produces:
  - `authStore.emailVerified: boolean | undefined` (persisted) and `authStore.setEmailVerified(value?: boolean)`
  - `loadVerifyState(sub: string): VerifyState`, `saveVerifyState(sub: string, state: VerifyState): void`
  - `claimOverlay(name: string): boolean`, `releaseOverlay(name: string): void`, `overlayOwner(): string | null` (MobX-observable)

- [ ] **Step 1: Write the failing test** — `app/utils/overlayGate.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest"

import { claimOverlay, overlayOwner, releaseOverlay } from "./overlayGate"

describe("overlayGate", () => {
  beforeEach(() => {
    releaseOverlay(overlayOwner() ?? "")
  })
  it("gives the overlay to the first claimer only", () => {
    expect(claimOverlay("verifyEmail")).toBe(true)
    expect(claimOverlay("announcement")).toBe(false)
    expect(overlayOwner()).toBe("verifyEmail")
  })
  it("lets the owner claim again", () => {
    claimOverlay("verifyEmail")
    expect(claimOverlay("verifyEmail")).toBe(true)
  })
  it("frees it only for the owner", () => {
    claimOverlay("verifyEmail")
    releaseOverlay("announcement")
    expect(overlayOwner()).toBe("verifyEmail")
    releaseOverlay("verifyEmail")
    expect(overlayOwner()).toBeNull()
    expect(claimOverlay("announcement")).toBe(true)
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npx vitest run app/utils/overlayGate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `app/utils/overlayGate.ts`

```ts
/**
 * One full-screen modal at a time. ADDED 2026-10-01 with VerifyEmailGate:
 * it and AnnouncementGate both check on mount and on every foreground, and
 * two React Native <Modal>s presenting together fail on iOS ("already
 * presenting"). Whoever claims first shows; the other sees `overlayOwner()`
 * change (it is MobX-observable) and checks again once it is free.
 *
 * No `@/` imports: vitest loads this.
 */
import { observable, runInAction } from "mobx"

const owner = observable.box<string | null>(null)

/** True when `name` now holds (or already held) the overlay. */
export function claimOverlay(name: string): boolean {
  const current = owner.get()
  if (current !== null && current !== name) return false
  runInAction(() => owner.set(name))
  return true
}

/** A release by anyone but the owner is ignored. */
export function releaseOverlay(name: string): void {
  if (owner.get() === name) runInAction(() => owner.set(null))
}

export function overlayOwner(): string | null {
  return owner.get()
}
```

- [ ] **Step 4: Run; expect pass**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npx vitest run app/utils/overlayGate.test.ts`
Expected: PASS.

- [ ] **Step 5: The MMKV record** — `app/services/auth/emailVerifyState.ts`

```ts
/**
 * Where the verify-email gate keeps its per-account record (spec §4): how many
 * times it has been shown, on which local day, and whether this install has
 * seen a successful verification. MMKV, so it survives restarts and is wiped
 * by Delete User Data / the DEV purge with everything else.
 *
 * The key is the HASHED sub: MMKV is not encrypted, and a raw Auth0 sub embeds
 * the identity provider's account id.
 */
import { load, save } from "@/utils/storage"
import { hashUserId } from "@/utils/logger"

import { EMPTY_VERIFY_STATE, type VerifyState } from "./emailVerifyLogic"

const keyFor = (sub: string) => `emailVerify.${hashUserId(sub)}`

export function loadVerifyState(sub: string): VerifyState {
  const stored = load<Partial<VerifyState>>(keyFor(sub))
  // Field by field: a record written by an older build may lack a field.
  return {
    count: typeof stored?.count === "number" ? stored.count : EMPTY_VERIFY_STATE.count,
    lastDay: typeof stored?.lastDay === "string" ? stored.lastDay : EMPTY_VERIFY_STATE.lastDay,
    verified: stored?.verified === true,
  }
}

export function saveVerifyState(sub: string, state: VerifyState): void {
  save(keyFor(sub), state)
}
```

If `hashUserId` is not re-exported from `@/utils/logger`, import it from `@/utils/logger/hashUserId` (check with `grep -n "hashUserId" app/utils/logger/index.ts`).

- [ ] **Step 6: The store flag** — in `app/models/AuthenticationStore.ts`:

Add to `.props({ … })`, after `previousOwnerSubs`:

```ts
    /**
     * ADDED 2026-10-01 (legacy email verification spec §3). The signed-in
     * account's `email_verified` ID-token claim, kept because the token itself
     * is volatile. Read only by VerifyEmailGate, and only for `auth0|`
     * (password) accounts. Undefined = not read yet, treated as unverified.
     */
    emailVerified: types.maybe(types.boolean),
```

Add an action after `setOwnerEmail`:

```ts
    /** See the `emailVerified` prop. Set from the ID token, or true after the API confirms a code. */
    setEmailVerified(value?: boolean) {
      log.debug("setEmailVerified()", { value })
      store.emailVerified = value
    },
```

In `logout()`, after `store.loginMethod = undefined`:

```ts
      // ADDED 2026-10-01: describes the session's account, so it goes with it.
      store.emailVerified = undefined
```

- [ ] **Step 7: Read the claim at sign-in** — in `app/services/auth/useAuth0Wrapper.ts`:

Add `decodeJwtPayload` and `type IdTokenClaims` to the existing import from `./jwtUtils`. Then, directly above the comment `// Update MST store with tokens`:

```ts
            // ADDED 2026-10-01 (legacy email verification spec §3): keep the
            // ID token's `email_verified` claim for VerifyEmailGate. Written
            // BEFORE setTokens so the gate never sees an authenticated session
            // with last session's value. Only `=== true` counts as verified.
            authStore.setEmailVerified(
              credentials.idToken
                ? decodeJwtPayload<IdTokenClaims>(credentials.idToken)?.email_verified === true
                : undefined,
            )
```

- [ ] **Step 8: Make AnnouncementGate share the overlay** — in `app/components/AnnouncementGate.tsx`:

Add the import:

```ts
import { claimOverlay, overlayOwner, releaseOverlay } from "@/utils/overlayGate"
```

In the component body, before `evaluate`:

```ts
  // ADDED 2026-10-01: one full-screen modal at a time (see overlayGate.ts).
  // Read in render so this observer re-renders, and re-checks, when the
  // verify-email gate lets go of the overlay.
  const overlay = overlayOwner()
```

In `evaluate`, replace `if (pending) setActive(pending)` with:

```ts
    if (pending && claimOverlay("announcement")) setActive(pending)
```

and add `overlay` to `evaluate`'s dependency array. In both `dismiss` and `handleCta`, add `releaseOverlay("announcement")` on the line before `setActive(null)`.

- [ ] **Step 9: Type-check, run the touched tests, lint**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npm run compile && npx vitest run app/utils/overlayGate.test.ts && npx jest app/components --forceExit && npx eslint --fix app/utils/overlayGate.ts app/utils/overlayGate.test.ts app/services/auth/emailVerifyState.ts app/models/AuthenticationStore.ts app/services/auth/useAuth0Wrapper.ts app/components/AnnouncementGate.tsx`
Expected: no type errors, tests pass, eslint silent.

- [ ] **Step 10: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app && git add app/utils/overlayGate.ts app/utils/overlayGate.test.ts app/services/auth/emailVerifyState.ts app/models/AuthenticationStore.ts app/services/auth/useAuth0Wrapper.ts app/components/AnnouncementGate.tsx && git commit -m "✨ feat(auth): keep the email_verified claim and a per-account verify record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 (app): API client methods

**Files:**
- Create: `app/services/api/emailVerifyProblem.ts`
- Test: `app/services/api/emailVerifyProblem.test.ts`
- Modify: `app/services/api/index.ts` (two methods, next to `linkIdentity`)

**Interfaces:**
- Consumes: the HTTP contract from Task 2.
- Produces:
  - `type EmailVerifyProblem = "email_in_use" | "invalid_code" | "code_expired" | "too_many_attempts" | "rate_limited" | "inactive_recipient" | "not_password_account" | "unavailable"`
  - `emailVerifyProblemFrom(status: number | undefined, bodyCode: unknown): EmailVerifyProblem`
  - `api.startEmailVerification(email: string): Promise<{ kind: "ok" } | { kind: "problem"; code: EmailVerifyProblem }>`
  - `api.confirmEmailVerification(email: string, code: string): Promise<{ kind: "ok"; email: string } | { kind: "problem"; code: EmailVerifyProblem }>`

The mapper lives under `services/api/` (not `services/auth/`) because `services/api` must stay a dependency leaf; `auth → api` already exists, so `api → auth` would be a cycle for depcruise.

- [ ] **Step 1: Write the failing test** — `app/services/api/emailVerifyProblem.test.ts`

```ts
import { describe, expect, it } from "vitest"

import { emailVerifyProblemFrom } from "./emailVerifyProblem"

describe("emailVerifyProblemFrom", () => {
  it.each([
    "email_in_use",
    "invalid_code",
    "code_expired",
    "too_many_attempts",
    "inactive_recipient",
    "not_password_account",
  ] as const)("passes the API's own code through: %s", (code) => {
    expect(emailVerifyProblemFrom(400, code)).toBe(code)
  })
  it("reads a 429 as rate_limited whatever the body says", () => {
    expect(emailVerifyProblemFrom(429, undefined)).toBe("rate_limited")
    expect(emailVerifyProblemFrom(429, "anything")).toBe("rate_limited")
  })
  it("treats an address the API's validator refuses as one we can't mail", () => {
    expect(emailVerifyProblemFrom(400, "invalid_email")).toBe("inactive_recipient")
  })
  it("falls back to unavailable for everything else", () => {
    expect(emailVerifyProblemFrom(503, "unavailable")).toBe("unavailable")
    expect(emailVerifyProblemFrom(502, "update_failed")).toBe("unavailable")
    expect(emailVerifyProblemFrom(undefined, undefined)).toBe("unavailable")
    expect(emailVerifyProblemFrom(400, { not: "a string" })).toBe("unavailable")
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npx vitest run app/services/api/emailVerifyProblem.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `app/services/api/emailVerifyProblem.ts`

```ts
/**
 * What went wrong with POST /auth0/email/start or /verify, as the verify-email
 * screen needs to know it. `getGeneralApiProblem` folds every 4xx into
 * "rejected" and drops the body, and this screen has to tell "wrong code" from
 * "address in use" — so these two calls read the API's `code` field instead.
 *
 * PURE and inside services/api/ on purpose: vitest loads it, and services/api
 * must not import from services/auth (depcruise cycle).
 */
export type EmailVerifyProblem =
  | "email_in_use"
  | "invalid_code"
  | "code_expired"
  | "too_many_attempts"
  | "rate_limited"
  | "inactive_recipient"
  | "not_password_account"
  /** Server trouble, no connection, or an answer we don't recognise: "try again". */
  | "unavailable"

const PASSED_THROUGH: readonly EmailVerifyProblem[] = [
  "email_in_use",
  "invalid_code",
  "code_expired",
  "too_many_attempts",
  "inactive_recipient",
  "not_password_account",
]

export function emailVerifyProblemFrom(
  status: number | undefined,
  bodyCode: unknown,
): EmailVerifyProblem {
  if (status === 429) return "rate_limited"
  // The app only sends addresses that pass isPlausibleEmail; one the API's
  // stricter check still refuses is, to the user, an address we can't mail.
  if (bodyCode === "invalid_email") return "inactive_recipient"
  const known = PASSED_THROUGH.find((code) => code === bodyCode)
  return known ?? "unavailable"
}
```

- [ ] **Step 4: Run; expect pass**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npx vitest run app/services/api/emailVerifyProblem.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the two methods** — in `app/services/api/index.ts`, add the import with the file's other relative imports:

```ts
import { emailVerifyProblemFrom, type EmailVerifyProblem } from "./emailVerifyProblem"
```

and directly after the `linkIdentity` method:

```ts
  /**
   * POST /auth0/email/start — email a verification code to `email` for the
   * signed-in password account (legacy email verification spec §6). The
   * address is NEVER logged.
   * ADDED 2026-10-01.
   */
  async startEmailVerification(
    email: string,
  ): Promise<{ kind: "ok" } | { kind: "problem"; code: EmailVerifyProblem }> {
    log.info("Starting email verification")
    const response = await this.recoverySkyApi.post<{ sent?: boolean; code?: unknown }>(
      "/auth0/email/start",
      { email },
    )
    if (!response.ok) {
      const code = emailVerifyProblemFrom(response.status, response.data?.code)
      log.warn("Email verification start failed", { code, status: response.status })
      return { kind: "problem", code }
    }
    return { kind: "ok" }
  }

  /**
   * POST /auth0/email/verify — on a matching code the API sets the account's
   * email and marks it verified. Returns the address as Auth0 now stores it.
   * Neither the address nor the code is logged.
   * ADDED 2026-10-01.
   */
  async confirmEmailVerification(
    email: string,
    code: string,
  ): Promise<{ kind: "ok"; email: string } | { kind: "problem"; code: EmailVerifyProblem }> {
    log.info("Confirming email verification")
    const response = await this.recoverySkyApi.post<{ email?: unknown; code?: unknown }>(
      "/auth0/email/verify",
      { email, code },
    )
    if (!response.ok) {
      const problem = emailVerifyProblemFrom(response.status, response.data?.code)
      log.warn("Email verification confirm failed", { code: problem, status: response.status })
      return { kind: "problem", code: problem }
    }
    if (typeof response.data?.email !== "string") {
      log.warn("Invalid email verification response format")
      return { kind: "problem", code: "unavailable" }
    }
    return { kind: "ok", email: response.data.email }
  }
```

- [ ] **Step 6: Type-check, dependency check, lint, commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app && npm run compile && npm run lint:deps && npx eslint --fix app/services/api/emailVerifyProblem.ts app/services/api/emailVerifyProblem.test.ts app/services/api/index.ts && git add app/services/api/emailVerifyProblem.ts app/services/api/emailVerifyProblem.test.ts app/services/api/index.ts && git commit -m "✨ feat(api): client calls for email verification

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: compile and depcruise clean before the commit.

---

### Task 6 (app): the screen — `VerifyEmailView` and its strings

**Files:**
- Create: `app/components/VerifyEmailView.tsx`
- Test: `app/components/VerifyEmailView.test.tsx`
- Modify: `app/i18n/en.ts` and the eight other locale files (`es.ts ar.ts de.ts fr.ts pt.ts ru.ts th.ts uk.ts`)

**Interfaces:**
- Consumes: `CodeStep`, `EmailStep` from `app/screens/login/LoginSteps.tsx`; `EmailVerifyProblem` (Task 5).
- Produces:

```ts
export type VerifyStep = "review" | "change" | "code"
export interface VerifyEmailViewProps {
  mode: "skippable" | "mandatory"
  /** Shown on skippable showings: 6 on the first, 1 on the sixth. */
  skipsLeft?: number
  step: VerifyStep
  /** The address on the account, in full. */
  accountEmail: string
  /** The address a code was last sent to (masked on the code step). */
  targetEmailMasked: string
  newEmail: string
  onChangeNewEmail: (value: string) => void
  code: string
  onChangeCode: (value: string) => void
  resendWaitSeconds: number
  isBusy: boolean
  problem: EmailVerifyProblem | null
  onSendToAccount: () => void
  onSendToNew: () => void
  onGoToChange: () => void
  onBackToReview: () => void
  onVerify: () => void
  onResend: () => void
  onNotNow: () => void
  onWhy: () => void
  onSupport: () => void
}
```

- [ ] **Step 1: Add the strings** — in `app/i18n/en.ts`, after the `wrongAccountScreen` block:

```ts
  // ADDED 2026-10-01 — legacy email verification (spec 2026-09-30-legacy-email-verification).
  verifyEmailScreen: {
    title: "Please review and verify your email address",
    body: "RecoverySky now signs you in with a code sent to your email. Check that this is an address you can read.",
    sendCode: "Send code",
    changeEmail: "Not my email? Change it",
    notNow: "Not now",
    requiredWarning: "Verification is required. Skips left: {{count}}",
    mandatory:
      "Email verification is now required to keep using your account. Need help? Contact support@recoverysky.app",
    contactSupport: "Contact support",
    why: "Why is verification required?",
    errorEmailInUse: "This email is already in use. Contact support@recoverysky.app.",
    errorInvalidCode: "That code isn't right. Check it and try again.",
    errorCodeExpired: "That code has expired. Send a new one.",
    errorTooManyAttempts: "Too many wrong codes. Send a new one.",
    errorRateLimited: "Too many requests. Wait a minute and try again.",
    errorInactiveRecipient: "We can't deliver email to that address. Try a different one.",
    errorNotPasswordAccount: "This account doesn't need email verification.",
    errorUnavailable: "We couldn't reach the server. Please try again.",
  },
```

Add the same `verifyEmailScreen` block, with the English text, to each of `app/i18n/es.ts`, `ar.ts`, `de.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `th.ts`, `uk.ts`, in the same position (after that file's `wrongAccountScreen` block). Then add one line to `docs/translation-review-2026-08-03.md`: "`verifyEmailScreen.*` (added 2026-10-01): English placeholders in all eight locales."

- [ ] **Step 2: Write the failing test** — `app/components/VerifyEmailView.test.tsx`

Under `test/setup.ts` the `tx` prop renders the bare key and `translate()` echoes its params, so controls are found by `testID` (the pattern in `app/screens/WrongAccountView.test.tsx`).

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native"

import { VerifyEmailView, type VerifyEmailViewProps } from "./VerifyEmailView"

type TreeNode = { type: unknown; props: Record<string, unknown> }
const txCount = (key: string) =>
  screen.UNSAFE_root.findAll((node: TreeNode) => node.props?.tx === key).length
const renderedStrings = () =>
  screen.UNSAFE_root.findAll((node: TreeNode) => typeof node.type === "string").flatMap(
    (node: TreeNode) =>
      Object.values(node.props ?? {}).filter((v): v is string => typeof v === "string"),
  )

const base: VerifyEmailViewProps = {
  mode: "skippable",
  skipsLeft: 6,
  step: "review",
  accountEmail: "typo@gmail.comf",
  targetEmailMasked: "t***@gmail.comf",
  newEmail: "",
  onChangeNewEmail: jest.fn(),
  code: "",
  onChangeCode: jest.fn(),
  resendWaitSeconds: 0,
  isBusy: false,
  problem: null,
  onSendToAccount: jest.fn(),
  onSendToNew: jest.fn(),
  onGoToChange: jest.fn(),
  onBackToReview: jest.fn(),
  onVerify: jest.fn(),
  onResend: jest.fn(),
  onNotNow: jest.fn(),
  onWhy: jest.fn(),
  onSupport: jest.fn(),
}

beforeEach(() => jest.clearAllMocks())

describe("VerifyEmailView — review step", () => {
  it("shows the heading and the account's address in full", () => {
    render(<VerifyEmailView {...base} />)
    expect(txCount("verifyEmailScreen:title")).toBe(1)
    expect(screen.getByTestId("verify-email-address").props.children).toBe("typo@gmail.comf")
  })

  it("sends a code, opens the change step, and opens the why link", () => {
    render(<VerifyEmailView {...base} />)
    fireEvent.press(screen.getByTestId("verify-email-send"))
    fireEvent.press(screen.getByTestId("verify-email-change"))
    fireEvent.press(screen.getByTestId("verify-email-why"))
    expect(base.onSendToAccount).toHaveBeenCalledTimes(1)
    expect(base.onGoToChange).toHaveBeenCalledTimes(1)
    expect(base.onWhy).toHaveBeenCalledTimes(1)
  })

  it("offers Not now with the skips left while skippable", () => {
    render(<VerifyEmailView {...base} skipsLeft={3} />)
    fireEvent.press(screen.getByTestId("verify-email-not-now"))
    expect(base.onNotNow).toHaveBeenCalledTimes(1)
    const warning = screen.UNSAFE_root.findAll(
      (node: TreeNode) => node.props?.tx === "verifyEmailScreen:requiredWarning",
    )[0]
    expect(warning.props.txOptions).toEqual({ count: 3 })
  })

  it("has no Not now on the mandatory showing, and offers support instead", () => {
    render(<VerifyEmailView {...base} mode="mandatory" skipsLeft={undefined} />)
    expect(screen.queryByTestId("verify-email-not-now")).toBeNull()
    expect(txCount("verifyEmailScreen:requiredWarning")).toBe(0)
    expect(txCount("verifyEmailScreen:mandatory")).toBe(1)
    fireEvent.press(screen.getByTestId("verify-email-support"))
    expect(base.onSupport).toHaveBeenCalledTimes(1)
  })

  it("disables the controls while busy", () => {
    render(<VerifyEmailView {...base} isBusy />)
    fireEvent.press(screen.getByTestId("verify-email-send"))
    fireEvent.press(screen.getByTestId("verify-email-not-now"))
    expect(base.onSendToAccount).not.toHaveBeenCalled()
    expect(base.onNotNow).not.toHaveBeenCalled()
  })
})

describe("VerifyEmailView — other steps", () => {
  it("change step shows the email field, not the account address", () => {
    render(<VerifyEmailView {...base} step="change" newEmail="right@gmail.com" />)
    expect(screen.getByTestId("login-email-field")).toBeTruthy()
    expect(screen.queryByTestId("verify-email-address")).toBeNull()
  })

  it("code step shows the code field and keeps the why link", () => {
    render(<VerifyEmailView {...base} step="code" />)
    expect(screen.getByTestId("login-code-field")).toBeTruthy()
    expect(screen.getByTestId("verify-email-why")).toBeTruthy()
    // The full address is not repeated on the code step: only the masked one.
    expect(renderedStrings().join(" ")).not.toContain("typo@gmail.comf")
  })
})

describe("VerifyEmailView — problems", () => {
  it.each([
    ["email_in_use", "verifyEmailScreen:errorEmailInUse"],
    ["invalid_code", "verifyEmailScreen:errorInvalidCode"],
    ["code_expired", "verifyEmailScreen:errorCodeExpired"],
    ["too_many_attempts", "verifyEmailScreen:errorTooManyAttempts"],
    ["rate_limited", "verifyEmailScreen:errorRateLimited"],
    ["inactive_recipient", "verifyEmailScreen:errorInactiveRecipient"],
    ["not_password_account", "verifyEmailScreen:errorNotPasswordAccount"],
    ["unavailable", "verifyEmailScreen:errorUnavailable"],
  ] as const)("shows the %s message as an alert", (problem, key) => {
    render(<VerifyEmailView {...base} problem={problem} />)
    expect(txCount(key)).toBe(1)
    expect(screen.getByTestId("verify-email-error").props.accessibilityRole).toBe("alert")
  })

  it("shows no alert when there is no problem", () => {
    render(<VerifyEmailView {...base} />)
    expect(screen.queryByTestId("verify-email-error")).toBeNull()
  })
})
```

Before running, confirm the two reused testIDs: `grep -n 'testID="login-email-field"\|testID="login-code-field"' app/screens/login/LoginSteps.tsx`. If the code field's testID differs, use the one that file has.

- [ ] **Step 3: Run; expect failure**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npx jest app/components/VerifyEmailView.test.tsx --forceExit`
Expected: FAIL, cannot find module `./VerifyEmailView`.

- [ ] **Step 4: Implement** — `app/components/VerifyEmailView.tsx`

```tsx
/**
 * The presentational half of VerifyEmailGate (legacy email verification spec
 * §5). Every decision arrives as a prop and every action leaves as a
 * callback, so jest mounts it bare — no stores, no API, no Modal.
 *
 * Three steps: review the address on the account → (optionally) change it →
 * enter the code. The change and code steps reuse the login steps so the two
 * flows look and behave the same.
 *
 * The account address is shown IN FULL on the review step, unlike everywhere
 * else in the app: the whole point is for its owner to eyeball it for typos,
 * on their own device.
 */
import { Pressable, View, type TextStyle, type ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import type { TxKeyPath } from "@/i18n"
import { CodeStep, EmailStep } from "@/screens/login/LoginSteps"
import type { EmailVerifyProblem } from "@/services/api/emailVerifyProblem"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export type VerifyStep = "review" | "change" | "code"

export interface VerifyEmailViewProps {
  mode: "skippable" | "mandatory"
  /** Shown on skippable showings: 6 on the first, 1 on the sixth. */
  skipsLeft?: number
  step: VerifyStep
  /** The address on the account, in full. */
  accountEmail: string
  /** The address a code was last sent to (masked on the code step). */
  targetEmailMasked: string
  newEmail: string
  onChangeNewEmail: (value: string) => void
  code: string
  onChangeCode: (value: string) => void
  resendWaitSeconds: number
  isBusy: boolean
  problem: EmailVerifyProblem | null
  onSendToAccount: () => void
  onSendToNew: () => void
  onGoToChange: () => void
  onBackToReview: () => void
  onVerify: () => void
  onResend: () => void
  onNotNow: () => void
  onWhy: () => void
  onSupport: () => void
}

const PROBLEM_TX: Record<EmailVerifyProblem, TxKeyPath> = {
  email_in_use: "verifyEmailScreen:errorEmailInUse",
  invalid_code: "verifyEmailScreen:errorInvalidCode",
  code_expired: "verifyEmailScreen:errorCodeExpired",
  too_many_attempts: "verifyEmailScreen:errorTooManyAttempts",
  rate_limited: "verifyEmailScreen:errorRateLimited",
  inactive_recipient: "verifyEmailScreen:errorInactiveRecipient",
  not_password_account: "verifyEmailScreen:errorNotPasswordAccount",
  unavailable: "verifyEmailScreen:errorUnavailable",
}

export function VerifyEmailView(props: VerifyEmailViewProps) {
  const { themed } = useAppTheme()
  const { mode, step, isBusy, problem } = props

  return (
    <View style={themed($container)}>
      <Text
        testID="verify-email-title"
        accessibilityRole="header"
        preset="heading"
        style={themed($title)}
        tx="verifyEmailScreen:title"
      />

      {/* The only error surface. Live-region for the same reason as Login's
          strip: it appears with no focus change, so a screen-reader user would
          otherwise never learn the code was refused. */}
      {problem && (
        <View
          testID="verify-email-error"
          style={themed($errorBox)}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={themed($errorText)} tx={PROBLEM_TX[problem]} />
        </View>
      )}

      {step === "review" && (
        <View style={themed($controls)}>
          <Text style={themed($body)} tx="verifyEmailScreen:body" />
          <Text testID="verify-email-address" style={themed($address)} selectable>
            {props.accountEmail}
          </Text>
          <Pressable
            testID="verify-email-send"
            accessibilityRole="button"
            accessibilityLabel={translate("verifyEmailScreen:sendCode")}
            accessibilityState={{ disabled: isBusy }}
            style={[themed($button), isBusy && themed($disabled)]}
            onPress={props.onSendToAccount}
            disabled={isBusy}
          >
            <Text style={themed($buttonText)} tx="verifyEmailScreen:sendCode" />
          </Pressable>
          <Pressable
            testID="verify-email-change"
            accessibilityRole="link"
            accessibilityLabel={translate("verifyEmailScreen:changeEmail")}
            onPress={props.onGoToChange}
            disabled={isBusy}
          >
            <Text style={themed($link)} tx="verifyEmailScreen:changeEmail" />
          </Pressable>
        </View>
      )}

      {step === "change" && (
        <EmailStep
          email={props.newEmail}
          onChangeEmail={props.onChangeNewEmail}
          isSending={isBusy}
          onSend={props.onSendToNew}
          onBack={props.onBackToReview}
        />
      )}

      {step === "code" && (
        <CodeStep
          emailMasked={props.targetEmailMasked}
          code={props.code}
          onChangeCode={props.onChangeCode}
          isVerifying={isBusy}
          onVerify={props.onVerify}
          resendWaitSeconds={props.resendWaitSeconds}
          onResend={props.onResend}
          // "Wrong email?" here means: go and type a different one.
          onWrongEmail={props.onGoToChange}
        />
      )}

      <View style={themed($footer)}>
        <Pressable
          testID="verify-email-why"
          accessibilityRole="link"
          accessibilityLabel={translate("verifyEmailScreen:why")}
          onPress={props.onWhy}
        >
          <Text style={themed($link)} tx="verifyEmailScreen:why" />
        </Pressable>

        {mode === "skippable" ? (
          <>
            <Text
              style={themed($note)}
              tx="verifyEmailScreen:requiredWarning"
              txOptions={{ count: props.skipsLeft ?? 0 }}
            />
            <Pressable
              testID="verify-email-not-now"
              accessibilityRole="button"
              accessibilityLabel={translate("verifyEmailScreen:notNow")}
              accessibilityState={{ disabled: isBusy }}
              onPress={props.onNotNow}
              disabled={isBusy}
            >
              <Text style={themed($notNow)} tx="verifyEmailScreen:notNow" />
            </Pressable>
          </>
        ) : (
          <>
            <Text style={themed($note)} tx="verifyEmailScreen:mandatory" />
            <Pressable
              testID="verify-email-support"
              accessibilityRole="link"
              accessibilityLabel={translate("verifyEmailScreen:contactSupport")}
              onPress={props.onSupport}
            >
              <Text style={themed($link)} tx="verifyEmailScreen:contactSupport" />
            </Pressable>
          </>
        )}
      </View>
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  justifyContent: "center",
  gap: spacing.lg,
})

const $title: ThemedStyle<TextStyle> = () => ({ textAlign: "center" })

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ textAlign: "center", color: colors.textDim })

const $address: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.text,
  fontSize: 20,
  fontWeight: "600",
})

const $controls: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.md })

const $footer: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.sm, alignItems: "center" })

const $note: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
  fontSize: 13,
})

const $link: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.tint,
  fontSize: 15,
  fontWeight: "600",
})

const $notNow: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
  fontSize: 16,
  fontWeight: "600",
})

const $errorBox: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  padding: spacing.md,
  backgroundColor: colors.errorBackground,
  borderRadius: 8,
})

const $errorText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.error, textAlign: "center" })

// The same outline-with-glow shape WrongAccountView and LoginSteps use.
const $button: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.background,
  borderWidth: 1.5,
  borderColor: colors.tint,
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.5,
  shadowRadius: 8,
  elevation: 8,
})

const $disabled: ThemedStyle<ViewStyle> = () => ({ opacity: 0.7 })

const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.tint,
})
```

If `TxKeyPath` is not exported from `@/i18n`, find it with `grep -rn "export type TxKeyPath" app/i18n` and import from that module.

- [ ] **Step 5: Run; expect pass**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npx jest app/components/VerifyEmailView.test.tsx --forceExit && npm run compile`
Expected: PASS; compile clean (a missing key in any of the nine locale files is a `tsc` error here).

- [ ] **Step 6: Lint and commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app && npx eslint --fix app/components/VerifyEmailView.tsx app/components/VerifyEmailView.test.tsx app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts && git add app/components/VerifyEmailView.tsx app/components/VerifyEmailView.test.tsx app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts docs/translation-review-2026-08-03.md && git commit -m "✨ feat(auth): the verify-email screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 (app): the gate — `VerifyEmailGate`

**Files:**
- Create: `app/components/VerifyEmailGate.tsx`
- Modify: `app/app.tsx` (mount it directly ABOVE `<AnnouncementGate />`, line 1296)

**Interfaces:**
- Consumes: Task 3 (`needsEmailVerification`, `decideVerifyPrompt`, `recordShowing`, `verifyGateBlocked`, `VERIFY_RESEND_COOLDOWN_MS`, `WHY_VERIFY_URL`, `SUPPORT_EMAIL`), Task 4 (`loadVerifyState`, `saveVerifyState`, `claimOverlay`, `releaseOverlay`, `overlayOwner`, `authStore.emailVerified`, `setEmailVerified`), Task 5 (`api.startEmailVerification`, `api.confirmEmailVerification`), Task 6 (`VerifyEmailView`), plus `maskEmail`, `resendWaitSeconds` (`loginFlowLogic.ts`), `todayLocalISODate` (`@/utils/localDate`), `isTimerSessionActive` (`@/services/attendance/timerSession`), `setUserEmail` (`@/services/purchases/revenueCatService`).
- Produces: `export const VerifyEmailGate: FC` (no props).

This file has no automated test (it imports `@/`, the MST tree and `Modal`); every decision it makes is in a tested pure function, and Task 9 verifies it by hand.

- [ ] **Step 1: Implement** — `app/components/VerifyEmailGate.tsx`

```tsx
/**
 * VerifyEmailGate (legacy email verification spec §3–5)
 *
 * A full-screen modal asking an unverified legacy PASSWORD account to confirm
 * or correct its email, so passwordless sign-in can find the account later.
 * Built like AnnouncementGate: it checks on mount and on every foreground,
 * and additionally whenever the things it depends on change (a sign-in, the
 * end of onboarding, coming back online, a timer ending, the other gate
 * letting go of the overlay).
 *
 * A Modal, NOT a navigator state: it can appear mid-session (the user comes
 * back to the app a day later), and swapping the navigator would unmount
 * whatever they had open. Nothing underneath is touched.
 *
 * This shell only does I/O. Who is asked, when, and how often are pure
 * functions in services/auth/emailVerifyLogic.ts (vitest-covered).
 */
import { FC, useCallback, useEffect, useState } from "react"
import { AppState, Linking, Modal, View, type ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  useAuthenticationStore,
  useConfigStore,
  useNetworkStore,
  useProfileStore,
} from "@/models"
import { api } from "@/services/api"
import type { EmailVerifyProblem } from "@/services/api/emailVerifyProblem"
import { isTimerSessionActive } from "@/services/attendance/timerSession"
import {
  SUPPORT_EMAIL,
  VERIFY_RESEND_COOLDOWN_MS,
  WHY_VERIFY_URL,
  decideVerifyPrompt,
  needsEmailVerification,
  recordShowing,
  verifyGateBlocked,
} from "@/services/auth/emailVerifyLogic"
import { loadVerifyState, saveVerifyState } from "@/services/auth/emailVerifyState"
import { maskEmail, resendWaitSeconds } from "@/services/auth/loginFlowLogic"
import { setUserEmail } from "@/services/purchases/revenueCatService"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { todayLocalISODate } from "@/utils/localDate"
import { logger } from "@/utils/logger"
import { claimOverlay, overlayOwner, releaseOverlay } from "@/utils/overlayGate"

import { VerifyEmailView, type VerifyStep } from "./VerifyEmailView"

const log = logger.child({ module: "VerifyEmailGate" })
const OVERLAY = "verifyEmail"
const SIX_DIGITS = /^\d{6}$/

type Shown = { mode: "skippable"; skipsLeft: number } | { mode: "mandatory" }

export const VerifyEmailGate: FC = observer(function VerifyEmailGate() {
  const authStore = useAuthenticationStore()
  const profileStore = useProfileStore()
  const configStore = useConfigStore()
  const networkStore = useNetworkStore()
  const { themed } = useAppTheme()

  const [shown, setShown] = useState<Shown | null>(null)
  const [step, setStep] = useState<VerifyStep>("review")
  const [newEmail, setNewEmail] = useState("")
  const [target, setTarget] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<EmailVerifyProblem | null>(null)
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Everything observable is read HERE, in render, so this observer re-renders
  // — and `evaluate` below gets a new identity and runs again — when any of it
  // changes. That is what makes the gate appear right after a password
  // sign-in, at the end of onboarding, or when the device comes back online.
  const sub = authStore.isAnonymous ? undefined : authStore.userId
  const accountEmail = authStore.authEmail
  const claim = authStore.emailVerified
  const loginMethod = authStore.loginMethod
  const blocked = verifyGateBlocked({
    isAuthenticated: authStore.isAuthenticated,
    isAnonymous: authStore.isAnonymous,
    onboardingCompleted: profileStore.onboardingCompleted,
    offline: networkStore.isOffline,
    maintenanceMode: configStore.maintenanceMode,
    outageMode: configStore.outageMode,
    timerSessionActive: isTimerSessionActive(),
  })
  const overlay = overlayOwner()

  const evaluate = useCallback(() => {
    if (shown) return
    if (!sub || blocked) return
    const state = loadVerifyState(sub)
    if (
      !needsEmailVerification({
        sub,
        emailVerifiedClaim: claim,
        loginMethod,
        locallyVerified: state.verified,
      })
    ) {
      return
    }
    const today = todayLocalISODate()
    const prompt = decideVerifyPrompt(state, today)
    if (prompt.mode === "hidden") return
    // An announcement is up: wait. `overlay` in the deps re-runs this when it closes.
    if (!claimOverlay(OVERLAY)) return
    // Counted when DISPLAYED, not when "Not now" is tapped (spec §4).
    const next = recordShowing(state, today)
    saveVerifyState(sub, next)
    log.info("Verify email shown", { mode: prompt.mode, showing: next.count })
    trackEvent("verify_email_shown", { mode: prompt.mode })
    setStep("review")
    setProblem(null)
    setCode("")
    setNewEmail("")
    setShown(prompt)
    // `overlay` is listed only so a release by the other gate re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sub, blocked, claim, loginMethod, overlay])

  useEffect(() => {
    evaluate()
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") evaluate()
    })
    return () => subscription.remove()
  }, [evaluate])

  // The account signed out (or was switched) underneath the modal: close it.
  useEffect(() => {
    if (shown && !sub) {
      releaseOverlay(OVERLAY)
      setShown(null)
    }
  }, [shown, sub])

  // One-second tick for the Resend countdown, only on the code step (the same
  // rule as LoginScreen: no re-render per second for nothing).
  useEffect(() => {
    if (!shown || step !== "code") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [shown, step])

  const close = useCallback(() => {
    releaseOverlay(OVERLAY)
    setShown(null)
  }, [])

  const send = useCallback(async (email: string) => {
    setBusy(true)
    setProblem(null)
    const result = await api.startEmailVerification(email)
    setBusy(false)
    if (result.kind === "problem") {
      setProblem(result.code)
      // Re-arm the cooldown on a refusal, as WrongAccountScreen does: a hot
      // Resend link would only feed the rate limiter.
      if (result.code === "rate_limited") {
        setLastSentAt(Date.now())
        setNow(Date.now())
      }
      return
    }
    setTarget(email)
    setCode("")
    setLastSentAt(Date.now())
    setNow(Date.now())
    setStep("code")
  }, [])

  const verify = useCallback(async () => {
    if (!sub || busy || !SIX_DIGITS.test(code)) return
    setBusy(true)
    setProblem(null)
    const result = await api.confirmEmailVerification(target, code)
    setBusy(false)
    if (result.kind === "problem") {
      setProblem(result.code)
      setCode("")
      // The code is dead: back to where a new one can be sent.
      if (result.code === "code_expired" || result.code === "too_many_attempts") setStep("review")
      if (result.code === "email_in_use") setStep("change")
      return
    }
    const changed = result.email.trim().toLowerCase() !== accountEmail.trim().toLowerCase()
    // The local record first: it is what stops a stale cached ID token from
    // asking again on the next cold start.
    saveVerifyState(sub, { ...loadVerifyState(sub), verified: true })
    authStore.setEmailVerified(true)
    authStore.setAuthEmail(result.email)
    // The Login screen's "Send code to …" must offer the address that works.
    if (authStore.ownerSub === sub) authStore.setOwnerEmail(result.email)
    // RevenueCat's $email, so support finds the customer by the new address.
    void setUserEmail(result.email)
    // Never the address.
    log.info("Email verified", { changed })
    trackEvent("verify_email_done", { changed })
    close()
  }, [sub, busy, code, target, accountEmail, authStore, close])

  // Auto-submit on six digits, as on Login. Keyed on `code` alone: `verify`
  // changes identity with every keystroke.
  useEffect(() => {
    if (shown && step === "code" && SIX_DIGITS.test(code) && !busy) void verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const handleNotNow = useCallback(() => {
    trackEvent("verify_email_skipped")
    close()
  }, [close])

  if (!shown) return null

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      // Android back: "Not now" while skippable, nothing once mandatory.
      onRequestClose={shown.mode === "skippable" ? handleNotNow : () => undefined}
    >
      <SafeAreaView style={themed($screen)} accessibilityViewIsModal>
        <View style={themed($inner)}>
          <VerifyEmailView
            mode={shown.mode}
            skipsLeft={shown.mode === "skippable" ? shown.skipsLeft : undefined}
            step={step}
            accountEmail={accountEmail}
            targetEmailMasked={maskEmail(target)}
            newEmail={newEmail}
            onChangeNewEmail={setNewEmail}
            code={code}
            onChangeCode={setCode}
            resendWaitSeconds={resendWaitSeconds(lastSentAt, now, VERIFY_RESEND_COOLDOWN_MS)}
            isBusy={busy}
            problem={problem}
            onSendToAccount={() => void send(accountEmail)}
            onSendToNew={() => void send(newEmail.trim())}
            onGoToChange={() => {
              setProblem(null)
              setStep("change")
            }}
            onBackToReview={() => {
              setProblem(null)
              setStep("review")
            }}
            onVerify={() => void verify()}
            onResend={() => void send(target)}
            onNotNow={handleNotNow}
            onWhy={() => void Linking.openURL(WHY_VERIFY_URL)}
            onSupport={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          />
        </View>
      </SafeAreaView>
    </Modal>
  )
})

const $screen: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flex: 1,
  backgroundColor: colors.background,
})

const $inner: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingVertical: spacing.xxl,
  paddingHorizontal: spacing.lg,
})
```

Check two names before compiling: `grep -n "useNetworkStore" app/models/index.ts` (CLAUDE.md shows it exported from `@/models`), and `grep -n "export function trackEvent" -r app/services/tracking`.

- [ ] **Step 2: Mount it** — in `app/app.tsx`, add the import next to `AnnouncementGate`'s:

```ts
import { VerifyEmailGate } from "./components/VerifyEmailGate"
```

and directly ABOVE `<AnnouncementGate />`:

```tsx
                      {/* ADDED 2026-10-01: before AnnouncementGate so its
                          mount effect runs first and takes the overlay when
                          both are due (see utils/overlayGate.ts). */}
                      <VerifyEmailGate />
```

- [ ] **Step 3: Type-check, dependency check, lint**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npm run compile && npm run lint:deps && npx eslint --fix app/components/VerifyEmailGate.tsx app/app.tsx`
Expected: all clean.

- [ ] **Step 4: See it on a device** (dev build, local API running, dev tenant)

1. On Login tap 🔑 **DEV: Sign in with password** and sign up with a throwaway address.
2. After onboarding, the verify screen appears with "Skips left: 6".
3. Tap **Not now**; background and foreground the app: it does not come back today.
4. In the Metro log: `Verify email shown {"mode":"skippable","showing":1}` and no address anywhere.

- [ ] **Step 5: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app && git add app/components/VerifyEmailGate.tsx app/app.tsx && git commit -m "✨ feat(auth): ask unverified password accounts to verify their email

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 (app): password sign-in for the locked out

**Files:**
- Modify: `app/services/auth/useAuth0Wrapper.ts` (rename the constant, rewrite its comment), `app/screens/LoginScreen.tsx` (the link), `app/screens/WrongAccountView.tsx` + `app/screens/WrongAccountView.test.tsx` (the link), `app/screens/WrongAccountScreen.tsx` (wire it), `app/services/auth/ownerLogic.ts` + `ownerLogic.test.ts` (`ownerHasPassword`), the nine locale files

**Interfaces:**
- Produces: `PASSWORD_CONNECTION` (replaces `DEV_PASSWORD_CONNECTION`), `ownerHasPassword(sub: string | undefined): boolean`, `WrongAccountViewProps.onPassword?: () => void`.

- [ ] **Step 1: Failing tests**

Append to `app/services/auth/ownerLogic.test.ts` (and add `ownerHasPassword` to its import from `./ownerLogic`):

```ts
describe("ownerHasPassword (ADDED 2026-10-01)", () => {
  it("is true only for a legacy password account", () => {
    expect(ownerHasPassword("auth0|abc")).toBe(true)
    for (const sub of ["email|abc", "google-oauth2|1", "apple|1", "weird|1", undefined]) {
      expect(ownerHasPassword(sub)).toBe(false)
    }
  })
})
```

Append to `app/screens/WrongAccountView.test.tsx`:

```tsx
describe("WrongAccountView — password link (ADDED 2026-10-01)", () => {
  it("shows the password link for a code owner when a handler is given", () => {
    const onPassword = jest.fn()
    render(
      <WrongAccountView
        {...base}
        proofMethod="code"
        ownerEmailMasked="j***@proton.me"
        onPassword={onPassword}
      />,
    )
    fireEvent.press(screen.getByTestId("wrong-account-password"))
    expect(onPassword).toHaveBeenCalledTimes(1)
  })
  it("has no password link without a handler, or for a social owner", () => {
    render(<WrongAccountView {...base} proofMethod="code" ownerEmailMasked="j***@proton.me" />)
    expect(screen.queryByTestId("wrong-account-password")).toBeNull()
    render(<WrongAccountView {...base} proofMethod="google" onPassword={jest.fn()} />)
    expect(screen.queryByTestId("wrong-account-password")).toBeNull()
  })
})
```

- [ ] **Step 2: Run; expect failure**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npx vitest run app/services/auth/ownerLogic.test.ts; npx jest app/screens/WrongAccountView.test.tsx --forceExit`
Expected: both FAIL (`ownerHasPassword` is not exported; no element with testID `wrong-account-password`).

- [ ] **Step 3: `ownerHasPassword`** — append to `app/services/auth/ownerLogic.ts`:

```ts
/**
 * ADDED 2026-10-01 (legacy email verification spec §7). True for a legacy
 * password account. Such an owner may be unable to receive a code (a typo'd
 * or dead address on the account), so the wrong-account screen also offers
 * the password form. An `email|` owner has no password to offer.
 */
export function ownerHasPassword(sub: string | undefined): boolean {
  return !!sub?.startsWith("auth0|")
}
```

- [ ] **Step 4: Rename the constant** — in `app/services/auth/useAuth0Wrapper.ts` replace the comment block above `DEV_PASSWORD_CONNECTION` and the constant with:

```ts
/**
 * Universal Login's password form for legacy `auth0|` accounts.
 *
 * ADDED 2026-09-30 as a DEV-only button for testing the "Link passwordless
 * identity" Action.
 * CHANGED 2026-10-01 (legacy email verification spec §7): now offered to
 * everyone as a small link on Login and on the wrong-account screen. A
 * password account whose email is a typo or a dead mailbox can never receive
 * a code, so the password is the only proof its owner has left. Once in, an
 * unverified account is taken to VerifyEmailGate to fix the address.
 */
export const PASSWORD_CONNECTION = "Username-Password-Authentication"
```

Then rename every other `DEV_PASSWORD_CONNECTION` in the repo to `PASSWORD_CONNECTION` (`grep -rn "DEV_PASSWORD_CONNECTION" app` lists them: `BrowserConnection`, `METHOD_FOR_CONNECTION`, the `loginWithProvider` doc comment, and `LoginScreen.tsx`). In the `METHOD_FOR_CONNECTION` comment, change "for a dev button" to "for the legacy password form". In the `loginWithProvider` doc comment, change "(DEV_PASSWORD_CONNECTION shows its password form; dev builds only.)" to "(PASSWORD_CONNECTION shows the legacy password form.)".

- [ ] **Step 5: Strings** — in `app/i18n/en.ts` add to `loginScreen`:

```ts
    // ADDED 2026-10-01 — legacy password accounts that cannot receive a code.
    passwordSignIn: "Can't get a code? Sign in with your password",
    passwordSignInHint: "Opens the password sign-in page in a browser",
```

and to `wrongAccountScreen`:

```ts
    passwordSignIn: "Sign in with your password instead",
```

Add the same three keys, with the English text, to `es.ts ar.ts de.ts fr.ts pt.ts ru.ts th.ts uk.ts`.

- [ ] **Step 6: The Login link** — in `app/screens/LoginScreen.tsx`:

Rename `handleDevPassword` to `handlePassword`, and replace its comment with:

```ts
  // Legacy password sign-in (spec 2026-09-30-legacy-email-verification §7).
  // Through `gated` like every other entry point, so the legal gate still applies.
```

Replace the whole `{__DEV__ && ( … 🔑 DEV: Sign in with password … )}` block (and its comment) with:

```tsx
      {/* CHANGED 2026-10-01: was a DEV-only button. A legacy password account
          whose email is wrong can't get a code, so every build now offers the
          password form — small, below the real options, because it is a
          rescue path and not a fourth way to sign up. */}
      <Pressable
        testID="login-password"
        accessibilityRole="link"
        accessibilityLabel={translate("loginScreen:passwordSignIn")}
        accessibilityHint={translate("loginScreen:passwordSignInHint")}
        onPress={handlePassword}
        disabled={isLoading}
        style={themed($passwordLink)}
      >
        <Text style={themed($passwordLinkText)} tx="loginScreen:passwordSignIn" />
      </Pressable>
```

Add the styles next to `$devPurgeButton`:

```ts
const $passwordLink: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignSelf: "center",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
})

const $passwordLinkText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 14,
  textDecorationLine: "underline",
})
```

If `translate` is not already imported in `LoginScreen.tsx`, add `import { translate } from "@/i18n"`.

- [ ] **Step 7: The wrong-account link** — in `app/screens/WrongAccountView.tsx`:

Add to `WrongAccountViewProps`:

```ts
  /**
   * ADDED 2026-10-01: given only when the owner is a legacy password account
   * (ownerHasPassword). Such an owner may be unable to receive the code.
   */
  onPassword?: () => void
```

Inside the `<> … </>` branch, directly after the `{emailMasked && ( … send-code … )}` block:

```tsx
            {showCode && props.onPassword && (
              <Pressable
                testID="wrong-account-password"
                accessibilityRole="link"
                accessibilityLabel={translate("wrongAccountScreen:passwordSignIn")}
                accessibilityState={{ disabled: isBusy }}
                onPress={props.onPassword}
                disabled={isBusy}
              >
                <Text style={themed($cancelText)} tx="wrongAccountScreen:passwordSignIn" />
              </Pressable>
            )}
```

In `app/screens/WrongAccountScreen.tsx`: change the `ownerLogic` import to `import { ownerHasPassword, ownerProofMethod } from "@/services/auth/ownerLogic"`, import `PASSWORD_CONNECTION` alongside `useAuth0Wrapper`, add after `handleProvider`:

```ts
  // ADDED 2026-10-01 (legacy email verification spec §7): a password owner
  // whose address is wrong can't receive the code above. Same cookie-trap rule
  // as handleProvider.
  const handlePassword = useCallback(() => {
    clearError()
    void loginWithProvider(PASSWORD_CONNECTION, {
      loginHint: ownerEmail,
      clearBrowserSessionFirst: foreignMethod !== "email",
    })
  }, [ownerEmail, foreignMethod, loginWithProvider, clearError])
```

and pass it to the view:

```tsx
          onPassword={ownerHasPassword(authStore.ownerSub) ? handlePassword : undefined}
```

- [ ] **Step 8: Run; expect pass**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npm run compile && npx vitest run app/services/auth/ownerLogic.test.ts && npx jest app/screens --forceExit`
Expected: PASS; compile clean.

- [ ] **Step 9: Lint and commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app && npx eslint --fix app/services/auth/useAuth0Wrapper.ts app/services/auth/ownerLogic.ts app/services/auth/ownerLogic.test.ts app/screens/LoginScreen.tsx app/screens/WrongAccountView.tsx app/screens/WrongAccountView.test.tsx app/screens/WrongAccountScreen.tsx app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts && git add app/services/auth/useAuth0Wrapper.ts app/services/auth/ownerLogic.ts app/services/auth/ownerLogic.test.ts app/screens/LoginScreen.tsx app/screens/WrongAccountView.tsx app/screens/WrongAccountView.test.tsx app/screens/WrongAccountScreen.tsx app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts && git commit -m "✨ feat(auth): password sign-in link for accounts that cannot get a code

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 (app): docs, full run, manual check

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`, `docs/AUTH_LINKING_TESTS.md`, `docs/PROD_AUTH0_ROLLOUT.md`

- [ ] **Step 1: CHANGELOG** — under `## [Unreleased]` → `### Added`:

```markdown
- **Legacy password accounts are asked to verify their email.** Passwordless
  sign-in finds an account by its address, so a password account with a typo'd
  or dead address could never be reached again after a sign-out. An unverified
  password account now sees "Please review and verify your email address" at
  app start and on returning to the app: confirm the address with a code, or
  change it to one that works. It can be skipped six times, once a day (the
  screen shows the skips left), so it becomes required on the seventh day of use. Login and the wrong-account screen
  also gain "Sign in with your password" for people already locked out.
  **Needs the API's `/auth0/email/start` and `/verify` deployed first.**
```

- [ ] **Step 2: CLAUDE.md** — in "Auth, Attestation & Encryption Keys" §1, after the `relinked` paragraph, add:

```markdown
   ADDED 2026-10-01 (spec `2026-09-30-legacy-email-verification-design.md`):
   `VerifyEmailGate` (a modal beside `AnnouncementGate` in `app.tsx`, sharing
   `utils/overlayGate.ts` so the two never present together) asks a signed-in
   `auth0|` account whose `email_verified` claim is false to confirm or change
   its email with a code the API sends (`POST /auth0/email/start` / `/verify`).
   Six skippable showings, one per local day, then mandatory (day seven). It is hidden,
   and not counted, offline, in maintenance, during onboarding and while an
   attendance timer runs. A session started by an email code is never asked,
   and this install's own "verified" record (MMKV `emailVerify.<hash>`) wins
   over the claim, because a cold start can restore a stale ID token.
   Decisions: `emailVerifyLogic.ts` (vitest). The password form
   (`PASSWORD_CONNECTION`) is no longer dev-only: Login and the wrong-account
   screen link to it for accounts that cannot receive a code.
```

Also in CLAUDE.md, the `loginMethod` line that says the DEV button is dev-only (search "DEV password") must be corrected if present: `grep -n "DEV_PASSWORD\|dev builds only" CLAUDE.md`.

- [ ] **Step 3: Manual test section** — append to `docs/AUTH_LINKING_TESTS.md`, before `## Not covered here`:

```markdown
## Part 3: Legacy email verification

Needs the local API with Postmark configured. Wipe users first.

| # | Device | Do | Expect | ✓ |
|---|---|---|---|---|
| 3.1 | iOS | 🧨 Purge → **Can't get a code? Sign in with your password** → **Sign up** with a mistyped address (e.g. your Gmail + `f`). Finish onboarding. | The verify screen: heading "Please review and verify your email address", the mistyped address in full, "Skips left: 6". | |
| 3.2 | iOS | Tap **Why is verification required?** | The browser opens the RecoverySky post. | |
| 3.3 | iOS | Tap **Not now**. Background and foreground the app. | Into the app. The screen does not return today. | |
| 3.4 | iOS | Set the phone's date forward one day, foreground the app. | The screen returns with "Skips left: 5". | |
| 3.5 | iOS | **Not my email? Change it** → type E1 → **Send Code** → enter the code from E1's inbox. | Into the app. Settings → Account shows E1. | |
| 🔎 | Claude | diag | One `auth0|` user whose email is now E1 (masked), verified. API log: `email verified` with `changed: true`, and no address in any line. Metro: `Email verified {"changed":true}`. | |
| 3.6 | iOS | Force-quit and reopen. | No verify screen (this install's record wins over the cached token). | |
| 3.7 | iOS | Sign out → **Continue with Email** → E1 → code. | Same account (the hash matches 3.1), attendance intact, no verify screen. | |
| 3.8 | Android | 🧨 Purge → sign in with the password link as a second mistyped account. Skip on six different days (move the date each time). | Day 7: no "Not now", the support line instead. Android's back button does nothing. | |
| 3.9 | Android | Turn on airplane mode, relaunch. | No verify screen while offline; it returns when back online. | |

Put the phone's date back to automatic afterwards.
```

- [ ] **Step 4: Rollout note** — in `docs/PROD_AUTH0_ROLLOUT.md`, under the update banner, add:

```markdown
> **ADDED 2026-10-01:** the OTA also carries legacy email verification
> (`docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md`).
> Deploy the API with `/auth0/email/start` and `/verify` to prod **before**
> the OTA, and confirm prod's API has Postmark and Redis configured.
```

- [ ] **Step 5: Run everything**

Run: `cd /Users/jenova/projects/recoverysky-org/app && npm run compile && npm run lint:deps && npm test`
Expected: compile and depcruise clean; vitest and jest all pass.

Run: `cd /Users/jenova/projects/recoverysky-org/api && pnpm tsc --noEmit && pnpm test`
Expected: clean, all pass.

- [ ] **Step 6: Manual run** — do Part 3 of `docs/AUTH_LINKING_TESTS.md` (3.1–3.9) on a real iOS and Android device with `npm run dev-log` and `pnpm dev-log` running, and record the result in that doc's Results table. Any failed row stops the task: fix it before committing.

- [ ] **Step 7: Commit**

```bash
cd /Users/jenova/projects/recoverysky-org/app && git add CHANGELOG.md CLAUDE.md docs/AUTH_LINKING_TESTS.md docs/PROD_AUTH0_ROLLOUT.md docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md docs/superpowers/plans/2026-10-01-legacy-email-verification.md && git commit -m "📝 docs(auth): legacy email verification

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
