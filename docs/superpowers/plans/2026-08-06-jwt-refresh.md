# Proactive JWT Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both of the app's JWTs — the device attestation token and the Auth0 access token — refresh proactively before every API call, so signed-in users stop silently losing API access when their access token expires.

**Architecture:** A single apisauce async request transform on `recoverySkyApi` awaits two injected "refresher" functions and stamps `X-Device-Token` / `Authorization` onto each individual request. Refreshers are injected (not imported) so `app/services/api/` stays a dependency leaf and `depcruise` sees no cycle. All decision logic lives in a pure, vitest-covered module; the I/O orchestrator around it is verified by hand.

**Tech Stack:** TypeScript, apisauce (`addAsyncRequestTransform`), `react-native-auth0` v5.4 (`Auth0` class + `credentialsManager`), `@expo/app-integrity`, MobX-State-Tree, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-06-jwt-refresh-design.md`

## Global Constraints

- **No `runtimeVersion` bump.** This work is JS-only: no new native dependency, no `app.json` native config change, no Podfile/Gradle change. `react-native-auth0` is already installed and linked. Ships as an OTA. Do **not** edit `runtimeVersion` in `app.json`.
- **Vitest cannot resolve the `@/` alias.** Any module you want unit-tested must contain zero `@/` *runtime* imports (type-only imports are erased and therefore fine). Pure logic goes in `*Logic.ts`; I/O goes in a separate orchestrator the tests never import.
- **Tests split by extension:** `*.test.ts` → Vitest (`npm run test:unit`), `*.test.tsx` → jest-expo. Everything in this plan is `.ts`.
- **`depcruise` forbids circular dependencies.** `app/services/api/index.ts` must gain **no new imports** from `app/services/auth/` or `app/services/attestation/`. The existing direction is `attestation → api`; keep it.
- **Comment convention (CLAUDE.md):** comment liberally where a line exists for a non-obvious reason. When changing existing behavior, keep the original comment and append a `CHANGED <date>:` note explaining the failure mode that motivated the change. Do not delete a functional comment that still describes what the code does.
- **Unused variables must be prefixed with `_`.**
- **No default React import**; named imports only.
- Verification commands: `npm run compile` (tsc), `npm run lint`, `npm run lint:deps` (depcruise), `npm run test:unit`.

---

### Task 1: Pure freshness logic + tests

The decision layer, with no I/O. Everything later tasks depend on for correctness lives here and is fully covered.

**Files:**
- Create: `app/services/auth/tokenFreshnessLogic.ts`
- Test: `app/services/auth/tokenFreshnessLogic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RefreshFailureKind = "transient" | "permanent"`
  - `PERMANENT_REFRESH_ERROR_CODES: readonly string[]`
  - `shouldRefresh(expiresAt: number | undefined, now: number, skewMs: number): boolean`
  - `classifyRefreshError(error: unknown): RefreshFailureKind`
  - `createSingleFlight<T>(fn: () => Promise<T>): () => Promise<T>`
  - `withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T>`

- [ ] **Step 1: Write the failing test**

Create `app/services/auth/tokenFreshnessLogic.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

import {
  classifyRefreshError,
  createSingleFlight,
  shouldRefresh,
  withTimeout,
} from "./tokenFreshnessLogic"

describe("shouldRefresh", () => {
  const NOW = 1_000_000
  const SKEW = 60_000

  it("refreshes when we have no expiry at all", () => {
    expect(shouldRefresh(undefined, NOW, SKEW)).toBe(true)
  })

  it("refreshes exactly at the skew boundary", () => {
    expect(shouldRefresh(NOW + SKEW, NOW, SKEW)).toBe(true)
  })

  it("does not refresh one ms outside the skew boundary", () => {
    expect(shouldRefresh(NOW + SKEW + 1, NOW, SKEW)).toBe(false)
  })

  it("refreshes one ms inside the skew boundary", () => {
    expect(shouldRefresh(NOW + SKEW - 1, NOW, SKEW)).toBe(true)
  })

  it("refreshes an already-expired token", () => {
    expect(shouldRefresh(NOW - 1, NOW, SKEW)).toBe(true)
  })

  it("does not refresh a token expiring far in the future", () => {
    expect(shouldRefresh(NOW + 86_400_000, NOW, SKEW)).toBe(false)
  })
})

describe("classifyRefreshError", () => {
  const permanent = [
    "NO_REFRESH_TOKEN",
    "NO_CREDENTIALS",
    "INVALID_CREDENTIALS",
    "DPOP_KEY_MISSING",
    "DPOP_KEY_MISMATCH",
  ]

  it.each(permanent)("classifies %s as permanent", (type) => {
    expect(classifyRefreshError({ type })).toBe("permanent")
  })

  const transient = [
    "NO_NETWORK",
    "RENEW_FAILED",
    "API_ERROR",
    "STORE_FAILED",
    "CRYPTO_EXCEPTION",
    "UNKNOWN_ERROR",
    "BIOMETRICS_FAILED",
    "LARGE_MIN_TTL",
  ]

  it.each(transient)("classifies %s as transient", (type) => {
    expect(classifyRefreshError({ type })).toBe("transient")
  })

  // This is the decision most likely to be "cleaned up" by a future
  // contributor. Misclassifying a transient failure as permanent logs a real
  // user out for nothing; the reverse merely keeps them signed in longer.
  it("defaults an unrecognized code to transient", () => {
    expect(classifyRefreshError({ type: "SOME_FUTURE_SDK_CODE" })).toBe("transient")
  })

  it("defaults a plain Error to transient", () => {
    expect(classifyRefreshError(new Error("boom"))).toBe("transient")
  })

  it("defaults a non-object throw to transient", () => {
    expect(classifyRefreshError("boom")).toBe("transient")
    expect(classifyRefreshError(null)).toBe("transient")
    expect(classifyRefreshError(undefined)).toBe("transient")
  })

  it("defaults a non-string type field to transient", () => {
    expect(classifyRefreshError({ type: 42 })).toBe("transient")
  })
})

