# App Attest Assertions, Device JWT Persistence, and Attestation Degrade (app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the device JWT and the iOS App Attest key id, re-authenticate with a cheap assertion instead of a new key, retry only the network exchanges on a longer ladder, and degrade to a banner instead of a blocking modal on temporary failures — shipped as a JS-only OTA.

**Architecture:** `services/attestation/index.ts` becomes the native layer only (generate key + attest, generate assertion). `services/attestation/deviceToken.ts` owns the credential lifecycle: SecureStore persistence, the cold-start decision tree, the exchange retry ladder, and the degraded outcome. Every decision is a pure function in a new `deviceTokenLogic.ts` (vitest-covered, no `@/` imports), mirroring the `tokenFreshnessLogic.ts` split. The banner gets a third variant driven by a volatile `ConfigStore.deviceAuthDegraded`.

**Tech Stack:** React Native 0.81 / Expo 54, `@expo/app-integrity` 0.1.10, `expo-secure-store`, apisauce, MobX-State-Tree, vitest (pure `.test.ts`), i18next (nine locales).

**Spec:** `docs/superpowers/specs/2026-09-09-app-attest-assertions-and-jwt-persistence-design.md` (Sections 2–5).

## Global Constraints

- Work in `/Users/jenova/projects/recoverysky-org/app` on branch `root`. Stage only named paths; never `git add -A`; never `git stash`. Other sessions share this checkout.
- **Prerequisite for shipping, not for coding:** API 1.6.0 must be deployed before `npm run update`. Code and tests can be written against the spec first.
- JS-only change. **Do not bump `runtimeVersion`.** Both native modules are already in the binary.
- SecureStore keys: `device_jwt_v1` (JSON `{ jwt, expiresAt }`), `app_attest_key_id_v1` (raw string). Never touched by sign-out or `clearAllSecureData()`.
- Exchange retry ladder exactly `[2000, 5000, 10000, 20000]` ms; temporary kinds exactly `timeout`, `cannot-connect`, `server`, `unknown`. Key generation and `attestKeyAsync` run at most once per `establishDeviceToken` call.
- Only `UNSUPPORTED` and a 4xx from `POST /attest` block. Everything else degrades.
- No "reinstall" wording anywhere in the attestation alerts. Any new i18n key exists in all nine locale files (`npm run compile` enforces it); non-English files carry the English text as a placeholder.
- Lint only the files you touched: `npx eslint <paths> --fix`. Never `npm run lint`.
- Comments are liberal and must carry the CHANGED-date convention from CLAUDE.md → "Comments".
- Update `CHANGELOG.md` `[Unreleased]` in the same commit as the behaviour it describes.

---

### Task 1: SecureStore helpers for the device credentials

**Files:**
- Modify: `app/services/auth/secureStorage.ts` (append after the Terms Acceptance section, before `clearAllSecureData`)

**Interfaces:**
- Produces:
  ```ts
  export interface StoredDeviceJwt { jwt: string; expiresAt: number }
  export function loadDeviceJwt(): Promise<StoredDeviceJwt | null>
  export function saveDeviceJwt(v: StoredDeviceJwt): Promise<void>
  export function clearDeviceJwt(): Promise<void>
  export function loadAppAttestKeyId(): Promise<string | null>
  export function saveAppAttestKeyId(keyId: string): Promise<void>
  export function clearAppAttestKeyId(): Promise<void>
  ```

- [ ] **Step 1: Add the helpers**

Insert before the `clearAllSecureData` doc comment:

```ts
// --- Device credentials (attestation) ---
//
// ADDED 2026-09-09. Both values are per-INSTALL, not per-user: they are what
// lets a cold start skip Apple/Play entirely (JWT still fresh) or re-auth
// with a cheap assertion (key id present). Deliberately NOT included in
// clearAllSecureData(): signing out or switching accounts must not force a
// new Secure Enclave key — Apple rate-limits key generation, and that limit
// is what bricked launches twice before. Spec:
// docs/superpowers/specs/2026-09-09-app-attest-assertions-and-jwt-persistence-design.md

const DEVICE_JWT_KEY = "device_jwt_v1"
const APP_ATTEST_KEY_ID_KEY = "app_attest_key_id_v1"

export interface StoredDeviceJwt {
  jwt: string
  /** Unix ms expiry as reported by /attest or /attest/assert */
  expiresAt: number
}

export async function loadDeviceJwt(): Promise<StoredDeviceJwt | null> {
  const raw = await getItemAsync(DEVICE_JWT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDeviceJwt>
    if (typeof parsed.jwt !== "string" || typeof parsed.expiresAt !== "number") return null
    return { jwt: parsed.jwt, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

export async function saveDeviceJwt(value: StoredDeviceJwt): Promise<void> {
  await setItemAsync(DEVICE_JWT_KEY, JSON.stringify(value))
}

export async function clearDeviceJwt(): Promise<void> {
  await deleteItemAsync(DEVICE_JWT_KEY)
}

export async function loadAppAttestKeyId(): Promise<string | null> {
  const value = await getItemAsync(APP_ATTEST_KEY_ID_KEY)
  return value && value.length > 0 ? value : null
}

export async function saveAppAttestKeyId(keyId: string): Promise<void> {
  await setItemAsync(APP_ATTEST_KEY_ID_KEY, keyId)
}

export async function clearAppAttestKeyId(): Promise<void> {
  await deleteItemAsync(APP_ATTEST_KEY_ID_KEY)
}
```

Then amend the `clearAllSecureData` doc comment to end with: ` * Deliberately leaves the device credentials (device_jwt_v1, app_attest_key_id_v1) alone — see the section above.`

- [ ] **Step 2: Type-check and commit**

Run: `npm run compile` — expected clean.

```bash
git add app/services/auth/secureStorage.ts
git commit -m "✨ feat(attestation): SecureStore helpers for the device JWT and App Attest key id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 2: API methods for the challenge and assert exchanges

**Files:**
- Modify: `app/services/api/index.ts:49-63` (types) and `:498-521` (methods)

**Interfaces:**
- Produces:
  ```ts
  export interface AttestationVerifyRequest { token; platform; deviceId; keyId?; nonce?: string }
  export interface AttestChallengeResult { nonce: string; expiresAt: number }
  export interface AttestationAssertRequest { deviceId: string; keyId: string; nonce: string; assertion: string }
  class Api {
    getAttestChallenge(deviceId: string): Promise<{ kind: "ok"; data: AttestChallengeResult } | GeneralApiProblem>
    assertAttestation(params: AttestationAssertRequest): Promise<{ kind: "ok"; data: AttestationVerifyResult } | GeneralApiProblem>
    verifyAttestation(params: AttestationVerifyRequest)  // unchanged signature, now forwards nonce
  }
  ```

- [ ] **Step 1: Extend the types**

Replace the `AttestationVerifyRequest` interface with:

```ts
export interface AttestationVerifyRequest {
  token: string
  platform: "ios" | "android"
  deviceId: string
  /** iOS only: Key ID from DCAppAttestService.generateKey() */
  keyId?: string
  /**
   * Nonce from GET /attest/challenge. ADDED 2026-09-09. Always sent by this
   * build; the server keeps a legacy branch for older clients that omit it.
   */
  nonce?: string
}

/** Response from GET /attest/challenge */
export interface AttestChallengeResult {
  nonce: string
  expiresAt: number
}

