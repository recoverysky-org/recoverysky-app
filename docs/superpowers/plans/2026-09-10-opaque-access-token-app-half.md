# Opaque Access Token — App Half Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the app from trusting a non-JWT access token: validate token shape at the three places a token enters the store, eject the session when the API says the bearer can never work, and tell the user to sign in again instead of "Failed to send report".

**Architecture:** A pure `isUsableAccessToken()` in `jwtUtils.ts` is the single rule; three call sites (SecureStore hydration, the Auth0 SDK sync effect, the request-gate refresher) apply it and route failures into the existing forced-logout path via `onPermanentFailure`. The user-lane refresher moves into its own dependency-injected module so vitest can exercise the eject latch. An apisauce monitor recognises the API's `token_malformed` / `token_claims` / `token_signature` codes (shipped in `api` v1.7.0) and trips the same latch through a new `markRejected()`.

**Tech Stack:** TypeScript, React Native 0.81 / Expo 54, MobX-State-Tree, apisauce 3.1.1 (axios 1.x), react-native-auth0 5.4, vitest for `*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md` — Sections 1–4 and Testing. The API side is already deployed; `docs/superpowers/specs/2026-09-10-api-bearer-rejection-codes-change-request.md` records exactly what it returns.

## Global Constraints

- **JS-only change → OTA. Do NOT bump `runtimeVersion`** in `app.json`.
- **Concurrent sessions share this checkout.** Run `git status` before each commit; stage only the paths named in the task, never `git add -A`, never `git stash`.
- **Never run `npm run lint` (repo-wide `--fix`).** Lint only the files you touched: `npx eslint <paths>`.
- **Vitest has no `@/` alias.** Every new `*.test.ts` and every module it imports (transitively, at value level) must be free of runtime `@/` imports. Type-only imports are erased and fine.
- **Nine locales.** A new translation key must exist in `en.ts` and all eight of `es, ar, de, fr, pt, ru, th, uk` or `npm run compile` fails. English placeholder text in the other eight is acceptable.
- **Never log a token or any substring of it.** Log `reason`, `tokenLength`, `tokenSegments`, `source` only.
- **Comments are liberal in this repo** (CLAUDE.md "Comments"). When changing behaviour next to an existing comment, keep the original and append a dated `CHANGED 2026-09-10:` note.
- **Eject codes are exactly** `token_malformed`, `token_claims`, `token_signature`. `token_expired`, `token_invalid`, a missing `code`, and any 503 must never eject.
- **The toast strings are `tx` keys**: `attendanceScreen:sendFailed` ("Failed to send report") and `attendanceScreen:sendFailedSignIn` ("Please sign in again to send this report").
- Commit messages follow the repo's gitmoji style (`✨ feat(auth): …`, `🐛 fix(auth): …`) and end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DQhYE5Uof4HmfPZuTH7eyJ
  ```

## File Map

| File | Responsibility |
| --- | --- |
| `app/services/auth/jwtUtils.ts` (modify) | `isUsableAccessToken()` — the one shape rule. Pure. |
| `app/services/auth/jwtUtils.test.ts` (create) | Vitest for the rule. |
| `app/services/auth/tokenFreshnessLogic.ts` (modify) | `UnusableTokenError`; `classifyRefreshError` treats it as permanent. |
| `app/services/auth/tokenFreshnessLogic.test.ts` (modify) | One new case. |
| `app/services/auth/userTokenRefresher.ts` (create) | The user-lane refresher with **injected** I/O so vitest can load it. Adds the shape check and `markRejected()`. |
| `app/services/auth/userTokenRefresher.test.ts` (create) | Vitest for eject latch, shape check, `markRejected`, `reset`. |
| `app/services/auth/tokenFreshness.ts` (modify) | Binds real I/O into `createUserTokenRefresher()`; device lane unchanged. |
| `app/services/auth/unusableTokenHandler.ts` (create) | Module-level registration so the SDK sync effect (mounted in `AppNavigator`, not `app.tsx`) can reach the refresher's latch. |
| `app/services/auth/useAuth0Wrapper.ts` (modify) | Call site 2. |
| `app/models/helpers/setupRootStore.ts` (modify) | Call site 1. |
| `app/services/api/bearerRejectionLogic.ts` (create) | Pure monitor decision: status + bearer present + eject code → code or null. |
| `app/services/api/bearerRejectionLogic.test.ts` (create) | Vitest for the decision. |
| `app/services/api/index.ts` (modify) | `onBearerRejected` on `TokenRefreshers`; `addMonitor` wired to the pure decision. |
| `app/app.tsx` (modify) | Wires `markRejected` into both the API monitor and the unusable-token handler. |
| `app/hooks/useReportSender.ts` (modify) | `tx` toasts; `unauthorized` → sign-in-again copy. |
| `app/i18n/{en,es,ar,de,fr,pt,ru,th,uk}.ts` (modify) | Two new keys under `attendanceScreen`. |
| `CHANGELOG.md`, `CLAUDE.md`, the spec (modify) | Discipline. |

---

### Task 1: `isUsableAccessToken()` in `jwtUtils.ts`

**Files:**
- Modify: `app/services/auth/jwtUtils.ts`
- Test: `app/services/auth/jwtUtils.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UnusableTokenReason = "not-jwt" | "wrong-audience" | "no-expiry"
  export interface AccessTokenCheckConfig { audience: string }
  export type AccessTokenCheck = { ok: true } | { ok: false; reason: UnusableTokenReason }
  export function isUsableAccessToken(token: string, config: AccessTokenCheckConfig): AccessTokenCheck
  ```

- [ ] **Step 1: Write the failing tests**

Create `app/services/auth/jwtUtils.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { decodeJwtPayload, isUsableAccessToken } from "./jwtUtils"

const AUDIENCE = "https://api.recoverysky.app"
const CONFIG = { audience: AUDIENCE }

/** Build an unsigned three-segment JWT. The signature segment is never inspected. */
function mint(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", typ: "JWT" }) {
  const seg = (obj: Record<string, unknown>) => Buffer.from(JSON.stringify(obj)).toString("base64url")
  return `${seg(header)}.${seg(payload)}.sig`
}

const GOOD = { iss: "https://auth.recoverysky.app/", aud: AUDIENCE, exp: 1_800_000_000, sub: "auth0|x" }