describe("createSingleFlight", () => {
  it("invokes the underlying fn once for concurrent callers", async () => {
    let resolveInner: (value: string) => void = () => {}
    const inner = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveInner = resolve
        }),
    )
    const flight = createSingleFlight(inner)

    const a = flight()
    const b = flight()
    const c = flight()
    resolveInner("token")

    expect(await a).toBe("token")
    expect(await b).toBe("token")
    expect(await c).toBe("token")
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it("re-invokes after the previous call settles", async () => {
    const inner = vi.fn(async () => "token")
    const flight = createSingleFlight(inner)

    await flight()
    await flight()

    expect(inner).toHaveBeenCalledTimes(2)
  })

  it("clears the slot on rejection so the next call retries", async () => {
    const inner = vi.fn(async () => {
      throw new Error("nope")
    })
    const flight = createSingleFlight(inner)

    await expect(flight()).rejects.toThrow("nope")
    await expect(flight()).rejects.toThrow("nope")

    expect(inner).toHaveBeenCalledTimes(2)
  })

  it("does not leak a synchronous throw past the slot", async () => {
    const inner = vi.fn(() => {
      throw new Error("sync boom")
    }) as unknown as () => Promise<string>
    const flight = createSingleFlight(inner)

    await expect(flight()).rejects.toThrow("sync boom")
    await expect(flight()).rejects.toThrow("sync boom")
  })
})

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves through when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve("fresh"), 1000, "stale")).resolves.toBe("fresh")
  })

  it("returns the fallback when the timeout wins", async () => {
    const never = new Promise<string>(() => {})
    const raced = withTimeout(never, 1000, "stale")
    await vi.advanceTimersByTimeAsync(1000)
    await expect(raced).resolves.toBe("stale")
  })

  it("clears its timer when the promise wins", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout")
    await withTimeout(Promise.resolve("fresh"), 1000, "stale")
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it("propagates a rejection instead of returning the fallback", async () => {
    await expect(withTimeout(Promise.reject(new Error("bad")), 1000, "stale")).rejects.toThrow(
      "bad",
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/services/auth/tokenFreshnessLogic.test.ts`

Expected: FAIL — `Failed to resolve import "./tokenFreshnessLogic"`.

- [ ] **Step 3: Write the implementation**

Create `app/services/auth/tokenFreshnessLogic.ts`:

```ts
/**
 * Pure decision logic for the proactive token freshness gate.
 *
 * PURE MODULE — no `@/` runtime imports, no React, no native modules. Vitest
 * cannot resolve the `@/` alias (see CLAUDE.md "Test Runner Split"), so
 * anything we want covered has to stay import-free. The I/O that composes these
 * helpers lives in tokenFreshness.ts, which is deliberately untested — same
 * split as syncLogic.ts vs services/sync/index.ts.
 */

/** Whether a failed credential renewal can plausibly succeed later. */
export type RefreshFailureKind = "transient" | "permanent"

/**
 * Auth0 `CredentialsManagerError.type` codes meaning the stored refresh token
 * can never work again — the user must sign in interactively.
 *
 * Everything NOT in this list is treated as transient, including codes we've
 * never seen. That default is load-bearing, not laziness: the two
 * misclassifications cost very different amounts. Calling a transient failure
 * permanent logs a real user out for nothing; calling a permanent failure
 * transient just keeps them signed in until the next attempt. RENEW_FAILED is
 * deliberately absent — the SDK uses it for network-ish renewal failures as
 * well as genuine rejections, and it is not worth ejecting someone over an
 * ambiguous code.
 */
export const PERMANENT_REFRESH_ERROR_CODES: readonly string[] = [
  "NO_REFRESH_TOKEN",
  "NO_CREDENTIALS",
  "INVALID_CREDENTIALS",
  "DPOP_KEY_MISSING",
  "DPOP_KEY_MISMATCH",
]

/**
 * Whether a token expiring at `expiresAt` should be refreshed now, given a
 * safety margin of `skewMs`.
 *
 * A missing expiry counts as "refresh" — we cannot prove the token is good, and
 * an unnecessary refresh is far cheaper than a request that 401s.
 */
export function shouldRefresh(
  expiresAt: number | undefined,
  now: number,
  skewMs: number,
): boolean {
  if (expiresAt === undefined) return true
  return expiresAt - skewMs <= now
}

/** Map an unknown throw from the Auth0 credentials manager to a retry verdict. */
export function classifyRefreshError(error: unknown): RefreshFailureKind {
  const code =
    typeof error === "object" && error !== null && "type" in error
      ? (error as { type: unknown }).type
      : undefined

  if (typeof code !== "string") return "transient"
  return PERMANENT_REFRESH_ERROR_CODES.includes(code) ? "permanent" : "transient"
}

/**
 * Wrap an async fn so concurrent callers share one in-flight execution.
 *
 * This is what stops the foreground attestation warm-up and the request-gate
 * from each kicking off their own multi-second Apple/Play round trip. The slot
 * is cleared once the promise settles (success OR failure) so a later call
 * retries rather than replaying a stale rejection forever.
 */
export function createSingleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null

  return () => {
    if (inFlight) return inFlight

    // Promise.resolve().then(fn) rather than fn() so a *synchronous* throw
    // inside fn still becomes a rejected promise, and still clears the slot.
    // Calling fn() bare would throw before the assignment below and wedge
    // `inFlight` at null-but-already-running.
    const promise = Promise.resolve()
      .then(fn)
      .finally(() => {
        if (inFlight === promise) inFlight = null
      })

    inFlight = promise
    return promise
  }
}

/**
 * Resolve `fallback` if `promise` hasn't settled within `ms`.
 *
 * Every API call waits on the refreshers, so one hung refresh would stall the
 * entire app — a worse failure than the stale token we're replacing. A
 * rejection still propagates: only *slowness* yields the fallback, because the
 * caller needs to see a real failure to classify it.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/services/auth/tokenFreshnessLogic.test.ts`

Expected: PASS, all tests green.

- [ ] **Step 5: Verify types and lint**

Run: `npm run compile && npm run lint`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/services/auth/tokenFreshnessLogic.ts app/services/auth/tokenFreshnessLogic.test.ts
git commit -m "✨ feat(auth): pure decision logic for the token freshness gate

shouldRefresh / classifyRefreshError / createSingleFlight / withTimeout,
with the unknown-error-code default pinned to transient by an explicit
test — misclassifying a transient failure as permanent would log a real
user out for nothing."
```

---

### Task 2: Move device attestation out of `app.tsx`

Behaviour-preserving move. `performAttestation` currently lives as module state plus a function inside the root component file, reachable only from there; the freshness gate needs it from a service. No logic changes in this task.

**Files:**
- Create: `app/services/attestation/deviceToken.ts`
- Modify: `app/app.tsx` (delete lines 112–137 and 138–212; update imports; `initializeDeviceAuthorization` and the foreground listener now call the new module)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `performAttestation(deviceId: string): Promise<{ ok: true } | { ok: false; error: AttestationError }>`
  - `isJwtExpiredOrNearExpiry(): boolean`
  - `getDeviceJwt(): string | null`
  - `setApiKeyFallback(): void`
  - `isUsingApiKeyFallback(): boolean`
  - `GOOGLE_CLOUD_PROJECT_NUMBER: string`

- [ ] **Step 1: Create the new module**

Create `app/services/attestation/deviceToken.ts`:

```ts
/**
 * Device attestation token lifecycle.
 *
 * MOVED 2026-08-06 from app/app.tsx, where this lived as module-level state
 * plus a function inside the root component and was reachable only from there.
 * The proactive request gate (app/services/auth/tokenFreshness.ts) needs to
 * drive re-attestation from a service, so it had to come out.
 *
 * The user-facing fatal alert on a failed *initial* attestation deliberately
 * stayed behind in app.tsx — it is UI, it needs `translate`, and it belongs
 * with the cold-start sequence it blocks.
 */

import { api } from "@/services/api"
import { logger } from "@/utils/logger"

import { attestDevice, isAttestationSupported, type AttestationError } from "./index"

const log = logger.child({ module: "deviceToken" })

/** Google Cloud project number for Play Integrity (Android only) */
export const GOOGLE_CLOUD_PROJECT_NUMBER =
  process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER || ""

/**
 * The current device JWT, memory-only.
 *
 * Never persisted: it is short-lived and re-obtainable, and writing it to disk
 * would hand an attacker with filesystem access a valid device credential.
 */
let deviceJwt: string | null = null

/** Tracks device JWT expiry so we can re-attest before it dies. */
let jwtExpiresAt: number | null = null

/** Whether we're using the X-API-Key fallback (simulators/web) instead of a JWT */
let usingApiKeyFallback = false

/**
 * Re-attest this far before actual expiry.
 *
 * Five minutes, not seconds: attestation is a multi-second round trip to
 * Apple/Google plus our backend, so it has to start well before the token dies.
 */
export const DEVICE_JWT_SKEW_MS = 5 * 60 * 1000

/** Retry delays for attestation attempts (exponential backoff) */
const ATTESTATION_RETRY_DELAYS = [1000, 2000, 3000]
const ATTESTATION_MAX_ATTEMPTS = ATTESTATION_RETRY_DELAYS.length + 1

/** Check if JWT is expired or near expiry (within DEVICE_JWT_SKEW_MS) */
export function isJwtExpiredOrNearExpiry(): boolean {
  if (!jwtExpiresAt) return true
  return Date.now() > jwtExpiresAt - DEVICE_JWT_SKEW_MS
}

/** The current device JWT, or null when unset or running the API-key fallback. */
export function getDeviceJwt(): string | null {
  return deviceJwt
}

/** Whether we're on the X-API-Key path (simulator, web, or an Android dev build). */
export function isUsingApiKeyFallback(): boolean {
  return usingApiKeyFallback
}

/** Switch to the X-API-Key fallback used by simulators, web, and dev builds. */
export function setApiKeyFallback(): void {
  usingApiKeyFallback = true
  deviceJwt = null
  jwtExpiresAt = null
  api.setApiKeyAuth()
}

/**
 * Perform device attestation with retries and update API headers.
 * Returns `{ ok: true }` on success, or `{ ok: false, error }` with the
 * last AttestationError on failure so the caller can choose a matching
 * user-facing alert.
 */
export async function performAttestation(
  deviceId: string,
): Promise<{ ok: true } | { ok: false; error: AttestationError }> {
  if (!isAttestationSupported()) {
    log.info("Attestation not supported on this platform/device")
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED",
        message: "Attestation not supported on this platform/device",
        temporary: false,
      },
    }
  }

  let lastError: AttestationError | undefined

  for (let attempt = 1; attempt <= ATTESTATION_MAX_ATTEMPTS; attempt++) {
    log.info("Performing device attestation", { attempt, of: ATTESTATION_MAX_ATTEMPTS })
    const result = await attestDevice(deviceId)

    if (result.ok) {
      deviceJwt = result.data.deviceJwt
      jwtExpiresAt = result.data.expiresAt
      usingApiKeyFallback = false
      api.setDeviceJwt(result.data.deviceJwt)
      log.info("Device attestation complete", {
        attempt,
        expiresIn: Math.round((result.data.expiresAt - Date.now()) / 1000 / 60) + " min",
      })
      return { ok: true }
    }

    lastError = result.error
    log.error("Device attestation failed", {
      attempt,
      code: result.error.code,
      kind: result.error.kind,
      temporary: result.error.temporary,
      message: result.error.message,
    })

    // Short-circuit: if the error is non-transient (unsupported device,
    // 401/403 from backend, bad-data), no number of retries will help.
    // Fail fast and let the caller surface a specific alert.
    if (!result.error.temporary) {
      log.warn("Attestation error is non-temporary — skipping remaining retries", {
        code: result.error.code,
        kind: result.error.kind,
      })
      return { ok: false, error: result.error }
    }

    // Wait before retrying (unless last attempt)
    if (attempt < ATTESTATION_MAX_ATTEMPTS) {
      const delay = ATTESTATION_RETRY_DELAYS[attempt - 1]
      log.info("Retrying attestation", { nextAttempt: attempt + 1, delay })
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  log.error("All attestation attempts exhausted", { attempts: ATTESTATION_MAX_ATTEMPTS })
  return {
    ok: false,
    error: lastError ?? {
      code: "ATTESTATION_FAILED",
      message: "Attestation exhausted with no error captured",
      temporary: true,
    },
  }
}
```

- [ ] **Step 2: Delete the moved code from `app.tsx`**

In `app/app.tsx`, delete the entire block from the `// Device Attestation State (memory-only)` banner comment (line 112) through the end of `performAttestation` (line 212). That removes: `jwtExpiresAt`, `usingApiKeyFallback`, `GOOGLE_CLOUD_PROJECT_NUMBER`, `isJwtExpiredOrNearExpiry`, `ATTESTATION_RETRY_DELAYS`, `ATTESTATION_MAX_ATTEMPTS`, and `performAttestation`.

- [ ] **Step 3: Update `app.tsx` imports**

Replace the existing attestation import block (currently `app/app.tsx:63-68`) with:

```ts
import {
  type AttestationError,
  isSimulator,
  preparePlayIntegrity,
} from "./services/attestation"
import {
  GOOGLE_CLOUD_PROJECT_NUMBER,
  isJwtExpiredOrNearExpiry,
  performAttestation,
  setApiKeyFallback,
  isUsingApiKeyFallback,
} from "./services/attestation/deviceToken"
```

Note: `isAttestationSupported` is no longer used in `app.tsx` — drop it from the import if the linter flags it.

- [ ] **Step 4: Update the three `api.setApiKeyAuth()` call sites**

In `initializeDeviceAuthorization` (`app/app.tsx`), replace each of the three
`api.setApiKeyAuth(); usingApiKeyFallback = true` pairs with a single call:

```ts
setApiKeyFallback()
```

There are three: web (was line 223–224), simulator (was 231–232), and the `__DEV__` physical-device branch (was 242–243).

- [ ] **Step 5: Update the foreground listener guard**

In the foreground re-attestation effect (`app/app.tsx`, was line 848), replace the bare `usingApiKeyFallback` read with the accessor:

```ts
    if (isUsingApiKeyFallback() || Platform.OS === "web") {
      return
    }
```

- [ ] **Step 6: Verify nothing broke**

Run: `npm run compile && npm run lint && npm run lint:deps`

Expected: no errors. `lint:deps` must report no new circular dependencies — `deviceToken.ts` importing `api` follows the existing `attestation → api` direction.

- [ ] **Step 7: Commit**

```bash
git add app/services/attestation/deviceToken.ts app/app.tsx
git commit -m "♻️ refactor(attestation): lift device token lifecycle out of app.tsx

performAttestation and its module state lived inside the root component
and were reachable only from there. The proactive request gate needs to
drive re-attestation from a service, so it moves to
services/attestation/deviceToken.ts. Behaviour is unchanged; the fatal
alert on failed initial attestation stays in app.tsx because it is UI."
```

---

### Task 3: Auth0 client door + the two refreshers

Builds the refresher functions. Nothing calls them yet — wiring happens in Task 5.

**Files:**
- Create: `app/services/auth/auth0Client.ts`
- Create: `app/services/auth/tokenFreshness.ts`
- Modify: `app/services/auth/index.ts` (barrel)

**Interfaces:**
- Consumes: `shouldRefresh`, `classifyRefreshError`, `createSingleFlight`, `withTimeout` (Task 1); `performAttestation`, `isJwtExpiredOrNearExpiry`, `getDeviceJwt`, `isUsingApiKeyFallback` (Task 2).
- Produces:
  - `getFreshCredentials(minTtlSec: number): Promise<Credentials>`
  - `clearStoredCredentials(): Promise<void>`
  - `createUserTokenRefresher(deps: UserRefresherDeps): { getToken: () => Promise<string | null>; reset: () => void }`
  - `createDeviceTokenRefresher(deps: DeviceRefresherDeps): { getToken: () => Promise<string | null> }`
  - `USER_TOKEN_SKEW_MS`, `USER_REFRESH_TIMEOUT_MS`, `DEVICE_REFRESH_TIMEOUT_MS`

- [ ] **Step 1: Create the non-React Auth0 door**

Create `app/services/auth/auth0Client.ts`:

```ts
/**
 * Non-React access to the Auth0 credentials manager.
 *
 * react-native-auth0 v5 exports a standalone `Auth0` class whose
 * credentialsManager is backed by the SAME Keychain/Keystore entry the
 * `useAuth0` hook uses — so a refresh performed here is immediately visible to
 * the hook, and vice versa. That is what lets the API layer refresh tokens
 * without lifting anything out of React.
 *
 * getCredentials() auto-renews with the stored refresh token when the access
 * token is expired or has less than `minTtl` seconds left. We request
 * `offline_access` (see auth0.ts) so the refresh token exists; before
 * 2026-08-06 it was persisted and never once used.
 */

import Auth0 from "react-native-auth0"

import { AUTH0_CONFIG } from "./auth0"

let client: Auth0 | null = null

/** Lazily construct the client — module load must not touch native modules. */
function getAuth0Client(): Auth0 {
  if (!client) {
    client = new Auth0({
      domain: AUTH0_CONFIG.domain,
      clientId: AUTH0_CONFIG.clientId,
    })
  }
  return client
}

/**
 * Stored credentials, refreshed if they expire within `minTtlSec` seconds.
 * Throws CredentialsManagerError — classify it with classifyRefreshError().
 */
export async function getFreshCredentials(minTtlSec: number) {
  return getAuth0Client().credentialsManager.getCredentials(undefined, minTtlSec)
}

/**
 * Drop the SDK's own stored credentials.
 *
 * Required on forced logout IN ADDITION to clearAuthCredentials(): that only
 * clears our SecureStore copy, and leaving the SDK's keychain entry intact lets
 * the next useAuth0Wrapper sync re-hydrate the dead session.
 */
export async function clearStoredCredentials(): Promise<void> {
  await getAuth0Client().credentialsManager.clearCredentials()
}
```

- [ ] **Step 2: Create the refreshers**

Create `app/services/auth/tokenFreshness.ts`:

```ts
/**
 * The two token refreshers behind the proactive request gate.
 *
 * ORCHESTRATOR — intentionally has no automated coverage: it imports
 * `@/utils/logger` and drives native SDKs, so vitest can't load it. Every
 * decision it makes is delegated to tokenFreshnessLogic.ts, which IS covered.
 * Same split as syncLogic.ts vs services/sync/index.ts. Verify changes here
 * against the manual checklist in the design spec.
 *
 * Dependencies arrive by injection rather than import so this module never
 * reaches into MST or app.tsx, and so app/services/api/ can consume the result
 * without gaining an import edge that would make depcruise see a cycle.
 */

import {
  getDeviceJwt,
  isJwtExpiredOrNearExpiry,
  isUsingApiKeyFallback,
  performAttestation,
} from "@/services/attestation/deviceToken"
import { logger } from "@/utils/logger"

import { saveAuthCredentials } from "./secureStorage"
import { getFreshCredentials } from "./auth0Client"
import {
  classifyRefreshError,
  createSingleFlight,
  shouldRefresh,
  withTimeout,
} from "./tokenFreshnessLogic"

const log = logger.child({ module: "tokenFreshness" })

/**
 * Refresh the access token when it has under a minute left. Cheap — one
 * network hop — so the margin can be tight, unlike the device lane.
 */
export const USER_TOKEN_SKEW_MS = 60 * 1000

/** Caps so one hung refresh can't stall every request behind it. */
export const USER_REFRESH_TIMEOUT_MS = 10 * 1000
export const DEVICE_REFRESH_TIMEOUT_MS = 15 * 1000

/** The slice of AuthenticationStore the user refresher touches. */
export interface UserRefresherStore {
  accessToken?: string
  refreshToken?: string
  idToken?: string
  expiresAt?: number
  isAnonymous: boolean
  setTokens(
    accessToken: string,
    refreshToken?: string,
    idToken?: string,
    expiresAt?: number,
  ): void
}

export interface UserRefresherDeps {
  authStore: UserRefresherStore
  /** Called once when the refresh token is proven dead. Drives forced logout. */
  onPermanentFailure: () => void
}

export interface DeviceRefresherDeps {
  /** Device id, or null before cold-start init has resolved one. */
  getDeviceId: () => string | null
}

/**
 * Refresher for the Auth0 access token (`Authorization: Bearer`).
 *
 * Returns the token to stamp on the outgoing request, or null when there
 * should be no Authorization header at all (anonymous, signed out, or the
 * refresh token is dead).
 */
export function createUserTokenRefresher(deps: UserRefresherDeps): {
  getToken: () => Promise<string | null>
  reset: () => void
} {
  const { authStore, onPermanentFailure } = deps

  /**
   * Latched once a refresh fails permanently. Without it every subsequent
   * request would retry a refresh we already know is dead — and during the
   * deferred-logout window (timer running) that could be a request every few
   * seconds for the length of a meeting.
   */
  let permanentlyFailed = false

  const refresh = createSingleFlight(async () => {
    const creds = await getFreshCredentials(USER_TOKEN_SKEW_MS / 1000)

    // Auth0 returns expiresAt in SECONDS; the rest of the app uses ms.
    const expiresAt = creds.expiresAt * 1000

    authStore.setTokens(
      creds.accessToken,
      creds.refreshToken ?? undefined,
      creds.idToken ?? undefined,
      expiresAt,
    )

    // Write-back matters: without it the same refresh repeats on every cold
    // start, because setupRootStore hydrates from SecureStore and would keep
    // reading the old expiry.
    saveAuthCredentials({
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken ?? undefined,
      idToken: creds.idToken ?? undefined,
      expiresAt,
    }).catch((err) => log.error("Failed to persist refreshed credentials", { error: String(err) }))

    log.info("Access token refreshed", {
      expiresIn: Math.round((expiresAt - Date.now()) / 1000 / 60) + " min",
    })

    return creds.accessToken
  })

  return {
    getToken: async () => {
      if (permanentlyFailed) return null
      if (authStore.isAnonymous) return null
      if (!authStore.accessToken && !authStore.refreshToken) return null

      const current = authStore.accessToken ?? null
      if (!shouldRefresh(authStore.expiresAt, Date.now(), USER_TOKEN_SKEW_MS)) {
        return current
      }

      try {
        // On timeout we fall back to the current token and let the request go
        // out and fail on its own. Blocking would hang every call in the app.
        return await withTimeout(refresh(), USER_REFRESH_TIMEOUT_MS, current)
      } catch (err) {
        if (classifyRefreshError(err) === "permanent") {
          log.error("Access token refresh failed permanently — forcing logout", {
            error: String(err),
          })
          permanentlyFailed = true
          onPermanentFailure()
          return null
        }

        log.warn("Access token refresh failed transiently — proceeding with current token", {
          error: String(err),
        })
        return current
      }
    },

    /** Clear the latch after a completed forced logout, so a re-login works. */
    reset: () => {
      permanentlyFailed = false
    },
  }
}

/**
 * Refresher for the device attestation token (`X-Device-Token`).
 *
 * Returns null when we're on the X-API-Key fallback (simulator, web, Android
 * dev build) — the gate stamps the API key instead.
 *
 * Deliberately NOT symmetric with the user lane: a permanent failure here logs
 * fatal and returns the stale token rather than ejecting anyone. Interrupting
 * someone mid-meeting because Apple's attestation service is having a bad day
 * is a worse outcome than a few failed background fetches. Cold-start failure
 * is still fatal — that alert lives in app.tsx.
 */
export function createDeviceTokenRefresher(deps: DeviceRefresherDeps): {
  getToken: () => Promise<string | null>
} {
  const { getDeviceId } = deps

  const refresh = createSingleFlight(async () => {
    const deviceId = getDeviceId()
    if (!deviceId) return getDeviceJwt()

    const result = await performAttestation(deviceId)
    if (!result.ok) {
      log.error("Re-attestation failed — continuing with existing device token", {
        code: result.error.code,
        kind: result.error.kind,
        temporary: result.error.temporary,
      })
    }
    return getDeviceJwt()
  })

  return {
    getToken: async () => {
      if (isUsingApiKeyFallback()) return null
      if (!isJwtExpiredOrNearExpiry()) return getDeviceJwt()

      return withTimeout(refresh(), DEVICE_REFRESH_TIMEOUT_MS, getDeviceJwt())
    },
  }
}
```

- [ ] **Step 3: Export from the barrel**

In `app/services/auth/index.ts`, append:

```ts
export * from "./auth0Client"
export * from "./tokenFreshness"
export * from "./tokenFreshnessLogic"
```

- [ ] **Step 4: Verify**

Run: `npm run compile && npm run lint && npm run lint:deps`

Expected: no errors, no circular dependencies. If `tsc` complains about the `Credentials` return type of `getFreshCredentials`, add an explicit import of the SDK type rather than widening to `any`.

- [ ] **Step 5: Commit**

```bash
git add app/services/auth/auth0Client.ts app/services/auth/tokenFreshness.ts app/services/auth/index.ts
git commit -m "✨ feat(auth): device and user token refreshers

Adds the non-React door to the Auth0 credentials manager (same keychain
entry the useAuth0 hook uses) and the two refresher factories that sit
behind the request gate. Not wired up yet.

The user lane latches on a permanent failure so a known-dead refresh
token isn't retried on every request during the deferred-logout window."
```

---

### Task 4: Forced logout with the attendance-timer carve-out

**Files:**
- Modify: `app/models/AuthenticationStore.ts` (volatile block ~line 21-32, actions ~line 77)
- Modify: `app/app.tsx` (add the deferred-logout reaction near the existing auth reaction, ~line 510)

**Interfaces:**
- Consumes: `clearStoredCredentials` (Task 3); `isTimerSessionActive` from `@/services/attendance`.
- Produces: `authStore.pendingLogout: boolean`, `authStore.setPendingLogout(value: boolean)`, and a local `performForcedLogout()` in `app.tsx`.

- [ ] **Step 1: Add the store field**

In `app/models/AuthenticationStore.ts`, inside the `.volatile(() => ({ … }))` block, after `authReady` (line 31), add:

```ts
    /**
     * Set when a refresh failed permanently but an attendance timer is still
     * running. A forced logout swaps the tree at the AppNavigator level, ABOVE
     * MainNavigator's isTimerSessionActive() tab lock, so that lock does not
     * catch it — the timer modal would unmount and TimerSessionResumer only
     * fires once per mount, losing the meeting. We hold the eject until the
     * timer resolves instead. Not persisted: a cold start re-derives auth
     * state from scratch.
     */
    pendingLogout: false,
```

- [ ] **Step 2: Add the action and clear the flag on logout**

In the `.actions((store) => ({ … }))` block of `app/models/AuthenticationStore.ts`, add:

```ts
    /**
     * Defer a forced logout until a running attendance timer finishes.
     * See the pendingLogout volatile field for why this exists.
     */
    setPendingLogout(value: boolean) {
      log.info("setPendingLogout()", { value })
      store.pendingLogout = value
    },
```

and inside the existing `logout()` action, add `store.pendingLogout = false` alongside the other resets (after `store.isAnonymous = false`).

- [ ] **Step 3: Add the imports to `app.tsx`**

```ts
import { clearStoredCredentials, createUserTokenRefresher } from "./services/auth"
import { clearAuthCredentials } from "./services/auth/secureStorage"
```

`isTimerSessionActive` is **already imported** at `app/app.tsx:61` — do not add a second import of it.

- [ ] **Step 4: Add the forced-logout helper and reaction**

In `app/app.tsx`, inside the store-init effect immediately after the existing auth reaction (which Task 6 removes), add:

```ts
        // ---- Forced logout on a dead refresh token ----------------------
        //
        // Two beats, deliberately. Beat one is inside the user refresher: it
        // returns null forever after a permanent failure, so no stale Bearer
        // can go out regardless of what happens below. Beat two is the actual
        // eject, which we hold while an attendance timer is live.
        const performForcedLogout = () => {
          log.warn("Performing forced logout after permanent refresh failure")
          authStore.logout()
          // Both credential stores must go. Clearing only ours leaves the SDK's
          // keychain entry intact and the next useAuth0Wrapper sync would
          // cheerfully re-hydrate the dead session.
          clearAuthCredentials().catch((err) =>
            log.error("Failed to clear auth credentials", { error: String(err) }),
          )
          clearStoredCredentials().catch((err) =>
            log.error("Failed to clear SDK credentials", { error: String(err) }),
          )
          userRefresher.reset()
        }

        const userRefresher = createUserTokenRefresher({
          authStore,
          onPermanentFailure: () => {
            if (isTimerSessionActive()) {
              log.warn("Refresh dead but timer is live — deferring logout")
              authStore.setPendingLogout(true)
            } else {
              performForcedLogout()
            }
          },
        })

        // Fire the deferred eject the moment the timer releases. Reads the
        // observable box in services/attendance/timerSession, so Save and
        // Cancel both trip it for free. MobX rather than a new event channel,
        // for the reason CLAUDE.md gives for maintenanceMode.
        reaction(
          () => ({ pending: authStore.pendingLogout, live: isTimerSessionActive() }),
          ({ pending, live }) => {
            if (pending && !live) performForcedLogout()
          },
        )
```

Note: `const userRefresher` is referenced inside `performForcedLogout` before its declaration. That is fine — the closure only runs later — but declare `performForcedLogout` first as written above so the reaction and the refresher can both see it.

- [ ] **Step 5: Verify**

Run: `npm run compile && npm run lint`

Expected: no errors. TypeScript will not yet complain about `userRefresher` being unused — Task 5 registers it.

- [ ] **Step 6: Commit**

```bash
git add app/models/AuthenticationStore.ts app/app.tsx
git commit -m "✨ feat(auth): forced logout deferred while an attendance timer runs

A permanent refresh failure logs the user out, but the eject swaps the
tree above MainNavigator's timer tab-lock, so a running timer would
unmount and TimerSessionResumer would not re-fire after re-login —
losing the meeting. pendingLogout holds the eject until Save or Cancel
releases the session."
```

---

### Task 5: The request gate

The feature goes live in this task. The transform becomes the sole authority for both auth headers, so the sticky-header setters are removed in the same change — they are inseparable.

**Files:**
- Modify: `app/services/api/index.ts` (constructor ~line 309; device/user auth methods lines 330–420; `verifyAttestation` ~line 438; `getPublicStatus` ~line 503)
- Modify: `app/services/attestation/deviceToken.ts` (drop the `api.setDeviceJwt` / `api.setApiKeyAuth` calls)
- Modify: `app/app.tsx` (register the refreshers; remove the auth reaction)

**Interfaces:**
- Consumes: `createUserTokenRefresher`, `createDeviceTokenRefresher` (Task 3); `userRefresher` (Task 4).
- Produces: `api.registerTokenRefreshers(refreshers: TokenRefreshers)`, `SKIP_AUTH_GATE_HEADER`.

- [ ] **Step 1: Add the refresher types and injection point to the Api class**

In `app/services/api/index.ts`, add above the `Api` class:

```ts
/**
 * Header that tells the auth gate to leave a request alone.
 *
 * A sentinel rather than a URL allow-list because getPublicStatus() and the
 * authenticated getStatus() hit the SAME /status path — a URL match cannot
 * tell them apart, and would silently start bypassing the gate for both.
 */
export const SKIP_AUTH_GATE_HEADER = "X-Skip-Auth-Gate"

/**
 * Token providers injected at startup.
 *
 * Injected rather than imported so this module gains no edge into
 * services/auth or services/attestation. The existing direction is
 * attestation → api; importing back would make depcruise see a cycle.
 */
export interface TokenRefreshers {
  /** Fresh device JWT, or null when running the X-API-Key fallback. */
  device: () => Promise<string | null>
  /** Fresh access token, or null when anonymous / signed out. */
  user: () => Promise<string | null>
}
```

Inside the class, replace the `deviceJwt` private field (line 300–301) with:

```ts
  /**
   * Token providers. No-ops until registerTokenRefreshers() runs, so any call
   * made during early cold start (before wiring) simply goes out unauthorized
   * rather than throwing.
   */
  private refreshers: TokenRefreshers = {
    device: async () => null,
    user: async () => null,
  }
```

**Leave `attestationPromise` (lines 303–304) alone.** It backs `waitForAttestation`, whose ~40 call sites are not removed until Task 6 — deleting it here would leave this file uncompilable between the two commits.

- [ ] **Step 2: Replace the device/user auth methods with the gate**

In `app/services/api/index.ts`, delete `setDeviceJwt`, `setApiKeyAuth`, `setAuthToken`, `clearAuthToken`, and `updateAuth` (within lines 330–420) and add the gate in their place, as below.

**Keep `setAttestationInProgress` and `waitForAttestation` for now.** Their callers (~40 call sites here plus the foreground listener in `app.tsx`) are removed in Task 6; deleting them in this commit would break the build in between.

```ts
  // ===========================================================================
  // Auth Gate
  // ===========================================================================

  /**
   * Install the token providers. Called once from app.tsx during init.
   */
  registerTokenRefreshers(refreshers: TokenRefreshers) {
    log.debug("Registering token refreshers")
    this.refreshers = refreshers
  }

  /**
   * Install the proactive auth gate on the RecoverySky client.
   *
   * CHANGED 2026-08-06: replaces setDeviceJwt/setAuthToken/updateAuth, which
   * wrote *sticky instance headers*. Sticky headers meant a request that
   * started before a refresh could still go out carrying the old token, and
   * they meant the Auth0 access token was only ever updated when the
   * useAuth0Wrapper `[user]` effect happened to re-run — which is to say,
   * essentially never after login. Stamping per-request makes both problems
   * structurally impossible.
   */
  private installAuthGate() {
    this.recoverySkyApi.addAsyncRequestTransform(async (request) => {
      const headers = (request.headers ?? {}) as Record<string, string>
      request.headers = headers as typeof request.headers

      // Bypass. /attest is called while we are still obtaining device
      // credentials, and getPublicStatus() runs before any credential exists.
      // This is ALSO the recursion guard: the device refresher calls
      // verifyAttestation(), which comes straight back through this transform.
      if (headers[SKIP_AUTH_GATE_HEADER]) {
        delete headers[SKIP_AUTH_GATE_HEADER]
        return
      }

      const [deviceJwt, accessToken] = await Promise.all([
        this.refreshers.device(),
        this.refreshers.user(),
      ])

      if (deviceJwt) {
        headers["X-Device-Token"] = deviceJwt
      } else if (this.authKey) {
        headers["X-API-Key"] = this.authKey
      }

      if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`
      }
    })
  }