/** Request body for POST /attest/assert (iOS only) */
export interface AttestationAssertRequest {
  deviceId: string
  keyId: string
  nonce: string
  /** Base64 CBOR from AppIntegrity.generateAssertionAsync */
  assertion: string
}
```

- [ ] **Step 2: Add the two methods**

Insert directly after the `verifyAttestation` method:

```ts
  /**
   * GET /attest/challenge — a nonce for the next attestation or assertion.
   * Bypasses the auth gate: it runs before any device JWT exists.
   */
  async getAttestChallenge(
    deviceId: string,
  ): Promise<{ kind: "ok"; data: AttestChallengeResult } | GeneralApiProblem> {
    const response = await this.recoverySkyApi.get<AttestChallengeResult>(
      "/attest/challenge",
      { deviceId },
      { headers: { [SKIP_AUTH_GATE_HEADER]: "1" } },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Attestation challenge failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }
    if (!response.data || typeof response.data.nonce !== "string") {
      log.warn("Invalid attestation challenge response format")
      return { kind: "bad-data" }
    }
    return { kind: "ok", data: response.data }
  }

  /**
   * POST /attest/assert — exchange an App Attest assertion for a device JWT.
   * Any 4xx here means "the server does not know this key"; the caller falls
   * back to a full attestation rather than surfacing it.
   */
  async assertAttestation(
    params: AttestationAssertRequest,
  ): Promise<{ kind: "ok"; data: AttestationVerifyResult } | GeneralApiProblem> {
    const response = await this.recoverySkyApi.post<AttestationVerifyResult>(
      "/attest/assert",
      params,
      { headers: { [SKIP_AUTH_GATE_HEADER]: "1" } },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Attestation assert failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }
    if (!response.data || typeof response.data.deviceJwt !== "string") {
      log.warn("Invalid attestation assert response format")
      return { kind: "bad-data" }
    }
    return { kind: "ok", data: response.data }
  }
```

- [ ] **Step 3: Type-check, lint, commit**

Run: `npm run compile && npx eslint app/services/api/index.ts --fix` — expected clean.

```bash
git add app/services/api/index.ts
git commit -m "✨ feat(api): getAttestChallenge + assertAttestation; verifyAttestation forwards the nonce

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 3: Pure decision module `deviceTokenLogic.ts`

**Files:**
- Create: `app/services/attestation/deviceTokenLogic.ts`
- Test: `app/services/attestation/deviceTokenLogic.test.ts`

**Interfaces:**
- Produces (all consumed by Tasks 5 and 8):
  ```ts
  export type ColdStartStep = "use-stored-jwt" | "assert" | "attest"
  export function decideColdStartStep(i: { platform: string; storedJwtExpiresAt: number | null; hasStoredKeyId: boolean; now: number; skewMs: number }): ColdStartStep
  export const EXCHANGE_RETRY_DELAYS_MS: readonly number[]
  export const TEMPORARY_API_KINDS: ReadonlySet<string>
  export type Exchange = "challenge" | "assert" | "attest"
  export type ExchangeFailureAction = "retry" | "fallback-to-attest" | "degrade" | "blocked"
  export function classifyExchangeFailure(i: { exchange: Exchange; kind: string }): ExchangeFailureAction
  export type NativeFailureAction = "fallback-to-attest" | "degrade" | "blocked"
  export function classifyNativeFailure(i: { phase: "assert" | "attest"; nativeCode: string | undefined }): NativeFailureAction
  export type BlockedReason = "unsupported" | "rejected"
  export type EstablishOutcome = { status: "ok" } | { status: "degraded"; detail: string } | { status: "blocked"; reason: BlockedReason }
  export function pickAttestationAlert(reason: BlockedReason): { titleKey: "errors:attestationUnsupportedTitle" | "errors:attestationServerFailedTitle"; messageKey: "errors:attestationUnsupportedMessage" | "errors:attestationServerFailedMessage" }
  ```

- [ ] **Step 1: Write the failing tests**

Create `app/services/attestation/deviceTokenLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  classifyExchangeFailure,
  classifyNativeFailure,
  decideColdStartStep,
  EXCHANGE_RETRY_DELAYS_MS,
  pickAttestationAlert,
  TEMPORARY_API_KINDS,
} from "./deviceTokenLogic"

const SKEW = 5 * 60 * 1000
const NOW = 1_700_000_000_000

describe("decideColdStartStep", () => {
  it("uses the stored JWT when it has more than the skew left", () => {
    expect(
      decideColdStartStep({ platform: "ios", storedJwtExpiresAt: NOW + SKEW + 1, hasStoredKeyId: true, now: NOW, skewMs: SKEW }),
    ).toBe("use-stored-jwt")
  })

  it("treats a JWT inside the skew window as expired", () => {
    expect(
      decideColdStartStep({ platform: "ios", storedJwtExpiresAt: NOW + SKEW, hasStoredKeyId: true, now: NOW, skewMs: SKEW }),
    ).toBe("assert")
  })

  it("asserts on iOS when a key id is stored", () => {
    expect(
      decideColdStartStep({ platform: "ios", storedJwtExpiresAt: null, hasStoredKeyId: true, now: NOW, skewMs: SKEW }),
    ).toBe("assert")
  })

  it("attests on iOS without a key id", () => {
    expect(
      decideColdStartStep({ platform: "ios", storedJwtExpiresAt: null, hasStoredKeyId: false, now: NOW, skewMs: SKEW }),
    ).toBe("attest")
  })

  it("android never asserts, even with a stray key id", () => {
    expect(
      decideColdStartStep({ platform: "android", storedJwtExpiresAt: null, hasStoredKeyId: true, now: NOW, skewMs: SKEW }),
    ).toBe("attest")
  })

  it("android uses a fresh stored JWT too", () => {
    expect(
      decideColdStartStep({ platform: "android", storedJwtExpiresAt: NOW + 86_400_000, hasStoredKeyId: false, now: NOW, skewMs: SKEW }),
    ).toBe("use-stored-jwt")
  })
})

describe("classifyExchangeFailure", () => {
  it("retries temporary kinds on every exchange", () => {
    for (const kind of TEMPORARY_API_KINDS) {
      expect(classifyExchangeFailure({ exchange: "challenge", kind })).toBe("retry")
      expect(classifyExchangeFailure({ exchange: "assert", kind })).toBe("retry")
      expect(classifyExchangeFailure({ exchange: "attest", kind })).toBe("retry")
    }
  })

  it("a rejected assert falls back to a full attestation", () => {
    expect(classifyExchangeFailure({ exchange: "assert", kind: "forbidden" })).toBe("fallback-to-attest")
    expect(classifyExchangeFailure({ exchange: "assert", kind: "rejected" })).toBe("fallback-to-attest")
    expect(classifyExchangeFailure({ exchange: "assert", kind: "bad-data" })).toBe("fallback-to-attest")
  })

  it("a rejected full attestation blocks", () => {
    expect(classifyExchangeFailure({ exchange: "attest", kind: "forbidden" })).toBe("blocked")
    expect(classifyExchangeFailure({ exchange: "attest", kind: "rejected" })).toBe("blocked")
    expect(classifyExchangeFailure({ exchange: "attest", kind: "unauthorized" })).toBe("blocked")
  })

  it("a non-temporary challenge failure degrades rather than blocks", () => {
    expect(classifyExchangeFailure({ exchange: "challenge", kind: "not-found" })).toBe("degrade")
    expect(classifyExchangeFailure({ exchange: "challenge", kind: "bad-data" })).toBe("degrade")
  })

  it("malformed attest responses degrade, not block", () => {
    expect(classifyExchangeFailure({ exchange: "attest", kind: "bad-data" })).toBe("degrade")
  })
})

describe("classifyNativeFailure", () => {
  it("any native failure while asserting means the key is gone", () => {
    expect(classifyNativeFailure({ phase: "assert", nativeCode: "ERR_APP_INTEGRITY_INVALID_KEY" })).toBe("fallback-to-attest")
    expect(classifyNativeFailure({ phase: "assert", nativeCode: undefined })).toBe("fallback-to-attest")
  })

  it("unsupported hardware blocks", () => {
    expect(classifyNativeFailure({ phase: "attest", nativeCode: "ERR_APP_INTEGRITY_FEATURE_UNSUPPORTED" })).toBe("blocked")
  })

  it("Apple/Play service trouble while attesting degrades", () => {
    expect(classifyNativeFailure({ phase: "attest", nativeCode: "ERR_APP_INTEGRITY_SERVER_UNAVAILABLE" })).toBe("degrade")
    expect(classifyNativeFailure({ phase: "attest", nativeCode: "ERR_APP_INTEGRITY_SYSTEM_FAILURE" })).toBe("degrade")
    expect(classifyNativeFailure({ phase: "attest", nativeCode: undefined })).toBe("degrade")
  })
})

describe("constants", () => {
  it("ladder is 2/5/10/20 seconds", () => {
    expect([...EXCHANGE_RETRY_DELAYS_MS]).toEqual([2000, 5000, 10000, 20000])
  })
})

describe("pickAttestationAlert", () => {
  it("maps the two blocked reasons to their copy", () => {
    expect(pickAttestationAlert("unsupported")).toEqual({
      titleKey: "errors:attestationUnsupportedTitle",
      messageKey: "errors:attestationUnsupportedMessage",
    })
    expect(pickAttestationAlert("rejected")).toEqual({
      titleKey: "errors:attestationServerFailedTitle",
      messageKey: "errors:attestationServerFailedMessage",
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit -- app/services/attestation/deviceTokenLogic.test.ts`
Expected: FAIL, cannot resolve `./deviceTokenLogic`.