describe("isUsableAccessToken", () => {
  it("rejects an opaque token as not-jwt", () => {
    expect(isUsableAccessToken("Xk9pQ2vL8mN4rT6wY1zA3bC5dE7fG0hJ", CONFIG)).toEqual({ ok: false, reason: "not-jwt" })
  })

  it("rejects two segments as not-jwt", () => {
    expect(isUsableAccessToken("abc.def", CONFIG)).toEqual({ ok: false, reason: "not-jwt" })
  })

  it("rejects three segments with a non-JSON payload as not-jwt", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")
    expect(isUsableAccessToken(`${header}.bm90LWpzb24.sig`, CONFIG)).toEqual({ ok: false, reason: "not-jwt" })
  })

  it("accepts aud as a matching string", () => {
    expect(isUsableAccessToken(mint(GOOD), CONFIG)).toEqual({ ok: true })
  })

  it("accepts aud as an array containing the audience", () => {
    expect(isUsableAccessToken(mint({ ...GOOD, aud: [AUDIENCE, "https://auth.recoverysky.app/userinfo"] }), CONFIG)).toEqual({ ok: true })
  })

  it("rejects a mismatched aud", () => {
    expect(isUsableAccessToken(mint({ ...GOOD, aud: "https://auth.recoverysky.app/userinfo" }), CONFIG)).toEqual({ ok: false, reason: "wrong-audience" })
  })

  it("rejects a missing aud", () => {
    const { aud: _aud, ...noAud } = GOOD
    expect(isUsableAccessToken(mint(noAud), CONFIG)).toEqual({ ok: false, reason: "wrong-audience" })
  })

  it("rejects a missing exp", () => {
    const { exp: _exp, ...noExp } = GOOD
    expect(isUsableAccessToken(mint(noExp), CONFIG)).toEqual({ ok: false, reason: "no-expiry" })
  })

  it("rejects a non-numeric exp", () => {
    expect(isUsableAccessToken(mint({ ...GOOD, exp: "soon" }), CONFIG)).toEqual({ ok: false, reason: "no-expiry" })
  })

  it("skips the audience rule when no audience is configured", () => {
    expect(isUsableAccessToken(mint({ ...GOOD, aud: "something-else" }), { audience: "" })).toEqual({ ok: true })
  })

  it("still rejects an opaque token when no audience is configured", () => {
    expect(isUsableAccessToken("opaque", { audience: "" })).toEqual({ ok: false, reason: "not-jwt" })
  })

  // Regression guard for the dropped issuer rule (spec Section 1): the API's
  // issuer is env-configured and the client must not second-guess it.
  it("passes a token with an unexpected iss but the right aud", () => {
    expect(isUsableAccessToken(mint({ ...GOOD, iss: "https://meetingmaker.auth0.com/" }), CONFIG)).toEqual({ ok: true })
  })

  it("agrees with decodeJwtPayload on what a payload is", () => {
    expect(decodeJwtPayload(mint(GOOD))).toMatchObject({ sub: "auth0|x" })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/services/auth/jwtUtils.test.ts`
Expected: FAIL — `isUsableAccessToken` is not exported.

- [ ] **Step 3: Implement**

Append to `app/services/auth/jwtUtils.ts` (after `decodeJwtPayload`, before `IdTokenClaims`):

```ts
/** Why an access token cannot be sent to the RecoverySky API. */
export type UnusableTokenReason = "not-jwt" | "wrong-audience" | "no-expiry"

export interface AccessTokenCheckConfig {
  /** AUTH0_CONFIG.audience. Empty (dev builds without the env var) skips the audience rule. */
  audience: string
}

export type AccessTokenCheck = { ok: true } | { ok: false; reason: UnusableTokenReason }

/** Decode one base64url JSON segment; null when it is not JSON. */
function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/")
    const parsed: unknown = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"))
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Can this access token possibly be accepted by the RecoverySky API?
 *
 * ADDED 2026-09-10. Auth0 hands out two kinds of access token: a signed JWT
 * for an API audience, and an opaque string valid for /userinfo only. Which
 * kind a refresh token mints is fixed by the login that created it, and the
 * SDK never adds an audience on renewal — so a session that started on a
 * build without EXPO_PUBLIC_AUTH0_AUDIENCE (every TestFlight build from
 * 3.12.1 through 4.1.6) renews into opaque tokens forever. The app used to
 * store those with a healthy expiry and every signed-in call 401'd.
 *
 * This checks a STRICT SUBSET of what the API's verifyToken checks — shape,
 * audience, expiry present — never the signature and deliberately never the
 * issuer (the API's issuer is env-configured; a client-side guess could eject
 * a user the server accepts). A token that fails here is guaranteed to fail
 * on the server; a token that passes may still fail there, and that case is
 * covered by the bearer-rejection monitor in services/api. Never logs the
 * token. Spec: docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md
 */
export function isUsableAccessToken(token: string, config: AccessTokenCheckConfig): AccessTokenCheck {
  const parts = token.split(".")
  if (parts.length !== 3) return { ok: false, reason: "not-jwt" }

  const header = decodeSegment(parts[0])
  const payload = decodeSegment(parts[1])
  if (!header || !payload) return { ok: false, reason: "not-jwt" }

  if (config.audience) {
    const aud = payload.aud
    const audiences = Array.isArray(aud) ? aud : typeof aud === "string" ? [aud] : []
    if (!audiences.includes(config.audience)) return { ok: false, reason: "wrong-audience" }
  }

  if (typeof payload.exp !== "number") return { ok: false, reason: "no-expiry" }

  return { ok: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/services/auth/jwtUtils.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint app/services/auth/jwtUtils.ts app/services/auth/jwtUtils.test.ts
git add app/services/auth/jwtUtils.ts app/services/auth/jwtUtils.test.ts
git commit -m "✨ feat(auth): isUsableAccessToken — shape and audience check for access tokens

An opaque Auth0 token (userinfo-only, no API audience) used to be stored
like a JWT and every signed-in call 401'd. This is the one rule the three
entry points will apply. Checks a strict subset of the API's verifyToken:
three decodable segments, aud contains the configured audience, exp
present. No issuer rule — the API's issuer is env-configured and a client
guess could eject a user the server accepts.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DQhYE5Uof4HmfPZuTH7eyJ"
```

---

### Task 2: `UnusableTokenError` is a permanent refresh failure

**Files:**
- Modify: `app/services/auth/tokenFreshnessLogic.ts`
- Test: `app/services/auth/tokenFreshnessLogic.test.ts`

**Interfaces:**
- Consumes: `UnusableTokenReason` from Task 1.
- Produces:
  ```ts
  export class UnusableTokenError extends Error { readonly reason: UnusableTokenReason }
  // classifyRefreshError(new UnusableTokenError("not-jwt")) === "permanent"
  ```

- [ ] **Step 1: Write the failing test**

In `app/services/auth/tokenFreshnessLogic.test.ts`, add `UnusableTokenError` to the import from `./tokenFreshnessLogic`, then add inside `describe("classifyRefreshError", …)` after the existing `it.each(transient…)` block:

```ts
  // A refreshed token that is not a JWT for our audience cannot be fixed by
  // refreshing again — the refresh token itself is bound to the wrong
  // audience. Only a new login helps, so this must eject.
  it("classifies UnusableTokenError as permanent", () => {
    expect(classifyRefreshError(new UnusableTokenError("not-jwt"))).toBe("permanent")
    expect(classifyRefreshError(new UnusableTokenError("wrong-audience"))).toBe("permanent")
  })

  it("carries the reason on the error", () => {
    const err = new UnusableTokenError("no-expiry")
    expect(err.reason).toBe("no-expiry")
    expect(err.name).toBe("UnusableTokenError")
    expect(err).toBeInstanceOf(Error)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/services/auth/tokenFreshnessLogic.test.ts`
Expected: FAIL — `UnusableTokenError` is not exported.

- [ ] **Step 3: Implement**

In `app/services/auth/tokenFreshnessLogic.ts`, add after the module doc comment (top of file):

```ts
import type { UnusableTokenReason } from "./jwtUtils"

/**
 * Thrown by the user refresher when Auth0 renews the session into a token
 * that isUsableAccessToken() rejects. Classified PERMANENT: the refresh
 * token is bound to the audience of the login that made it, so renewing
 * again yields the same kind of token. ADDED 2026-09-10.
 */
export class UnusableTokenError extends Error {
  readonly reason: UnusableTokenReason

  constructor(reason: UnusableTokenReason) {
    super(`Refreshed access token unusable: ${reason}`)
    this.name = "UnusableTokenError"
    this.reason = reason
  }
}
```

Then change `classifyRefreshError`:

```ts
/** Map an unknown throw from the Auth0 credentials manager to a retry verdict. */
export function classifyRefreshError(error: unknown): RefreshFailureKind {
  // ADDED 2026-09-10: our own verdict on the renewed token, not an SDK code.
  if (error instanceof UnusableTokenError) return "permanent"

  const code =
    typeof error === "object" && error !== null && "type" in error
      ? (error as { type: unknown }).type
      : undefined

  if (typeof code !== "string") return "transient"
  return PERMANENT_REFRESH_ERROR_CODES.includes(code) ? "permanent" : "transient"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/services/auth/tokenFreshnessLogic.test.ts`
Expected: PASS (all existing cases plus 2 new).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint app/services/auth/tokenFreshnessLogic.ts app/services/auth/tokenFreshnessLogic.test.ts
git add app/services/auth/tokenFreshnessLogic.ts app/services/auth/tokenFreshnessLogic.test.ts
git commit -m "✨ feat(auth): UnusableTokenError classifies as a permanent refresh failure

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DQhYE5Uof4HmfPZuTH7eyJ"
```

---

### Task 3: Extract the user refresher with injected I/O, add the shape check and `markRejected()`

The user lane of `tokenFreshness.ts` moves verbatim into `userTokenRefresher.ts`, with the three things vitest cannot load (`getFreshCredentials` → react-native-auth0, `saveAuthCredentials` → `Platform`, `logger` → `@/`) injected. `tokenFreshness.ts` keeps the same public `createUserTokenRefresher(deps)` signature by binding the real I/O, so `app.tsx` only changes to use the new method.

**Files:**
- Create: `app/services/auth/userTokenRefresher.ts`
- Create: `app/services/auth/userTokenRefresher.test.ts`
- Modify: `app/services/auth/tokenFreshness.ts`

**Interfaces:**
- Consumes: `isUsableAccessToken` (Task 1), `UnusableTokenError` (Task 2), `StoredAuthCredentials` type from `./secureStorage`.
- Produces (from `userTokenRefresher.ts`):
  ```ts
  export interface UserRefresherStore { … unchanged from tokenFreshness.ts … }
  export interface UserRefresherDeps { authStore: UserRefresherStore; onPermanentFailure: () => void }
  export interface FreshCredentials { accessToken: string; refreshToken?: string | null; idToken?: string | null; expiresAt: number /* seconds */ }
  export interface RefresherLog { info(m: string, a?: Record<string, unknown>): void; warn(…): void; error(…): void }
  export interface UserRefresherIo {
    getFreshCredentials: (minTtlSec: number) => Promise<FreshCredentials>
    persistCredentials: (creds: StoredAuthCredentials) => Promise<void>
    log: RefresherLog
    audience: string
  }
  export interface UserTokenRefresher { getToken(): Promise<string | null>; reset(): void; markRejected(): void }
  export function buildUserTokenRefresher(deps: UserRefresherDeps & UserRefresherIo): UserTokenRefresher
  export const USER_TOKEN_SKEW_MS, USER_REFRESH_TIMEOUT_MS, USER_REFRESH_BACKOFF_MS
  ```
- Produces (from `tokenFreshness.ts`, unchanged names): `createUserTokenRefresher(deps: UserRefresherDeps): UserTokenRefresher` — now with `markRejected`.

- [ ] **Step 1: Write the failing tests**

Create `app/services/auth/userTokenRefresher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import type { StoredAuthCredentials } from "./secureStorage"
import { buildUserTokenRefresher, type FreshCredentials, type UserRefresherStore } from "./userTokenRefresher"

const AUDIENCE = "https://api.recoverysky.app"

function mint(payload: Record<string, unknown>) {
  const seg = (obj: Record<string, unknown>) => Buffer.from(JSON.stringify(obj)).toString("base64url")
  return `${seg({ alg: "RS256", typ: "JWT" })}.${seg(payload)}.sig`
}

const GOOD_JWT = mint({ aud: AUDIENCE, exp: 1_800_000_000, sub: "auth0|x" })
const OPAQUE = "Xk9pQ2vL8mN4rT6wY1zA3bC5dE7fG0hJ"

/** A store that already holds a signed-in session whose token needs refreshing. */
function makeStore(): UserRefresherStore & { setTokens: ReturnType<typeof vi.fn> } {
  return {
    accessToken: "stale.stale.stale",
    refreshToken: "rt-1",
    idToken: undefined,
    expiresAt: undefined, // undefined → shouldRefresh() says refresh now
    isAnonymous: false,
    setTokens: vi.fn(),
  }
}

function harness(fresh: FreshCredentials | (() => Promise<FreshCredentials>), audience = AUDIENCE) {
  const authStore = makeStore()
  const onPermanentFailure = vi.fn()
  const getFreshCredentials = vi.fn(typeof fresh === "function" ? fresh : async () => fresh)
  const persistCredentials = vi.fn(async (_c: StoredAuthCredentials) => {})
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const refresher = buildUserTokenRefresher({
    authStore,
    onPermanentFailure,
    getFreshCredentials,
    persistCredentials,
    log,
    audience,
  })
  return { authStore, onPermanentFailure, getFreshCredentials, persistCredentials, log, refresher }
}

describe("buildUserTokenRefresher — usable token", () => {
  it("stores, persists and returns a JWT for the configured audience", async () => {
    const h = harness({ accessToken: GOOD_JWT, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 })
    await expect(h.refresher.getToken()).resolves.toBe(GOOD_JWT)
    expect(h.authStore.setTokens).toHaveBeenCalledWith(GOOD_JWT, "rt-1", undefined, 1_800_000_000_000)
    expect(h.persistCredentials).toHaveBeenCalledWith({
      accessToken: GOOD_JWT,
      refreshToken: "rt-1",
      idToken: undefined,
      expiresAt: 1_800_000_000_000,
    })
    expect(h.onPermanentFailure).not.toHaveBeenCalled()
  })
})

describe("buildUserTokenRefresher — unusable token from the SDK", () => {
  it("does not store or persist it, ejects once, and resolves null", async () => {
    const h = harness({ accessToken: OPAQUE, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 })
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.authStore.setTokens).not.toHaveBeenCalled()
    expect(h.persistCredentials).not.toHaveBeenCalled()
    expect(h.onPermanentFailure).toHaveBeenCalledTimes(1)
  })

  it("logs the reason and shape but never the token", async () => {
    const h = harness({ accessToken: OPAQUE, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 })
    await h.refresher.getToken()
    const calls = [...h.log.error.mock.calls, ...h.log.warn.mock.calls, ...h.log.info.mock.calls]
    const serialized = JSON.stringify(calls)
    expect(serialized).toContain('"reason":"not-jwt"')
    expect(serialized).toContain('"source":"refresh"')
    expect(serialized).toContain(`"tokenLength":${OPAQUE.length}`)
    expect(serialized).not.toContain(OPAQUE)
  })

  it("short-circuits every later getToken without calling the SDK again", async () => {
    const h = harness({ accessToken: OPAQUE, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 })
    await h.refresher.getToken()
    await expect(h.refresher.getToken()).resolves.toBeNull()
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.getFreshCredentials).toHaveBeenCalledTimes(1)
    expect(h.onPermanentFailure).toHaveBeenCalledTimes(1)
  })

  it("reset() re-enables refreshing", async () => {
    let attempt = 0
    const h = harness(async () => {
      attempt += 1
      return {
        accessToken: attempt === 1 ? OPAQUE : GOOD_JWT,
        refreshToken: null,
        idToken: null,
        expiresAt: 1_800_000_000,
      }
    })
    await expect(h.refresher.getToken()).resolves.toBeNull()
    h.refresher.reset()
    await expect(h.refresher.getToken()).resolves.toBe(GOOD_JWT)
    expect(h.getFreshCredentials).toHaveBeenCalledTimes(2)
  })

  it("rejects a JWT for the wrong audience", async () => {
    const wrong = mint({ aud: "https://auth.recoverysky.app/userinfo", exp: 1_800_000_000 })
    const h = harness({ accessToken: wrong, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 })
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.onPermanentFailure).toHaveBeenCalledTimes(1)
  })

  it("accepts any JWT when no audience is configured (dev builds)", async () => {
    const other = mint({ aud: "anything", exp: 1_800_000_000 })
    const h = harness({ accessToken: other, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 }, "")
    await expect(h.refresher.getToken()).resolves.toBe(other)
  })
})

describe("buildUserTokenRefresher — markRejected()", () => {
  it("ejects once and is a no-op on repeat", () => {
    const h = harness({ accessToken: GOOD_JWT, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 })
    h.refresher.markRejected()
    h.refresher.markRejected()
    expect(h.onPermanentFailure).toHaveBeenCalledTimes(1)
  })

  it("stops bearers going out until reset()", async () => {
    const h = harness({ accessToken: GOOD_JWT, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 })
    h.refresher.markRejected()
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.getFreshCredentials).not.toHaveBeenCalled()
    h.refresher.reset()
    await expect(h.refresher.getToken()).resolves.toBe(GOOD_JWT)
  })
})

describe("buildUserTokenRefresher — guards that predate this change", () => {
  it("returns null without refreshing for an anonymous user", async () => {
    const h = harness({ accessToken: GOOD_JWT, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 })
    h.authStore.isAnonymous = true
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.getFreshCredentials).not.toHaveBeenCalled()
  })

  it("returns null without refreshing when there is no session at all", async () => {
    const h = harness({ accessToken: GOOD_JWT, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 })
    h.authStore.accessToken = undefined
    h.authStore.refreshToken = undefined
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.getFreshCredentials).not.toHaveBeenCalled()
    expect(h.onPermanentFailure).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/services/auth/userTokenRefresher.test.ts`
Expected: FAIL — cannot find module `./userTokenRefresher`.

- [ ] **Step 3: Create `app/services/auth/userTokenRefresher.ts`**

```ts
/**
 * The Auth0 access-token refresher behind the proactive request gate.
 *
 * EXTRACTED 2026-09-10 from tokenFreshness.ts with its I/O injected, so
 * vitest can exercise the eject latch — the decision that signs a user out.
 * It has NO `@/` imports and no native imports at value level: the SDK call,
 * the SecureStore write and the logger all arrive through `UserRefresherIo`.
 * tokenFreshness.ts binds the real ones. Keep it that way (see CLAUDE.md
 * "Test Runner Split").
 *
 * Returns the token to stamp on the outgoing request, or null when there
 * should be no Authorization header at all (anonymous, signed out, or the
 * refresh token is dead).
 */

import { isUsableAccessToken } from "./jwtUtils"
import type { StoredAuthCredentials } from "./secureStorage"
import {
  classifyRefreshError,
  createFailureBackoff,
  createSingleFlight,
  shouldRefresh,
  UnusableTokenError,
  withTimeout,
} from "./tokenFreshnessLogic"

/**
 * Refresh the access token when it has under a minute left. Cheap — one
 * network hop — so the margin can be tight, unlike the device lane.
 */
export const USER_TOKEN_SKEW_MS = 60 * 1000

/** Cap so one hung refresh can't stall every request behind it. */
export const USER_REFRESH_TIMEOUT_MS = 10 * 1000

/**
 * Hold-off ladder after failed refreshes (see createFailureBackoff for the
 * failure modes it exists to stop). ADDED 2026-08-07: without it, refresh was
 * retried at REQUEST rate. Parks at 15 min — the AppState foreground warm-up
 * and the next successful attempt are the recovery paths.
 */
export const USER_REFRESH_BACKOFF_MS: readonly number[] = [15_000, 60_000, 300_000, 900_000]

/** The slice of AuthenticationStore the user refresher touches. */
export interface UserRefresherStore {
  accessToken?: string
  refreshToken?: string
  idToken?: string
  expiresAt?: number
  isAnonymous: boolean
  setTokens(accessToken: string, refreshToken?: string, idToken?: string, expiresAt?: number): void
}

export interface UserRefresherDeps {
  authStore: UserRefresherStore
  /** Called once when the session is proven dead. Drives forced logout. */
  onPermanentFailure: () => void
}

/** What the Auth0 credentials manager hands back. `expiresAt` is SECONDS. */
export interface FreshCredentials {
  accessToken: string
  refreshToken?: string | null
  idToken?: string | null
  expiresAt: number
}

export interface RefresherLog {
  info(message: string, attributes?: Record<string, unknown>): void
  warn(message: string, attributes?: Record<string, unknown>): void
  error(message: string, attributes?: Record<string, unknown>): void
}

/** The I/O this module refuses to import. Bound by tokenFreshness.ts. */
export interface UserRefresherIo {
  getFreshCredentials: (minTtlSec: number) => Promise<FreshCredentials>
  persistCredentials: (creds: StoredAuthCredentials) => Promise<void>
  log: RefresherLog
  /** AUTH0_CONFIG.audience; empty skips the audience rule (dev builds). */
  audience: string
}

export interface UserTokenRefresher {
  getToken: () => Promise<string | null>
  /** Clear the latch after a completed forced logout, so a re-login works. */
  reset: () => void
  /**
   * The API answered a bearer with a code meaning "this token can never
   * work" (token_malformed / token_claims / token_signature). Latches exactly
   * like a permanent refresh failure and ejects once. ADDED 2026-09-10.
   */
  markRejected: () => void
}

export function buildUserTokenRefresher(deps: UserRefresherDeps & UserRefresherIo): UserTokenRefresher {
  const { authStore, onPermanentFailure, getFreshCredentials, persistCredentials, log, audience } = deps

  /**
   * Latched once a refresh fails permanently. Without it every subsequent
   * request would retry a refresh we already know is dead — and during the
   * deferred-logout window (timer running) that could be a request every few
   * seconds for the length of a meeting.
   */
  let permanentlyFailed = false

  /**
   * ADDED 2026-08-07: hold-off between failed renewals. RENEW_FAILED — the
   * SDK's bucket for invalid_grant, i.e. the ORDINARY revoked/expired refresh
   * token — is classified transient on purpose, which used to mean a dead
   * session re-attempted a full renewal on every single request, forever. The
   * backoff absorbs that cost so the classification can stay conservative.
   */
  const backoff = createFailureBackoff(USER_REFRESH_BACKOFF_MS)

  /** Shared by the refresh path and markRejected(). Ejects at most once per latch. */
  const latchAndEject = (message: string, attributes: Record<string, unknown>) => {
    if (permanentlyFailed) return
    log.error(message, attributes)
    permanentlyFailed = true
    onPermanentFailure()
  }

  const refresh = createSingleFlight(async () => {
    // Outcome recording lives INSIDE the single-flight fn, not in getToken's
    // catch: when withTimeout resolves the stale fallback, the underlying
    // refresh keeps running and settles after the caller has moved on — this
    // is the only place that observes that late outcome.
    try {
      const creds = await getFreshCredentials(USER_TOKEN_SKEW_MS / 1000)

      // ADDED 2026-09-10: refuse a renewed token that is not a JWT for our
      // audience BEFORE it reaches the store. Thrown, not returned, so the
      // existing permanent-failure catch in getToken handles it — no second
      // eject path. See isUsableAccessToken for the why.
      const check = isUsableAccessToken(creds.accessToken, { audience })
      if (!check.ok) {
        log.error("Auth0 SDK renewed into an unusable access token", {
          source: "refresh",
          reason: check.reason,
          tokenLength: creds.accessToken.length,
          tokenSegments: creds.accessToken.split(".").length,
        })
        throw new UnusableTokenError(check.reason)
      }

      // Auth0 returns expiresAt in SECONDS; the rest of the app uses ms.
      const expiresAt = creds.expiresAt * 1000

      // CHANGED 2026-08-07: keep the stored refresh token when the response does
      // not carry a new one. Auth0 only returns a refresh token when it actually
      // rotates one, and passing undefined through blanked BOTH copies —
      // setTokens() assigns unconditionally and persistCredentials() rewrites
      // the whole record. Read before setTokens(), which is what would overwrite it.
      const refreshToken = creds.refreshToken ?? authStore.refreshToken

      authStore.setTokens(creds.accessToken, refreshToken, creds.idToken ?? undefined, expiresAt)

      // Write-back matters: without it the same refresh repeats on every cold
      // start, because setupRootStore hydrates from SecureStore and would keep
      // reading the old expiry.
      persistCredentials({
        accessToken: creds.accessToken,
        refreshToken,
        idToken: creds.idToken ?? undefined,
        expiresAt,
      }).catch((err) => log.error("Failed to persist refreshed credentials", { error: String(err) }))

      log.info("Access token refreshed", {
        expiresIn: Math.round((expiresAt - Date.now()) / 1000 / 60) + " min",
      })

      backoff.recordSuccess()
      return creds.accessToken
    } catch (err) {
      backoff.recordFailure(Date.now())
      throw err
    }
  })

  return {
    getToken: async () => {
      if (permanentlyFailed) return null
      if (authStore.isAnonymous) return null
      // Load-bearing, not defensive. A user who has never signed in has no
      // tokens at all, so without this the very first request would call
      // getFreshCredentials(), the SDK would throw NO_CREDENTIALS, and
      // classifyRefreshError() treats that as PERMANENT — which fires
      // onPermanentFailure() and force-logs-out someone who was never logged
      // in. Bail before the refresh, not inside it.
      if (!authStore.accessToken && !authStore.refreshToken) return null

      const current = authStore.accessToken ?? null
      if (!shouldRefresh(authStore.expiresAt, Date.now(), USER_TOKEN_SKEW_MS)) {
        return current
      }

      // Backing off after recent failures — go out with what we have. A stale
      // Bearer yields a clean 401; hammering the renewal endpoint on every
      // request yields nothing but load.
      if (!backoff.shouldAttempt(Date.now())) {
        return current
      }

      try {
        // On timeout we fall back to the current token and let the request go
        // out and fail on its own. Blocking would hang every call in the app.
        return await withTimeout(refresh(), USER_REFRESH_TIMEOUT_MS, current)
      } catch (err) {
        // Concurrent callers share one in-flight refresh (createSingleFlight),
        // so a permanent rejection lands in EVERY waiting caller's catch. Only
        // the first one may latch and eject: performForcedLogout() ends with
        // reset(), so a second pass would log the user out twice AND leave the
        // latch cleared, re-enabling the dead-refresh retries this latch exists
        // to stop.
        if (permanentlyFailed) return null

        if (classifyRefreshError(err) === "permanent") {
          latchAndEject("Access token refresh failed permanently — forcing logout", {
            error: String(err),
          })
          return null
        }

        log.warn("Access token refresh failed transiently — proceeding with current token", {
          error: String(err),
        })
        return current
      }
    },

    reset: () => {
      permanentlyFailed = false
      // The dead session's failure ladder must not throttle the NEW session's
      // first refreshes after re-login.
      backoff.recordSuccess()
    },

    markRejected: () => {
      latchAndEject("Server rejected the bearer as unusable — forcing logout", {
        source: "server-401",
      })
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/services/auth/userTokenRefresher.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Rewire `tokenFreshness.ts`**

In `app/services/auth/tokenFreshness.ts`:

1. Replace the import block's `./secureStorage` and `./tokenFreshnessLogic` lines and add the new module:

```ts
import { AUTH0_CONFIG } from "./auth0"
import { getFreshCredentials } from "./auth0Client"
import { saveAuthCredentials } from "./secureStorage"
import { createFailureBackoff, createSingleFlight, withTimeout } from "./tokenFreshnessLogic"
import {
  buildUserTokenRefresher,
  type UserRefresherDeps,
  type UserTokenRefresher,
} from "./userTokenRefresher"
```

(`classifyRefreshError` and `shouldRefresh` are no longer used here — remove them from the import or ESLint fails on unused imports.)

2. Delete `USER_TOKEN_SKEW_MS`, `USER_REFRESH_TIMEOUT_MS`, `USER_REFRESH_BACKOFF_MS`, `UserRefresherStore`, `UserRefresherDeps`, and the entire body of `createUserTokenRefresher` from this file. Keep `DEVICE_REFRESH_TIMEOUT_MS`, `DEVICE_REFRESH_BACKOFF_MS`, `DeviceRefresherDeps`, and `createDeviceTokenRefresher` exactly as they are (the comment block above `USER_REFRESH_BACKOFF_MS` that explains both ladders stays, attached to the device constant).

3. Add in their place:

```ts
export {
  USER_REFRESH_BACKOFF_MS,
  USER_REFRESH_TIMEOUT_MS,
  USER_TOKEN_SKEW_MS,
  type UserRefresherDeps,
  type UserRefresherStore,
  type UserTokenRefresher,
} from "./userTokenRefresher"

/**
 * Refresher for the Auth0 access token (`Authorization: Bearer`).
 *
 * CHANGED 2026-09-10: the body lives in userTokenRefresher.ts with its I/O
 * injected so it can be unit-tested; this binds the real SDK call, the
 * SecureStore write, the logger and the configured audience. The public
 * shape is unchanged apart from the new markRejected().
 */
export function createUserTokenRefresher(deps: UserRefresherDeps): UserTokenRefresher {
  return buildUserTokenRefresher({
    ...deps,
    getFreshCredentials,
    persistCredentials: saveAuthCredentials,
    log,
    audience: AUTH0_CONFIG.audience,
  })
}
```

4. Update the file's header comment: after "Every decision it makes is delegated to tokenFreshnessLogic.ts, which IS covered." append:

```
 * CHANGED 2026-09-10: the user lane itself is now covered too — see
 * userTokenRefresher.ts, which takes its I/O by injection. Only the device
 * lane below remains orchestrator-only.
```

- [ ] **Step 6: Type-check, run the whole vitest suite, lint**

Run: `npm run compile`
Expected: clean. (If `app.tsx` complains about `createUserTokenRefresher`'s return type, it will not — the returned object is a superset of the old one.)

Run: `npm run test:unit`
Expected: all green, including the three auth test files.

Run: `npx eslint app/services/auth/tokenFreshness.ts app/services/auth/userTokenRefresher.ts app/services/auth/userTokenRefresher.test.ts`

- [ ] **Step 7: Commit**

```bash
git add app/services/auth/userTokenRefresher.ts app/services/auth/userTokenRefresher.test.ts app/services/auth/tokenFreshness.ts
git commit -m "♻️ refactor(auth): user refresher takes injected I/O, checks token shape, adds markRejected()

The user lane moves out of tokenFreshness.ts with its SDK call, SecureStore
write and logger injected, so vitest can exercise the eject latch — the
decision that signs a user out. Behaviour is unchanged except:
- a renewed token that fails isUsableAccessToken() is thrown as
  UnusableTokenError before it reaches the store, and ejects through the
  existing permanent-failure catch
- markRejected() lets the API's bearer-rejection codes trip the same latch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DQhYE5Uof4HmfPZuTH7eyJ"
```

---

### Task 4: Call site 1 — discard an unusable stored token at cold start

**Files:**
- Modify: `app/models/helpers/setupRootStore.ts`

**Interfaces:**
- Consumes: `isUsableAccessToken` (Task 1), `AUTH0_CONFIG`, `clearAuthCredentials`.

No vitest here (the module imports `@/`). Verified by `npm run compile` and the manual checklist in Task 8.

- [ ] **Step 1: Add imports**

In `app/models/helpers/setupRootStore.ts`, change the secureStorage import and add two more:

```ts
import { AUTH0_CONFIG } from "@/services/auth/auth0"
import { isUsableAccessToken } from "@/services/auth/jwtUtils"
import { clearAuthCredentials, loadAuthCredentials } from "@/services/auth/secureStorage"
```

- [ ] **Step 2: Gate `setTokens` on the check**

Replace the body of the `try` that starts `const creds = await loadAuthCredentials()` with:

```ts
    const creds = await loadAuthCredentials()
    if (creds) {
      // ADDED 2026-09-10: refuse to hydrate a token that can never be accepted
      // by the API (an opaque Auth0 token from an audience-less session — see
      // isUsableAccessToken). Discard it and let the Auth0Provider's [user]
      // effect produce a good one or eject; a corrupt blob must not punish a
      // user whose SDK session is fine. An EXPIRED JWT still hydrates — the
      // gate-driven refresh below needs the refresh token beside it.
      const check = isUsableAccessToken(creds.accessToken, { audience: AUTH0_CONFIG.audience })
      if (!check.ok) {
        log.warn("Stored access token unusable — discarding", {
          source: "hydration",
          reason: check.reason,
          tokenLength: creds.accessToken.length,
          tokenSegments: creds.accessToken.split(".").length,
        })
        clearAuthCredentials().catch((e) =>
          log.error("Failed to clear unusable auth credentials", { error: String(e) }),
        )
      } else {
        rootStore.authenticationStore.setTokens(
          creds.accessToken,
          creds.refreshToken,
          creds.idToken,
          creds.expiresAt,
        )
        if (creds.expiresAt > Date.now()) {
          log.info("Auth credentials restored from SecureStore", {
            expiresIn: Math.round((creds.expiresAt - Date.now()) / 1000 / 60) + " min",
          })
        } else {
          log.info("Stored access token expired — hydrated for gate-driven refresh", {
            hasRefreshToken: !!creds.refreshToken,
          })
        }
      }
    }
```

- [ ] **Step 3: Type-check and lint**

Run: `npm run compile && npx eslint app/models/helpers/setupRootStore.ts`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/models/helpers/setupRootStore.ts
git commit -m "🐛 fix(auth): discard an unusable stored access token instead of hydrating it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DQhYE5Uof4HmfPZuTH7eyJ"
```

---

### Task 5: Call site 2 — the Auth0 SDK sync effect ejects on an unusable token

`useAuth0Wrapper()` is mounted by `AppNavigator`, `LoginScreen`, `SettingsScreen` and `DevScreen`, not by `app.tsx` — so the eject handler cannot be a prop wired from `app.tsx`'s closure. A tiny module-level registration (same idiom as `api.registerTokenRefreshers`) carries it. Every mounted instance runs the sync effect, so the handler may fire more than once for one bad token; `markRejected()` latches and `performForcedLogout()` is safe to repeat, so that is harmless.

**Files:**
- Create: `app/services/auth/unusableTokenHandler.ts`
- Modify: `app/services/auth/useAuth0Wrapper.ts`
- Modify: `app/app.tsx` (the registration; the monitor wiring comes in Task 6)

**Interfaces:**
- Produces:
  ```ts
  export function registerUnusableTokenHandler(handler: (reason: UnusableTokenReason) => void): void
  export function reportUnusableToken(reason: UnusableTokenReason): boolean // false when nothing registered
  ```

- [ ] **Step 1: Create the handler module**

`app/services/auth/unusableTokenHandler.ts`:

```ts
/**
 * Lets the Auth0 SDK sync effect (useAuth0Wrapper, mounted inside the
 * navigator tree) reach the user refresher's eject latch, which is created
 * in app.tsx's init closure before the tree exists.
 *
 * ADDED 2026-09-10. Module-level registration rather than a prop or a
 * context: the hook has four mount sites (AppNavigator, LoginScreen,
 * SettingsScreen, DevScreen) and none of them is app.tsx. Same idiom as
 * api.registerTokenRefreshers(). Spec:
 * docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md
 */

import type { UnusableTokenReason } from "./jwtUtils"

type UnusableTokenHandler = (reason: UnusableTokenReason) => void

let handler: UnusableTokenHandler | null = null

/** Called once from app.tsx after the user refresher exists. */
export function registerUnusableTokenHandler(fn: UnusableTokenHandler): void {
  handler = fn
}

/**
 * Report a token the SDK handed us that can never be accepted by the API.
 * Returns false when no handler is registered yet (nothing ejected); the
 * caller logs either way.
 */
export function reportUnusableToken(reason: UnusableTokenReason): boolean {
  if (!handler) return false
  handler(reason)
  return true
}
```

- [ ] **Step 2: Apply the check in the sync effect**

In `app/services/auth/useAuth0Wrapper.ts`:

Add imports:

```ts
import { decodeJwtPayload, extractSqliteKeyFromClaims, isUsableAccessToken, type IdTokenClaims } from "./jwtUtils"
import { reportUnusableToken } from "./unusableTokenHandler"
```

Inside `syncUserToStore`, immediately after `const credentials = await getCredentials()` and `if (credentials) {`, before the `expiresAt` line, insert:

```ts
            // ADDED 2026-09-10: the SDK renews with the stored refresh token,
            // and a refresh token from an audience-less login (TestFlight
            // builds 3.12.1–4.1.6 shipped without EXPO_PUBLIC_AUTH0_AUDIENCE)
            // renews into an opaque token the API can never accept. Do not
            // store it; eject through the same path as a dead refresh token.
            // setAuthReady() still runs so the splash never waits on a session
            // that is being torn down — forced logout flips isAuthenticated
            // and routes to Login on its own.
            const check = isUsableAccessToken(credentials.accessToken, {
              audience: AUTH0_CONFIG.audience,
            })
            if (!check.ok) {
              const handled = reportUnusableToken(check.reason)
              log.error("Auth0 SDK returned unusable access token — signing out", {
                source: "sdk-sync",
                reason: check.reason,
                tokenLength: credentials.accessToken.length,
                tokenSegments: credentials.accessToken.split(".").length,
                handled,
              })
              authStore.setAuthReady()
              return
            }
```

(`AUTH0_CONFIG` is already imported in this file.)

- [ ] **Step 3: Register the handler in `app.tsx`**

In `app/app.tsx`, add to the `./services/auth` import block:

```ts
import {
  clearStoredCredentials,
  createDeviceTokenRefresher,
  createUserTokenRefresher,
} from "./services/auth"
import { registerUnusableTokenHandler } from "./services/auth/unusableTokenHandler"
```

Directly after the `const userRefresher = createUserTokenRefresher({ … })` block (before `const deviceRefresher = …`), add:

```ts
        // ADDED 2026-09-10: the Auth0 SDK sync effect (useAuth0Wrapper) can
        // hand us a token that is not a JWT for our audience. It reports
        // here; markRejected() latches the refresher so no bearer goes out
        // and ejects through the same timer-aware onPermanentFailure above.
        // The hook has several mount sites and each may report the same
        // token — the latch and performForcedLogout() both tolerate repeats.
        registerUnusableTokenHandler(() => userRefresher.markRejected())
```

- [ ] **Step 4: Type-check and lint**

Run: `npm run compile && npx eslint app/services/auth/unusableTokenHandler.ts app/services/auth/useAuth0Wrapper.ts app/app.tsx`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/services/auth/unusableTokenHandler.ts app/services/auth/useAuth0Wrapper.ts app/app.tsx
git commit -m "🐛 fix(auth): eject when the Auth0 SDK syncs an unusable access token

The [user] sync effect used to store whatever getCredentials() returned.
An opaque token (audience-less refresh token) now reports to the user
refresher's latch via a module-level handler registered from app.tsx, and
the existing forced-logout path takes over.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DQhYE5Uof4HmfPZuTH7eyJ"
```

---

### Task 6: Bearer-rejection monitor on the API client

**Files:**
- Create: `app/services/api/bearerRejectionLogic.ts`
- Create: `app/services/api/bearerRejectionLogic.test.ts`
- Modify: `app/services/api/index.ts`
- Modify: `app/app.tsx`

**Interfaces:**
- Produces (`bearerRejectionLogic.ts`):
  ```ts
  export const BEARER_EJECT_CODES: readonly string[] // ["token_malformed","token_claims","token_signature"]
  export function readHeader(headers: unknown, name: string): string | undefined
  export function bearerRejectionCode(status: number | undefined, requestHeaders: unknown, data: unknown): string | null
  ```
- Produces (`index.ts`): `TokenRefreshers.onBearerRejected?: () => void`.
- Consumes: `userRefresher.markRejected` (Task 3).

- [ ] **Step 1: Write the failing tests**

Create `app/services/api/bearerRejectionLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { BEARER_EJECT_CODES, bearerRejectionCode, readHeader } from "./bearerRejectionLogic"

/** Mimics axios 1.x AxiosHeaders: case-insensitive get(), no own enumerable keys to rely on. */
class FakeAxiosHeaders {
  private map = new Map<string, string>()
  constructor(init: Record<string, string>) {
    for (const [k, v] of Object.entries(init)) this.map.set(k.toLowerCase(), v)
  }
  get(name: string) {
    return this.map.get(name.toLowerCase())
  }
}

const BEARER = { Authorization: "Bearer Xk9pQ2vL8mN4rT6wY1zA3bC5dE7fG0hJ" }
const body = (code?: string) => ({ error: "Unauthorized", message: "Invalid token", ...(code ? { code } : {}) })

describe("readHeader", () => {
  it("reads through an AxiosHeaders-style get()", () => {
    expect(readHeader(new FakeAxiosHeaders(BEARER), "authorization")).toBe(BEARER.Authorization)
  })
  it("reads a plain object case-insensitively", () => {
    expect(readHeader({ authorization: "Bearer x" }, "Authorization")).toBe("Bearer x")
    expect(readHeader({ Authorization: "Bearer y" }, "authorization")).toBe("Bearer y")
  })
  it("returns undefined for missing, null, or non-object headers", () => {
    expect(readHeader({}, "Authorization")).toBeUndefined()
    expect(readHeader(null, "Authorization")).toBeUndefined()
    expect(readHeader("nope", "Authorization")).toBeUndefined()
  })
})

describe("bearerRejectionCode", () => {
  it.each(BEARER_EJECT_CODES)("returns %s for a 401 with a bearer and that code", (code) => {
    expect(bearerRejectionCode(401, new FakeAxiosHeaders(BEARER), body(code))).toBe(code)
  })

  it("works with plain-object request headers too", () => {
    expect(bearerRejectionCode(401, BEARER, body("token_malformed"))).toBe("token_malformed")
  })

  it("ignores token_expired (the gate refreshes)", () => {
    expect(bearerRejectionCode(401, BEARER, body("token_expired"))).toBeNull()
  })

  it("ignores token_invalid", () => {
    expect(bearerRejectionCode(401, BEARER, body("token_invalid"))).toBeNull()
  })

  it("ignores a 401 with no code (Invalid API key, missing header, older API)", () => {
    expect(bearerRejectionCode(401, BEARER, body())).toBeNull()
    expect(bearerRejectionCode(401, BEARER, { error: "Unauthorized", message: "Invalid API key" })).toBeNull()
  })

  it("ignores a 401 that carried no bearer", () => {
    expect(bearerRejectionCode(401, { "X-API-Key": "k" }, body("token_malformed"))).toBeNull()
    expect(bearerRejectionCode(401, undefined, body("token_malformed"))).toBeNull()
  })

  it("ignores a 503 auth_unavailable and every non-401 status", () => {
    expect(bearerRejectionCode(503, BEARER, { error: "ServiceUnavailable", code: "auth_unavailable" })).toBeNull()
    expect(bearerRejectionCode(403, BEARER, body("token_malformed"))).toBeNull()
    expect(bearerRejectionCode(undefined, BEARER, body("token_malformed"))).toBeNull()
  })

  it("ignores non-object or string bodies", () => {
    expect(bearerRejectionCode(401, BEARER, "Unauthorized")).toBeNull()
    expect(bearerRejectionCode(401, BEARER, null)).toBeNull()
    expect(bearerRejectionCode(401, BEARER, { code: 42 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/services/api/bearerRejectionLogic.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `app/services/api/bearerRejectionLogic.ts`**

```ts
/**
 * Pure decision behind the bearer-rejection monitor in services/api/index.ts.
 *
 * Kept free of @/ imports and side effects so vitest can load it (see
 * CLAUDE.md "Test Runner Split"). ADDED 2026-09-10; spec:
 * docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md
 *
 * The API (v1.7.0+) puts a machine-readable `code` on every bearer rejection.
 * Only three of them mean "this token can never work, sign in again". The
 * rest — token_expired (the gate refreshes), token_invalid, a 503
 * auth_unavailable (the API could not reach Auth0's keys), and the code-less
 * 401s for a bad X-API-Key or a missing header — must never eject. Loki
 * showed 10 JWKS timeouts against 8 genuine malformed tokens in one month;
 * ejecting on a message string would have signed out healthy users.
 */

export const BEARER_EJECT_CODES: readonly string[] = [
  "token_malformed",
  "token_claims",
  "token_signature",
]

/**
 * Case-insensitive header read that works on both shapes a monitor can see:
 * an axios 1.x AxiosHeaders instance (has get()) and a plain object. The
 * request transform in index.ts sees a plain object; by the time a monitor
 * runs, response.config.headers is an AxiosHeaders — do not bracket-index it.
 */
export function readHeader(headers: unknown, name: string): string | undefined {
  if (headers === null || typeof headers !== "object") return undefined

  const maybeGet = (headers as { get?: unknown }).get
  if (typeof maybeGet === "function") {
    const value: unknown = maybeGet.call(headers, name)
    return typeof value === "string" ? value : undefined
  }

  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === wanted) return typeof value === "string" ? value : undefined
  }
  return undefined
}

/**
 * The eject code when this response says the bearer can never work, else null.
 * A request that bypassed the auth gate (SKIP_AUTH_GATE_HEADER) never had a
 * bearer stamped, so "carried a bearer" already excludes it.
 */
export function bearerRejectionCode(
  status: number | undefined,
  requestHeaders: unknown,
  data: unknown,
): string | null {
  if (status !== 401) return null

  const authorization = readHeader(requestHeaders, "Authorization")
  if (!authorization || !authorization.startsWith("Bearer ")) return null

  if (data === null || typeof data !== "object") return null
  const code = (data as { code?: unknown }).code
  if (typeof code !== "string") return null

  return BEARER_EJECT_CODES.includes(code) ? code : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/services/api/bearerRejectionLogic.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Wire the monitor into `Api`**

In `app/services/api/index.ts`:

1. Add the import next to the `./apiProblem` import:

```ts
import { bearerRejectionCode } from "./bearerRejectionLogic"
```

2. Extend `TokenRefreshers`:

```ts
export interface TokenRefreshers {
  /** Fresh device JWT, or null when running the X-API-Key fallback. */
  device: () => Promise<string | null>
  /** Fresh access token, or null when anonymous / signed out. */
  user: () => Promise<string | null>
  /**
   * ADDED 2026-09-10: the server answered a bearer with a code meaning it can
   * never work (see bearerRejectionLogic.ts). Wired to the user refresher's
   * markRejected() so the session is ejected exactly like a dead refresh
   * token. Optional: tests and early cold start have no refresher yet.
   */
  onBearerRejected?: () => void
}
```

3. In the constructor, after `this.installAuthGate()`, add `this.installBearerRejectionMonitor()`.

4. Add the method directly after `installAuthGate()`:

```ts
  /**
   * Watch every RecoverySky response for a bearer the server says can never
   * work and hand the verdict to the user refresher.
   *
   * ADDED 2026-09-10. A monitor rather than a response transform because it
   * must not alter the response — the call site still gets its
   * `{ kind: "unauthorized" }` and shows the sign-in-again toast; the eject
   * happens beside it. The decision is in bearerRejectionLogic.ts (pure,
   * vitest-covered); this only logs and forwards. Dedupe is the refresher's
   * latch, not ours.
   */
  private installBearerRejectionMonitor() {
    this.recoverySkyApi.addMonitor((response) => {
      const code = bearerRejectionCode(response.status, response.config?.headers, response.data)
      if (!code) return
      log.error("Server rejected the bearer as unusable", {
        source: "server-401",
        code,
        url: response.config?.url,
      })
      this.refreshers.onBearerRejected?.()
    })
  }
```

- [ ] **Step 6: Wire `markRejected` in `app.tsx`**

In `app/app.tsx`, change the `api.registerTokenRefreshers({ … })` call to:

```ts
        api.registerTokenRefreshers({
          device: deviceRefresher.getToken,
          user: userRefresher.getToken,
          // ADDED 2026-09-10: a 401 with token_malformed / token_claims /
          // token_signature latches the user lane and ejects (timer-aware,
          // via onPermanentFailure above). token_expired, token_invalid, a
          // code-less 401 and the 503 auth_unavailable never reach this.
          onBearerRejected: userRefresher.markRejected,
        })
```

- [ ] **Step 7: Confirm no call site turns `server` into a sign-out**

Run:

```bash
grep -rn 'kind === "server"\|case "server"' app --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
```

Expected: no matches outside `app/services/api/apiProblem.ts`. (If a match appears, read it; the 503 `auth_unavailable` must flow through it without logging anyone out.)

- [ ] **Step 8: Type-check, lint deps, run all vitest, lint files**

```bash
npm run compile
npm run lint:deps
npm run test:unit
npx eslint app/services/api/bearerRejectionLogic.ts app/services/api/bearerRejectionLogic.test.ts app/services/api/index.ts app/app.tsx
```

Expected: all clean. `lint:deps` matters here — `services/api` must stay a dependency leaf and this task adds only a sibling import.

- [ ] **Step 9: Commit**

```bash
git add app/services/api/bearerRejectionLogic.ts app/services/api/bearerRejectionLogic.test.ts app/services/api/index.ts app/app.tsx
git commit -m "✨ feat(api): eject the session when the server says the bearer can never work

An apisauce monitor recognises the API's token_malformed / token_claims /
token_signature codes (api v1.7.0) on a 401 that carried a bearer and trips
the user refresher's latch. token_expired, token_invalid, code-less 401s
and the 503 auth_unavailable are ignored — the decision is pure and
vitest-covered in bearerRejectionLogic.ts.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DQhYE5Uof4HmfPZuTH7eyJ"
```

---

### Task 7: Report-send toast copy as `tx` keys, sign-in-again on `unauthorized`

**Files:**
- Modify: `app/i18n/en.ts`, `app/i18n/es.ts`, `app/i18n/ar.ts`, `app/i18n/de.ts`, `app/i18n/fr.ts`, `app/i18n/pt.ts`, `app/i18n/ru.ts`, `app/i18n/th.ts`, `app/i18n/uk.ts`
- Modify: `app/hooks/useReportSender.ts`

**Interfaces:**
- Produces: `TxKeyPath` values `"attendanceScreen:sendFailed"` and `"attendanceScreen:sendFailedSignIn"`.

- [ ] **Step 1: Add the keys to `en.ts`**

In `app/i18n/en.ts`, inside `attendanceScreen: {`, directly after the `goToSettings:` line, add:

```ts
    // Report-send toasts. ADDED 2026-09-10 — these were hardcoded English in
    // useReportSender. sendFailedSignIn is shown when the API answered 401;
    // the forced logout usually swaps to Login in the same tick, so it is a
    // one-line explanation of why the screen changed.
    sendFailed: "Failed to send report",
    sendFailedSignIn: "Please sign in again to send this report",
```

- [ ] **Step 2: Add the same keys to the other eight locales**

In each of `es.ts`, `ar.ts`, `de.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `th.ts`, `uk.ts`, find the line `  attendanceScreen: {` and insert directly after it:

```ts
    // English placeholder — queue for native-speaker review (docs/translation-review-2026-08-03.md)
    sendFailed: "Failed to send report",
    sendFailedSignIn: "Please sign in again to send this report",
```

- [ ] **Step 3: Verify the type gate**

Run: `npm run compile`
Expected: clean. (A missing key in any locale is a hard `tsc` error — that is the check.)

- [ ] **Step 4: Use the keys in `useReportSender.ts`**

1. Add `import type { TxKeyPath } from "@/i18n"` to the `@/` import block.

2. Move the `ShowToast` type above `processApiResult` and widen it (delete the later `type ShowToast = …` line at ~153):

```ts
type ShowToast = (config: {
  message?: string
  tx?: TxKeyPath
  type: "success" | "error"
  duration?: number
}) => void
```

3. In `processApiResult`, change the parameter `showToast: (config: { message: string; … }) => void` to `showToast: ShowToast`.

4. Replace the three `showToast({ message: "Failed to send report", type: "error" })` calls:

   - In the `if (data.error)` branch (line ~105): `showToast({ tx: "attendanceScreen:sendFailed", type: "error" })`
   - In the non-ok tail of `processApiResult` (line ~145), replace the single line with:

```ts
  // CHANGED 2026-09-10: a 401 means the bearer was rejected. The API-client
  // monitor is ejecting the session beside this; tell the user why the
  // screen is about to change instead of a generic failure.
  const tx: TxKeyPath =
    apiResult.kind === "unauthorized" ? "attendanceScreen:sendFailedSignIn" : "attendanceScreen:sendFailed"
  showToast({ tx, type: "error" })
```

   - In the hook's `catch` (line ~378): `toast.showToast({ tx: "attendanceScreen:sendFailed", type: "error" })`

- [ ] **Step 5: Type-check and lint**

Run: `npm run compile && npx eslint app/hooks/useReportSender.ts app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/hooks/useReportSender.ts app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts
git commit -m "🌐 i18n(attendance): report-send failure toasts as tx keys, sign-in-again on 401

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DQhYE5Uof4HmfPZuTH7eyJ"
```

---

### Task 8: Changelog, docs, full verification, manual checklist

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md` (the "Auth, Attestation & Encryption Keys" section)
- Modify: `docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md` (status line)

- [ ] **Step 1: CHANGELOG entry**

Under `## [Unreleased]` in `CHANGELOG.md`, add:

```markdown
### Fixed

- **A stale sign-in could silently break report sending.** A refresh token from
  a login made without the API audience (every TestFlight build from 3.12.1
  through 4.1.6 shipped that way) renews into an opaque Auth0 token the API can
  never accept. The app stored it like a real one, so meeting lists worked but
  every report send and push-token registration answered 401 and the user only
  saw "Failed to send report". The app now checks the shape of every access
  token where one enters the store (cold-start hydration, the Auth0 SDK sync,
  the request-gate refresher) and, when the API rejects a bearer with one of
  its new `token_malformed` / `token_claims` / `token_signature` codes, signs
  the user out through the existing forced-logout path so the next login mints
  a proper token. Expired tokens and the API's 503 `auth_unavailable` never
  trigger this. The report toast on a 401 now reads "Please sign in again to
  send this report" (new `attendanceScreen:sendFailed*` keys, English
  placeholder in the other eight locales).
```

- [ ] **Step 2: CLAUDE.md note**

In `CLAUDE.md`, section "Auth, Attestation & Encryption Keys", item 1 (User identity — Auth0), append after the sentence ending "`vault.ts` is a **web-only** tweetnacl-obscured storage shim (native uses Keychain/Keystore instead).":

```markdown
   ADDED 2026-09-10: every access token is shape-checked by the pure
   `isUsableAccessToken()` (`jwtUtils.ts`) before it enters the store —
   cold-start hydration, the SDK sync effect, and the refresher all apply
   it — because an audience-less refresh token renews into an opaque
   userinfo-only token forever. The user-lane refresher now lives in
   `userTokenRefresher.ts` with injected I/O (vitest-covered); the API's
   bearer-rejection codes reach its `markRejected()` through an apisauce
   monitor (`bearerRejectionLogic.ts`). Spec:
   `docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md`.
```

Also in the "Token freshness gate" bullet list, after the bullet beginning "A refresh failure classified `permanent`", add:

```markdown
- Two more things latch the user lane the same way (2026-09-10): a renewed
  token that fails `isUsableAccessToken()` (thrown as `UnusableTokenError`,
  classified permanent) and a 401 carrying `token_malformed` /
  `token_claims` / `token_signature` from the API. `token_expired`,
  `token_invalid`, a code-less 401 and a 503 `auth_unavailable` never do.
```

- [ ] **Step 3: Spec status**

In the spec's header, change `App half (Sections 1–3) not yet implemented.` to `App half implemented 2026-09-10 (plan: docs/superpowers/plans/2026-09-10-opaque-access-token-app-half.md); awaiting the manual checklist and OTA.`

- [ ] **Step 4: Full verification**

```bash
npm run compile
npm run lint:deps
npm test
git status
```

Expected: compile clean, depcruise clean, vitest and jest green. `git status` shows only the files this plan touched (plus any foreign files from concurrent sessions — leave those alone).

- [ ] **Step 5: Commit docs**

```bash
git add CHANGELOG.md CLAUDE.md docs/superpowers/specs/2026-09-10-opaque-access-token-after-idle-renewal-design.md docs/superpowers/specs/2026-09-10-api-bearer-rejection-codes-change-request.md docs/superpowers/plans/2026-09-10-opaque-access-token-app-half.md
git commit -m "📝 docs(auth): changelog + CLAUDE.md for the opaque-token fix, track the spec and plan

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DQhYE5Uof4HmfPZuTH7eyJ"
```

- [ ] **Step 6: Manual checklist on a dev build (before `npm run update`)**

Do these on a device or simulator with a dev build. Record results in the spec's Testing section.

1. **Baseline.** Sign in normally. Send a report. Expect success.
2. **Call site 1 (hydration).** Temporarily add, at the top of `setupRootStore()`, `await saveAuthCredentials({ accessToken: "opaque-test-token", refreshToken: "x", expiresAt: Date.now() + 86_400_000 })` (import from `@/services/auth/secureStorage`), cold start once, then remove the line. Expect the WARN `Stored access token unusable — discarding` with `source: "hydration"`, `reason: "not-jwt"`, then either the Login screen or a good token from the SDK sync. Nothing in the log contains the string `opaque-test-token`.
3. **Call site 2 (SDK sync).** In `.env` set `EXPO_PUBLIC_AUTH0_AUDIENCE=` (empty), `npm start -- --clear`, sign out, sign in (Auth0 issues an opaque token; with an empty audience the check skips the audience rule, so this login succeeds). Restore the audience in `.env`, `npm start -- --clear`, cold start. Expect the ERROR `Auth0 SDK returned unusable access token — signing out` with `source: "sdk-sync"`, `reason: "not-jwt"`, and the Login screen. This is the exact shape of the production sessions from builds ≤ 4.1.6.
4. **Post-eject re-login.** Tap Login after step 3. Expect it to complete without a password prompt (the Auth0 web-session cookie survived). Send a report. Expect success.
5. **Monitor, real API.** With a good session, in `installAuthGate()` temporarily replace the stamped bearer with `"Bearer opaque-test"` for a single request by adding `if (request.url === "/reports") headers["Authorization"] = "Bearer opaque-test"` after the real stamp, send a report, then remove the line. Expect: toast "Please sign in again to send this report", the ERROR `Server rejected the bearer as unusable` with `code: "token_malformed"`, and the Login screen. Only ONE `source: "server-401"` line even though the push-token path may 401 too.
6. **Monitor, negative.** Repeat step 5 but point the fake bearer at a route the API answers with a **503**: not reproducible without a proxy, so instead assert from the unit tests (`bearerRejectionLogic.test.ts`) and from step 7.
7. **Timer deferral.** Start an in-person or external-Zoom attendance timer, then trigger step 5. Expect `Refresh dead but timer is live — deferring logout` and the timer still running; Save the timer; expect the eject to fire then.
8. **Loki.** After the OTA reaches devices: `{service_name="recoverysky-app"} |= "server-401"` shows at most one line per device, and `{service_name="app_api"} |= "token_malformed"` shows no repeats from one device.

- [ ] **Step 7: Ship**

Only after the checklist passes. This is JS-only: **no `runtimeVersion` bump.** Move the `[Unreleased]` changelog entry under the `[4.10.0-N]` heading the counter is about to create, commit it, then `npm run update`.

---

## Self-review

**Spec coverage.** Section 1 helper → Task 1; call site 1 → Task 4; call site 2 → Task 5; call site 3 + `UnusableTokenError` + `markRejected` → Tasks 2, 3; Section 2 monitor + `onBearerRejected` → Task 6; Section 3 toast copy as tx keys → Task 7; Section 3 timer note and re-login note → manual steps 4 and 7; Section 4 telemetry (`source` on every line: `hydration` Task 4, `sdk-sync` Task 5, `refresh` Task 3, `server-401` Tasks 3 and 6, with `code` on the monitor line) → covered; Testing list → Tasks 1, 2, 3, 6 unit, Task 8 manual; the "no call site maps `server` to a sign-out" assertion → Task 6 Step 7. Out of scope items untouched. The spec's Testing section said the refresher tests live "alongside `tokenFreshnessLogic.test.ts`"; they live in `userTokenRefresher.test.ts` in the same folder because the refresher needed its own module to be loadable — Task 8 Step 3 records that.

**Deviation from spec, deliberate.** The spec wires `onUnusableToken` as a wrapper prop from `app.tsx`. `app.tsx` does not call the wrapper (AppNavigator and three screens do), so Task 5 uses a module-level registration and routes through `markRejected()` rather than directly through `onPermanentFailure`, which also gives the latch for free. Same forced-logout path, same timer deferral.

**Type consistency.** `UnusableTokenReason` (Task 1) is consumed by Tasks 2, 3, 5. `buildUserTokenRefresher` / `UserTokenRefresher` / `FreshCredentials` / `UserRefresherIo` (Task 3) are consumed by Task 3's binder only; `markRejected` is consumed by Tasks 5 and 6. `bearerRejectionCode(status, requestHeaders, data)` (Task 6) matches its call. `TokenRefreshers.onBearerRejected` (Task 6) matches `app.tsx`. `ShowToast` widened in Task 7 matches `ToastConfig` in `Toast.tsx` (`message?`, `tx?`). `attendanceScreen:sendFailed` uses the colon first-level separator that `TxKeyPath` requires.

**Placeholders.** None; every step carries its code or exact command.
