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

import {
  classifyExchangeFailure,
  classifyNativeFailure,
  decideColdStartStep,
  EXCHANGE_RETRY_DELAYS_MS,
  type EstablishOutcome,
  type Exchange,
} from "./deviceTokenLogic"

import { generateAssertion, generateAttestation, isAttestationSupported } from "./index"

const log = logger.child({ module: "deviceToken" })

/** Google Cloud project number for Play Integrity (Android only) */
export const GOOGLE_CLOUD_PROJECT_NUMBER = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER || ""

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

/** Tracks device JWT expiry so we can re-attest before it dies. */
let jwtExpiresAt: number | null = null

/** Whether we're using the X-API-Key fallback (simulators/web) instead of a JWT */
let usingApiKeyFallback = false

/**
 * Whether cold-start init has chosen a device-auth lane yet.
 *
 * ADDED 2026-08-07. `initializeDeviceAuthorization()` in app.tsx decides which
 * lane this device is on — real attestation, or the X-API-Key fallback used by
 * simulators, web, and `__DEV__` physical builds. Until it has decided, the
 * module state is indistinguishable from "attested device whose JWT has
 * expired": `usingApiKeyFallback` is false and `jwtExpiresAt` is null, which
 * makes isJwtExpiredOrNearExpiry() return true. The request gate reads exactly
 * those two signals, so without this flag it would drive attestation itself,
 * before init ran, on any request that happens to go out first.
 *
 * The case that motivated it is outage mode: the /status precheck failing makes
 * app.tsx return early, BEFORE initializeDeviceAuthorization(), while still
 * mounting the provider tree (MeetingProvider's getStatus/getLiveSchedules) and
 * starting the 60 s /config poll. Every one of those requests hit the gate and
 * ran performAttestation — which does the Apple App Attest round trip
 * (generateKeyAsync + attestKeyAsync) FIRST and only then fails at /attest, 4×
 * per cycle. Apple rate-limits App Attest key generation, and a throttled
 * device then trips the fatal blocking alert in app.tsx on the recovery reload:
 * a recovered outage turned into a bricked launch. On an Android dev build it
 * also re-introduced exactly the Play Integrity churn the __DEV__ skip exists to
 * prevent. Before the gate landed, outage mode attempted no attestation at all.
 *
 * Deliberately one-way: nothing clears it. Once a lane is chosen it stays
 * chosen for the process lifetime, and setApiKeyFallback() can be called again
 * without harm.
 */
let deviceAuthInitialized = false

/**
 * Re-attest this far before actual expiry.
 *
 * Five minutes, not seconds: attestation is a multi-second round trip to
 * Apple/Google plus our backend, so it has to start well before the token dies.
 */
export const DEVICE_JWT_SKEW_MS = 5 * 60 * 1000

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

/**
 * Whether cold-start init has committed this device to a lane.
 *
 * Read by the device refresher, which must NOT attempt a refresh while this is
 * false — see the `deviceAuthInitialized` declaration above for the failure
 * mode that motivated it.
 */
export function isDeviceAuthInitialized(): boolean {
  return deviceAuthInitialized
}

/**
 * Switch to the X-API-Key fallback used by simulators, web, and dev builds.
 *
 * CHANGED 2026-08-06: no longer calls api.setApiKeyAuth(). The auth gate reads
 * this module state through the device refresher on every request and stamps
 * X-API-Key itself when the refresher returns null, so pushing a sticky header
 * into the API layer is both redundant and the bug the gate exists to fix.
 *
 * CHANGED 2026-08-07: also marks device auth initialized. Choosing the fallback
 * IS a completed lane decision, so the gate is free to act on module state from
 * here on.
 */
export function setApiKeyFallback(): void {
  usingApiKeyFallback = true
  deviceJwt = null
  jwtExpiresAt = null
  deviceAuthInitialized = true
}

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
    if (result.kind === "ok")
      return { status: "ok", data: (result as { kind: "ok"; data: T }).data }
    lastKind = result.kind
    const action = classifyExchangeFailure({ exchange: name, kind: result.kind })
    log.warn("Attestation exchange failed", { exchange: name, attempt, kind: result.kind, action })
    if (action !== "retry") return { status: action, kind: result.kind }
    if (attempt < maxAttempts) await sleep(EXCHANGE_RETRY_DELAYS_MS[attempt - 1])
  }
  log.error("Attestation exchange exhausted", {
    exchange: name,
    attempts: maxAttempts,
    kind: lastKind,
  })
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
      const action = classifyNativeFailure({
        phase: "assert",
        nativeCode: native.failure.nativeCode,
      })
      log.info("Assertion unavailable — regenerating key", { action, ...native.failure })
      await clearAppAttestKeyId().catch(() => undefined)
      // fall through to full attestation
    } else {
      const assert = await exchange("assert", () =>
        api.assertAttestation({
          deviceId,
          keyId,
          nonce: challenge.data.nonce,
          assertion: native.assertion,
        }),
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