- [ ] **Step 3: Implement**

Create `app/services/attestation/deviceTokenLogic.ts`:

```ts
/**
 * Pure decisions for the device credential lifecycle. No runtime `@/` imports
 * (vitest cannot resolve the alias) and no React Native — see
 * [[vitest-no-path-alias]] and the same split in auth/tokenFreshnessLogic.ts.
 * The I/O orchestrator is ./deviceToken.ts.
 *
 * ADDED 2026-09-09. Spec:
 * docs/superpowers/specs/2026-09-09-app-attest-assertions-and-jwt-persistence-design.md
 */

export type ColdStartStep = "use-stored-jwt" | "assert" | "attest"

/**
 * Which credential path a cold start (or a refresh) takes.
 *
 * A stored JWT with more than `skewMs` left needs no network at all. iOS with
 * a stored key id does a cheap assertion. Everything else — first launch,
 * Android always, iOS after the key was dropped — does a full attestation.
 */
export function decideColdStartStep(i: {
  platform: string
  storedJwtExpiresAt: number | null
  hasStoredKeyId: boolean
  now: number
  skewMs: number
}): ColdStartStep {
  if (i.storedJwtExpiresAt !== null && i.now < i.storedJwtExpiresAt - i.skewMs) {
    return "use-stored-jwt"
  }
  if (i.platform === "ios" && i.hasStoredKeyId) return "assert"
  return "attest"
}

/**
 * Retry ladder for the NETWORK exchanges only. Apple/Play are never retried:
 * key generation is Apple-rate-limited and every attempt used to burn one.
 * ~37 s worst case, which covers a container swap or a Postgres restart
 * (the 2026-09-08 outage would have cleared for most users on this ladder).
 */
export const EXCHANGE_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 10000, 20000]

/** GeneralApiProblem kinds that another attempt could plausibly clear. */
export const TEMPORARY_API_KINDS: ReadonlySet<string> = new Set([
  "timeout",
  "cannot-connect",
  "server",
  "unknown",
])

export type Exchange = "challenge" | "assert" | "attest"

export type ExchangeFailureAction = "retry" | "fallback-to-attest" | "degrade" | "blocked"

/**
 * What to do when one of the three server exchanges fails.
 *
 * - Temporary kinds retry on the ladder, whatever the exchange.
 * - A non-temporary `assert` failure means "the server does not know this
 *   key" (wiped Keychain, restored backup, pre-2.9.0 row): fall back to a
 *   full attestation. Never user-visible.
 * - A 4xx on `attest` is the server refusing this app on this device:
 *   bundle/team mismatch, tampered binary, failed Play verdict. That blocks.
 *   `bad-data` is our own parsing, not a refusal, so it degrades.
 * - A non-temporary `challenge` failure is a server-side problem, not a
 *   verdict about the device: degrade and let the refresher keep trying.
 */
export function classifyExchangeFailure(i: { exchange: Exchange; kind: string }): ExchangeFailureAction {
  if (TEMPORARY_API_KINDS.has(i.kind)) return "retry"
  if (i.exchange === "assert") return "fallback-to-attest"
  if (i.exchange === "attest" && i.kind !== "bad-data") return "blocked"
  return "degrade"
}

export type NativeFailureAction = "fallback-to-attest" | "degrade" | "blocked"

/**
 * What to do when the OS attestation framework throws.
 *
 * `nativeCode` is the expo-modules `code` on the thrown error; the values
 * are `IntegrityErrorCodes` in @expo/app-integrity's Swift module
 * (ERR_APP_INTEGRITY_*). Only FEATURE_UNSUPPORTED is a verdict about the
 * device; everything else during a full attestation is Apple/Play having a
 * bad moment, and the framework is NOT retried (see the ladder comment).
 * Any failure while asserting means the stored key is unusable — drop it
 * and attest fresh.
 */
export function classifyNativeFailure(i: {
  phase: "assert" | "attest"
  nativeCode: string | undefined
}): NativeFailureAction {
  if (i.phase === "assert") return "fallback-to-attest"
  if (i.nativeCode === "ERR_APP_INTEGRITY_FEATURE_UNSUPPORTED") return "blocked"
  return "degrade"
}

export type BlockedReason = "unsupported" | "rejected"

export type EstablishOutcome =
  | { status: "ok" }
  /** Temporary trouble; the app runs without a device token and the refresher keeps trying. */
  | { status: "degraded"; detail: string }
  /** The device cannot attest at all, or the server refused it. Full-screen alert. */
  | { status: "blocked"; reason: BlockedReason }

/**
 * Alert copy for the two blocking outcomes. MOVED 2026-09-09 from app.tsx's
 * pickAttestationAlertStrings, which also had "generic" and "Apple failed"
 * variants — those cases no longer block, so they have no copy.
 */
export function pickAttestationAlert(reason: BlockedReason): {
  titleKey: "errors:attestationUnsupportedTitle" | "errors:attestationServerFailedTitle"
  messageKey: "errors:attestationUnsupportedMessage" | "errors:attestationServerFailedMessage"
} {
  if (reason === "unsupported") {
    return {
      titleKey: "errors:attestationUnsupportedTitle",
      messageKey: "errors:attestationUnsupportedMessage",
    }
  }
  return {
    titleKey: "errors:attestationServerFailedTitle",
    messageKey: "errors:attestationServerFailedMessage",
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- app/services/attestation/deviceTokenLogic.test.ts`
Expected: 16 passed.

- [ ] **Step 5: Commit**

```bash
git add app/services/attestation/deviceTokenLogic.ts app/services/attestation/deviceTokenLogic.test.ts
git commit -m "✨ feat(attestation): pure decision module for the credential lifecycle (cold-start step, retry classes, alerts)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 4: Native layer — `generateAttestation` and `generateAssertion`

**Files:**
- Modify: `app/services/attestation/index.ts` (remove `attestDevice`, `AttestationResult`, `AttestationError`, `AttestationResponse`, `TEMPORARY_API_KINDS`; keep platform detection and `preparePlayIntegrity`)

**Interfaces:**
- Produces:
  ```ts
  export interface NativeFailure { nativeCode: string | undefined; message: string }
  export function generateAttestation(challenge: string): Promise<{ ok: true; token: string; keyId?: string } | { ok: false; failure: NativeFailure }>
  export function generateAssertion(keyId: string, challenge: string): Promise<{ ok: true; assertion: string } | { ok: false; failure: NativeFailure }>
  // unchanged: isSimulator(), isAttestationSupported(), preparePlayIntegrity(projectNumber)
  ```
  `api` is no longer imported here; the server exchanges move to `deviceToken.ts`.

- [ ] **Step 1: Rewrite the file from the Types section down**

Keep the file header comment (update the "Flow" list to: `1. deviceToken.ts asks the server for a challenge`, `2. this module produces an attestation object or an assertion for it`, `3. deviceToken.ts exchanges it for a device JWT`). Keep the `Platform`, `Device`, `AppIntegrity`, and `logger` imports; **delete** the `api` import. Replace everything from `// Types` to the end of the file with:

