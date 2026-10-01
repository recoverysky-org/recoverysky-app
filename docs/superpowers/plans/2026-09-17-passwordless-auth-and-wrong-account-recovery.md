# Passwordless Auth & Wrong-Account Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-based login with an in-app email-code flow plus direct-to-provider Apple/Google buttons, and make a wrong-account login on an owned device recover to the owner with a persistent identity link.

**Architecture:** Pure decision modules (`loginFlowLogic.ts`, `ownerLogic.ts`, extended `authErrorLogic.ts`) carry every rule and are vitest-covered; `useAuth0Wrapper.ts` stays the only file that talks to `react-native-auth0` and gains the passwordless calls, the ownership gate, and the foreign-session lifecycle; the login screen becomes three exported presentational steps; a new `WrongAccountScreen` reuses them. On the API, `POST /auth0/link` verifies the foreign ID token against the Native app's client id, reassigns the seven user-keyed tables inside one pg transaction, and links via the Management API before commit.

**Tech Stack:** React Native 0.81 / Expo 54, `react-native-auth0` 5.x hook API (`sendEmailCode`, `authorizeWithEmail`, `authorize({ connection })`, `clearCredentials`, `clearSession`), MobX-State-Tree, vitest (pure `.test.ts`) + jest-expo (`.test.tsx`), Express + zod + jose + node-postgres on the API.

**Specs:**
- `docs/superpowers/specs/2026-09-12-passwordless-login-design.md` (spec 1)
- `docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md` (spec 2)

## Global Constraints

- **Two repos.** App tasks run in `/Users/jenova/projects/recoverysky-org/app` on branch `feat/passwordless-auth` (create a worktree via `superpowers:using-git-worktrees`). API tasks (13–16) run in `/Users/jenova/projects/recoverysky-org/api` on branch `feat/identity-link`. Every subagent dispatch must `cd` explicitly and check `git branch --show-current` first — subagents launch in the main checkout (see memory `subagents-dont-inherit-worktree-cwd`).
- **Shared checkout discipline.** Stage only the paths you touched (`git add <path>`), never `git add -A`; never `git stash`. Lint only the files you touched: `npx eslint --fix <files>`, never `npm run lint`.
- **Test runner split.** `*.test.ts` → vitest, pure TypeScript with **no runtime `@/` imports** (type-only imports are fine). `*.test.tsx` → jest-expo. Run one file with `npm run test:unit -- <path>` / `npm run test:component -- <path>`.
- **No `runtimeVersion` bump.** Everything here is JS-only. Do not touch `app.json`.
- **No new dependencies** in either repo.
- **i18n is a nine-file change**: `en`, `es`, `ar`, `de`, `fr`, `pt`, `ru`, `th`, `uk`. `npm run compile` fails until every locale has every key. Non-English locales ship the English text as a placeholder.
- **Never log PII**: no `user.sub` raw (use `hashUserId()`), no emails, no codes. IDs in logs are the 16-hex hash.
- **A foreign session never writes tokens, `userId`, our SecureStore copy, or `loginMethod`**, and nothing reachable from `WrongAccountScreen` deletes or rekeys local data.
- **Audience on the code login is load-bearing**: `authorizeWithEmail` must receive `audience: AUTH0_CONFIG.audience` and `scope: AUTH0_CONFIG.scopes.join(" ")`, or the token is opaque and `isUsableAccessToken()` signs the user straight out.
- **Comments are part of the change** (CLAUDE.md "Comments"): every non-obvious line gets a why; changed behaviour keeps the old comment and appends a dated `CHANGED`/`ADDED` note.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn
  ```
- **Ship gate (not a code task):** nothing merges until spec 1 §3 (tenant runbook) is complete on the production tenant. API deploys first; the app OTA follows.

---

## File Structure

**App — create**
- `app/services/auth/loginFlowLogic.ts` (+ `.test.ts`) — email mask, plausibility check, resend cooldown, step transitions. Pure.
- `app/services/auth/ownerLogic.ts` (+ `.test.ts`) — `decideOwnership`, `ownerProofMethod`. Pure.
- `app/services/auth/linkForeignIdentity.ts` — calls `api.linkIdentity` with the content-retry ladder. I/O.
- `app/screens/login/LoginSteps.tsx` (+ `LoginSteps.test.tsx`) — `ChooseStep`, `EmailStep`, `CodeStep`, presentational.
- `app/screens/WrongAccountScreen.tsx` (+ `WrongAccountView.test.tsx`) — observer shell + presentational `WrongAccountView`.

**App — modify**
- `app/services/auth/authErrorLogic.ts` (+ test) — passwordless error classes.
- `app/models/AuthenticationStore.ts` — `loginMethod`, `ownerSub`, `ownerEmail` props; volatile `foreignSession`; actions.
- `app/models/helpers/setupRootStore.ts` — stamp the owner from a signed-in hydration.
- `app/services/auth/useAuth0Wrapper.ts` — `sendCode`, `verifyCode`, `loginWithProvider`, `abandonForeignSession`, logout branch, ownership gate, link trigger; `login`/`signup` removed.
- `app/screens/LoginScreen.tsx` — three-state shell around the steps; legal modal untouched.
- `app/navigators/AppNavigator.tsx`, `app/navigators/navigationTypes.ts` — `WrongAccount` route.
- `app/db/resetLocalDatabase.ts` (+ callers `SettingsScreen.tsx`, `DatabaseProvider.tsx`) — clears the owner record.
- `app/services/api/index.ts`, `app/services/api/types.ts` — `linkIdentity`.
- `app/i18n/*.ts` (nine files), `CHANGELOG.md`, `CLAUDE.md`, `docs/BACKUP.md`, `docs/DIAGNOSTICS.md`, `docs/translation-review-2026-08-03.md`, `docs/superpowers/specs/2026-09-12-react-native-auth0-5.11-upgrade-design.md`.

**API — create**
- `src/services/identitySweep.ts` (+ `.test.ts`) — `reassignUserRows(client, …)` over a pg client.

**API — modify**
- `src/config/index.ts` — `auth.mobileClientId` ← `AUTH_MOBILE_CLIENT_ID`.
- `src/middleware/auth.ts` (+ test) — `verifyIdToken()`.
- `src/routes/auth0.ts` (+ test) — `POST /auth0/link`.
- `TODO.md` / env notes.

---

### Task 1: Pure login-flow logic

**Files:**
- Create: `app/services/auth/loginFlowLogic.ts`
- Test: `app/services/auth/loginFlowLogic.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LoginStep = "choose" | "email" | "code"
  export type LoginEvent = "chooseEmail" | "chooseOwnerEmail" | "codeSent" | "back" | "wrongEmail" | "tooManyAttempts" | "sendRateLimited"
  export const RESEND_COOLDOWN_MS = 30_000
  export function maskEmail(email: string): string
  export function isPlausibleEmail(value: string): boolean
  export function resendWaitSeconds(lastSentAt: number | null, now: number): number  // 0 = allowed
  export function nextStep(step: LoginStep, event: LoginEvent): LoginStep
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// app/services/auth/loginFlowLogic.test.ts
import { describe, expect, it } from "vitest"

import {
  RESEND_COOLDOWN_MS,
  isPlausibleEmail,
  maskEmail,
  nextStep,
  resendWaitSeconds,
} from "./loginFlowLogic"

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("jenova@proton.me")).toBe("j***@proton.me")
  })
  it("handles a one-character local part", () => {
    expect(maskEmail("j@proton.me")).toBe("j***@proton.me")
  })
  it("returns the input unchanged when there is no @", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email")
  })
  it("trims and lowercases before masking", () => {
    expect(maskEmail("  Jenova@Proton.me ")).toBe("j***@proton.me")
  })
})

describe("isPlausibleEmail", () => {
  it("accepts x@y.z shapes and nothing stricter", () => {
    expect(isPlausibleEmail("a@b.c")).toBe(true)
    expect(isPlausibleEmail("first.last+tag@sub.example.org")).toBe(true)
  })
  it("rejects missing parts and whitespace", () => {
    expect(isPlausibleEmail("")).toBe(false)
    expect(isPlausibleEmail("a@b")).toBe(false)
    expect(isPlausibleEmail("a b@c.d")).toBe(false)
    expect(isPlausibleEmail("@b.c")).toBe(false)
  })
})

describe("resendWaitSeconds", () => {
  it("allows a first send", () => {
    expect(resendWaitSeconds(null, 1_000)).toBe(0)
  })
  it("counts down whole seconds inside the cooldown", () => {
    expect(resendWaitSeconds(0, 1_000)).toBe(29)
    expect(resendWaitSeconds(0, RESEND_COOLDOWN_MS - 1)).toBe(1)
  })
  it("is 0 at exactly the cooldown boundary", () => {
    expect(resendWaitSeconds(0, RESEND_COOLDOWN_MS)).toBe(0)
  })
})

describe("nextStep", () => {
  it("walks choose → email → code", () => {
    expect(nextStep("choose", "chooseEmail")).toBe("email")
    expect(nextStep("email", "codeSent")).toBe("code")
  })
  it("skips the email step for the owner-aware button", () => {
    expect(nextStep("choose", "chooseOwnerEmail")).toBe("code")
  })
  it("goes back one step, and from code to email on wrongEmail", () => {
    expect(nextStep("email", "back")).toBe("choose")
    expect(nextStep("code", "back")).toBe("email")
    expect(nextStep("code", "wrongEmail")).toBe("email")
    expect(nextStep("choose", "back")).toBe("choose")
  })
  it("returns to email when the only remedy is waiting", () => {
    expect(nextStep("code", "tooManyAttempts")).toBe("email")
    expect(nextStep("code", "sendRateLimited")).toBe("email")
    expect(nextStep("email", "sendRateLimited")).toBe("email")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/services/auth/loginFlowLogic.test.ts`
Expected: FAIL — `Cannot find module './loginFlowLogic'`

- [ ] **Step 3: Write the implementation**

```ts
// app/services/auth/loginFlowLogic.ts
/**
 * Pure decisions for the three-state login screen (spec:
 * docs/superpowers/specs/2026-09-12-passwordless-login-design.md §1, §4.1).
 *
 * PURE MODULE — no `@/` runtime imports, no React, no native modules, so
 * vitest can load it (CLAUDE.md "Test Runner Split"). The screen owns the
 * I/O and calls these.
 */

export type LoginStep = "choose" | "email" | "code"

export type LoginEvent =
  | "chooseEmail"
  | "chooseOwnerEmail"
  | "codeSent"
  | "back"
  | "wrongEmail"
  | "tooManyAttempts"
  | "sendRateLimited"

/**
 * Our own resend hold-off. Auth0's per-address send limit is stricter over an
 * hour; this just stops a double-tap from burning two codes.
 */
export const RESEND_COOLDOWN_MS = 30_000

/**
 * `j***@proton.me`. Shown wherever the address might be glanced at on a shared
 * screen — the login screen's owner button, the code step header, and the
 * wrong-account screen. Always the same three asterisks so the mask never
 * leaks the local part's length.
 */
export function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase()
  const at = normalized.indexOf("@")
  if (at <= 0) return email
  return `${normalized[0]}***${normalized.slice(at)}`
}

/**
 * Deliberately permissive: `x@y.z`. Real validation is Auth0's job — a code
 * that never arrives is the feedback. This only gates the Send button so an
 * obviously unfinished address doesn't fire a request.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/** Seconds left before Resend is allowed again; 0 means allowed now. */
export function resendWaitSeconds(lastSentAt: number | null, now: number): number {
  if (lastSentAt === null) return 0
  const remainingMs = lastSentAt + RESEND_COOLDOWN_MS - now
  if (remainingMs <= 0) return 0
  return Math.ceil(remainingMs / 1000)
}

/**
 * Step transitions. `tooManyAttempts` / `sendRateLimited` return to `email`
 * on purpose: the only remedy is waiting, and leaving the user on `code`
 * invites more failed attempts and a longer lockout.
 */