```

- [ ] **Step 3: Call the gate installer from the constructor**

At the end of the `Api` constructor in `app/services/api/index.ts` (after `this.recoverySkyApi = create({ … })`, line 327), add:

```ts
    this.installAuthGate()
```

- [ ] **Step 4: Mark the two bypass call sites**

In `verifyAttestation` (`app/services/api/index.ts`), change the post call to pass the sentinel:

```ts
    const response = await this.recoverySkyApi.post<AttestationVerifyResult>("/attest", params, {
      headers: { [SKIP_AUTH_GATE_HEADER]: "1" },
    })
```

In `getPublicStatus`, add the sentinel to the existing per-request config:

```ts
    const response = await this.recoverySkyApi.get<{ status: string }>("/status", undefined, {
      timeout: timeoutMs,
      headers: { [SKIP_AUTH_GATE_HEADER]: "1" },
    })
```

Also append to `getPublicStatus`'s existing doc comment (keep the current text, it still describes the behaviour):

```
   * CHANGED 2026-08-06: no longer relies on "no headers have been set yet" —
   * it passes SKIP_AUTH_GATE_HEADER so the auth gate leaves it alone
   * explicitly. The old implicit version broke the moment anything set a
   * header earlier in cold start.
```

- [ ] **Step 5: Drop the api calls from `deviceToken.ts`**

In `app/services/attestation/deviceToken.ts`, remove `api.setDeviceJwt(result.data.deviceJwt)` from `performAttestation` and `api.setApiKeyAuth()` from `setApiKeyFallback`. Remove the now-unused `import { api } from "@/services/api"`. The module state (`deviceJwt`, `usingApiKeyFallback`) is now read by the gate through the refresher instead.

- [ ] **Step 6: Register the refreshers in `app.tsx`**

In `app/app.tsx`, immediately after the `userRefresher` declaration added in Task 4, add:

```ts
        const deviceRefresher = createDeviceTokenRefresher({
          getDeviceId: () => deviceIdRef.current,
        })

        api.registerTokenRefreshers({
          device: deviceRefresher.getToken,
          user: userRefresher.getToken,
        })