```ts
// =============================================================================
// Types
// =============================================================================

/**
 * Why the OS framework refused. `nativeCode` is the expo-modules error code
 * (ERR_APP_INTEGRITY_*, see @expo/app-integrity ios/IntegrityErrorCodes.swift);
 * undefined when the throw was not a CodedError. deviceTokenLogic's
 * classifyNativeFailure() decides what it means.
 */
export interface NativeFailure {
  nativeCode: string | undefined
  message: string
}

function toNativeFailure(err: unknown): NativeFailure {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined
  return {
    nativeCode: typeof code === "string" ? code : undefined,
    message: err instanceof Error ? err.message : String(err),
  }
}

// =============================================================================
// Platform Detection
// =============================================================================

/**
 * Check if running on simulator/emulator
 * expo-device: Device.isDevice is false on simulators
 */
export function isSimulator(): boolean {
  return !Device.isDevice
}

/**
 * Check if device attestation is supported
 * Must be iOS/Android AND physical device (not simulator)
 */
export function isAttestationSupported(): boolean {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false
  if (!Device.isDevice) return false
  if (Platform.OS === "ios") return AppIntegrity.isSupported ?? false
  return true
}

// =============================================================================
// Android Play Integrity
// =============================================================================

let playIntegrityPrepared = false

/**
 * Prepare Android Play Integrity token provider. Called once per process
 * from app.tsx; the standard-API provider is the cheap, un-throttled path.
 */
export async function preparePlayIntegrity(cloudProjectNumber: string): Promise<boolean> {
  if (Platform.OS !== "android" || !Device.isDevice) return false
  try {
    log.info("Preparing Play Integrity token provider")
    await AppIntegrity.prepareIntegrityTokenProviderAsync(cloudProjectNumber)
    playIntegrityPrepared = true
    log.info("Play Integrity provider ready")
    return true
  } catch (err) {
    log.error("Failed to prepare Play Integrity provider", { error: toNativeFailure(err).message })
    playIntegrityPrepared = false
    return false
  }
}

// =============================================================================
// Attestation (full) and assertion
// =============================================================================

/**
 * Produce a platform attestation for `challenge`.
 *
 * iOS: generates a NEW Secure Enclave key and attests it with Apple. This is
 * the expensive, Apple-rate-limited step — callers run it at most once per
 * establishDeviceToken() and persist the returned keyId so later launches
 * use generateAssertion() instead.
 * CHANGED 2026-09-09: was attestDevice(), which also POSTed to /attest and
 * retried the whole thing (new key each time). The exchange now lives in
 * deviceToken.ts so only the network half retries.
 *
 * Android: requests a Play Integrity token with `challenge` as the request
 * hash; the server checks it against the nonce it issued.
 */
export async function generateAttestation(
  challenge: string,
): Promise<{ ok: true; token: string; keyId?: string } | { ok: false; failure: NativeFailure }> {
  try {
    if (Platform.OS === "ios") {
      log.info("Generating iOS App Attest key pair")
      const keyId = await AppIntegrity.generateKeyAsync()
      log.debug("Key pair generated", { keyId: keyId.slice(0, 8) + "..." })
      log.info("Attesting key with Apple servers")
      const token = await AppIntegrity.attestKeyAsync(keyId, challenge)
      return { ok: true, token, keyId }
    }
    if (!playIntegrityPrepared) {
      throw new Error("Play Integrity provider not prepared. Call preparePlayIntegrity() first.")
    }
    log.info("Requesting Play Integrity token")
    const token = await AppIntegrity.requestIntegrityCheckAsync(challenge)
    return { ok: true, token }
  } catch (err) {
    const failure = toNativeFailure(err)
    log.error("Native attestation failed", { platform: Platform.OS, ...failure })
    return { ok: false, failure }
  }
}

/**
 * Sign `challenge` with the stored App Attest key (iOS only).
 *
 * The native module SHA-256s the challenge string itself before calling
 * DCAppAttestService.generateAssertion, which is exactly what
 * node-app-attest's verifyAssertion recomputes from the nonce on the server.
 */
export async function generateAssertion(
  keyId: string,
  challenge: string,
): Promise<{ ok: true; assertion: string } | { ok: false; failure: NativeFailure }> {
  try {
    const assertion = await AppIntegrity.generateAssertionAsync(keyId, challenge)
    return { ok: true, assertion }
  } catch (err) {
    const failure = toNativeFailure(err)
    // info, not error: a dropped key is expected after a Keychain wipe and
    // the caller silently falls back to a full attestation.
    log.info("Native assertion failed — key will be regenerated", failure)
    return { ok: false, failure }
  }
}
```

- [ ] **Step 2: Confirm nothing else imports the removed names**

Run: `grep -rn "attestDevice\|AttestationResponse\|AttestationResult\b" app --include=*.ts --include=*.tsx`
Expected: only `app/services/attestation/deviceToken.ts` (rewritten in Task 5) and `app/services/api/index.ts`'s own `AttestationVerifyResult` (different name, keep). `AttestationError` is still imported by `deviceToken.ts`, `tokenFreshness.ts`, and `app.tsx` — Tasks 5, 6, and 8 remove those. The build stays red until then; that is expected.

- [ ] **Step 3: Commit**

```bash
git add app/services/attestation/index.ts
git commit -m "♻️ refactor(attestation): native layer only — generateAttestation + generateAssertion; server exchange moves to deviceToken

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 5: `deviceToken.ts` — persistence, decision tree, retry ladder

**Files:**
- Modify: `app/services/attestation/deviceToken.ts` (replace `performAttestation` and the retry constants; keep the module state, `DEVICE_JWT_SKEW_MS`, `isJwtExpiredOrNearExpiry`, `getDeviceJwt`, `isUsingApiKeyFallback`, `isDeviceAuthInitialized`, `setApiKeyFallback`, `GOOGLE_CLOUD_PROJECT_NUMBER`)

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 API methods, Task 3 logic, Task 4 natives.
- Produces:
  ```ts
  export async function hydratePersistedDeviceJwt(now?: number): Promise<boolean>   // true = fresh JWT loaded, lane initialized
  export async function establishDeviceToken(deviceId: string): Promise<EstablishOutcome>
  ```
  `performAttestation` is removed.

- [ ] **Step 1: Replace the imports and retry constants**

Replace the import block with:

```ts
import { Platform } from "react-native"

import { api } from "@/services/api"
import {
  clearAppAttestKeyId,
  clearDeviceJwt,
  loadAppAttestKeyId,
  loadDeviceJwt,
  saveAppAttestKeyId,
  saveDeviceJwt,
} from "@/services/auth/secureStorage"
import { logger } from "@/utils/logger"