export function nextStep(step: LoginStep, event: LoginEvent): LoginStep {
  switch (event) {
    case "chooseEmail":
      return "email"
    case "chooseOwnerEmail":
      return "code"
    case "codeSent":
      return "code"
    case "back":
      if (step === "code") return "email"
      return "choose"
    case "wrongEmail":
      return "email"
    case "tooManyAttempts":
    case "sendRateLimited":
      return "email"
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/services/auth/loginFlowLogic.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Lint and commit**

```bash
npx eslint --fix app/services/auth/loginFlowLogic.ts app/services/auth/loginFlowLogic.test.ts
git add app/services/auth/loginFlowLogic.ts app/services/auth/loginFlowLogic.test.ts
git commit -m "✨ feat(auth): pure login-flow logic for the passwordless screen

Email mask, plausibility gate, resend cooldown and step transitions,
vitest-covered. Spec: 2026-09-12-passwordless-login-design.md §1, §4.1.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 2: Classify passwordless errors

**Files:**
- Modify: `app/services/auth/authErrorLogic.ts`
- Test: `app/services/auth/authErrorLogic.test.ts`

**Interfaces:**
- Produces: `AuthErrorMessageKey` gains `"wrongCode" | "codeExpired" | "tooManyAttempts" | "sendRateLimited" | "passwordlessNotEnabled"`. `classifyAuthError(err)` unchanged signature.
- The SDK's `AuthError` (Authentication API failures) carries `code`, `message`, and `status`; `WebAuthError` carries `type`. Both are duck-typed here.

- [ ] **Step 1: Add the failing tests** (append inside the existing `describe`)

```ts
  describe("passwordless outcomes (ADDED 2026-09-17)", () => {
    it("maps invalid_grant to wrongCode", () => {
      expect(
        classifyAuthError({ code: "invalid_grant", message: "Wrong email or verification code." }),
      ).toBe("wrongCode")
    })
    it("maps an expired code, which Auth0 also reports as invalid_grant", () => {
      expect(
        classifyAuthError({ code: "invalid_grant", message: "The verification code has expired." }),
      ).toBe("codeExpired")
    })
    it("maps too_many_attempts", () => {
      expect(classifyAuthError({ code: "too_many_attempts", message: "Too many attempts" })).toBe(
        "tooManyAttempts",
      )
    })
    it("maps a 429 / too_many_requests on send to sendRateLimited", () => {
      expect(classifyAuthError({ code: "too_many_requests", message: "..." })).toBe("sendRateLimited")
      expect(classifyAuthError({ status: 429, message: "Too Many Requests" })).toBe("sendRateLimited")
    })
    it("maps unauthorized_client to passwordlessNotEnabled (tenant runbook not done)", () => {
      expect(
        classifyAuthError({ code: "unauthorized_client", message: "Grant type not allowed" }),
      ).toBe("passwordlessNotEnabled")
    })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/services/auth/authErrorLogic.test.ts`
Expected: FAIL — five new cases return `null`

- [ ] **Step 3: Extend the classifier**

Replace the type and the interface, and add the branches before the existing `return null`:

```ts
export type AuthErrorMessageKey =
  | "browserTerminated"
  | "networkError"
  // ADDED 2026-09-17 for the in-app passwordless flow (spec 1 §2.5). These
  // come from the Authentication API (`AuthError.code`), not the web-auth
  // `type` field.
  | "wrongCode"
  | "codeExpired"
  | "tooManyAttempts"
  | "sendRateLimited"
  | "passwordlessNotEnabled"

/** Shape-only view of a react-native-auth0 `WebAuthError` / `AuthError` (or anything thrown). */
interface AuthErrorLike {
  type?: unknown
  code?: unknown
  status?: unknown
  message?: unknown
}
```

```ts
  const code = typeof (err as AuthErrorLike).code === "string" ? ((err as AuthErrorLike).code as string) : ""
  const status = typeof (err as AuthErrorLike).status === "number" ? ((err as AuthErrorLike).status as number) : 0

  // Auth0 reports both a wrong and an expired OTP as invalid_grant; only the
  // description tells them apart. Exact strings to be confirmed against the
  // tenant (spec 1 §6) — the regex is deliberately loose.
  if (code === "invalid_grant") return /expir/i.test(msg) ? "codeExpired" : "wrongCode"
  if (code === "too_many_attempts") return "tooManyAttempts"
  if (code === "too_many_requests" || status === 429) return "sendRateLimited"
  // The Passwordless OTP grant is missing on the application — runbook §3.2.
  if (code === "unauthorized_client") return "passwordlessNotEnabled"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit -- app/services/auth/authErrorLogic.test.ts`
Expected: PASS (all cases, old ones included)

- [ ] **Step 5: Lint and commit**

```bash
npx eslint --fix app/services/auth/authErrorLogic.ts app/services/auth/authErrorLogic.test.ts
git add app/services/auth/authErrorLogic.ts app/services/auth/authErrorLogic.test.ts
git commit -m "✨ feat(auth): classify passwordless OTP failures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 3: Owner logic

**Files:**
- Create: `app/services/auth/ownerLogic.ts`
- Test: `app/services/auth/ownerLogic.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OwnershipDecision = "adopt" | "match" | "mismatch"
  export function decideOwnership(input: { ownerSub: string | undefined; sessionSub: string; isAnonymous: boolean }): OwnershipDecision
  export type ProofMethod = "code" | "google" | "apple" | "unknown"
  export function ownerProofMethod(sub: string | undefined): ProofMethod
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// app/services/auth/ownerLogic.test.ts
import { describe, expect, it } from "vitest"

import { decideOwnership, ownerProofMethod } from "./ownerLogic"

describe("decideOwnership", () => {
  it("adopts when the device has no owner yet", () => {
    expect(decideOwnership({ ownerSub: undefined, sessionSub: "email|1", isAnonymous: false })).toBe("adopt")
  })
  it("matches the owner", () => {
    expect(decideOwnership({ ownerSub: "auth0|a", sessionSub: "auth0|a", isAnonymous: false })).toBe("match")
  })
  it("flags a different account", () => {
    expect(decideOwnership({ ownerSub: "auth0|a", sessionSub: "google-oauth2|b", isAnonymous: false })).toBe("mismatch")
  })
  it("never stamps or blocks an anonymous session", () => {
    expect(decideOwnership({ ownerSub: undefined, sessionSub: "device-1", isAnonymous: true })).toBe("match")
    expect(decideOwnership({ ownerSub: "auth0|a", sessionSub: "device-1", isAnonymous: true })).toBe("match")
  })
})

describe("ownerProofMethod", () => {
  it("sends a code for email and legacy password owners", () => {
    expect(ownerProofMethod("email|abc")).toBe("code")
    expect(ownerProofMethod("auth0|abc")).toBe("code")
  })
  it("uses the provider button for social owners", () => {
    expect(ownerProofMethod("google-oauth2|123")).toBe("google")
    expect(ownerProofMethod("apple|000123.abc")).toBe("apple")
  })
  it("is unknown for anything else", () => {
    expect(ownerProofMethod("sms|1")).toBe("unknown")
    expect(ownerProofMethod("")).toBe("unknown")
    expect(ownerProofMethod(undefined)).toBe("unknown")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/services/auth/ownerLogic.test.ts`
Expected: FAIL — `Cannot find module './ownerLogic'`

- [ ] **Step 3: Write the implementation**

```ts
// app/services/auth/ownerLogic.ts
/**
 * Device ownership decisions (spec:
 * docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md §1.2).
 *
 * PURE MODULE — no `@/` runtime imports so vitest can load it. The I/O half
 * (reading/writing the store, routing) is in useAuth0Wrapper.ts and
 * AppNavigator.tsx.
 */

export type OwnershipDecision = "adopt" | "match" | "mismatch"

/**
 * One device, one owner. Anonymous sessions never own a device and are never
 * blocked by one — the first real sign-in adopts.
 */
export function decideOwnership(input: {
  ownerSub: string | undefined
  sessionSub: string
  isAnonymous: boolean
}): OwnershipDecision {
  if (input.isAnonymous) return "match"
  if (!input.ownerSub) return "adopt"
  return input.ownerSub === input.sessionSub ? "match" : "mismatch"
}

export type ProofMethod = "code" | "google" | "apple" | "unknown"

/**
 * How the owner proves it's them, derived from the Auth0 sub prefix rather
 * than stored — storing it would let the two drift.
 *
 * `auth0|` (legacy password account) maps to `code` on purpose: spec 1's
 * post-login Action links an `email|` login into the password account when
 * the addresses match, so a code sent to ownerEmail returns the owner's sub.
 */
export function ownerProofMethod(sub: string | undefined): ProofMethod {
  if (!sub) return "unknown"
  if (sub.startsWith("email|") || sub.startsWith("auth0|")) return "code"
  if (sub.startsWith("google-oauth2|")) return "google"
  if (sub.startsWith("apple|")) return "apple"
  return "unknown"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/services/auth/ownerLogic.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Lint and commit**

```bash
npx eslint --fix app/services/auth/ownerLogic.ts app/services/auth/ownerLogic.test.ts
git add app/services/auth/ownerLogic.ts app/services/auth/ownerLogic.test.ts
git commit -m "✨ feat(auth): pure device-ownership decisions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 4: AuthenticationStore fields

**Files:**
- Modify: `app/models/AuthenticationStore.ts`

**Interfaces:**
- Produces (used by Tasks 6–11):
  ```ts
  export type LoginMethod = "email" | "apple" | "google"
  export interface ForeignSession { sub: string; email?: string; idToken?: string; loginMethod?: LoginMethod }
  // props (MMKV): loginMethod?: LoginMethod; ownerSub?: string; ownerEmail?: string
  // volatile: foreignSession?: ForeignSession
  // actions: setLoginMethod(m?: LoginMethod), setOwner(sub: string, email?: string), clearOwner(),
  //          setForeignSession(fs: ForeignSession), clearForeignSession()
  // logout() additionally clears loginMethod and foreignSession; never touches ownerSub/ownerEmail
  ```
- No vitest possible (the store imports `@/utils/logger`); verification is `npm run compile` plus Task 7's jest test which mounts nothing of the store. Behaviour is exercised end-to-end by the manual checklist (Task 18).

- [ ] **Step 1: Add the types and props**

Above `AuthenticationStoreModel`:

```ts
/** How the CURRENT session was established — drives the logout branch (spec 1 §2.4). */
export type LoginMethod = "email" | "apple" | "google"

/**
 * A session whose sub is not the device owner's. Held in memory only while
 * WrongAccountScreen is up; never persisted (spec 2 §2.1).
 */
export interface ForeignSession {
  sub: string
  email?: string
  idToken?: string
  /** undefined on a cold-start restore — consumers treat that as "browser possible". */
  loginMethod?: LoginMethod
}
```

In `.props({ ... })` after `isAnonymous`:

```ts
    /**
     * ADDED 2026-09-17 (spec 1 §2.4). Written only when a session is ACCEPTED
     * by the ownership gate — a foreign session must not leave this behind.
     */
    loginMethod: types.maybe(types.enumeration<LoginMethod>("LoginMethod", ["email", "apple", "google"])),
    /**
     * ADDED 2026-09-17 (spec 2 §1). The one account that owns this device's
     * local data. Survives logout on purpose; cleared only by
     * resetLocalDatabase(). Proof method is derived from the prefix by
     * ownerProofMethod() — do not add a stored method field.
     */
    ownerSub: types.maybe(types.string),
    /** Owner's email at stamping time. Shown masked, only for the code path; login_hint otherwise. Never logged. */
    ownerEmail: types.maybe(types.string),
```

In `.volatile(() => ({ ... }))`:

```ts
    /** See ForeignSession. Volatile: a cold start re-derives it from the SDK's restored session. */
    foreignSession: undefined as ForeignSession | undefined,
```

- [ ] **Step 2: Add the actions and extend logout**

In the second `.actions((store) => ({ ... }))`, before `loginAnonymously`:

```ts
    setLoginMethod(method?: LoginMethod) {
      log.debug("setLoginMethod()", { method })
      store.loginMethod = method
    },
    /** Stamp the device owner. Called only on an `adopt` decision (spec 2 §1.3). */
    setOwner(sub: string, email?: string) {
      log.info("setOwner()", { ownerId: hashUserId(sub) })
      store.ownerSub = sub
      store.ownerEmail = email
    },
    /** Only resetLocalDatabase() calls this — the record and the data are one unit. */
    clearOwner() {
      log.warn("clearOwner()")
      store.ownerSub = undefined
      store.ownerEmail = undefined
    },
    setForeignSession(session: ForeignSession) {
      log.warn("setForeignSession()", { sessionId: hashUserId(session.sub), loginMethod: session.loginMethod })
      store.foreignSession = session
    },
    clearForeignSession() {
      store.foreignSession = undefined
    },
```

Change the import line to `import { hashUserId, logger } from "@/utils/logger"`.

In `logout()`, after `store.pendingLogout = false`:

```ts
      // ADDED 2026-09-17: the session's method goes with the session; the
      // owner record does NOT — it protects the data that stays on disk.
      store.loginMethod = undefined
      store.foreignSession = undefined
```

- [ ] **Step 3: Type-check**

Run: `npm run compile`
Expected: PASS (no errors; nothing consumes the new members yet)

- [ ] **Step 4: Lint and commit**

```bash
npx eslint --fix app/models/AuthenticationStore.ts
git add app/models/AuthenticationStore.ts
git commit -m "✨ feat(auth): loginMethod, owner record and foreign session on AuthenticationStore

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 5: i18n keys (nine locales)

**Files:**
- Modify: `app/i18n/en.ts`, `es.ts`, `ar.ts`, `de.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `th.ts`, `uk.ts`
- Modify: `docs/translation-review-2026-08-03.md`

**Interfaces:**
- Produces the keys used by Tasks 7 and 10. `loginScreen:loginButton` / `signupButton` are **kept until Task 7** removes their last consumer, then deleted there.

- [ ] **Step 1: Add the keys to `en.ts`**

Inside `loginScreen: { ... }` (keep the existing keys):

```ts
    // ADDED 2026-09-17 — passwordless login (spec 1). loginButton/signupButton removed in the same change.
    continueWithEmail: "Continue with Email",
    continueWithApple: "Continue with Apple",
    continueWithGoogle: "Continue with Google",
    sendCodeTo: "Send code to {{email}}",
    useDifferentEmail: "Use a different email",
    emailLabel: "Email address",
    emailPlaceholder: "you@example.com",
    sendCode: "Send Code",
    codeSentTo: "We sent a code to {{email}}",
    codeLabel: "6-digit code",
    verify: "Verify",
    resendCode: "Resend code",
    resendIn: "Resend in {{seconds}}s",
    wrongEmailGoBack: "Wrong email? Go back",
    errorWrongCode: "That code didn't match. Check the email and try again.",
    errorCodeExpired: "That code has expired. Tap Resend to get a new one.",
    errorTooManyAttempts: "Too many attempts. Please wait a few minutes and try again.",
    errorSendRateLimited: "We've sent several codes to that address recently. Please wait before requesting another.",
```

New top-level block after `loginScreen`:

```ts
  wrongAccountScreen: {
    title: "This device is set up for a different RecoverySky account.",
    body: "Sign in to that account to continue. Your meetings and records are safe.",
    support: "If you can't sign in to that account, contact support@recoverysky.app",
    sendCodeTo: "Send code to {{email}}",
    signInWithGoogle: "Sign in with Google",
    signInWithApple: "Sign in with Apple",
    cancel: "Cancel",
  },
```

- [ ] **Step 2: Add the same keys to the other eight locales**

For each of `es`, `ar`, `de`, `fr`, `pt`, `ru`, `th`, `uk`: paste the identical English values into `loginScreen` and add the identical `wrongAccountScreen` block in the same position. (The `Translations` type makes a missing key a compile error, so placement is all that matters.)

- [ ] **Step 3: Type-check**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 4: Queue the review**

Append to `docs/translation-review-2026-08-03.md` under its existing queue list:

```markdown
- 2026-09-17 — `loginScreen` (18 new keys: continueWith*, sendCodeTo, useDifferentEmail, email*, sendCode, codeSentTo, codeLabel, verify, resend*, wrongEmailGoBack, error*) and the new `wrongAccountScreen` block (7 keys) ship English placeholders in all eight non-English locales. Native-speaker review needed before the passwordless login OTA.
```

- [ ] **Step 5: Lint and commit**

```bash
npx eslint --fix app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts
git add app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts docs/translation-review-2026-08-03.md
git commit -m "🌐 i18n(auth): passwordless login and wrong-account strings (English placeholders x8)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 6: `api.linkIdentity` and `linkForeignIdentity()`

**Files:**
- Modify: `app/services/api/types.ts` (append)
- Modify: `app/services/api/index.ts` (add a method after `deleteReminders`, ~line 1229)
- Create: `app/services/auth/linkForeignIdentity.ts`

**Interfaces:**
- Consumes: `fetchWithContentRetry`, `isRetryableProblem` from `app/services/api/contentRetryLogic.ts`; `delay` from `@/utils/delay`.
- Produces:
  ```ts
  export interface LinkIdentityResponse { linked: boolean; reason?: "same_user" | "already_linked"; moved: Record<string, number> }
  Api.linkIdentity(idToken: string): Promise<{ kind: "ok"; data: LinkIdentityResponse } | GeneralApiProblem>
  linkForeignIdentity(idToken: string): Promise<boolean>
  ```
- No unit test: `Api` is I/O and `linkForeignIdentity` imports `@/`. The retry ladder it composes is already covered by `contentRetryLogic.test.ts`. Verified by `npm run compile` and by the API route tests (Task 16) + manual checklist.

- [ ] **Step 1: Add the response type** (append to `app/services/api/types.ts`)

```ts
/**
 * POST /auth0/link response (spec 2 §3.4). `moved` is per-table counts of
 * rows reassigned from the foreign identity to the caller; all zero in the
 * accidental-login case.
 */
export interface LinkIdentityResponse {
  linked: boolean
  reason?: "same_user" | "already_linked"
  moved: Record<string, number>
}
```

- [ ] **Step 2: Add the API method** (in `class Api`, after `deleteReminders`)

```ts
  /**
   * Fold a foreign identity into the signed-in account (spec 2 §3). The body
   * carries the foreign session's ID token; the server verifies it against the
   * Native app's client id before touching anything. Goes through the token
   * freshness gate like every call, so the bearer is the OWNER's.
   * ADDED 2026-09-17.
   */
  async linkIdentity(
    idToken: string,
  ): Promise<{ kind: "ok"; data: LinkIdentityResponse } | GeneralApiProblem> {
    log.info("Linking foreign identity")
    const response = await this.recoverySkyApi.post<LinkIdentityResponse>("/auth0/link", {
      linkWith: idToken,
    })
    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Link identity failed", { problem: problem?.kind, status: response.status })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }
    if (!response.data || typeof response.data.linked !== "boolean") {
      log.warn("Invalid link identity response format")
      return { kind: "bad-data" }
    }
    return { kind: "ok", data: response.data }
  }
```

Add `LinkIdentityResponse` to the `./types` import at the top of `index.ts`.

- [ ] **Step 3: Create the service**

```ts
// app/services/auth/linkForeignIdentity.ts
/**
 * After the owner signs back in on WrongAccountScreen, hand the foreign
 * session's ID token to the API so the two identities are linked and the same
 * mistake next time resolves to the owner (spec 2 §2.5, §3.5).
 *
 * Fire-and-forget from the caller's point of view. Retries ride the content
 * retry ladder (500 / 1500 / 4000 ms) on TRANSPORT failures only — a 4xx is an
 * answer (bad token, already linked) and ends it. Nothing is persisted: on
 * final failure the next mismatch produces a fresh token and a fresh attempt.
 */
import { api } from "@/services/api"
import { fetchWithContentRetry } from "@/services/api/contentRetryLogic"
import { delay } from "@/utils/delay"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "linkForeignIdentity" })

export async function linkForeignIdentity(idToken: string): Promise<boolean> {
  const result = await fetchWithContentRetry(
    () => api.linkIdentity(idToken),
    delay,
    (notice) => log.warn("Link identity retry", { problem: notice.problem, attempt: notice.attempt }),
  )
  if (result.kind === "ok") {
    log.info("Foreign identity linked", {
      linked: result.data.linked,
      reason: result.data.reason,
      moved: result.data.moved,
    })
    return true
  }
  log.error("Foreign identity link failed", { problem: result.kind })
  return false
}
```

- [ ] **Step 4: Type-check, lint, commit**

Run: `npm run compile` → PASS

```bash
npx eslint --fix app/services/api/types.ts app/services/api/index.ts app/services/auth/linkForeignIdentity.ts
git add app/services/api/types.ts app/services/api/index.ts app/services/auth/linkForeignIdentity.ts
git commit -m "✨ feat(auth): linkIdentity API call and retrying link service

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 7: Auth wrapper — passwordless calls, logout branch, ownership gate

**Files:**
- Modify: `app/services/auth/useAuth0Wrapper.ts`

**Interfaces:**
- Consumes: `decideOwnership` (Task 3), store members (Task 4), `linkForeignIdentity` (Task 6), `classifyAuthError` (Task 2).
- Produces (consumed by Tasks 8, 11, and existing `SettingsScreen` / `DevScreen` / `AppNavigator`):
  ```ts
  export type ProviderConnection = "apple" | "google-oauth2"
  export interface ProviderLoginOptions { loginHint?: string; clearBrowserSessionFirst?: boolean }
  export function authErrorMessage(err: unknown, fallback: string): string
  export interface UseAuth0WrapperResult {
    sendCode: (email: string) => Promise<void>          // rejects with the raw SDK error
    verifyCode: (email: string, code: string) => Promise<void>
    loginWithProvider: (connection: ProviderConnection, options?: ProviderLoginOptions) => Promise<void>
    abandonForeignSession: () => Promise<void>
    loginAnonymously: () => void
    logout: () => Promise<void>
    isLoading: boolean; error: string | null; clearError: () => void
    user: Auth0UserInfo | null; isAuthenticated: boolean
  }
  ```
- `login` and `signup` are **removed**. `SettingsScreen`/`DevScreen` only use `logout`; `AppNavigator` calls the hook bare. The only `login`/`signup` consumer is `LoginScreen`, rewritten in Task 8 — so `npm run compile` is expected to FAIL between this task and Task 8 on `LoginScreen.tsx` only. Do Tasks 7 and 8 back to back.
- No automated test (SDK-bound hook). Verify by `npm run compile` after Task 8 and by the manual checklist.

- [ ] **Step 1: Imports and module-level helpers**

Replace the `react-native-auth0` import and add the new ones:

```ts
import { useAuth0, WebAuthError, WebAuthErrorCodes } from "react-native-auth0"

import { translate } from "@/i18n"
import { useAuthenticationStore, useConfigStore, type LoginMethod } from "@/models"
import { setSqliteEncryptionKey, getCurrentSqliteKey } from "@/services/encryption/sqliteKey"
import { hashUserId, logger } from "@/utils/logger"

import { AUTH0_CONFIG, type Auth0UserInfo } from "./auth0"
import { classifyAuthError } from "./authErrorLogic"
import {
  decodeJwtPayload,
  extractSqliteKeyFromClaims,
  isUsableAccessToken,
  type IdTokenClaims,
} from "./jwtUtils"
import { linkForeignIdentity } from "./linkForeignIdentity"
import { decideOwnership } from "./ownerLogic"
import { saveAuthCredentials, clearAuthCredentials } from "./secureStorage"
import { reportUnusableToken } from "./unusableTokenHandler"
```

Replace `displayMessageFor` with an exported, extended version:

```ts
/**
 * Pick what the login screen shows for a failed auth call. Classified cases
 * get an i18n string; everything else keeps the SDK's message so the raw
 * diagnostic still reaches us via the "Auth error displayed to user" log line.
 * ADDED 2026-09-12 — see authErrorLogic.ts for the incident history.
 * CHANGED 2026-09-17: exported and extended with the passwordless outcomes
 * (spec 1 §2.5) so LoginScreen can map a thrown error the same way.
 */
export function authErrorMessage(err: unknown, fallback: string): string {
  switch (classifyAuthError(err)) {
    case "browserTerminated":
      return translate("loginScreen:errorBrowserTerminated")
    case "networkError":
    // The OTP grant is missing on the Auth0 application (runbook §3.2). The
    // user can do nothing about it; the error-level log below is for us.
    case "passwordlessNotEnabled":
      return translate("loginScreen:errorNetwork")
    case "wrongCode":
      return translate("loginScreen:errorWrongCode")
    case "codeExpired":
      return translate("loginScreen:errorCodeExpired")
    case "tooManyAttempts":
      return translate("loginScreen:errorTooManyAttempts")
    case "sendRateLimited":
      return translate("loginScreen:errorSendRateLimited")
    default:
      return (err instanceof Error && err.message) || fallback
  }
}

export type ProviderConnection = "apple" | "google-oauth2"

export interface ProviderLoginOptions {
  /** Prefills the provider's account chooser — the owner's stored email (spec 2 §2.3). */
  loginHint?: string
  /**
   * Clear Auth0's browser cookie before opening the provider. Required when a
   * foreign session arrived through the browser: otherwise the cookie hands
   * that same account straight back (spec 2 §2.3 "the cookie trap").
   */
  clearBrowserSessionFirst?: boolean
}

const METHOD_FOR_CONNECTION: Record<ProviderConnection, LoginMethod> = {
  apple: "apple",
  "google-oauth2": "google",
}
```

Update every `displayMessageFor(` call in the file to `authErrorMessage(`.

- [ ] **Step 2: Replace the result interface**

```ts
export interface UseAuth0WrapperResult {
  /** Email a six-digit code. Rejects with the raw SDK error (classify with classifyAuthError). */
  sendCode: (email: string) => Promise<void>
  /** Exchange the code for a session. Rejects with the raw SDK error. */
  verifyCode: (email: string, code: string) => Promise<void>
  /** Browser login straight to Apple/Google — Universal Login never shows. */
  loginWithProvider: (connection: ProviderConnection, options?: ProviderLoginOptions) => Promise<void>
  /** Cancel on WrongAccountScreen: drop the foreign session and return to Login. */
  abandonForeignSession: () => Promise<void>
  /** Login as anonymous user (no OAuth) */
  loginAnonymously: () => void
  /** Logout and clear all tokens */
  logout: () => Promise<void>
  isLoading: boolean
  error: string | null
  clearError: () => void
  user: Auth0UserInfo | null
  isAuthenticated: boolean
}
```

- [ ] **Step 3: Hook destructure and the pending-method ref**

```ts
  const {
    authorize,
    clearSession,
    clearCredentials,
    sendEmailCode,
    authorizeWithEmail,
    user,
    isLoading: auth0Loading,
    error: auth0Error,
    getCredentials,
    cancelWebAuth,
  } = useAuth0()

  // ...existing localLoading / isLoggingOut...

  // How the login that is currently in flight was started. Read by the sync
  // effect once the SDK sets `user`, then cleared. NOT the store's persisted
  // loginMethod: that is written only for an ACCEPTED session, so a foreign
  // session never leaves it behind (spec 2 §2.1). Empty on a cold-start
  // restore, which every consumer treats as "browser possible".
  const pendingLoginMethodRef = useRef<LoginMethod | undefined>(undefined)
```

In the `auth0Error` effect, log at error level when the tenant is misconfigured:

```ts
      if (classifyAuthError(auth0Error) === "passwordlessNotEnabled") {
        log.error("Passwordless OTP grant missing on the Auth0 application — see spec 1 §3.2")
      }
```

- [ ] **Step 4: The ownership gate in `syncUserToStore`**

Insert immediately after the `isUsableAccessToken` block (after its `return`) and before `const expiresAt = credentials.expiresAt * 1000`:

```ts
            // ADDED 2026-09-17 (spec 2 §2.1): one device, one owner. A session
            // for any other account writes NOTHING below — no tokens, no
            // userId, no SecureStore copy — so isAuthenticated stays false and
            // every identity-driven reaction (sync outbox handover, RevenueCat,
            // push registration, logger/Sentry identity) never sees it. The SDK
            // has already saved these credentials in its own keychain entry;
            // a cold start restores them, hits this gate again, and shows the
            // same screen. That is intended.
            const decision = decideOwnership({
              ownerSub: authStore.ownerSub,
              sessionSub: user.sub,
              isAnonymous: authStore.isAnonymous,
            })
            if (decision === "mismatch") {
              authStore.setForeignSession({
                sub: user.sub,
                email: user.email,
                idToken: credentials.idToken ?? undefined,
                loginMethod: pendingLoginMethodRef.current,
              })
              pendingLoginMethodRef.current = undefined
              // The splash must never wait on a session we are refusing.
              authStore.setAuthReady()
              log.warn("Foreign session on an owned device", {
                ownerId: hashUserId(authStore.ownerSub),
                sessionId: hashUserId(user.sub),
                loginMethod: authStore.foreignSession?.loginMethod ?? "unknown",
              })
              return
            }
            if (decision === "adopt") {
              authStore.setOwner(user.sub, user.email)
              log.info("Device owner adopted", { ownerId: hashUserId(user.sub) })
            }
```

Immediately after the existing `authStore.setUserId(user.sub)`:

```ts
            // Accepted session: record how it was started (drives the logout
            // branch). Falls back to the persisted value on a cold-start
            // restore, where nothing is in flight.
            authStore.setLoginMethod(pendingLoginMethodRef.current ?? authStore.loginMethod)
            pendingLoginMethodRef.current = undefined
```

After the existing final `log.info("Auth state synced to MST store", ...)` line inside the `if (credentials)` block:

```ts
            // spec 2 §2.5: the owner just signed back in over a foreign
            // session. Link that identity into the owner's account so the
            // same wrong tap next time resolves to the owner. Fire-and-forget;
            // the token lives only in memory and a failure just means the next
            // mismatch retries with a fresh one.
            const foreign = authStore.foreignSession
            if (foreign && foreign.sub !== user.sub) {
              authStore.clearForeignSession()
              if (foreign.idToken) {
                void linkForeignIdentity(foreign.idToken)
              } else {
                log.warn("Foreign session had no ID token — nothing to link")
              }
            }
```

- [ ] **Step 5: Replace `login` and `signup` with the three new calls**

Delete the `login` and `signup` callbacks. Add:

```ts
  /**
   * Email a six-digit code. Any address is accepted — passwordless creates the
   * account on first use — so there is no "no account" outcome to surface.
   */
  const sendCode = useCallback(
    async (email: string) => {
      log.info("Sending passwordless code")
      setError(null)
      setLocalLoading(true)
      try {
        await sendEmailCode({ email: email.trim().toLowerCase(), send: "code" })
        pendingLoginMethodRef.current = "email"
      } finally {
        setLocalLoading(false)
      }
    },
    [sendEmailCode],
  )

  /**
   * Exchange the code for a session. The SDK saves the credentials and sets
   * `user`; the sync effect above does the rest, exactly as for a browser login.
   */
  const verifyCode = useCallback(
    async (email: string, code: string) => {
      log.info("Verifying passwordless code")
      setError(null)
      setLocalLoading(true)
      pendingLoginMethodRef.current = "email"
      try {
        await authorizeWithEmail({
          email: email.trim().toLowerCase(),
          code: code.trim(),
          // LOAD-BEARING (spec 1 §2.2): without the audience Auth0 issues an
          // opaque token, isUsableAccessToken() rejects it, and the user is
          // signed out one tick after signing in. offline_access in the scope
          // string is what yields the refresh token.
          audience: AUTH0_CONFIG.audience,
          scope: AUTH0_CONFIG.scopes.join(" "),
        })
      } catch (err) {
        pendingLoginMethodRef.current = undefined
        throw err
      } finally {
        setLocalLoading(false)
      }
    },
    [authorizeWithEmail],
  )

  /**
   * Browser login pointed straight at Apple or Google. Cancel, browser-
   * terminated and network handling are exactly the old login()'s.
   */
  const loginWithProvider = useCallback(
    async (connection: ProviderConnection, options: ProviderLoginOptions = {}) => {
      log.info("Starting provider login", { connection, clearFirst: !!options.clearBrowserSessionFirst })
      setError(null)
      pendingLoginMethodRef.current = METHOD_FOR_CONNECTION[connection]

      try {
        // Cancel any stale/interrupted login transactions (iOS only)
        try {
          await cancelWebAuth()
        } catch {
          // Ignore - cancelWebAuth may fail if no transaction exists
        }

        if (options.clearBrowserSessionFirst) {
          try {
            await clearSession({}, { customScheme: AUTH0_CONFIG.customScheme })
          } catch (err) {
            // The iOS "Sign In" dialog was dismissed. Proceed anyway: worst
            // case the cookie is still there and the provider returns the
            // foreign account, which lands on the same screen again.
            if (!(err instanceof WebAuthError && err.type === WebAuthErrorCodes.USER_CANCELLED)) throw err
            log.info("Browser session clear cancelled by user — proceeding")
          }
        }

        await authorize(
          {
            scope: AUTH0_CONFIG.scopes.join(" "),
            audience: AUTH0_CONFIG.audience,
            connection,
            additionalParameters: options.loginHint ? { login_hint: options.loginHint } : undefined,
          },
          { customScheme: AUTH0_CONFIG.customScheme },
        )
        log.info("Provider login flow completed", { connection })
      } catch (err) {
        pendingLoginMethodRef.current = undefined
        if (err instanceof WebAuthError && err.type === WebAuthErrorCodes.USER_CANCELLED) {
          log.info("Provider login cancelled by user")
          return
        }
        const message = err instanceof Error ? err.message : "Login failed"
        log.error("Provider login failed", { connection, error: message })
        setError(authErrorMessage(err, message))
      }
    },
    [authorize, clearSession, cancelWebAuth],
  )

  /**
   * Cancel on WrongAccountScreen (spec 2 §2.4). Drops the SDK's stored
   * credentials for the foreign session and, when it arrived through the
   * browser (or we cannot tell), Auth0's cookie too — otherwise the next
   * provider tap silently returns the same wrong account.
   */
  const abandonForeignSession = useCallback(async () => {
    const foreign = authStore.foreignSession
    log.info("Abandoning foreign session", { loginMethod: foreign?.loginMethod ?? "unknown" })
    isLoggingOut.current = true
    try {
      if (foreign?.loginMethod !== "email") {
        try {
          await clearSession({}, { customScheme: AUTH0_CONFIG.customScheme })
        } catch (err) {
          if (!(err instanceof WebAuthError && err.type === WebAuthErrorCodes.USER_CANCELLED)) {
            log.warn("Browser session clear failed — clearing credentials only", { error: String(err) })
          }
        }
      }
      await clearCredentials().catch((err) =>
        log.error("Failed to clear SDK credentials", { error: String(err) }),
      )
    } finally {
      authStore.clearForeignSession()
      isLoggingOut.current = false
    }
  }, [authStore, clearSession, clearCredentials])
```

- [ ] **Step 6: The logout branch**

Replace the `if (user && !authStore.isAnonymous) { await clearSession(...) ... }` block inside `logout`:

```ts
      if (user && !authStore.isAnonymous) {
        // CHANGED 2026-09-17 (spec 1 §2.4): an email-code session never
        // created a browser session, so there is no Auth0 cookie to clear.
        // clearSession() would open a browser for nothing and, on iOS, show
        // the system dialog. Social sessions keep the browser logout.
        if (authStore.loginMethod === "email") {
          await clearCredentials()
          log.info("Email session credentials cleared")
        } else {
          await clearSession({}, { customScheme: AUTH0_CONFIG.customScheme })
          log.info("Auth0 session cleared")
        }
      }
```

Add `clearCredentials` to the `logout` dependency array.

- [ ] **Step 7: Return the new surface**

```ts
  return {
    sendCode,
    verifyCode,
    loginWithProvider,
    abandonForeignSession,
    loginAnonymously,
    logout,
    isLoading,
    error,
    clearError,
    user: user as Auth0UserInfo | null,
    isAuthenticated: !!user,
  }
```

Update the file header comment: add "- Passwordless email code login (sendCode/verifyCode), direct-to-provider social login, and the device-ownership gate (spec 2 §2.1)".

- [ ] **Step 8: Lint and commit (compile still fails on LoginScreen — expected until Task 8)**

```bash
npx eslint --fix app/services/auth/useAuth0Wrapper.ts
git add app/services/auth/useAuth0Wrapper.ts
git commit -m "✨ feat(auth): passwordless calls, provider login, logout branch and ownership gate in useAuth0Wrapper

login()/signup() removed; LoginScreen is rewritten in the next commit.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 8: Login steps and the three-state login screen

**Files:**
- Create: `app/screens/login/LoginSteps.tsx`
- Test: `app/screens/login/LoginSteps.test.tsx`
- Modify: `app/screens/LoginScreen.tsx`
- Modify: `app/i18n/*.ts` (remove `loginButton`, `signupButton` from all nine)

**Interfaces:**
- Consumes: Task 1 logic, Task 7 wrapper, Task 4 store (`ownerSub`, `ownerEmail`), Task 3 `ownerProofMethod`, Task 5 keys.
- Produces:
  ```ts
  export interface ChooseStepProps { ownerEmailMasked?: string; isLoading: boolean; onEmail: () => void; onOwnerEmail: () => void; onProvider: (c: ProviderConnection) => void }
  export interface EmailStepProps { email: string; onChangeEmail: (v: string) => void; isSending: boolean; onSend: () => void; onBack: () => void }
  export interface CodeStepProps { emailMasked: string; code: string; onChangeCode: (v: string) => void; isVerifying: boolean; onVerify: () => void; resendWaitSeconds: number; onResend: () => void; onWrongEmail: () => void }
  export function ChooseStep / EmailStep / CodeStep
  ```
  `LoginScreen` is reused by Task 11 through these three components, not through the screen itself.

- [ ] **Step 1: Write the failing component tests**

```tsx
// app/screens/login/LoginSteps.test.tsx
/**
 * The three presentational login steps (spec 1 §1, §4.2). They take callbacks
 * only — no store, no SDK — which is what lets this mount them bare.
 */
import { fireEvent, render, screen } from "@testing-library/react-native"

import { ChooseStep, CodeStep, EmailStep } from "./LoginSteps"

describe("ChooseStep", () => {
  const props = {
    isLoading: false,
    onEmail: jest.fn(),
    onOwnerEmail: jest.fn(),
    onProvider: jest.fn(),
  }
  beforeEach(() => jest.clearAllMocks())

  it("renders the three buttons and routes each tap", () => {
    render(<ChooseStep {...props} />)
    fireEvent.press(screen.getByTestId("login-apple"))
    fireEvent.press(screen.getByTestId("login-google"))
    fireEvent.press(screen.getByTestId("login-email"))
    expect(props.onProvider).toHaveBeenNthCalledWith(1, "apple")
    expect(props.onProvider).toHaveBeenNthCalledWith(2, "google-oauth2")
    expect(props.onEmail).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("login-owner-email")).toBeNull()
  })

  it("shows the masked owner button instead of the plain email button when given", () => {
    render(<ChooseStep {...props} ownerEmailMasked="j***@proton.me" />)
    expect(screen.getByText("Send code to j***@proton.me")).toBeTruthy()
    fireEvent.press(screen.getByTestId("login-owner-email"))
    expect(props.onOwnerEmail).toHaveBeenCalledTimes(1)
    fireEvent.press(screen.getByTestId("login-use-different-email"))
    expect(props.onEmail).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("login-email")).toBeNull()
  })
})