```

Add `createDeviceTokenRefresher` to the existing `./services/auth` import.

- [ ] **Step 7: Remove the superseded auth wiring**

Delete `api.updateAuth(authStore.isAnonymous, authStore.accessToken)` and the log line that follows it (`app/app.tsx:503-507`), plus the entire auth-state `reaction` at `app/app.tsx:510-519`. Per-request stamping reads the store on every call, so pushing changes into the API layer is no longer meaningful.

Do **not** touch `api.updateAuth0Profile` at `app/app.tsx:671` — different method, unrelated.

- [ ] **Step 8: Verify**

Run: `npm run compile && npm run lint && npm run lint:deps && npm run test:unit`

Expected: all pass. If `tsc` rejects the `request.headers` cast, adjust the cast — do not weaken the header type to `any`.

- [ ] **Step 9: Manual smoke test**

Run the app on a simulator: `npm start -- --clear` then `npm run ios`.

Expected: app boots to Home; Meetings tab loads. In the logs, requests carry `X-API-Key` (simulator path) and no attestation is attempted. Sign in with Auth0 and confirm Meetings still loads — that proves the Bearer is being stamped by the gate.

- [ ] **Step 10: Commit**

```bash
git add app/services/api/index.ts app/services/attestation/deviceToken.ts app/app.tsx
git commit -m "✨ feat(api): proactive auth gate stamps both tokens per request