import { generateAssertion, generateAttestation, isAttestationSupported } from "./index"
import {
  classifyExchangeFailure,
  classifyNativeFailure,
  decideColdStartStep,
  EXCHANGE_RETRY_DELAYS_MS,
  type EstablishOutcome,
  type Exchange,
} from "./deviceTokenLogic"
```

Delete the `ATTESTATION_RETRY_DELAYS` / `ATTESTATION_MAX_ATTEMPTS` constants.

- [ ] **Step 2: Update the module-state doc comment**

Replace the `deviceJwt` declaration comment with:

```ts
/**
 * The current device JWT.
 *
 * CHANGED 2026-09-09: now ALSO persisted in SecureStore (device_jwt_v1) by
 * establishDeviceToken() and loaded by hydratePersistedDeviceJwt() at cold
 * start. It used to be memory-only on the theory that a persisted credential
 * is an exposure; the Auth0 refresh token already lives in the same Keychain
 * and is worth far more, and memory-only meant EVERY cold start paid a
 * multi-second Apple round trip and every /attest outage was a cold-start
 * outage (2026-09-08). Module state stays the source of truth for the gate.
 */
let deviceJwt: string | null = null
```

- [ ] **Step 3: Replace `performAttestation` with the new orchestrator**

Delete `performAttestation` entirely and append:

```ts
// =============================================================================
// Persistence
// =============================================================================

function adopt(jwt: string, expiresAt: number): void {
  // Not dead stores — these ARE the module's public state. The auth gate
  // reads getDeviceJwt() / isUsingApiKeyFallback() / isJwtExpiredOrNearExpiry()
  // on EVERY request.
  deviceJwt = jwt
  jwtExpiresAt = expiresAt
  usingApiKeyFallback = false
  deviceAuthInitialized = true
}

/**
 * Cold-start fast path: adopt a persisted JWT that still has more than the
 * skew left. Returns true when it did, in which case no attestation is
 * needed at all. Never throws — SecureStore trouble just means "no".
 */
export async function hydratePersistedDeviceJwt(now: number = Date.now()): Promise<boolean> {
  try {
    const stored = await loadDeviceJwt()
    const step = decideColdStartStep({
      platform: Platform.OS,
      storedJwtExpiresAt: stored?.expiresAt ?? null,
      hasStoredKeyId: false,
      now,
      skewMs: DEVICE_JWT_SKEW_MS,
    })
    if (step !== "use-stored-jwt" || !stored) return false
    adopt(stored.jwt, stored.expiresAt)
    log.info("Device JWT hydrated from SecureStore", {
      expiresIn: Math.round((stored.expiresAt - now) / 1000 / 60) + " min",
    })
    return true
  } catch (err) {
    log.warn("Could not read persisted device JWT", { error: String(err) })
    return false
  }
}

async function persist(jwt: string, expiresAt: number): Promise<void> {
  adopt(jwt, expiresAt)
  try {
    await saveDeviceJwt({ jwt, expiresAt })
  } catch (err) {
    // Non-fatal: the session works from module state; only the next cold
    // start loses the fast path.
    log.warn("Could not persist device JWT", { error: String(err) })
  }
}

// =============================================================================
// Exchange retry ladder
// =============================================================================

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type ExchangeResult<T> =
  | { status: "ok"; data: T }
  | { status: "fallback-to-attest"; kind: string }
  | { status: "degrade"; kind: string }
  | { status: "blocked"; kind: string }

/**
 * Run one server exchange, retrying ONLY temporary failures on
 * EXCHANGE_RETRY_DELAYS_MS. The native step that produced the payload is
 * never re-run: the same attestation object / assertion is re-sent, so a
 * backend blip costs zero Apple/Play calls.
 */
async function exchange<T>(
  name: Exchange,
  run: () => Promise<{ kind: "ok"; data: T } | { kind: string }>,
): Promise<ExchangeResult<T>> {
  const maxAttempts = EXCHANGE_RETRY_DELAYS_MS.length + 1
  let lastKind = "unknown"
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await run()
    if (result.kind === "ok") return { status: "ok", data: (result as { kind: "ok"; data: T }).data }
    lastKind = result.kind
    const action = classifyExchangeFailure({ exchange: name, kind: result.kind })
    log.warn("Attestation exchange failed", { exchange: name, attempt, kind: result.kind, action })
    if (action !== "retry") return { status: action, kind: result.kind }
    if (attempt < maxAttempts) await sleep(EXCHANGE_RETRY_DELAYS_MS[attempt - 1])
  }
  log.error("Attestation exchange exhausted", { exchange: name, attempts: maxAttempts, kind: lastKind })
  return { status: "degrade", kind: lastKind }
}

// =============================================================================
// Establish
// =============================================================================

/**
 * Obtain a device JWT: stored JWT → iOS assertion → full attestation.
 *
 * CHANGED 2026-09-09: replaces performAttestation(). That loop retried the
 * ENTIRE flow 4× in ~6 s, generating a new Secure Enclave key each time; it
 * was too short to outlast a backend blip and burned Apple's key-generation
 * budget doing it. Now: the native step runs at most once, the network
 * exchanges retry on a ~37 s ladder, and a temporary failure returns
 * `degraded` so the app can open on local data while the refresher keeps
 * trying (its 30 s → 15 min backoff). Spec:
 * docs/superpowers/specs/2026-09-09-app-attest-assertions-and-jwt-persistence-design.md
 *
 * Marks the lane initialized on ok AND on degraded — both are completed lane
 * decisions; only `blocked` leaves it undecided, and the caller blocks.
 */
export async function establishDeviceToken(deviceId: string): Promise<EstablishOutcome> {
  if (!isAttestationSupported()) {
    log.warn("Attestation not supported on this platform/device")
    return { status: "blocked", reason: "unsupported" }
  }

  const stored = await loadDeviceJwt().catch(() => null)
  const keyId = Platform.OS === "ios" ? await loadAppAttestKeyId().catch(() => null) : null
  const step = decideColdStartStep({
    platform: Platform.OS,
    storedJwtExpiresAt: stored?.expiresAt ?? null,
    hasStoredKeyId: keyId !== null,
    now: Date.now(),
    skewMs: DEVICE_JWT_SKEW_MS,
  })
  log.info("Establishing device token", { step, hasKeyId: keyId !== null })

  if (step === "use-stored-jwt" && stored) {
    adopt(stored.jwt, stored.expiresAt)
    return { status: "ok" }
  }

  const degraded = (detail: string): EstablishOutcome => {
    // A completed lane decision: the app runs without a device token and the
    // refresher retries. Leaving this false would make the gate refuse to
    // refresh (see `deviceAuthInitialized`).
    deviceAuthInitialized = true
    usingApiKeyFallback = false
    return { status: "degraded", detail }
  }

  // ---- Step 2: iOS assertion against the stored key ----------------------
  if (step === "assert" && keyId) {
    const challenge = await exchange("challenge", () => api.getAttestChallenge(deviceId))
    if (challenge.status !== "ok") return degraded(`challenge:${challenge.kind}`)

    const native = await generateAssertion(keyId, challenge.data.nonce)
    if (!native.ok) {
      const action = classifyNativeFailure({ phase: "assert", nativeCode: native.failure.nativeCode })
      log.info("Assertion unavailable — regenerating key", { action, ...native.failure })
      await clearAppAttestKeyId().catch(() => undefined)
      // fall through to full attestation
    } else {
      const assert = await exchange("assert", () =>
        api.assertAttestation({ deviceId, keyId, nonce: challenge.data.nonce, assertion: native.assertion }),
      )
      if (assert.status === "ok") {
        await persist(assert.data.deviceJwt, assert.data.expiresAt)
        log.info("Device token established via assertion")
        return { status: "ok" }
      }
      if (assert.status !== "fallback-to-attest") return degraded(`assert:${assert.kind}`)
      log.info("Server rejected the stored key — attesting fresh", { kind: assert.kind })
      await clearAppAttestKeyId().catch(() => undefined)
      // fall through to full attestation
    }
  }

  // ---- Step 3: full attestation ------------------------------------------
  const challenge = await exchange("challenge", () => api.getAttestChallenge(deviceId))
  if (challenge.status !== "ok") return degraded(`challenge:${challenge.kind}`)

  const native = await generateAttestation(challenge.data.nonce)
  if (!native.ok) {
    const action = classifyNativeFailure({ phase: "attest", nativeCode: native.failure.nativeCode })
    if (action === "blocked") return { status: "blocked", reason: "unsupported" }
    return degraded(`native:${native.failure.nativeCode ?? "unknown"}`)
  }

  const attest = await exchange("attest", () =>
    api.verifyAttestation({
      token: native.token,
      platform: Platform.OS as "ios" | "android",
      deviceId,
      keyId: native.keyId,
      nonce: challenge.data.nonce,
    }),
  )
  if (attest.status === "ok") {
    if (native.keyId) await saveAppAttestKeyId(native.keyId).catch(() => undefined)
    await persist(attest.data.deviceJwt, attest.data.expiresAt)
    log.info("Device token established via full attestation")
    return { status: "ok" }
  }
  if (attest.status === "blocked") {
    // The server refused this app on this device. A stale persisted JWT
    // must not let the next launch sneak past that verdict.
    await clearDeviceJwt().catch(() => undefined)
    return { status: "blocked", reason: "rejected" }
  }
  return degraded(`attest:${attest.kind}`)
}
```

- [ ] **Step 4: Type-check this file in isolation**

Run: `npm run compile 2>&1 | grep -v "tokenFreshness.ts\|app/app.tsx"`
Expected: no errors from `deviceToken.ts`. (The two listed files still reference `performAttestation`; Tasks 6 and 8.)

- [ ] **Step 5: Commit**

```bash
git add app/services/attestation/deviceToken.ts
git commit -m "✨ feat(attestation): establishDeviceToken — persisted JWT, assertion path, exchange-only retry ladder, degraded outcome

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 6: Device refresher uses `establishDeviceToken` and reports outcomes