describe("EmailStep", () => {
  const props = { email: "", onChangeEmail: jest.fn(), isSending: false, onSend: jest.fn(), onBack: jest.fn() }

  it("carries the email autofill hints", () => {
    render(<EmailStep {...props} />)
    const field = screen.getByTestId("login-email-field")
    expect(field.props.textContentType).toBe("emailAddress")
    expect(field.props.autoComplete).toBe("email")
    expect(field.props.keyboardType).toBe("email-address")
  })

  it("disables Send until the address is plausible", () => {
    const { rerender } = render(<EmailStep {...props} email="jenova@" />)
    expect(screen.getByTestId("login-send-code").props.accessibilityState.disabled).toBe(true)
    rerender(<EmailStep {...props} email="jenova@proton.me" />)
    expect(screen.getByTestId("login-send-code").props.accessibilityState.disabled).toBe(false)
  })
})

describe("CodeStep", () => {
  const props = {
    emailMasked: "j***@proton.me",
    code: "",
    onChangeCode: jest.fn(),
    isVerifying: false,
    onVerify: jest.fn(),
    resendWaitSeconds: 0,
    onResend: jest.fn(),
    onWrongEmail: jest.fn(),
  }
  beforeEach(() => jest.clearAllMocks())

  it("carries the one-time-code autofill hints and shows the masked address", () => {
    render(<CodeStep {...props} />)
    const field = screen.getByTestId("login-code-field")
    expect(field.props.textContentType).toBe("oneTimeCode")
    expect(field.props.autoComplete).toBe("one-time-code")
    expect(field.props.maxLength).toBe(6)
    expect(screen.getByText("We sent a code to j***@proton.me")).toBeTruthy()
  })

  it("disables Verify until six digits are present", () => {
    const { rerender } = render(<CodeStep {...props} code="12345" />)
    expect(screen.getByTestId("login-verify").props.accessibilityState.disabled).toBe(true)
    rerender(<CodeStep {...props} code="123456" />)
    expect(screen.getByTestId("login-verify").props.accessibilityState.disabled).toBe(false)
  })

  it("disables Resend during the cooldown and shows the countdown", () => {
    render(<CodeStep {...props} resendWaitSeconds={12} />)
    expect(screen.getByText("Resend in 12s")).toBeTruthy()
    expect(screen.getByTestId("login-resend").props.accessibilityState.disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:component -- app/screens/login/LoginSteps.test.tsx`
Expected: FAIL — `Cannot find module './LoginSteps'`

- [ ] **Step 3: Write `LoginSteps.tsx`**

```tsx
// app/screens/login/LoginSteps.tsx
/**
 * The three states of the login screen (spec 1 §1). Presentational: every
 * decision arrives as a prop, every action leaves as a callback, so the jest
 * test can mount them without navigation, the SDK, or the MST tree — and so
 * WrongAccountScreen can reuse CodeStep unchanged (spec 2 §2.3).
 */
import { ActivityIndicator, Platform, Pressable, View, type TextStyle, type ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { translate } from "@/i18n"
import type { ProviderConnection } from "@/services/auth/useAuth0Wrapper"
import { isPlausibleEmail } from "@/services/auth/loginFlowLogic"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export interface ChooseStepProps {
  /** `j***@proton.me` when the device owner uses the code path (spec 2 §2.6); absent otherwise. */
  ownerEmailMasked?: string
  isLoading: boolean
  onEmail: () => void
  onOwnerEmail: () => void
  onProvider: (connection: ProviderConnection) => void
}

export function ChooseStep({ ownerEmailMasked, isLoading, onEmail, onOwnerEmail, onProvider }: ChooseStepProps) {
  const { themed, theme } = useAppTheme()
  // Apple above Google on iOS: App Store guideline 4.8 wants the Apple button
  // at least as prominent as other third-party logins. Android leads with
  // Google (spec 1 §1.1). jest runs as iOS, which the test's call order assumes.
  const apple = (
    <Pressable
      key="apple"
      testID="login-apple"
      accessibilityRole="button"
      accessibilityLabel={translate("loginScreen:continueWithApple")}
      style={[themed($button), isLoading && themed($buttonDisabled)]}
      onPress={() => onProvider("apple")}
      disabled={isLoading}
    >
      <Text style={themed($buttonText)} tx="loginScreen:continueWithApple" />
    </Pressable>
  )
  const google = (
    <Pressable
      key="google"
      testID="login-google"
      accessibilityRole="button"
      accessibilityLabel={translate("loginScreen:continueWithGoogle")}
      style={[themed($button), isLoading && themed($buttonDisabled)]}
      onPress={() => onProvider("google-oauth2")}
      disabled={isLoading}
    >
      <Text style={themed($buttonText)} tx="loginScreen:continueWithGoogle" />
    </Pressable>
  )
  return (
    <View style={themed($stack)}>
      {Platform.OS === "ios" ? [apple, google] : [google, apple]}
      {ownerEmailMasked ? (
        <>
          <Pressable
            testID="login-owner-email"
            accessibilityRole="button"
            accessibilityLabel={translate("loginScreen:sendCodeTo", { email: ownerEmailMasked })}
            style={[themed($button), isLoading && themed($buttonDisabled)]}
            onPress={onOwnerEmail}
            disabled={isLoading}
          >
            <Text
              style={themed($buttonText)}
              tx="loginScreen:sendCodeTo"
              txOptions={{ email: ownerEmailMasked }}
            />
          </Pressable>
          <Pressable
            testID="login-use-different-email"
            accessibilityRole="link"
            accessibilityLabel={translate("loginScreen:useDifferentEmail")}
            onPress={onEmail}
            disabled={isLoading}
          >
            <Text style={themed($linkText)} tx="loginScreen:useDifferentEmail" />
          </Pressable>
        </>
      ) : (
        <Pressable
          testID="login-email"
          accessibilityRole="button"
          accessibilityLabel={translate("loginScreen:continueWithEmail")}
          style={[themed($button), isLoading && themed($buttonDisabled)]}
          onPress={onEmail}
          disabled={isLoading}
        >
          <Text style={themed($buttonText)} tx="loginScreen:continueWithEmail" />
        </Pressable>
      )}
      {isLoading && <ActivityIndicator size="small" color={theme.colors.tint} style={themed($spinner)} />}
    </View>
  )
}

export interface EmailStepProps {
  email: string
  onChangeEmail: (value: string) => void
  isSending: boolean
  onSend: () => void
  onBack: () => void
}

export function EmailStep({ email, onChangeEmail, isSending, onSend, onBack }: EmailStepProps) {
  const { themed } = useAppTheme()
  const canSend = isPlausibleEmail(email) && !isSending
  return (
    <View style={themed($stack)}>
      <TextField
        testID="login-email-field"
        labelTx="loginScreen:emailLabel"
        placeholderTx="loginScreen:emailPlaceholder"
        value={email}
        onChangeText={onChangeEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        autoComplete="email"
        returnKeyType="send"
        onSubmitEditing={canSend ? onSend : undefined}
        editable={!isSending}
      />
      <Pressable
        testID="login-send-code"
        accessibilityRole="button"
        accessibilityLabel={translate("loginScreen:sendCode")}
        accessibilityState={{ disabled: !canSend }}
        style={[themed($button), !canSend && themed($buttonDisabled)]}
        onPress={onSend}
        disabled={!canSend}
      >
        <Text style={themed($buttonText)} tx="loginScreen:sendCode" />
        {isSending && <ActivityIndicator size="small" style={themed($spinner)} />}
      </Pressable>
      <Pressable
        testID="login-back"
        accessibilityRole="button"
        accessibilityLabel={translate("common:back")}
        onPress={onBack}
        disabled={isSending}
      >
        <Text style={themed($linkText)} tx="common:back" />
      </Pressable>
    </View>
  )
}

export interface CodeStepProps {
  emailMasked: string
  code: string
  onChangeCode: (value: string) => void
  isVerifying: boolean
  onVerify: () => void
  /** 0 = Resend allowed now; otherwise the countdown shown on the link. */
  resendWaitSeconds: number
  onResend: () => void
  onWrongEmail: () => void
}

export function CodeStep({
  emailMasked,
  code,
  onChangeCode,
  isVerifying,
  onVerify,
  resendWaitSeconds,
  onResend,
  onWrongEmail,
}: CodeStepProps) {
  const { themed } = useAppTheme()
  const canVerify = /^\d{6}$/.test(code) && !isVerifying
  const canResend = resendWaitSeconds === 0 && !isVerifying
  return (
    <View style={themed($stack)}>
      <Text
        preset="subheading"
        style={themed($centered)}
        tx="loginScreen:codeSentTo"
        txOptions={{ email: emailMasked }}
      />
      <TextField
        testID="login-code-field"
        labelTx="loginScreen:codeLabel"
        value={code}
        // Digits only: OS autofill hands us "123456"; a pasted "123 456" is
        // normalised rather than rejected.
        onChangeText={(v) => onChangeCode(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        editable={!isVerifying}
      />
      <Pressable
        testID="login-verify"
        accessibilityRole="button"
        accessibilityLabel={translate("loginScreen:verify")}
        accessibilityState={{ disabled: !canVerify }}
        style={[themed($button), !canVerify && themed($buttonDisabled)]}
        onPress={onVerify}
        disabled={!canVerify}
      >
        <Text style={themed($buttonText)} tx="loginScreen:verify" />
        {isVerifying && <ActivityIndicator size="small" style={themed($spinner)} />}
      </Pressable>
      <Pressable
        testID="login-resend"
        accessibilityRole="button"
        accessibilityLabel={
          canResend
            ? translate("loginScreen:resendCode")
            : translate("loginScreen:resendIn", { seconds: resendWaitSeconds })
        }
        accessibilityState={{ disabled: !canResend }}
        onPress={onResend}
        disabled={!canResend}
      >
        {canResend ? (
          <Text style={themed($linkText)} tx="loginScreen:resendCode" />
        ) : (
          <Text style={themed($linkTextDim)} tx="loginScreen:resendIn" txOptions={{ seconds: resendWaitSeconds }} />
        )}
      </Pressable>
      <Pressable
        testID="login-wrong-email"
        accessibilityRole="button"
        accessibilityLabel={translate("loginScreen:wrongEmailGoBack")}
        onPress={onWrongEmail}
        disabled={isVerifying}
      >
        <Text style={themed($linkText)} tx="loginScreen:wrongEmailGoBack" />
      </Pressable>
    </View>
  )
}

const $stack: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.md })

const $centered: ThemedStyle<TextStyle> = () => ({ textAlign: "center" })

// Same outline-with-glow button LoginScreen has always used; moved here with
// the buttons (2026-09-17) so the two screens that render steps share it.
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

const $buttonDisabled: ThemedStyle<ViewStyle> = () => ({ opacity: 0.7 })

const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.tint,
})

const $linkText: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.tint,
  fontSize: 15,
})

const $linkTextDim: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
  fontSize: 15,
})

const $spinner: ThemedStyle<ViewStyle> = ({ spacing }) => ({ marginLeft: spacing.sm })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:component -- app/screens/login/LoginSteps.test.tsx`
Expected: PASS (7 tests). If `TextField` does not forward `testID` to its `TextInput`, add `testID={TextInputProps.testID}` where it spreads `...TextInputProps` — check `app/components/TextField.tsx` line ~132 first; the spread already carries it.

- [ ] **Step 5: Rewrite the top half of `LoginScreen.tsx`**

Replace everything from `interface LoginScreenProps` down to (but not including) the line `{/* EUA Modal */}` with the block below. Keep the EUA `Modal` JSX and everything after it unchanged, except delete the now-unused styles `$button`, `$buttonDisabled`, `$buttonText`, `$buttonTextSecondary`, `$spinner` (they live in `LoginSteps.tsx`).

```tsx
interface LoginScreenProps extends AppStackScreenProps<"Login"> {}

/**
 * What the legal-agreements modal will run once accepted. CHANGED 2026-09-17:
 * was a "authenticated" | "signup" | "anonymous" string; the passwordless
 * screen has more entry points, each carrying its own argument.
 */
type PendingAction =
  | { kind: "email" }
  | { kind: "ownerEmail" }
  | { kind: "provider"; connection: ProviderConnection }
  | { kind: "anonymous" }
  | null

/**
 * LoginScreen — three ways in (spec 1 §1): an in-app email code, Apple, Google.
 * Login and sign-up are one path. The legal-agreements modal gates every
 * method exactly as it gated the two buttons before 2026-09-17.
 */
export const LoginScreen: FC<LoginScreenProps> = observer(function LoginScreen(_props) {
  const { themed } = useAppTheme()
  const { rekeyDb } = useDatabase()
  const authStore = useAuthenticationStore()
  const {
    sendCode,
    verifyCode,
    loginWithProvider,
    loginAnonymously,
    isLoading,
    error,
    clearError,
  } = useAuth0Wrapper({ onSqliteKeyChange: rekeyDb })

  // spec 2 §2.6: a returning owner on their own device taps once and gets a
  // code. Only the code path prefills — social owners get plain buttons.
  const ownerEmail = ownerProofMethod(authStore.ownerSub) === "code" ? authStore.ownerEmail : undefined

  const [step, setStep] = useState<LoginStep>("choose")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Agreement modal state
  const [showEuaModal, setShowEuaModal] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [termsAlreadyAccepted, setTermsAlreadyAccepted] = useState(false)
  const [activeTab, setActiveTab] = useState<"disclaimer" | "eula">("disclaimer")
```

Keep the existing `disclaimerContent` / `eulaContent` / `contentLoading` / `contentLoaded` / `canAgree` state and effects exactly as they are (they follow this point in the original file). Then replace `proceedWithLogin`, `handleLoginPress`, `handleSignupPress`, `handleAnonymousPress`, `handleEuaAgree`, `handleEuaCancel` and the JSX up to the modal with:

```tsx
  // One-second tick for the Resend countdown, only while the code step is up.
  useEffect(() => {
    if (step !== "code") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [step])

  const runSend = useCallback(
    async (address: string, event: LoginEvent) => {
      clearError()
      try {
        await sendCode(address)
        setLastSentAt(Date.now())
        setNow(Date.now())
        trackEvent("login_code_sent")
        setStep((s) => nextStep(s, event))
      } catch (err) {
        const key = classifyAuthError(err)
        log.warn("Send code failed", { key: key ?? "unclassified" })
        if (key === "sendRateLimited") setStep((s) => nextStep(s, "sendRateLimited"))
        // Display comes from the wrapper's `error` (its SDK-error effect ran).
      }
    },
    [sendCode, clearError],
  )

  const handleVerify = useCallback(async () => {
    clearError()
    try {
      await verifyCode(email, code)
      trackEvent("login_completed", { method: "email" })
    } catch (err) {
      const key = classifyAuthError(err)
      log.warn("Verify code failed", { key: key ?? "unclassified" })
      if (key === "wrongCode") setCode("")
      if (key === "tooManyAttempts") {
        setCode("")
        setStep((s) => nextStep(s, "tooManyAttempts"))
      }
    }
  }, [verifyCode, email, code, clearError])

  // Auto-submit the moment six digits are present, autofilled or typed (spec 1 §1.3).
  useEffect(() => {
    if (step === "code" && /^\d{6}$/.test(code) && !isLoading) void handleVerify()
    // handleVerify changes identity with `code`; depending on it here is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const runAction = useCallback(
    async (action: PendingAction) => {
      if (!action) return
      clearError()
      switch (action.kind) {
        case "email":
          setStep((s) => nextStep(s, "chooseEmail"))
          return
        case "ownerEmail":
          if (!ownerEmail) return
          setEmail(ownerEmail)
          await runSend(ownerEmail, "chooseOwnerEmail")
          return
        case "provider":
          await loginWithProvider(action.connection)
          trackEvent("login_completed", { method: action.connection === "apple" ? "apple" : "google" })
          return
        case "anonymous":
          loginAnonymously()
          trackEvent("login_completed", { method: "anonymous" })
          return
      }
    },
    [clearError, ownerEmail, runSend, loginWithProvider, loginAnonymously],
  )

  // Every entry point goes through the legal gate first.
  const gated = useCallback(
    (action: PendingAction) => {
      log.info("Login action", { kind: action?.kind ?? "none" })
      if (termsAlreadyAccepted) {
        void runAction(action)
      } else {
        setPendingAction(action)
        setShowEuaModal(true)
      }
    },
    [termsAlreadyAccepted, runAction],
  )

  // Kept for the commented-out anonymous-login button further down (see the
  // comment above that block).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleAnonymousPress = useCallback(() => gated({ kind: "anonymous" }), [gated])

  const handleEuaAgree = useCallback(async () => {
    // Belt-and-braces alongside the button's `disabled` prop: acceptance is
    // persisted to SecureStore and never re-asked, so a single slip here would
    // permanently record consent to documents the user was never shown.
    if (!canAgree) {
      log.warn("EUA accept blocked — legal content not displayed")
      return
    }
    log.info("EUA accepted", { action: pendingAction?.kind ?? "none" })
    setShowEuaModal(false)
    setTermsAlreadyAccepted(true)
    setTermsAccepted().catch((err) =>
      log.error("Failed to persist terms acceptance", { error: String(err) }),
    )
    await runAction(pendingAction)
    setPendingAction(null)
  }, [canAgree, pendingAction, runAction])

  const handleEuaCancel = useCallback(() => {
    log.info("EUA cancelled", { action: pendingAction?.kind ?? "none" })
    setShowEuaModal(false)
    setPendingAction(null)
  }, [pendingAction])

  return (
    <Screen
      preset="auto"
      contentContainerStyle={themed($screenContentContainer)}
      safeAreaEdges={["top", "bottom"]}
    >
      <View style={themed($headerContainer)}>
        <Text testID="login-heading" tx="loginScreen:logIn" preset="heading" style={themed($logIn)} />
        <Text
          tx={Platform.OS === "ios" ? "loginScreen:enterDetails" : "loginScreen:enterDetailsAndroid"}
          preset="subheading"
          style={themed($enterDetails)}
        />
      </View>

      <View style={themed($contentContainer)}>
        {error && (
          <View style={themed($errorContainer)}>
            <Text style={themed($errorText)}>{error}</Text>
          </View>
        )}

        {step === "choose" && (
          <ChooseStep
            ownerEmailMasked={ownerEmail ? maskEmail(ownerEmail) : undefined}
            isLoading={isLoading}
            onEmail={() => gated({ kind: "email" })}
            onOwnerEmail={() => gated({ kind: "ownerEmail" })}
            onProvider={(connection) => gated({ kind: "provider", connection })}
          />
        )}
        {step === "email" && (
          <EmailStep
            email={email}
            onChangeEmail={setEmail}
            isSending={isLoading}
            onSend={() => void runSend(email, "codeSent")}
            onBack={() => {
              clearError()
              setStep((s) => nextStep(s, "back"))
            }}
          />
        )}
        {step === "code" && (
          <CodeStep
            emailMasked={maskEmail(email)}
            code={code}
            onChangeCode={setCode}
            isVerifying={isLoading}
            onVerify={() => void handleVerify()}
            resendWaitSeconds={resendWaitSeconds(lastSentAt, now)}
            onResend={() => void runSend(email, "codeSent")}
            onWrongEmail={() => {
              clearError()
              setCode("")
              setStep((s) => nextStep(s, "wrongEmail"))
            }}
          />
        )}

        {/* Anonymous login intentionally disabled in the UI. We're keeping the
            handler + state plumbing (handleAnonymousPress, loginAnonymously,
            the "anonymous" PendingAction) so re-enabling is a one-block
            uncomment. Hidden because the anonymous-user experience doesn't
            meet the bar we want for new installs — bring it back only when
            paired with a clear upgrade path. */}
        {/* {Platform.OS !== "ios" && step === "choose" && (
          <Pressable testID="anonymous-button" accessibilityRole="button"
            accessibilityLabel={translate("loginScreen:continueAnonymously")}
            onPress={handleAnonymousPress} disabled={isLoading}>
            <Text tx="loginScreen:continueAnonymously" />
          </Pressable>
        )} */}

        {isLoading && step === "choose" && (
          <Text style={themed($loadingText)} tx="loginScreen:openingBrowser" />
        )}
      </View>
```

Imports to add at the top of `LoginScreen.tsx`:

```ts
import { useAuthenticationStore } from "@/models"
import { classifyAuthError } from "@/services/auth/authErrorLogic"
import { maskEmail, nextStep, resendWaitSeconds, type LoginEvent, type LoginStep } from "@/services/auth/loginFlowLogic"
import { ownerProofMethod } from "@/services/auth/ownerLogic"
import { useAuth0Wrapper, type ProviderConnection } from "@/services/auth/useAuth0Wrapper"

import { ChooseStep, CodeStep, EmailStep } from "./login/LoginSteps"
```

Remove `ActivityIndicator` from the `react-native` import if nothing else in the file uses it (the modal uses it for content loading — check before removing; the original uses `$contentSpinner` with `ActivityIndicator`, so **keep it**). Remove the `LoginType` type.

- [ ] **Step 6: Remove the dead i18n keys**

Delete `loginButton` and `signupButton` from `loginScreen` in all nine locale files.

- [ ] **Step 7: Type-check and run both test files**

Run: `npm run compile` → PASS (this is the first green compile since Task 7)
Run: `npm run test:component -- app/screens/login/LoginSteps.test.tsx` → PASS
Run: `npm run lint:deps` → PASS (`screens → services/auth → services/api` is an existing direction)

- [ ] **Step 8: Lint and commit**

```bash
npx eslint --fix app/screens/LoginScreen.tsx app/screens/login/LoginSteps.tsx app/screens/login/LoginSteps.test.tsx app/i18n/*.ts
git add app/screens/LoginScreen.tsx app/screens/login/LoginSteps.tsx app/screens/login/LoginSteps.test.tsx app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts
git commit -m "✨ feat(auth): three-state passwordless login screen

Continue with Email (in-app code), Apple, Google. Sign Up button removed —
sign-up and login are one path. Legal modal unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 9: Stamp the owner from a signed-in hydration

**Files:**
- Modify: `app/models/helpers/setupRootStore.ts` (between `applySnapshot` and the `isAnonymous` reset)

**Interfaces:**
- Consumes: `authenticationStore.setOwner` (Task 4).
- Behaviour: an install that is signed in when the OTA lands gets `ownerSub`/`ownerEmail` stamped from the persisted `userId`/`authEmail` before any reaction runs (spec 2 §1.3). Must run BEFORE the existing `isAnonymous` reset, because an anonymous snapshot has `userId === deviceId` and must not become the owner.
- No unit test (imports `@/`); covered by manual checklist items 5–6.

- [ ] **Step 1: Insert the stamping block**

Directly after the `try { restoredState = ... } catch { ... }` block and before `if (rootStore.authenticationStore.isAnonymous) {`:

```ts
  // ADDED 2026-09-17 (spec 2 §1.3): first launch after the ownership OTA on an
  // install that was signed in. Adopt the persisted account as the device
  // owner NOW, before any reaction sees the session, so the upgrade itself
  // never shows the wrong-account screen. Must run before the isAnonymous
  // reset below: an anonymous snapshot carries userId === deviceId, and a
  // device id must never become the owner.
  {
    const auth = rootStore.authenticationStore
    if (!auth.ownerSub && auth.userId && !auth.isAnonymous) {
      auth.setOwner(auth.userId, auth.authEmail || undefined)
      log.info("Owner stamped from hydration")
    }
  }
```

- [ ] **Step 2: Type-check, lint, commit**

Run: `npm run compile` → PASS

```bash
npx eslint --fix app/models/helpers/setupRootStore.ts
git add app/models/helpers/setupRootStore.ts
git commit -m "✨ feat(auth): adopt the persisted account as device owner on upgrade

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 10: `resetLocalDatabase()` clears the owner record

**Files:**
- Modify: `app/db/resetLocalDatabase.ts`
- Modify: `app/db/DatabaseProvider.tsx` (the `resetLocalData` callback, ~line 273)
- Modify: `app/screens/SettingsScreen.tsx` (Delete User Data handler, ~line 566)

**Interfaces:**
- Produces: `resetLocalDatabase(options: { clearOwner: () => void }): Promise<void>` — the owner record and the data are one unit (spec 2 §1.4). The callback keeps `app/db/` from importing the store module directly; both callers already sit inside `RootStoreProvider`.

- [ ] **Step 1: Change the signature**

```ts
// app/db/resetLocalDatabase.ts
import { clearSqliteEncryptionKey } from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { closeDb, deleteDatabase } from "./provider"

const log = logger.child({ module: "DatabaseProvider" })

export interface ResetLocalDatabaseOptions {
  /**
   * Clears AuthenticationStore.ownerSub/ownerEmail. ADDED 2026-09-17 (spec 2
   * §1.4): a record pointing at data that no longer exists would show the
   * wrong-account screen over an empty database. Passed in rather than
   * imported so db/ does not grow a runtime dependency on models/.
   */
  clearOwner: () => void
}

/**
 * The single teardown for the encrypted file and its key (RS-024). Anything
 * that removes one must go through here so the two never drift apart.
 */
export async function resetLocalDatabase(options: ResetLocalDatabaseOptions): Promise<void> {
  log.warn("Resetting local database and encryption key")
  await closeDb()
  await deleteDatabase()
  await clearSqliteEncryptionKey()
  options.clearOwner()
  log.warn("Local database reset complete")
}
```

- [ ] **Step 2: Update `DatabaseProvider.tsx`**

Add `import { useAuthenticationStore } from "@/models"` and, inside `DatabaseProvider`, `const authStore = useAuthenticationStore()`. Change the call to `await resetLocalDatabase({ clearOwner: () => authStore.clearOwner() })` and add `authStore` to the `resetLocalData` dependency array.

- [ ] **Step 3: Update `SettingsScreen.tsx`**

`authStore` is already in scope there (it calls `authStore.logout()` in the same handler). Change the call to `await resetLocalDatabase({ clearOwner: () => authStore.clearOwner() })`.

- [ ] **Step 4: Type-check, lint, commit**

Run: `npm run compile` → PASS

```bash
npx eslint --fix app/db/resetLocalDatabase.ts app/db/DatabaseProvider.tsx app/screens/SettingsScreen.tsx
git add app/db/resetLocalDatabase.ts app/db/DatabaseProvider.tsx app/screens/SettingsScreen.tsx
git commit -m "✨ feat(db): resetLocalDatabase also clears the device owner record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 11: `WrongAccountScreen` and the navigator branch

**Files:**
- Create: `app/screens/WrongAccountScreen.tsx`
- Test: `app/screens/WrongAccountView.test.tsx`
- Modify: `app/navigators/navigationTypes.ts` (add `WrongAccount: undefined`)
- Modify: `app/navigators/AppNavigator.tsx` (unauthenticated branch)

**Interfaces:**
- Consumes: `CodeStep` (Task 8), wrapper (Task 7), `ownerProofMethod` + `maskEmail`, store fields (Task 4), i18n (Task 5).
- Produces:
  ```ts
  export interface WrongAccountViewProps {
    proofMethod: ProofMethod
    ownerEmailMasked?: string
    step: "prompt" | "code"
    code: string
    onChangeCode: (v: string) => void
    resendWaitSeconds: number
    isBusy: boolean
    onSendCode: () => void
    onVerify: () => void
    onResend: () => void
    onProvider: () => void
    onCancel: () => void
  }
  export function WrongAccountView(props: WrongAccountViewProps)   // presentational
  export const WrongAccountScreen: FC<AppStackScreenProps<"WrongAccount">>  // observer shell
  ```

- [ ] **Step 1: Write the failing view test**

```tsx
// app/screens/WrongAccountView.test.tsx
/**
 * spec 2 §4: the code variant shows the masked-email button and no provider
 * button; the social variants show one provider button and never an email;
 * Cancel is always there; `unknown` with no email shows Cancel only.
 */
import { fireEvent, render, screen } from "@testing-library/react-native"

import { WrongAccountView } from "./WrongAccountScreen"

const base = {
  step: "prompt" as const,
  code: "",
  onChangeCode: jest.fn(),
  resendWaitSeconds: 0,
  isBusy: false,
  onSendCode: jest.fn(),
  onVerify: jest.fn(),
  onResend: jest.fn(),
  onProvider: jest.fn(),
  onCancel: jest.fn(),
}

describe("WrongAccountView", () => {
  beforeEach(() => jest.clearAllMocks())

  it("code owner: masked-email button, no provider button, cancel", () => {
    render(<WrongAccountView {...base} proofMethod="code" ownerEmailMasked="j***@proton.me" />)
    expect(screen.getByText("Send code to j***@proton.me")).toBeTruthy()
    expect(screen.queryByTestId("wrong-account-provider")).toBeNull()
    fireEvent.press(screen.getByTestId("wrong-account-send-code"))
    expect(base.onSendCode).toHaveBeenCalledTimes(1)
    fireEvent.press(screen.getByTestId("wrong-account-cancel"))
    expect(base.onCancel).toHaveBeenCalledTimes(1)
  })

  it("apple owner: one provider button and no email anywhere", () => {
    render(<WrongAccountView {...base} proofMethod="apple" ownerEmailMasked="j***@privaterelay.appleid.com" />)
    expect(screen.getByText("Sign in with Apple")).toBeTruthy()
    expect(screen.queryByText(/privaterelay/)).toBeNull()
    expect(screen.queryByTestId("wrong-account-send-code")).toBeNull()
    fireEvent.press(screen.getByTestId("wrong-account-provider"))
    expect(base.onProvider).toHaveBeenCalledTimes(1)
  })

  it("google owner: one provider button", () => {
    render(<WrongAccountView {...base} proofMethod="google" ownerEmailMasked="j***@gmail.com" />)
    expect(screen.getByText("Sign in with Google")).toBeTruthy()
    expect(screen.queryByText(/gmail/)).toBeNull()
  })

  it("unknown owner with no email: cancel only", () => {
    render(<WrongAccountView {...base} proofMethod="unknown" />)
    expect(screen.queryByTestId("wrong-account-send-code")).toBeNull()
    expect(screen.queryByTestId("wrong-account-provider")).toBeNull()
    expect(screen.getByTestId("wrong-account-cancel")).toBeTruthy()
  })

  it("code step renders the shared CodeStep", () => {
    render(<WrongAccountView {...base} proofMethod="code" ownerEmailMasked="j***@proton.me" step="code" />)
    expect(screen.getByTestId("login-code-field")).toBeTruthy()
    expect(screen.getByTestId("wrong-account-cancel")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:component -- app/screens/WrongAccountView.test.tsx`
Expected: FAIL — `Cannot find module './WrongAccountScreen'`

- [ ] **Step 3: Write the screen**

```tsx
// app/screens/WrongAccountScreen.tsx
/**
 * Shown instead of Login when the SDK holds a session for an account that is
 * not this device's owner (spec 2 §2.3). Two exits only: prove you are the
 * owner, or Cancel. Nothing here can delete, rekey, or overwrite local data.
 *
 * WrongAccountView is presentational (jest-covered); WrongAccountScreen is
 * the observer shell that reads the store and calls the auth wrapper.
 */
import { FC, useCallback, useEffect, useState } from "react"
import { Pressable, View, type TextStyle, type ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useAuthenticationStore } from "@/models"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { classifyAuthError } from "@/services/auth/authErrorLogic"
import { maskEmail, resendWaitSeconds } from "@/services/auth/loginFlowLogic"
import { ownerProofMethod, type ProofMethod } from "@/services/auth/ownerLogic"
import { useAuth0Wrapper, type ProviderConnection } from "@/services/auth/useAuth0Wrapper"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

import { CodeStep } from "./login/LoginSteps"

const log = logger.child({ module: "WrongAccountScreen" })

export interface WrongAccountViewProps {
  proofMethod: ProofMethod
  /** Shown only for the code path. Social owners never see an address (Apple relay). */
  ownerEmailMasked?: string
  step: "prompt" | "code"
  code: string
  onChangeCode: (value: string) => void
  resendWaitSeconds: number
  isBusy: boolean
  onSendCode: () => void
  onVerify: () => void
  onResend: () => void
  onProvider: () => void
  onCancel: () => void
}

// A plain View, not <Screen>: nothing in the jest suite provides a
// SafeAreaProvider, and the shell below owns the Screen wrapper.
export function WrongAccountView(props: WrongAccountViewProps) {
  const { themed } = useAppTheme()
  const { proofMethod, ownerEmailMasked, step, isBusy } = props
  const showCode = proofMethod === "code" || (proofMethod === "unknown" && !!ownerEmailMasked)
  const showProvider = proofMethod === "google" || proofMethod === "apple"

  return (
    <View style={themed($container)}>
      <Text
        testID="wrong-account-title"
        accessibilityRole="header"
        preset="heading"
        style={themed($title)}
        tx="wrongAccountScreen:title"
      />
      <Text style={themed($body)} tx="wrongAccountScreen:body" />

      <View style={themed($controls)}>
        {step === "code" && ownerEmailMasked ? (
          <CodeStep
            emailMasked={ownerEmailMasked}
            code={props.code}
            onChangeCode={props.onChangeCode}
            isVerifying={isBusy}
            onVerify={props.onVerify}
            resendWaitSeconds={props.resendWaitSeconds}
            onResend={props.onResend}
            // "Wrong email? Go back" makes no sense here — the address is the owner's. Back = cancel.
            onWrongEmail={props.onCancel}
          />
        ) : (
          <>
            {showCode && ownerEmailMasked && (
              <Pressable
                testID="wrong-account-send-code"
                accessibilityRole="button"
                accessibilityLabel={translate("wrongAccountScreen:sendCodeTo", { email: ownerEmailMasked })}
                style={[themed($button), isBusy && themed($buttonDisabled)]}
                onPress={props.onSendCode}
                disabled={isBusy}
              >
                <Text
                  style={themed($buttonText)}
                  tx="wrongAccountScreen:sendCodeTo"
                  txOptions={{ email: ownerEmailMasked }}
                />
              </Pressable>
            )}
            {showProvider && (
              <Pressable
                testID="wrong-account-provider"
                accessibilityRole="button"
                accessibilityLabel={translate(
                  proofMethod === "apple"
                    ? "wrongAccountScreen:signInWithApple"
                    : "wrongAccountScreen:signInWithGoogle",
                )}
                style={[themed($button), isBusy && themed($buttonDisabled)]}
                onPress={props.onProvider}
                disabled={isBusy}
              >
                <Text
                  style={themed($buttonText)}
                  tx={
                    proofMethod === "apple"
                      ? "wrongAccountScreen:signInWithApple"
                      : "wrongAccountScreen:signInWithGoogle"
                  }
                />
              </Pressable>
            )}
          </>
        )}

        <Pressable
          testID="wrong-account-cancel"
          accessibilityRole="button"
          accessibilityLabel={translate("wrongAccountScreen:cancel")}
          onPress={props.onCancel}
          disabled={isBusy}
        >
          <Text style={themed($cancelText)} tx="wrongAccountScreen:cancel" />
        </Pressable>
      </View>

      <Text style={themed($support)} tx="wrongAccountScreen:support" />
    </View>
  )
}

interface WrongAccountScreenProps extends AppStackScreenProps<"WrongAccount"> {}

export const WrongAccountScreen: FC<WrongAccountScreenProps> = observer(function WrongAccountScreen() {
  const { themed } = useAppTheme()
  const authStore = useAuthenticationStore()
  const { sendCode, verifyCode, loginWithProvider, abandonForeignSession, isLoading, error, clearError } =
    useAuth0Wrapper()

  const proofMethod = ownerProofMethod(authStore.ownerSub)
  const ownerEmail = authStore.ownerEmail
  const foreignMethod = authStore.foreignSession?.loginMethod

  const [step, setStep] = useState<"prompt" | "code">("prompt")
  const [code, setCode] = useState("")
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (proofMethod === "unknown") log.warn("Owner has an unrecognised sub prefix", { hasEmail: !!ownerEmail })
    trackEvent("wrong_account_shown", { proof: proofMethod })
  }, [proofMethod, ownerEmail])

  useEffect(() => {
    if (step !== "code") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [step])

  const handleSendCode = useCallback(async () => {
    if (!ownerEmail) return
    clearError()
    try {
      await sendCode(ownerEmail)
      setLastSentAt(Date.now())
      setNow(Date.now())
      setStep("code")
    } catch (err) {
      log.warn("Send code failed", { key: classifyAuthError(err) ?? "unclassified" })
    }
  }, [ownerEmail, sendCode, clearError])

  const handleVerify = useCallback(async () => {
    if (!ownerEmail) return
    clearError()
    try {
      // Success: the SDK sets `user`, the wrapper's gate says `match`, the
      // navigator swaps to Main, and the link fires — nothing to do here.
      await verifyCode(ownerEmail, code)
    } catch (err) {
      const key = classifyAuthError(err)
      log.warn("Verify code failed", { key: key ?? "unclassified" })
      setCode("")
      if (key === "tooManyAttempts") setStep("prompt")
    }
  }, [ownerEmail, code, verifyCode, clearError])

  useEffect(() => {
    if (step === "code" && /^\d{6}$/.test(code) && !isLoading) void handleVerify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const handleProvider = useCallback(() => {
    const connection: ProviderConnection = proofMethod === "apple" ? "apple" : "google-oauth2"
    clearError()
    void loginWithProvider(connection, {
      loginHint: ownerEmail,
      // The cookie trap (spec 2 §2.3): a browser-established foreign session,
      // or one we cannot classify (cold-start restore), must be logged out
      // of Auth0 first or the provider hands it straight back.
      clearBrowserSessionFirst: foreignMethod !== "email",
    })
  }, [proofMethod, ownerEmail, foreignMethod, loginWithProvider, clearError])

  const handleCancel = useCallback(() => {
    trackEvent("wrong_account_cancelled")
    void abandonForeignSession()
  }, [abandonForeignSession])

  return (
    <Screen preset="auto" contentContainerStyle={themed($screen)} safeAreaEdges={["top", "bottom"]}>
      <WrongAccountView
        proofMethod={proofMethod}
        ownerEmailMasked={proofMethod === "code" || proofMethod === "unknown" ? (ownerEmail ? maskEmail(ownerEmail) : undefined) : undefined}
        step={step}
        code={code}
        onChangeCode={setCode}
        resendWaitSeconds={resendWaitSeconds(lastSentAt, now)}
        isBusy={isLoading}
        onSendCode={() => void handleSendCode()}
        onVerify={() => void handleVerify()}
        onResend={() => void handleSendCode()}
        onProvider={handleProvider}
        onCancel={handleCancel}
      />
      {error && <ErrorStrip message={error} />}
    </Screen>
  )
})

function ErrorStrip({ message }: { message: string }) {
  const { themed } = useAppTheme()
  return (
    <View style={themed($errorContainer)} pointerEvents="none">
      <Text style={themed($errorText)}>{message}</Text>
    </View>
  )
}

const $screen: ThemedStyle<ViewStyle> = () => ({ flex: 1 })
const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingVertical: spacing.xxl,
  paddingHorizontal: spacing.lg,
  justifyContent: "center",
  gap: spacing.lg,
})
const $title: ThemedStyle<TextStyle> = () => ({ textAlign: "center" })
const $body: ThemedStyle<TextStyle> = ({ colors }) => ({ textAlign: "center", color: colors.textDim })
const $controls: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.md })
const $support: ThemedStyle<TextStyle> = ({ colors }) => ({ textAlign: "center", color: colors.textDim, fontSize: 13 })
const $cancelText: ThemedStyle<TextStyle> = ({ colors }) => ({ textAlign: "center", color: colors.textDim, fontSize: 16, fontWeight: "600" })
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
})
const $buttonDisabled: ThemedStyle<ViewStyle> = () => ({ opacity: 0.7 })
const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({ fontSize: 18, fontWeight: "600", color: colors.tint })
// Absolute so the strip draws over the Screen without shifting the layout.
const $errorContainer: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  position: "absolute",
  top: spacing.xxl,
  left: spacing.lg,
  right: spacing.lg,
  padding: spacing.md,
  backgroundColor: colors.errorBackground,
  borderRadius: 8,
})
const $errorText: ThemedStyle<TextStyle> = ({ colors }) => ({ color: colors.error, textAlign: "center" })
```

- [ ] **Step 4: Run the view test**

Run: `npm run test:component -- app/screens/WrongAccountView.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Route type and navigator branch**

`app/navigators/navigationTypes.ts`, in `AppStackParamList` after `Login: undefined`:

```ts
  /** ADDED 2026-09-17 (spec 2 §2.2): shown instead of Login while a foreign session is held. */
  WrongAccount: undefined
```

`app/navigators/AppNavigator.tsx`: add `import { WrongAccountScreen } from "@/screens/WrongAccountScreen"` and replace the unauthenticated branch:

```tsx
      ) : authStore.foreignSession ? (
        // spec 2 §2.2: the SDK holds a session for an account that is not this
        // device's owner. isAuthenticated is false (the gate wrote no token),
        // so nothing in the authenticated branch — or any identity-driven
        // reaction — ever sees it.
        <Stack.Screen name="WrongAccount" component={WrongAccountScreen} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
```

Add `foreignSession: !!authStore.foreignSession` to the existing `log.debug("Auth state retrieved", ...)` payload and to the `useEffect` dependency list that logs auth state (~line 72).

- [ ] **Step 6: Type-check, lint, deps, commit**

Run: `npm run compile` → PASS
Run: `npm run lint:deps` → PASS

```bash
npx eslint --fix app/screens/WrongAccountScreen.tsx app/screens/WrongAccountView.test.tsx app/navigators/navigationTypes.ts app/navigators/AppNavigator.tsx
git add app/screens/WrongAccountScreen.tsx app/screens/WrongAccountView.test.tsx app/navigators/navigationTypes.ts app/navigators/AppNavigator.tsx
git commit -m "✨ feat(auth): WrongAccountScreen — recover to the device owner, cancel is the only other exit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 12: App documentation

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`)
- Modify: `CLAUDE.md` (Navigation; AuthenticationStore props; Auth §1; Database Layer; Attendance Cloud Backup & Sync)
- Modify: `docs/BACKUP.md` (`## Testing` checklist)
- Modify: `docs/DIAGNOSTICS.md` (after `# Identifiers in logs`)
- Modify: `docs/superpowers/specs/2026-09-12-react-native-auth0-5.11-upgrade-design.md` (one note under "Why" item 2)

- [ ] **Step 1: CHANGELOG under `## [Unreleased]`**

```markdown
### Added
- Passwordless email login: type your email, get a six-digit code, done — no password, no browser. Login and sign-up are one path; the separate Sign Up button is gone. Apple and Google buttons now open the provider directly instead of Auth0's login page. (spec: `docs/superpowers/specs/2026-09-12-passwordless-login-design.md`)
- Wrong-account recovery: signing in with an account that isn't the one this device belongs to shows one screen that gets you back into the right account (a code to its email, or its Apple/Google button) and links the two so the same wrong tap next time just works. Cancel is the only other exit. (spec: `docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md`)

### Changed
- Signing out after an email-code login no longer opens a browser (and no longer shows the iOS "Sign In" dialog).

### Removed
- The Sign Up button and the separate signup flow.

### Security
- A session for a different account can no longer read the device owner's local data, clear their unsynced attendance outbox, or register push/RevenueCat identity — the ownership gate in the auth wrapper refuses it before any identity is written.
```

- [ ] **Step 2: CLAUDE.md edits**

- **State Management → AuthenticationStore Props**: change to `refreshToken`, `authEmail`, `userId`, `deviceId`, `isAnonymous`, `loginMethod` (how the current session started; drives the logout branch), `ownerSub` / `ownerEmail` (the device owner — survives logout, cleared only by `resetLocalDatabase()`); **Volatile** add `foreignSession` (a session the ownership gate refused; drives the `WrongAccount` route).
- **Navigation → App-level gating**: `outage check → WrongAccount (when authStore.foreignSession) → Login → Onboarding → Main`, with one sentence: "`WrongAccountScreen` shows while the SDK holds a session whose sub is not `ownerSub`; `isAuthenticated` is false in that state by construction (the gate in `useAuth0Wrapper` writes no token), so no identity-driven reaction sees it. Spec: `docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md`."
- **Auth, Attestation & Encryption Keys §1**: replace "Universal Login via `react-native-auth0`" with: "Three ways in (spec `2026-09-12-passwordless-login-design.md`): an in-app email code (`sendCode` / `verifyCode` — `authorizeWithEmail` MUST get our `audience`+`scope` or the token is opaque), and Apple / Google via `authorize({ connection })` so Universal Login never renders. `loginMethod` is recorded only for an accepted session; logout branches on it (`clearCredentials` for email, `clearSession` for social). The ownership gate (`decideOwnership`, `ownerLogic.ts`, vitest) runs before any token is written. The password migration is entirely an Auth0 post-login Action — see spec 1 §3.5."
- **Database Layer**, the RS-024 bullet "The key and the file are one unit": append "…and so is the owner record: `resetLocalDatabase({ clearOwner })` clears `ownerSub`/`ownerEmail` (2026-09-17)."
- **Attendance Cloud Backup & Sync**, after the `sync.queueOwnerUid` bullet: "ADDED 2026-09-17: the ownership gate in `useAuth0Wrapper` is what keeps a foreign session from ever reaching `takeQueueOwnership` — a refused session never sets `userId`, so the account-switch clear cannot fire for an accidental wrong-account login. The MMKV check stays as belt-and-braces."
- **Test Runner Split** counts: bump to "34 test files (27 `.test.ts`, 9 `.test.tsx`)" — recount with `find app -name '*.test.ts' | wc -l` / `'*.test.tsx'` before writing the number.

- [ ] **Step 3: `docs/BACKUP.md` → `## Testing`**

Append to the manual checklist:

```markdown
- **Wrong-account login leaves the outbox alone (2026-09-17).** Create an attendance offline as A. Sign out. Sign in as a different email → WrongAccountScreen. Cancel → Login. Sign in as A. Expect: the row pushes on the next tick and the log never shows `Account switch — clearing the previous owner's outbox`.
```

- [ ] **Step 4: `docs/DIAGNOSTICS.md` → after the identifiers table**

```markdown
### Ownership lines (2026-09-17)

| line | module | ids |
| --- | --- | --- |
| `Device owner adopted` | useAuth0Wrapper | `ownerId` (hashed) |
| `Owner stamped from hydration` | RootStore | — |
| `Foreign session on an owned device` | useAuth0Wrapper | `ownerId`, `sessionId` (both hashed), `loginMethod` |
| `Foreign identity linked` / `Foreign identity link failed` | linkForeignIdentity | counts / problem kind |

Support lookup for "I signed in and my meetings are gone": search `Foreign session on an owned device` for the device; `ownerId` is the account with the data.
```

- [ ] **Step 5: 5.11 spec cross-reference**

Under "Why" item 2 in `2026-09-12-react-native-auth0-5.11-upgrade-design.md`, append: "NOTE 2026-09-17: with passwordless login (spec `2026-09-12-passwordless-login-design.md`) the email path never opens a browser, so this scenario now applies only to the Apple and Google buttons."

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md CLAUDE.md docs/BACKUP.md docs/DIAGNOSTICS.md docs/superpowers/specs/2026-09-12-react-native-auth0-5.11-upgrade-design.md
git commit -m "📝 docs(auth): changelog, CLAUDE.md, backup checklist and diagnostics for passwordless login + ownership

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

## API tasks (repo `/Users/jenova/projects/recoverysky-org/api`, branch `feat/identity-link`)

Every API task starts with `cd /Users/jenova/projects/recoverysky-org/api && git branch --show-current` and expects `feat/identity-link` (create it from `prod`'s default branch with `git switch -c feat/identity-link` on the first task). Tests run with `npm test -- <path>` (vitest). Commit trailer as in Global Constraints.

### Task 13: `AUTH_MOBILE_CLIENT_ID` config

**Files:**
- Modify: `src/config/index.ts` (auth schema ~line 49; env map ~line 302)
- Modify: `.env.example` (after `AUTH_MGMT_TIMEOUT_MS`)

**Interfaces:**
- Produces: `config.auth.mobileClientId?: string` — the Native application's client id (same value the app has as `EXPO_PUBLIC_AUTH0_CLIENT_ID`; public, not a secret; NOT the M2M `AUTH_MGMT_CLIENT_ID`).

- [ ] **Step 1: Schema**

In the `auth: z.object({ ... })` block after `mgmtTimeoutMs`:

```ts
    // The Native application's client id — the `aud` of an ID token issued to
    // the mobile app. POST /auth0/link verifies the foreign session's ID token
    // against it (spec 2 §3.2). Public identifier; not the M2M client above.
    mobileClientId: z.string().optional(),
```

- [ ] **Step 2: Env map**

After `mgmtTimeoutMs: process.env["AUTH_MGMT_TIMEOUT_MS"],`:

```ts
      mobileClientId: process.env["AUTH_MOBILE_CLIENT_ID"],
```

- [ ] **Step 3: `.env.example`**

```
# Native app's Auth0 client id (same value as the app's EXPO_PUBLIC_AUTH0_CLIENT_ID).
# Required by POST /auth0/link; the route answers 503 without it.
AUTH_MOBILE_CLIENT_ID=your-native-app-client-id
```

- [ ] **Step 4: Type-check and commit**

Run: `npx tsc --noEmit` → PASS

```bash
git add src/config/index.ts .env.example
git commit -m "🔧 config(auth): AUTH_MOBILE_CLIENT_ID for ID-token verification

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 14: `verifyIdToken()`

**Files:**
- Modify: `src/middleware/auth.ts` (export a new function after `verifyToken`)
- Test: `src/middleware/auth.test.ts` (new `describe` at the end, reusing its JWKS server and `mint()`)

**Interfaces:**
- Consumes: the module-private `getJWKS()`, `config.auth.issuer`, `config.auth.mobileClientId` (Task 13), `ok`/`err`/`unauthorized`/`serviceUnavailable` from `../errors/results.js`.
- Produces: `export async function verifyIdToken(token: string): Promise<ApiResult<jose.JWTPayload>>` — `ok(payload)` with a non-empty `sub`; `err(unauthorized("Invalid link token", { code: "invalid_link_token" }))` for any verification failure; `err(serviceUnavailable(...))` when `mobileClientId` is unset.

- [ ] **Step 1: Write the failing tests** (append to `auth.test.ts`; add `mobileClientId: "native-app"` to `mockConfig.auth` and import `verifyIdToken`)

```ts
describe("verifyIdToken (POST /auth0/link, ADDED 2026-09-17)", () => {
  it("accepts a token issued to the Native app", async () => {
    const result = await verifyIdToken(await mint({ audience: "native-app" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sub).toBe("auth0|tester");
  });

  it("rejects a token issued to the API audience — an access token is not an ID token", async () => {
    const result = await verifyIdToken(await mint({ audience: "recoverysky-api" }));
    expect(expectError(result).context).toMatchObject({ code: "invalid_link_token" });
  });

  it("rejects a token signed by a stranger", async () => {
    const result = await verifyIdToken(await mint({ audience: "native-app", key: strangerKey }));
    expect(expectError(result).context).toMatchObject({ code: "invalid_link_token" });
  });

  it("rejects an expired token", async () => {
    const result = await verifyIdToken(await mint({ audience: "native-app", expiresIn: "-1h" }));
    expect(expectError(result).context).toMatchObject({ code: "invalid_link_token" });
  });

  it("is a 503 when AUTH_MOBILE_CLIENT_ID is unset", async () => {
    const saved = mockConfig.auth.mobileClientId;
    mockConfig.auth.mobileClientId = undefined as unknown as string;
    const result = await verifyIdToken(await mint({ audience: "native-app" }));
    expect(expectError(result).kind).toBe("ServiceUnavailable");
    mockConfig.auth.mobileClientId = saved;
  });
});
```

(`ApiErrorKind` literals are PascalCase — `ServiceUnavailable`, `Unauthorized`, `BadRequest` — see `src/errors/results.ts` lines 14–27.) The test's `expectError` helper already exists in the file. `mockConfig.auth` is typed from its literal; declare `mobileClientId: "native-app" as string | undefined` so the 503 case compiles.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/middleware/auth.test.ts`
Expected: FAIL — `verifyIdToken` is not exported

- [ ] **Step 3: Implement**

After `verifyToken` in `src/middleware/auth.ts`:

```ts
/**
 * Verify an ID token issued to the Native application (audience = the mobile
 * client id) against the tenant's JWKS. Used by POST /auth0/link to prove the
 * caller actually holds a session for the identity it wants linked before a
 * single row is reassigned (spec 2 §3.2). Deliberately NOT the bearer path:
 * the audiences differ, and a bearer must never be accepted here.
 * ADDED 2026-09-17.
 */
export async function verifyIdToken(token: string): Promise<ApiResult<jose.JWTPayload>> {
  if (!config.auth.mobileClientId) {
    return err(serviceUnavailable("AUTH_MOBILE_CLIENT_ID is not configured"));
  }
  try {
    const { payload } = await jose.jwtVerify(token, getJWKS(), {
      issuer: config.auth.issuer,
      audience: config.auth.mobileClientId,
    });
    if (!payload.sub) {
      return err(unauthorized("Invalid link token", { code: "invalid_link_token" }));
    }
    return ok(payload);
  } catch (error) {
    getLogger().warn({ err: error }, "Auth: link token rejected");
    return err(unauthorized("Invalid link token", { code: "invalid_link_token" }));
  }
}
```

Add `serviceUnavailable` to the `../errors/results.js` import if it is not already there (it is used elsewhere in the file — check).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/middleware/auth.test.ts`
Expected: PASS (existing suite + 5 new)

- [ ] **Step 5: Commit**

```bash
git add src/middleware/auth.ts src/middleware/auth.test.ts
git commit -m "✨ feat(auth): verifyIdToken against the Native app's client id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 15: `reassignUserRows()` sweep

**Files:**
- Create: `src/services/identitySweep.ts`
- Test: `src/services/identitySweep.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SqlRunner { query(text: string, params: unknown[]): Promise<{ rowCount: number | null }> }  // pg.PoolClient satisfies this
  export interface SweepCounts { attendances: number; attendanceReports: number; reminders: number; notificationDeliveries: number; unsubscribes: number; pushTokens: number; notificationSubscriptions: number }
  export interface SweepResult { moved: SweepCounts; dropped: { pushTokens: number; notificationSubscriptions: number } }
  export async function reassignUserRows(db: SqlRunner, args: { from: string; to: string; nowMs: number }): Promise<SweepResult>
  ```
- The caller (Task 16) owns `BEGIN`/`COMMIT`/`ROLLBACK`; this function only issues statements on the client it is given.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/identitySweep.test.ts
import { describe, expect, it } from "vitest";

import { reassignUserRows, type SqlRunner } from "./identitySweep.js";

function fakeRunner(counts: number[]) {
  const calls: { text: string; params: unknown[] }[] = [];
  const runner: SqlRunner = {
    async query(text, params) {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
      return { rowCount: counts.shift() ?? 0 };
    },
  };
  return { runner, calls };
}

describe("reassignUserRows", () => {
  it("issues nine statements in order: five plain updates, then drop+move for the two unique-per-device tables", async () => {
    const { runner, calls } = fakeRunner([3, 1, 2, 0, 0, 1, 4, 0, 2]);
    const result = await reassignUserRows(runner, { from: "email|b", to: "auth0|a", nowMs: 1_700_000_000_000 });

    expect(calls.map((c) => c.text)).toEqual([
      "UPDATE attendances SET uid = $1, updated = $2 WHERE uid = $3",
      "UPDATE attendance_reports SET uid = $1, updated = $2 WHERE uid = $3",
      "UPDATE reminders SET uid = $1 WHERE uid = $2",
      "UPDATE notification_deliveries SET uid = $1 WHERE uid = $2",
      "UPDATE unsubscribes SET uid = $1 WHERE uid = $2",
      "DELETE FROM push_tokens b WHERE b.uid = $1 AND EXISTS (SELECT 1 FROM push_tokens a WHERE a.uid = $2 AND a.did = b.did)",
      "UPDATE push_tokens SET uid = $1 WHERE uid = $2",
      "DELETE FROM notification_subscriptions b WHERE b.uid = $1 AND EXISTS (SELECT 1 FROM notification_subscriptions a WHERE a.uid = $2 AND a.did = b.did AND a.type_id = b.type_id)",
      "UPDATE notification_subscriptions SET uid = $1 WHERE uid = $2",
    ]);
    expect(calls[0]!.params).toEqual(["auth0|a", 1_700_000_000_000, "email|b"]);
    expect(calls[2]!.params).toEqual(["auth0|a", "email|b"]);
    expect(calls[5]!.params).toEqual(["email|b", "auth0|a"]);

    expect(result).toEqual({
      moved: {
        attendances: 3,
        attendanceReports: 1,
        reminders: 2,
        notificationDeliveries: 0,
        unsubscribes: 0,
        pushTokens: 4,
        notificationSubscriptions: 2,
      },
      dropped: { pushTokens: 1, notificationSubscriptions: 0 },
    });
  });

  it("treats a null rowCount as zero", async () => {
    const runner: SqlRunner = { async query() { return { rowCount: null }; } };
    const result = await reassignUserRows(runner, { from: "x", to: "y", nowMs: 1 });
    expect(Object.values(result.moved).every((n) => n === 0)).toBe(true);
  });

  it("refuses to sweep an identity onto itself", async () => {
    const { runner, calls } = fakeRunner([]);
    await expect(reassignUserRows(runner, { from: "same", to: "same", nowMs: 1 })).rejects.toThrow(/same/);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/services/identitySweep.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

```ts
// src/services/identitySweep.ts
/**
 * Move every row keyed on one Auth0 sub to another (spec 2 §3.4). Runs on the
 * pg client the caller hands in, inside the caller's transaction — this module
 * never BEGINs or COMMITs.
 *
 * Two groups of tables:
 * - plain reassignment (no uniqueness rule involves uid): attendances,
 *   attendance_reports, reminders, notification_deliveries, unsubscribes.
 *   Attendance and report rows also get `updated` bumped to `nowMs` so the
 *   owner's devices pull them: AttendanceRepository.findChangedSince keys on
 *   `updated` (epoch ms) and the pull cursor is per uid.
 * - drop-then-move (a unique index includes uid): push_tokens (uid, did) and
 *   notification_subscriptions (uid, did, type_id). Rows the target already
 *   has for that device (and type) are deleted first, the rest move. Deleting
 *   instead of reassigning everything was rejected: reminders are created
 *   once and never re-sent by the app, so a delete would drop scheduled pushes.
 */

export interface SqlRunner {
  query(text: string, params: unknown[]): Promise<{ rowCount: number | null }>;
}

export interface SweepCounts {
  attendances: number;
  attendanceReports: number;
  reminders: number;
  notificationDeliveries: number;
  unsubscribes: number;
  pushTokens: number;
  notificationSubscriptions: number;
}

export interface SweepResult {
  moved: SweepCounts;
  dropped: { pushTokens: number; notificationSubscriptions: number };
}

async function run(db: SqlRunner, text: string, params: unknown[]): Promise<number> {
  const result = await db.query(text, params);
  return result.rowCount ?? 0;
}

export async function reassignUserRows(
  db: SqlRunner,
  args: { from: string; to: string; nowMs: number },
): Promise<SweepResult> {
  const { from, to, nowMs } = args;
  if (from === to) throw new Error("reassignUserRows: from and to are the same identity");

  const attendances = await run(db, "UPDATE attendances SET uid = $1, updated = $2 WHERE uid = $3", [to, nowMs, from]);
  const attendanceReports = await run(db, "UPDATE attendance_reports SET uid = $1, updated = $2 WHERE uid = $3", [to, nowMs, from]);
  const reminders = await run(db, "UPDATE reminders SET uid = $1 WHERE uid = $2", [to, from]);
  const notificationDeliveries = await run(db, "UPDATE notification_deliveries SET uid = $1 WHERE uid = $2", [to, from]);
  const unsubscribes = await run(db, "UPDATE unsubscribes SET uid = $1 WHERE uid = $2", [to, from]);

  const droppedPushTokens = await run(
    db,
    "DELETE FROM push_tokens b WHERE b.uid = $1 AND EXISTS (SELECT 1 FROM push_tokens a WHERE a.uid = $2 AND a.did = b.did)",
    [from, to],
  );
  const pushTokens = await run(db, "UPDATE push_tokens SET uid = $1 WHERE uid = $2", [to, from]);

  const droppedSubscriptions = await run(
    db,
    "DELETE FROM notification_subscriptions b WHERE b.uid = $1 AND EXISTS (SELECT 1 FROM notification_subscriptions a WHERE a.uid = $2 AND a.did = b.did AND a.type_id = b.type_id)",
    [from, to],
  );
  const notificationSubscriptions = await run(db, "UPDATE notification_subscriptions SET uid = $1 WHERE uid = $2", [to, from]);

  return {
    moved: { attendances, attendanceReports, reminders, notificationDeliveries, unsubscribes, pushTokens, notificationSubscriptions },
    dropped: { pushTokens: droppedPushTokens, notificationSubscriptions: droppedSubscriptions },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/services/identitySweep.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/identitySweep.ts src/services/identitySweep.test.ts
git commit -m "✨ feat(auth): reassignUserRows — move a foreign identity's rows to the owner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 16: `POST /auth0/link`

**Files:**
- Modify: `src/routes/auth0.ts` (new route after `/profile`)
- Test: `src/routes/auth0.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `verifyIdToken` (Task 14), `reassignUserRows` (Task 15), `getPool` from `../db/index.js`, `management()` / `getDomain()` already in the file.
- Produces: `POST /auth0/link` with body `{ linkWith: string }`:
  - 200 `{ linked: true, moved: SweepCounts }`
  - 200 `{ linked: false, reason: "same_user" | "already_linked", moved: {} }`
  - 400 `{ error: "bad_request" | "unauthorized", message, code?: "invalid_link_token" }` for a bad body / bad token
  - 502 `{ error: "link_failed", message }` when Auth0 refuses the link (sweep rolled back)
  - 503 when the Management API or `AUTH_MOBILE_CLIENT_ID` is unconfigured

- [ ] **Step 1: Write the failing tests** (append to `auth0.test.ts`)

Extend the `vi.mock("../middleware/auth.js", ...)` factory to also export `verifyIdToken`, and add a pool mock:

```ts
const verifyIdTokenMock = vi.hoisted(() => vi.fn());
const dbQueries = vi.hoisted(() => [] as { text: string; params: unknown[] }[]);
vi.mock("../middleware/auth.js", () => ({
  authenticateSignedIn: (req: any, _res: any, next: any) => {
    req.user = { sub: "auth0|tester", isAnonymous: false };
    next();
  },
  verifyIdToken: verifyIdTokenMock,
}));
vi.mock("../db/index.js", () => ({
  getPool: () => ({
    connect: async () => ({
      query: async (text: string, params: unknown[] = []) => {
        dbQueries.push({ text: text.replace(/\s+/g, " ").trim(), params });
        return { rowCount: 0 };
      },
      release: () => {},
    }),
  }),
}));
```

Add `mobileClientId: "native-app"` to `mockConfig.auth`. Then:

```ts
const A_ID = "auth0|tester";
const B_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJlbWFpbHxiIn0.c2ln";

function getUserOk(identities: { provider: string; user_id: string }[]): Step {
  return { kind: "ok", body: { identities } };
}
function linkOk(): Step {
  return { kind: "ok", body: [{ provider: "auth0", user_id: "tester" }, { provider: "email", user_id: "b" }] };
}
function postLink(body: unknown = { linkWith: B_TOKEN }) {
  return request(app()).post("/auth0/link").send(body);
}

describe("POST /auth0/link", () => {
  beforeEach(() => {
    dbQueries.length = 0;
    verifyIdTokenMock.mockReset();
    verifyIdTokenMock.mockResolvedValue({ ok: true, value: { sub: "email|b" } });
  });

  it("400s a non-JWT body without touching the database or Auth0", async () => {
    const res = await postLink({ linkWith: "nope" });
    expect(res.status).toBe(400);
    expect(dbQueries).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("400s a token that fails verification", async () => {
    verifyIdTokenMock.mockResolvedValue({
      ok: false,
      error: { kind: "Unauthorized", statusCode: 401, message: "Invalid link token", context: { code: "invalid_link_token" } },
    });
    const res = await postLink();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_link_token");
    expect(dbQueries).toHaveLength(0);
  });

  it("is a no-op when the token's sub is the caller", async () => {
    verifyIdTokenMock.mockResolvedValue({ ok: true, value: { sub: A_ID } });
    const res = await postLink();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false, reason: "same_user", moved: {} });
    expect(dbQueries).toHaveLength(0);
  });

  it("is a no-op when the identity is already linked", async () => {
    steps = [tokenOk(), getUserOk([{ provider: "auth0", user_id: "tester" }, { provider: "email", user_id: "b" }])];
    const res = await postLink();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false, reason: "already_linked", moved: {} });
    expect(dbQueries).toHaveLength(0);
  });

  it("sweeps inside a transaction, links, and commits", async () => {
    steps = [tokenOk(), getUserOk([{ provider: "auth0", user_id: "tester" }]), linkOk()];
    const res = await postLink();
    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(true);
    expect(res.body.moved).toEqual({
      attendances: 0, attendanceReports: 0, reminders: 0, notificationDeliveries: 0,
      unsubscribes: 0, pushTokens: 0, notificationSubscriptions: 0,
    });
    expect(dbQueries[0]!.text).toBe("BEGIN");
    expect(dbQueries.at(-1)!.text).toBe("COMMIT");
    expect(dbQueries).toHaveLength(11); // BEGIN + 9 sweep statements + COMMIT
    const link = calls.find((c) => c.url.endsWith(`/api/v2/users/${encodeURIComponent(A_ID)}/identities`));
    expect(link).toBeDefined();
    expect(JSON.parse(String(link!.init!.body))).toEqual({ link_with: B_TOKEN });
    expect(link!.init!.method).toBe("POST");
  });

  it("rolls the sweep back and answers 502 when Auth0 refuses the link", async () => {
    // fetchAuth0 retries a 5xx once, so script the failure twice.
    steps = [tokenOk(), getUserOk([{ provider: "auth0", user_id: "tester" }]), { kind: "ok", status: 500, body: {} }, { kind: "ok", status: 500, body: {} }];
    const res = await postLink();
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("link_failed");
    expect(dbQueries.at(-1)!.text).toBe("ROLLBACK");
  });

  it("does not sweep when a 4xx from Auth0 says the token is bad (no retry, rollback)", async () => {
    steps = [tokenOk(), getUserOk([{ provider: "auth0", user_id: "tester" }]), { kind: "ok", status: 400, body: { message: "invalid link_with" } }];
    const res = await postLink();
    expect(res.status).toBe(502);
    expect(dbQueries.at(-1)!.text).toBe("ROLLBACK");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/routes/auth0.test.ts`
Expected: FAIL — `POST /auth0/link` 404s

- [ ] **Step 3: Implement the route**

Imports to add at the top of `src/routes/auth0.ts`:

```ts
import { authenticateSignedIn, verifyIdToken, type AuthenticatedRequest } from "../middleware/auth.js";
import { badGateway, badRequest, internalError, serviceUnavailable } from "../errors/results.js";
import { getPool } from "../db/index.js";
import { reassignUserRows } from "../services/identitySweep.js";
```

`badGateway` does not exist yet. In `src/errors/results.ts` add `| 'BadGateway'` to the `ApiErrorKind` union (line ~26, after `'AttestationFailed'`) and, after `serviceUnavailable`:

```ts
/** Upstream (Auth0 Management API) answered, but not usefully. ADDED 2026-09-17 for POST /auth0/link. */
export function badGateway(message: string, cause?: unknown): ApiError {
  return {
    kind: 'BadGateway',
    message,
    statusCode: 502,
    cause,
  };
}
```

Schema and route, after the `/profile` handler:

```ts
// Compact JWS only. Length cap keeps a hostile body off the JWKS verifier.
const linkSchema = z.object({
  linkWith: z
    .string()
    .min(20)
    .max(8192)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "must be a compact JWT"),
});

/**
 * Fold a foreign identity into the caller's account (spec 2 §3).
 *
 * Order is deliberate: verify the foreign ID token (no row moves on an
 * unverified string) → same-user / already-linked no-ops → BEGIN → sweep →
 * Auth0 link → COMMIT. Auth0 first would be wrong: once it folds B into A,
 * B's identity is gone and a failed sweep could never be retried with a fresh
 * proof, whereas a failed link after a rolled-back sweep costs nothing.
 * ADDED 2026-09-17.
 */
router.post(
  "/link",
  authenticateSignedIn,
  createRateLimiter(),
  async (req: AuthenticatedRequest, res: Response) => {
    const logger = getLogger();
    const user = req.user!;
    const ownerSub = user.sub;

    if (!config.auth.mgmtClientId || !config.auth.mgmtClientSecret) {
      const error = serviceUnavailable("Auth0 Management API is not configured");
      res.status(error.statusCode).json({ error: error.kind, message: error.message });
      return;
    }

    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ sub: ownerSub, issues: parsed.error.issues }, "POST /auth0/link: validation failed");
      const error = badRequest("Invalid request body", { issues: parsed.error.issues });
      res.status(error.statusCode).json({ error: error.kind, message: error.message, details: error.context });
      return;
    }
    const { linkWith } = parsed.data;

    const verified = await verifyIdToken(linkWith);
    if (!verified.ok) {
      const error = verified.error;
      // 503 (unconfigured) passes through; anything else is the client's token.
      const status = error.statusCode === 503 ? 503 : 400;
      logger.warn({ sub: ownerSub, kind: error.kind }, "POST /auth0/link: link token rejected");
      res.status(status).json({ error: error.kind, message: error.message, code: "invalid_link_token" });
      return;
    }
    const foreignSub = verified.value.sub as string;

    if (foreignSub === ownerSub) {
      res.status(200).json({ linked: false, reason: "same_user", moved: {} });
      return;
    }

    const domain = getDomain();
    try {
      const mgmtToken = await management().getManagementToken();
      const headers = { Authorization: `Bearer ${mgmtToken}`, "Content-Type": "application/json" };

      // Idempotency: a linked identity appears in the primary's identities as
      // provider + user_id. (Confirm Auth0's own duplicate-link error when
      // tenant access returns — spec 2 §6 — and map it here too.)
      const getRes = await management().fetchAuth0(
        "get-user-identities",
        `https://${domain}/api/v2/users/${encodeURIComponent(ownerSub)}?fields=identities&include_fields=true`,
        { method: "GET", headers },
      );
      if (!getRes.ok) {
        const text = await getRes.text();
        logger.error({ sub: ownerSub, status: getRes.status, body: text }, "POST /auth0/link: identities lookup failed");
        const error = badGateway(`Auth0 lookup failed: ${getRes.status}`);
        res.status(error.statusCode).json({ error: "link_failed", message: error.message });
        return;
      }
      const { identities = [] } = (await getRes.json()) as { identities?: { provider: string; user_id: string }[] };
      if (identities.some((i) => `${i.provider}|${i.user_id}` === foreignSub)) {
        res.status(200).json({ linked: false, reason: "already_linked", moved: {} });
        return;
      }

      const client = await getPool().connect();
      let linkedInAuth0 = false;
      try {
        await client.query("BEGIN");
        const sweep = await reassignUserRows(client, { from: foreignSub, to: ownerSub, nowMs: Date.now() });

        const linkRes = await management().fetchAuth0(
          "link-identity",
          `https://${domain}/api/v2/users/${encodeURIComponent(ownerSub)}/identities`,
          { method: "POST", headers, body: JSON.stringify({ link_with: linkWith }) },
        );
        if (!linkRes.ok) {
          const text = await linkRes.text();
          await client.query("ROLLBACK");
          logger.error({ sub: ownerSub, status: linkRes.status, body: text }, "POST /auth0/link: Auth0 refused the link — sweep rolled back");
          const error = badGateway(`Auth0 link failed: ${linkRes.status}`);
          res.status(error.statusCode).json({ error: "link_failed", message: error.message });
          return;
        }
        linkedInAuth0 = true;
        await client.query("COMMIT");

        logger.info({ sub: ownerSub, foreignSub, moved: sweep.moved, dropped: sweep.dropped }, "POST /auth0/link: linked");
        res.status(200).json({ linked: true, moved: sweep.moved });
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => {});
        if (linkedInAuth0) {
          // Auth0 has already folded the identity; the rows did not move.
          // Support finishes by hand: re-run the sweep for these two subs.
          logger.error({ err: cause, sub: ownerSub, foreignSub }, "POST /auth0/link: COMMIT failed AFTER Auth0 linked — rows not moved, needs manual sweep");
        } else {
          logger.error({ err: cause, sub: ownerSub, foreignSub }, "POST /auth0/link: sweep failed — rolled back");
        }
        const error = internalError("Failed to link identity", cause);
        res.status(error.statusCode).json({ error: error.kind, message: error.message });
      } finally {
        client.release();
      }
    } catch (cause) {
      logger.error({ err: cause, sub: ownerSub }, "POST /auth0/link: unexpected failure");
      const error = internalError("Failed to link identity", cause);
      res.status(error.statusCode).json({ error: error.kind, message: error.message });
    }
  },
);
```

Logging note: this route logs raw subs like its sibling `/profile` route does — the API's server-side logs already carry `sub` throughout; the app-side hashing rule applies to the app's Loki stream.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/routes/auth0.test.ts`
Expected: PASS (existing `/profile` suite + 7 new)

- [ ] **Step 5: Type-check, commit**

Run: `npx tsc --noEmit` → PASS

```bash
git add src/routes/auth0.ts src/routes/auth0.test.ts src/errors/results.ts
git commit -m "✨ feat(auth): POST /auth0/link — verify, sweep in a transaction, link, commit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 17: API docs

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`)
- Modify: `TODO.md` (if it tracks the Auth0-MFA-blocked items, add the runbook there)

- [ ] **Step 1: CHANGELOG**

```markdown
### Added
- `POST /auth0/link` (bearer = the device owner; body `{ linkWith: <foreign ID token> }`). Verifies the token against `AUTH_MOBILE_CLIENT_ID`, reassigns the foreign sub's rows in `attendances`, `attendance_reports`, `reminders`, `notification_deliveries`, `unsubscribes`, `push_tokens`, `notification_subscriptions` to the caller inside one transaction, then links the identity via the Management API and commits. Answers `{ linked, reason?, moved }`; 502 `link_failed` rolls the sweep back. Spec: app repo `docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md`.
- `AUTH_MOBILE_CLIENT_ID` — the Native app's Auth0 client id; the link route answers 503 without it.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md TODO.md
git commit -m "📝 docs(auth): changelog for POST /auth0/link and AUTH_MOBILE_CLIENT_ID

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014BsZLdqxeB3eZLm47iPhvn"
```

---

### Task 18: Tenant runbook, deploy order, and manual verification (no code)

Blocked until Auth0 tenant access is restored. Nothing from Tasks 1–17 merges before this task is complete on the **production** tenant. Run it first against the **dev** application, then repeat on production.

- [ ] **Step 1: Confirm the "verify when tenant access returns" items** — spec 1 §6 and spec 2 §6. Record the answers as a dated note at the bottom of each spec:
  - exact `code`/`message` for wrong and expired OTP (adjust `classifyAuthError`'s `invalid_grant` regex if needed);
  - the tenant's passwordless send limit (adjust `errorSendRateLimited` copy if needed);
  - Auth0's response for `link_with` on an already-linked identity (map it in the route's `!linkRes.ok` branch to the `already_linked` 200 if it is a 4xx with a recognisable message);
  - what happens to a linked secondary's refresh token on another device;
  - which other applications use the database connection.
- [ ] **Step 2: Execute spec 1 §3 runbook, items 1–6** (passwordless connection in OTP mode, Passwordless OTP grant on the Native app, social connections enabled, Postmark + SPF/DKIM/DMARC + verification-code template, the linking Action with `read:users` + `update:users` on the M2M client, brute-force protection on). Item 7 (retire password login from the mobile app) is LAST and only after step 4 below passes.
- [ ] **Step 3: Deploy the API branch** with `AUTH_MOBILE_CLIENT_ID` set in the environment. Confirm `POST /auth0/link` with a garbage body returns 400, not 503.
- [ ] **Step 4: Manual checklist — spec 1 §4.3** (dev application, dev build):
  - code autofills from Mail (iOS) / Gmail (Android); six digits auto-submit
  - wrong code → inline message, stays on `code`; expired (>3 min) → message, Resend works
  - Resend disabled 30 s; Auth0's send limit → `errorSendRateLimited`, back to `email`
  - existing **password** user by code → same hashed `userId` in the sign-in log line as before, attendance intact, no prompt
  - existing **Google** user types their Gmail → lands in the Google account
  - Apple / Google buttons open the provider directly; Universal Login never appears
  - sign out after an email session: no browser, no iOS dialog
  - sign out after a social session: unchanged
  - cold start after each method restores the session; no "unusable access token" log line
  - ADDED 2026-09-30 — the happy-path run of the two items below, step by step across iOS + Android with sync: `docs/AUTH_LINKING_TESTS.md`
  - ADDED 2026-09-30 — **Link passwordless identity** Action (`auth0/actions/bad-bitch-tenant/link-passwordless-identity.js`, deployed per `auth0/README.md`). On bad-bitch-tenant, create a **password** user (Auth0 dashboard → User Management → Users → Create, Username-Password connection) with a real inbox you can read. Then on a device, Continue with Email with that address:
    - lands in the password account: the ID token's `sub` is `auth0|…`, not `email|…`; Auth0 Logs show `linked email identity into auth0 primary`; Users has ONE user for that email with two identities (auth0 + email), no separate `email|` user
    - sign out and sign in by code again → same sub, no second `linked…` line (idempotency guard), Settings → Account now lists Email active + password linked
    - repeat with a **Google** account: sign up with Google first, then Continue with Email with the Gmail address → lands in the Google account (`google-oauth2|…` sub)
    - two candidates (a password AND a Google account on the same address) → links into the OLDER one
    - a brand-new address → a fresh `email|…` user, no link, login unaffected
    - failure path: temporarily break `MGMT_CLIENT_SECRET` in the Action's secrets → login still succeeds (fresh `email|` user), log shows `link skipped: token grant 401`; restore the secret, delete that stray user
    - an existing device owned by the password account (sign in once with the password on an older build, or seed `ownerSub`) → the code login is a `match`, no wrong-account screen, attendance intact
  - ADDED 2026-09-30 — **relinked owner** (spec 2 §7, needs Identities claim v2): phone A signs in as X by code; phone B signed in as Y (Google) links X from Settings → Account; phone A signs out and back in as X → goes straight in, logs `Device owner relinked into a linked account`, `Moved local rows to the relinked owner`, `Relinked owner — keeping the outbox`, never `Account switch — clearing…`; A's unsynced attendance survives and syncs under Y
- [ ] **Step 5: Manual checklist — spec 2 §4** (items 1–10 as written in the spec), including item 7 (an unpushed attendance survives a B mismatch; `Account switch — clearing the previous owner's outbox` never logs) and item 8 (a real B account with attendance on a second phone → `moved.attendances > 0` → A's device pulls them).
- [ ] **Step 6: Repeat steps 2–5 on the production tenant/application**, then spec 1 §3 item 7, then deploy the Identities claim Action to prod (ADDED 2026-09-30: copy `identities-claim.js` into `auth0/actions/meetingmaker/`, then `ENV_FILE=<prod mgmt env> auth0/scripts/deploy-actions.sh meetingmaker --apply --prod` after a dry run; the linking Action must end up ABOVE it in Post Login — see `auth0/README.md`), then ship the app as an OTA via `npm run update` after moving the CHANGELOG `[Unreleased]` entries under the new `[X.Y.Z-N]` heading.