One async request transform refreshes the device JWT and the Auth0
access token before each call and stamps them on that request's config,
replacing the sticky-header setters. Fixes signed-in users silently
losing API access once their access token expired: it was only ever
refreshed by an effect keyed on Auth0's [user] object, which does not
change on a timer.

Bypass is a sentinel header, not a URL list — getPublicStatus() and the
authenticated getStatus() share the /status path. It doubles as the
recursion guard for the device refresher's own /attest call."
```

---

### Task 6: Remove the superseded attestation queue

Mechanical cleanup. Removes `waitForAttestation` / `setAttestationInProgress`, their ~40 call sites, and repoints the foreground warm-up onto the device refresher.

**Files:**
- Modify: `app/services/api/index.ts` (~40 `await this.waitForAttestation()` lines)
- Modify: `app/app.tsx` (foreground re-attestation effect, was ~line 845-869)

**Interfaces:**
- Consumes: `createDeviceTokenRefresher` result from Task 5.
- Produces: nothing new.

- [ ] **Step 1: Find every call site**

Run: `grep -n "await this.waitForAttestation()" app/services/api/index.ts | wc -l`

Expected: ~40. Note the number; you will confirm it drops to 0.

- [ ] **Step 2: Delete them**

Remove every `await this.waitForAttestation()` line from `app/services/api/index.ts`. Each sits directly under its method signature and is followed by a `log.debug(...)` — delete only the `waitForAttestation` line, leave the logging.

Queueing is now provided by `createSingleFlight` inside the refreshers, which every request reaches through the gate rather than only the methods that remembered to call it.

- [ ] **Step 3: Delete the methods themselves**

Now that nothing calls them, delete from `app/services/api/index.ts`:
- the `attestationPromise` private field (was lines 303–304)
- the `setAttestationInProgress` method
- the `waitForAttestation` method

- [ ] **Step 4: Verify none remain**

Run: `grep -c "waitForAttestation\|attestationPromise\|setAttestationInProgress" app/services/api/index.ts`

Expected: `0`.

- [ ] **Step 5: Repoint the foreground warm-up**

In `app/app.tsx`, the foreground re-attestation effect currently calls `performAttestation(...)` and hands the promise to `api.setAttestationInProgress(...)`. Replace the body of the `if (isJwtExpiredOrNearExpiry() && deviceIdRef.current)` branch with:

```ts
          log.info("JWT expired/near-expiry, warming re-attestation")
          // Fire and forget. Queueing is no longer this listener's job:
          // single-flight inside the device refresher gives every caller the
          // same in-flight promise, which is exactly why
          // setAttestationInProgress could be deleted.
          //
          // CHANGED 2026-08-06: this warm-up is now redundant for
          // *correctness* — the request gate refreshes on demand — but it is
          // kept for latency. Attestation is a multi-second Apple/Play round
          // trip; without it the first fetch after a long background sleep
          // pays that cost inline and visibly.
          void deviceRefresherRef.current?.getToken()