**Files:**
- Modify: `app/services/auth/tokenFreshness.ts:14-22` (imports), `:79-82` (deps), `:236-285` (refresher body)

**Interfaces:**
- Produces: `DeviceRefresherDeps` gains `onOutcome?: (outcome: EstablishOutcome) => void`. Consumed by Task 8.

- [ ] **Step 1: Imports**

Replace `performAttestation,` in the `@/services/attestation/deviceToken` import with `establishDeviceToken,` and add:

```ts
import type { EstablishOutcome } from "@/services/attestation/deviceTokenLogic"
```

- [ ] **Step 2: Deps**

```ts
export interface DeviceRefresherDeps {
  /** Device id, or null before cold-start init has resolved one. */
  getDeviceId: () => string | null
  /**
   * ADDED 2026-09-09: told the result of every background attempt so the
   * caller can flip ConfigStore.deviceAuthDegraded on/off (the "Connecting…"
   * banner). Optional: tests and the API-key lanes never care.
   */
  onOutcome?: (outcome: EstablishOutcome) => void
}
```

- [ ] **Step 3: Refresher body**

In `createDeviceTokenRefresher`, destructure `const { getDeviceId, onOutcome } = deps` and replace the `try { const result = await performAttestation(deviceId) ... }` block inside the single-flight function with:

```ts
    try {
      const outcome = await establishDeviceToken(deviceId)
      onOutcome?.(outcome)
      if (outcome.status === "ok") {
        backoff.recordSuccess()
      } else {
        backoff.recordFailure(Date.now())
        // Documented lane policy: never eject anyone because attestation had
        // a bad day. `blocked` here (post-init) is treated like degraded —
        // keep the stale token, keep retrying; the cold-start path in app.tsx
        // is the only place a blocked outcome shows an alert.
        log.error("Re-attestation did not produce a token — continuing with existing device token", {
          status: outcome.status,
          detail: outcome.status === "degraded" ? outcome.detail : outcome.reason,
        })
      }
    } catch (err) {
      backoff.recordFailure(Date.now())
      throw err
    }
```

Update the block comment above it: replace the sentence about `performAttestation retries up to 4×, and on iOS every attempt is a NEW Secure Enclave key generation` with `CHANGED 2026-09-09: establishDeviceToken() asserts against the persisted key and never re-runs the native step inside one call, so the storm this ladder was built for is now impossible by construction; the ladder stays as defense in depth.`

- [ ] **Step 4: Run the existing logic tests and type-check the file**

Run: `npm run test:unit -- app/services/auth/tokenFreshnessLogic.test.ts` — expected pass (untouched).
Run: `npm run compile 2>&1 | grep -v "app/app.tsx"` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/services/auth/tokenFreshness.ts
git commit -m "♻️ refactor(auth): device refresher drives establishDeviceToken and reports outcomes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 7: `deviceAuthDegraded` store flag and the "Connecting…" banner variant

**Files:**
- Modify: `app/models/ConfigStore.ts:125` (prop), `:339-341` (action), reset block
- Modify: `app/utils/connectivityLogic.ts:18-32`
- Modify: `app/components/MaintenanceBanner.tsx`
- Test: `app/utils/connectivityLogic.test.ts`

**Interfaces:**
- Produces: `configStore.deviceAuthDegraded: boolean`, `configStore.setDeviceAuthDegraded(v: boolean)`; `BannerState` gains `"connecting"`; `decideBanner` takes `deviceAuthDegraded`.

- [ ] **Step 1: Failing tests**

In `app/utils/connectivityLogic.test.ts`, update every existing `decideBanner({...})` call to add `deviceAuthDegraded: false`, then add inside `describe("decideBanner", ...)`:

```ts
  it("shows connecting when device auth is degraded and the device is online", () => {
    expect(decideBanner({ isOffline: false, maintenanceMode: false, deviceAuthDegraded: true })).toBe(
      "connecting",
    )
  })

  it("offline wins over connecting", () => {
    expect(decideBanner({ isOffline: true, maintenanceMode: false, deviceAuthDegraded: true })).toBe(
      "offline",
    )
  })

  it("connecting wins over maintenance", () => {
    expect(decideBanner({ isOffline: false, maintenanceMode: true, deviceAuthDegraded: true })).toBe(
      "connecting",
    )
  })
```

Run: `npm run test:unit -- app/utils/connectivityLogic.test.ts` — expected: the three new cases FAIL.

- [ ] **Step 2: Logic**

```ts
export type BannerState = "none" | "offline" | "connecting" | "maintenance"

/**
 * Pick the runtime banner. Offline wins over everything: an offline device
 * cannot verify any server claim, and "you're offline" is true and
 * actionable regardless of our service state.
 * ADDED 2026-09-09 "connecting": cold-start attestation hit a temporary
 * failure, the app opened on local data, and the refresher is retrying.
 * Ranks above maintenance because it is the more specific diagnosis — the
 * device-token-less requests are what make features look "in maintenance".
 */
export function decideBanner(i: {
  isOffline: boolean
  maintenanceMode: boolean
  deviceAuthDegraded: boolean
}): BannerState {
  if (i.isOffline) return "offline"
  if (i.deviceAuthDegraded) return "connecting"
  if (i.maintenanceMode) return "maintenance"
  return "none"
}
```

Run the test file again — expected: all pass.

- [ ] **Step 3: Store**

After `isLoading: types.optional(types.boolean, false),` add:

```ts
    /**
     * ADDED 2026-09-09: cold-start attestation degraded (temporary failure
     * after the retry ladder) and the app is running without a device token
     * while the refresher keeps trying. Drives the "Connecting…" banner.
     * Volatile by nature — ConfigStore is never persisted.
     */
    deviceAuthDegraded: types.optional(types.boolean, false),
```

After `setOutageMode() { ... },` add:

```ts
      /** See `deviceAuthDegraded`. Set by app.tsx from establishDeviceToken outcomes. */
      setDeviceAuthDegraded(value: boolean) {
        store.deviceAuthDegraded = value
      },
```

In `reset()` after `store.outageMode = false` add `store.deviceAuthDegraded = false`.

