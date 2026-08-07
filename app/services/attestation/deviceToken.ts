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

import { logger } from "@/utils/logger"

import { attestDevice, isAttestationSupported, type AttestationError } from "./index"

const log = logger.child({ module: "deviceToken" })

/** Google Cloud project number for Play Integrity (Android only) */
export const GOOGLE_CLOUD_PROJECT_NUMBER = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER || ""

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

/**
 * Switch to the X-API-Key fallback used by simulators, web, and dev builds.
 *
 * CHANGED 2026-08-06: no longer calls api.setApiKeyAuth(). The auth gate reads
 * this module state through the device refresher on every request and stamps
 * X-API-Key itself when the refresher returns null, so pushing a sticky header
 * into the API layer is both redundant and the bug the gate exists to fix.
 */
export function setApiKeyFallback(): void {
  usingApiKeyFallback = true
  deviceJwt = null
  jwtExpiresAt = null
}

/**
 * Perform device attestation with retries.
 * Returns `{ ok: true }` on success, or `{ ok: false, error }` with the
 * last AttestationError on failure so the caller can choose a matching
 * user-facing alert.
 *
 * CHANGED 2026-08-06: no longer pushes the JWT into the API layer via
 * api.setDeviceJwt(). The gate pulls it from getDeviceJwt() per request.
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