```

Hold the refresher in a ref so the effect can reach it. Next to `deviceIdRef` (`app/app.tsx:408`), add:

```ts
  // Set during store init so the foreground warm-up can reach the refresher.
  const deviceRefresherRef = useRef<{ getToken: () => Promise<string | null> } | null>(null)
```

and in the init effect, right after constructing `deviceRefresher` (Task 5, step 6), add:

```ts
        deviceRefresherRef.current = deviceRefresher
```

Remove the now-unused `performAttestation` and `api` references from the foreground effect, and drop `performAttestation` from the `app.tsx` import list if nothing else uses it (`initializeDeviceAuthorization` still does — check before deleting).

- [ ] **Step 6: Verify**

Run: `npm run compile && npm run lint && npm run lint:deps && npm run test:unit`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/services/api/index.ts app/app.tsx
git commit -m "🔥 chore(api): drop waitForAttestation and its ~40 call sites

Superseded by the request gate: single-flight inside the refreshers
queues every caller, instead of only the methods that remembered the
line. The foreground warm-up stays — it is redundant for correctness now
but still saves a multi-second attestation round trip on the first fetch
after a long background sleep."
```

---

### Task 7: Docs, changelog, and manual verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` in `CHANGELOG.md`, add to the `Fixed` group (create it if absent):