- [ ] **Step 4: Banner**

In `MaintenanceBanner.tsx`: add `deviceAuthDegraded: configStore.deviceAuthDegraded,` to the `decideBanner` call; replace `const offline = banner === "offline"` and the JSX with:

```tsx
  // "connecting" borrows the offline palette on purpose: it is informational
  // (we are working on it), not alarm-amber (something is wrong with us).
  const calm = banner === "offline" || banner === "connecting"
  const icon =
    banner === "offline" ? "cloud-offline-outline" : banner === "connecting" ? "sync-outline" : "warning-outline"
  const tx =
    banner === "offline"
      ? "common:offlineBanner"
      : banner === "connecting"
        ? "common:connectingBanner"
        : "common:maintenanceBanner"

  return (
    <View
      style={[styles.container, { backgroundColor: calm ? OFFLINE_BG : MAINT_BG, paddingTop: insets.top + 8 }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View style={styles.row}>
        <Ionicons name={icon} size={18} color={calm ? OFFLINE_FG : MAINT_FG} />
        <Text style={[styles.text, { color: calm ? OFFLINE_FG : MAINT_FG }]} tx={tx} />
      </View>
    </View>
  )
```

Add a third bullet to the file header comment: `- "connecting" — cold-start attestation degraded; app is up on local data, refresher retrying. Same calm palette as offline. ADDED 2026-09-09.`

- [ ] **Step 5: Type-check (expect only the missing i18n key), lint, commit**

Run: `npm run compile 2>&1 | grep -v "app/app.tsx"` — expected: exactly the `common:connectingBanner` key error (added in Task 9) and nothing else. `npx eslint app/models/ConfigStore.ts app/utils/connectivityLogic.ts app/components/MaintenanceBanner.tsx app/utils/connectivityLogic.test.ts --fix`.

```bash
git add app/models/ConfigStore.ts app/utils/connectivityLogic.ts app/utils/connectivityLogic.test.ts app/components/MaintenanceBanner.tsx
git commit -m "✨ feat(banner): deviceAuthDegraded flag and the Connecting… banner variant

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 8: Wire the cold start in `app.tsx`

**Files:**
- Modify: `app/app.tsx:67-74` (imports), `:134-259` (`initializeDeviceAuthorization` + `pickAttestationAlertStrings`), `:376-379` (refresher deps), `:554` (call site)

**Interfaces:**
- Consumes: `hydratePersistedDeviceJwt`, `establishDeviceToken`, `pickAttestationAlert`, `DeviceRefresherDeps.onOutcome`, `configStore.setDeviceAuthDegraded`.

- [ ] **Step 1: Imports**

Replace lines 67–74 with:

```ts
import { isSimulator, preparePlayIntegrity } from "./services/attestation"
import {
  GOOGLE_CLOUD_PROJECT_NUMBER,
  establishDeviceToken,
  hydratePersistedDeviceJwt,
  isJwtExpiredOrNearExpiry,
  setApiKeyFallback,
  isUsingApiKeyFallback,
} from "./services/attestation/deviceToken"
import { type EstablishOutcome, pickAttestationAlert } from "./services/attestation/deviceTokenLogic"
```

- [ ] **Step 2: Replace `initializeDeviceAuthorization` and delete `pickAttestationAlertStrings`**

```ts
/**
 * Initialize device authorization (called once on cold start)
 * - Physical devices: stored JWT → assertion → full attestation
 * - Simulators / web / dev builds: X-API-Key fallback
 *
 * CHANGED 2026-09-09: returns "degraded" instead of blocking on temporary
 * failures. The app then renders on local data with the "Connecting…"
 * banner while the device refresher keeps trying. Only `unsupported` and a
 * server refusal still block — and the copy no longer tells anyone to
 * reinstall (attendance is local; a reinstall destroys it).
 */
async function initializeDeviceAuthorization(deviceId: string): Promise<"ok" | "degraded"> {
  if (Platform.OS === "web") {
    log.info("Web platform, skipping attestation")
    setApiKeyFallback()
    return "ok"
  }
  if (isSimulator()) {
    log.info("Simulator detected, using X-API-Key fallback")
    setApiKeyFallback()
    return "ok"
  }
  // Dev builds on physical devices — skip attestation entirely.
  // Play Integrity can't validate the debug signing key (not registered with
  // Play Console), so every attempt fails, burns retries, and delays startup.
  if (__DEV__) {
    log.info("Dev build on device, skipping attestation and using X-API-Key")
    setApiKeyFallback()
    return "ok"
  }

  // Fast path: a persisted JWT with more than the skew left needs no network.
  if (await hydratePersistedDeviceJwt()) return "ok"

  if (Platform.OS === "android" && GOOGLE_CLOUD_PROJECT_NUMBER) {
    await preparePlayIntegrity(GOOGLE_CLOUD_PROJECT_NUMBER)
  }

  const outcome = await establishDeviceToken(deviceId)
  if (outcome.status === "ok") return "ok"
  if (outcome.status === "degraded") {
    log.warn("Device attestation degraded — running without a device token", { detail: outcome.detail })
    return "degraded"
  }

  log.fatal("Initial attestation blocked", { reason: outcome.reason })
  const { titleKey, messageKey } = pickAttestationAlert(outcome.reason)
  return new Promise<"ok" | "degraded">(() => {
    Alert.alert(
      translate(titleKey),
      translate(messageKey),
      [
        {
          text: translate("common:retry"),
          onPress: () => {
            // Full app reload to retry from scratch.
            // CHANGED 2026-05-21: via reloadApp() to close the expo-sqlite
            // SharedObject before teardown — avoids the SharedObjectRegistry
            // .clear / ~WeakObject EXC_BAD_ACCESS crash seen on OTA reloads.
            reloadApp(() => BackHandler.exitApp())
          },
        },
        { text: translate("common:close"), style: "destructive", onPress: () => BackHandler.exitApp() },
      ],
      { cancelable: false },
    )
  })
}
```

- [ ] **Step 3: Refresher outcome → store flag**

Immediately after `const _rootStore = RootStoreModel.create({})` (line 328) nothing changes; at the refresher creation (line 376) pass the outcome hook:

```ts
        const deviceRefresher = createDeviceTokenRefresher({
          getDeviceId: () => deviceIdRef.current,
          // Background attempts clear or set the "Connecting…" banner. Safe
          // to reference _rootStore here: the closure runs long after the
          // node exists, and setupRootStore() applies a snapshot to this
          // same node rather than replacing it (see the ORDERING note below).
          onOutcome: (outcome: EstablishOutcome) =>
            _rootStore.configStore.setDeviceAuthDegraded(outcome.status !== "ok"),
        })
```

- [ ] **Step 4: Call site**

Replace `await initializeDeviceAuthorization(deviceId)` (line 554) with:

```ts
        const deviceAuth = await initializeDeviceAuthorization(deviceId)
        _rootStore.configStore.setDeviceAuthDegraded(deviceAuth === "degraded")
```

- [ ] **Step 5: Type-check, lint, commit**

Run: `npm run compile 2>&1` — expected: only the `common:connectingBanner` i18n error remains. `npx eslint app/app.tsx --fix`.

```bash
git add app/app.tsx
git commit -m "✨ feat(startup): hydrate the persisted device JWT; degrade to the Connecting… banner instead of blocking on temporary attestation failures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 9: i18n — nine locales

**Files:**
- Modify: `app/i18n/en.ts`, `es.ts`, `ar.ts`, `de.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `th.ts`, `uk.ts`

- [ ] **Step 1: English**

In `en.ts` `common` block, after `offlineBanner`, add:

```ts
    connectingBanner: "Connecting to RecoverySky… Your saved data is available.",
```

In the `errors` block, delete the four keys `attestationFailedTitle`, `attestationFailedMessage`, `attestationAppleFailedTitle`, `attestationAppleFailedMessage` (and their comments), and replace the two remaining messages:

```ts
    // Shown when the device / OS can't participate in App Attest or Play Integrity at all.
    attestationUnsupportedTitle: "Device Not Supported",
    attestationUnsupportedMessage:
      "This device does not support the security verification required by RecoverySky.\n\nYour attendance records stay on this device. If you believe this is a mistake, please contact support@recoverysky.app",
    // Shown when our backend refused a full attestation (403/400): bundle/team
    // mismatch, tampered app, or a failed Play verdict. Temporary failures never
    // reach an alert any more — they show the Connecting… banner instead.
    // CHANGED 2026-09-09: dropped "please reinstall the app" — attendance is
    // local SQLite and a reinstall destroys it (support ticket, 2026-09-07).
    attestationServerFailedTitle: "Verification Rejected",
    attestationServerFailedMessage:
      "RecoverySky could not verify this app on this device.\n\nYour attendance records stay on this device. Please contact support@recoverysky.app and we will help.",
```

- [ ] **Step 2: The other eight**

For each of `es ar de fr pt ru th uk`: add `connectingBanner` after `offlineBanner` with the English text, delete the same four `attestation*` keys, and replace the two `attestation*Message` values with the English text above (titles may keep their existing translations). Then:

Run: `npm run compile` — expected: clean (this is the nine-file gate).
Run: `grep -rn "reinstall\|redownload" app/i18n/*.ts` — expected: no matches.

- [ ] **Step 3: Translation review queue**

Append to `docs/translation-review-2026-08-03.md` under a new `## 2026-09-09` heading: `- common.connectingBanner, errors.attestationUnsupportedMessage, errors.attestationServerFailedMessage — English placeholder in all eight locales.`

- [ ] **Step 4: Commit**

```bash
git add app/i18n/*.ts docs/translation-review-2026-08-03.md
git commit -m "💬 i18n(attestation): Connecting… banner; blocking alerts no longer say reinstall

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

---

### Task 10: Docs, changelog, full verification

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `CLAUDE.md:327-339` (attestation bullet) and the "Token freshness gate" paragraph
- Modify: `docs/PRODUCTION_CHECKLIST.md` (append a section)

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]` add:

```markdown
### Changed
- **Device verification no longer blocks the app on temporary failures.** A server
  blip, timeout, or Apple/Play hiccup at launch now opens the app on local data
  with a calm "Connecting to RecoverySky…" banner while verification retries in the
  background. Only an unsupported device or an outright server refusal still shows
  an alert, and that alert no longer tells anyone to reinstall (attendance is local
  and a reinstall destroys it). Motivated by the 2026-09-08 `/attest` outage.
- **Launch is faster.** The device credential is persisted for its seven-day life,
  so most cold starts skip verification entirely; when it does expire, iOS
  re-verifies with a cheap App Attest assertion instead of generating a new
  Secure Enclave key (which Apple rate-limits). Requires API 1.6.0.

### Fixed
- Verification retries no longer regenerate the Apple key on every attempt; only
  the network exchange retries, on a longer 2/5/10/20 s ladder.
```

- [ ] **Step 2: CLAUDE.md**

Replace the `2. **Device trust — attestation**` bullet with:

```markdown
2. **Device trust — attestation** (`app/services/attestation/`). Apple App
   Attest (iOS 14+) / Google Play Integrity via `@expo/app-integrity`,
   exchanged with the backend for a device JWT that becomes
   `X-Device-Token`. CHANGED 2026-09-09: the JWT and the iOS App Attest key
   id are **persisted in SecureStore** (`device_jwt_v1`,
   `app_attest_key_id_v1`, per install, untouched by sign-out). Cold start
   is `hydratePersistedDeviceJwt()` → `establishDeviceToken()`, which asserts
   against the stored key (`POST /attest/assert`) and only generates a new
   key when the server rejects it. Decisions live in the pure, vitest-covered
   `deviceTokenLogic.ts`; the native calls in `index.ts`; the I/O in
   `deviceToken.ts`. Temporary failures **degrade** (app opens,
   `configStore.deviceAuthDegraded`, "Connecting…" banner, refresher retries)
   rather than block; only `unsupported` and a 4xx on `POST /attest` block.
   Simulators, web, and Android dev builds call `setApiKeyFallback()` to take
   the `X-API-Key` path instead. Spec:
   `docs/superpowers/specs/2026-09-09-app-attest-assertions-and-jwt-persistence-design.md`.
```

In the "Token freshness gate" paragraph, change `(a multi-second Apple/Play round trip that must start early)` to `(a server round trip, plus a multi-second Apple/Play round trip only when the stored key was rejected)`.

- [ ] **Step 3: Manual checklist**

Append to `docs/PRODUCTION_CHECKLIST.md`:

```markdown
## Device Verification (after any change under `app/services/attestation/`)

Physical devices only; watch Loki `{service_name="recoverysky-app", module=~"attestation|deviceToken"}`.

- [ ] Fresh install (iPhone): logs show `Establishing device token {step: attest}` → `Device token established via full attestation`. API logs `Attestation successful`.
- [ ] Kill and relaunch within 7 days: `Device JWT hydrated from SecureStore`, no other attestation lines.
- [ ] Force expiry: in a local production-profile build (`npm run build:ios:device` with the production profile — `__DEV__` builds skip attestation entirely) temporarily set `DEVICE_JWT_SKEW_MS` to 8 days so the stored JWT reads as expired. Relaunch shows `{step: assert}` → `established via assertion`; no `Generating iOS App Attest key pair` line. Revert the constant before committing anything.
- [ ] Wiped key: in the same local build temporarily add `await clearAppAttestKeyId()` as the first line of `establishDeviceToken()` (so the assert path runs with a key the server knows but the device has forgotten — mirror of a Keychain wipe is to instead save a bogus key id via `saveAppAttestKeyId("bogus")`, which exercises `assert_rejected`). Relaunch shows `Server rejected the stored key — attesting fresh` → full attestation; API logs `device rebound`. Revert before committing.
- [ ] Point a release build at a dead API URL with an expired JWT: app opens, "Connecting to RecoverySky…" banner, Attendance tab works; restore the URL — banner clears within the refresher backoff (≤ 15 min).
- [ ] Android physical device: fresh install, relaunch, and the dead-URL case.
```

- [ ] **Step 4: Full verification**

Run, in order, and paste the tails into the commit message body if anything is notable:

```bash
npm run compile
npm run test:unit
npm run test:component
npm run lint:deps
npx eslint app/services/attestation app/services/auth/tokenFreshness.ts app/services/auth/secureStorage.ts app/services/api/index.ts app/app.tsx app/models/ConfigStore.ts app/utils/connectivityLogic.ts app/components/MaintenanceBanner.tsx app/i18n --fix
```

Expected: all four commands exit 0. `lint:deps` in particular must not report a cycle — `services/attestation` now imports `services/auth/secureStorage`, which is a leaf (react-native + expo-secure-store only); if depcruise objects, the fix is to keep `secureStorage.ts` free of `@/services/attestation` imports, never to import `auth/index`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md CLAUDE.md docs/PRODUCTION_CHECKLIST.md
git commit -m "📝 docs(attestation): changelog, CLAUDE.md, and the device verification manual checklist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019SG3fY4ctdjShyoUJVRgmr"
```

- [ ] **Step 6: Ship (Jenova, after API 1.6.0 is live)**

1. Confirm `curl -s https://api.recoverysky.app/status | jq .version` prints `"1.6.0"`.
2. Run the manual checklist above on one iPhone and one Android device using a preview build or TestFlight pointed at production.
3. Move `[Unreleased]` under `[4.8.0-4]`, commit, then `npm run update`. **No `runtimeVersion` bump.**