```markdown
### Fixed

- Signed-in users silently lost API access once their Auth0 access token
  expired — meetings, reports and cloud backup would quietly stop working
  until the app was force-quit and reopened. Both the access token and the
  device attestation token are now refreshed proactively before each API
  call. If the session cannot be renewed at all (revoked or expired sign-in),
  the app returns to the sign-in screen — but never while an attendance timer
  is running, so an in-progress meeting is never lost to it.
```

- [ ] **Step 2: Document the subsystem in `CLAUDE.md`**

In `CLAUDE.md`, inside the "Auth, Attestation & Encryption Keys" section, append after the numbered list:

```markdown
**Token freshness gate.** Both JWTs are refreshed *proactively*, by a single
apisauce async request transform installed in the `Api` constructor
(`installAuthGate`). It awaits two injected refreshers and stamps
`X-Device-Token` / `Authorization` onto each individual request — there are no
sticky auth headers any more, and `setDeviceJwt` / `setAuthToken` /
`updateAuth` / `waitForAttestation` are gone.

- Refreshers are **injected** via `api.registerTokenRefreshers()` from
  `app.tsx`, never imported. `app/services/api/` must stay a dependency leaf:
  the direction is `attestation → api`, and importing back would make
  `depcruise` see a cycle.
- Bypass is the `X-Skip-Auth-Gate` sentinel header, **not** a URL list —
  `getPublicStatus()` and the authenticated `getStatus()` share the `/status`
  path. It is also the recursion guard for the device refresher's own
  `/attest` call.
- Skews are asymmetric on purpose: 60 s for the Auth0 token (one cheap hop,
  handed to the SDK as `minTtl`), 5 min for the device token (a multi-second
  Apple/Play round trip that must start early).
- A refresh failure classified `permanent` (see `tokenFreshnessLogic.ts`)
  forces a logout — **deferred while `isTimerSessionActive()`**, because the
  eject swaps the tree above `MainNavigator`'s timer tab-lock and
  `TimerSessionResumer` would not re-fire after re-login. Unknown error codes
  default to `transient` deliberately; do not "tidy" that default.
- There is **no reactive 401 path**. Both server middlewares return an
  identical 401 body, so the client cannot tell which token failed. Accepted
  consequence: server-side revocation and large clock skew are not
  self-healing within a session.

Design + manual test checklist:
`docs/superpowers/specs/2026-08-06-jwt-refresh-design.md`.
```

- [ ] **Step 3: Run the full verification suite**

Run: `npm run compile && npm run lint && npm run lint:deps && npm test`

Expected: all pass.

- [ ] **Step 4: Work the manual checklist**

`tokenFreshness.ts` and the transform have no automated coverage by design. Run each of these on a device or simulator and record the result:

1. Signed in, backgrounded past token expiry (shorten the Auth0 API token TTL in the Auth0 dashboard to make this fast), foreground, trigger a fetch → logs show exactly one refresh, request succeeds, **no logout**.
2. Airplane mode with an expired token → calls fail, **no logout**, recovery on reconnect.
3. Revoke the refresh token in the Auth0 dashboard → next call → lands on the Login screen.
4. As (3) but with an in-person timer running → stays on Main, timer intact and still counting, Save writes the record, **then** Login appears.
5. Simulator (`X-API-Key` path) → unaffected, no attestation attempted.
6. Anonymous user → no `Authorization` header on any request.
7. Device JWT near expiry: foreground the app and immediately pull-to-refresh → logs show exactly **one** attestation, not two (single-flight working).
8. Concurrent burst (Meetings tab load, ~4 parallel calls) with a stale user token → exactly one refresh.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "📝 docs: record the token freshness gate

Changelog entry describes the user-visible failure mode (silent loss of
API access after token expiry). CLAUDE.md documents the injection
constraint, the sentinel bypass, the asymmetric skews, and the two
decisions most likely to be reversed by accident: unknown error codes
default to transient, and there is deliberately no reactive 401 path."
```

---

## Notes for the implementer

**Do not bump `runtimeVersion`.** This ships as an OTA. See Global Constraints.

**The two decisions most likely to get "fixed" back:**
1. Unknown refresh error codes classify as **transient**. A future contributor may see `UNKNOWN_ERROR → transient` and think it should be permanent. It should not — the test in Task 1 pins it, and the reasoning is in the comment above `PERMANENT_REFRESH_ERROR_CODES`.
2. The foreground re-attestation warm-up looks redundant once the gate exists. It is redundant for *correctness* and load-bearing for *latency*. Keep it.

**If `npm run lint:deps` reports a cycle**, you have imported `services/auth` or `services/attestation` from `services/api/index.ts`. Revert that and go through `registerTokenRefreshers` instead — that injection point exists for exactly this reason.
