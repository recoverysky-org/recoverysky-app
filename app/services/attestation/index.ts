/**
 * Device Attestation Service
 *
 * Provides device/app attestation to verify API requests originate from
 * the genuine RecoverySky app running on a real iOS/Android device.
 *
 * Uses:
 * - iOS: Apple App Attest (iOS 14+)
 * - Android: Google Play Integrity
 *
 * Flow:
 * 1. Generate attestation token on device
 * 2. Send to backend for verification
 * 3. Receive JWT for subsequent API calls
 */
import { Platform } from "react-native"
import * as Device from "expo-device"
import * as AppIntegrity from "@expo/app-integrity"

import { api } from "@/services/api"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "attestation" })

// =============================================================================
// Types
// =============================================================================

export interface AttestationResult {
  deviceJwt: string
  expiresAt: number // Unix timestamp (ms)
}

export interface AttestationError {
  code: "UNSUPPORTED" | "SIMULATOR" | "ATTESTATION_FAILED" | "VERIFICATION_FAILED"
  message: string
  /**
   * For VERIFICATION_FAILED only: the underlying GeneralApiProblem.kind
   * (e.g. "timeout", "unauthorized", "server"). Lets callers distinguish
   * a 401 from a 5xx from a network drop without reverse-engineering
   * the error message.
   */
  kind?: string
  /**
   * Whether another retry could plausibly succeed. UNSUPPORTED and
   * SIMULATOR are always false; ATTESTATION_FAILED defaults to true
   * (Apple/Play framework calls can have transient hiccups);
   * VERIFICATION_FAILED follows the underlying GeneralApiProblem —
   * timeouts/5xx/connection drops are temporary, 4xx/bad-data are not.
   */
  temporary: boolean
}

/** Map an api-layer GeneralApiProblem kind to attestation retry semantics. */
const TEMPORARY_API_KINDS: ReadonlySet<string> = new Set([
  "timeout",
  "cannot-connect",
  "server",
  "unknown",
])

export type AttestationResponse =
  | { ok: true; data: AttestationResult }
  | { ok: false; error: AttestationError }

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
  // Web and other platforms not supported
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return false
  }

  // Must be physical device
  if (!Device.isDevice) {
    return false
  }

  // iOS: Check if App Attest is available (requires iOS 14+)
  if (Platform.OS === "ios") {
    return AppIntegrity.isSupported ?? false
  }

  // Android: Play Integrity is generally available
  return true
}

// =============================================================================
// iOS App Attest
// =============================================================================

// In-memory storage for iOS attestation key ID
// This is intentionally NOT persisted - we generate a new key on each cold start
let iosKeyId: string | null = null

/**
 * Generate and attest an iOS key pair
 *
 * iOS App Attest flow:
 * 1. Generate a hardware-backed key pair (key stored in Secure Enclave)
 * 2. Attest the key with Apple's servers
 * 3. Send attestation object to our backend for verification
 */
async function generateiOSAttestation(challenge: string): Promise<string> {
  // Step 1: Generate a new key pair
  log.info("Generating iOS App Attest key pair")
  iosKeyId = await AppIntegrity.generateKeyAsync()
  log.debug("Key pair generated", { keyId: iosKeyId.slice(0, 8) + "..." })

  // Step 2: Attest the key with Apple
  log.info("Attesting key with Apple servers")
  const attestationObject = await AppIntegrity.attestKeyAsync(iosKeyId, challenge)

  return attestationObject
}

// =============================================================================
// Android Play Integrity
// =============================================================================

// Track if Play Integrity provider is prepared
let playIntegrityPrepared = false

/**
 * Prepare Android Play Integrity token provider
 * This should be called early in app lifecycle (e.g., app.tsx init)
 */
export async function preparePlayIntegrity(cloudProjectNumber: string): Promise<boolean> {
  if (Platform.OS !== "android" || !Device.isDevice) {
    return false
  }

  try {
    log.info("Preparing Play Integrity token provider")
    await AppIntegrity.prepareIntegrityTokenProviderAsync(cloudProjectNumber)
    playIntegrityPrepared = true
    log.info("Play Integrity provider ready")
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("Failed to prepare Play Integrity provider", { error: message })
    playIntegrityPrepared = false
    return false
  }
}

/**
 * Request Android Play Integrity token
 */
async function generateAndroidAttestation(challenge: string): Promise<string> {
  if (!playIntegrityPrepared) {
    throw new Error("Play Integrity provider not prepared. Call preparePlayIntegrity() first.")
  }

  log.info("Requesting Play Integrity token")
  const result = await AppIntegrity.requestIntegrityCheckAsync(challenge)
  return result
}

// =============================================================================
// Main Attestation Function
// =============================================================================

/**
 * Generate attestation token and exchange for device JWT
 *
 * @param deviceId - Unique device identifier (used as challenge)
 * @param challenge - Optional server-provided challenge (defaults to deviceId)
 * @returns AttestationResponse with device JWT or error
 */
export async function attestDevice(
  deviceId: string,
  challenge?: string,
): Promise<AttestationResponse> {
  const attestChallenge = challenge ?? deviceId

  // 1. Check platform support
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    log.info("Web platform - attestation not supported")
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED",
        message: "Web platform not supported",
        temporary: false,
      },
    }
  }

  // 2. Check for simulator - use X-API-Key fallback
  if (isSimulator()) {
    log.info("Running on simulator, skipping attestation (using X-API-Key)")
    return {
      ok: false,
      error: {
        code: "SIMULATOR",
        message: "Simulator detected, using API key fallback",
        temporary: false,
      },
    }
  }

  // 3. Check if attestation is supported
  if (!isAttestationSupported()) {
    log.warn("Attestation not supported on this device")
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED",
        message: "Device attestation not supported",
        temporary: false,
      },
    }
  }

  try {
    // 4. Generate platform-specific attestation token
    log.info("Generating attestation token", { platform: Platform.OS })
    let token: string
    let keyId: string | undefined

    if (Platform.OS === "ios") {
      token = await generateiOSAttestation(attestChallenge)
      // iosKeyId is set by generateiOSAttestation
      keyId = iosKeyId ?? undefined
    } else {
      token = await generateAndroidAttestation(attestChallenge)
    }

    log.info("Attestation token generated", {
      platform: Platform.OS,
      tokenLength: token.length,
      hasKeyId: !!keyId,
    })

    // 5. Send to backend for verification and JWT exchange
    const response = await api.verifyAttestation({
      token,
      platform: Platform.OS,
      deviceId,
      keyId, // iOS only - required for App Attest verification
    })

    if (response.kind !== "ok") {
      const temporary = TEMPORARY_API_KINDS.has(response.kind)
      log.error("Backend verification failed", { kind: response.kind, temporary })
      return {
        ok: false,
        error: {
          code: "VERIFICATION_FAILED",
          message: `API error: ${response.kind}`,
          kind: response.kind,
          temporary,
        },
      }
    }

    log.info("Device attestation successful", {
      expiresAt: new Date(response.data.expiresAt).toISOString(),
    })

    return { ok: true, data: response.data }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("Attestation failed", { error: message, platform: Platform.OS })

    // Apple App Attest / Play Integrity calls can have transient failures
    // (service unavailable, network glitch while talking to Apple), so we
    // treat framework-level errors as retryable by default.
    return {
      ok: false,
      error: { code: "ATTESTATION_FAILED", message, temporary: true },
    }
  }
}

/**
 * Generate an assertion for a sensitive request (iOS only)
 *
 * After initial attestation, assertions can be generated for
 * individual sensitive requests to prove they come from the same device.
 *
 * @param requestData - Data to include in the assertion (usually stringified JSON)
 * @returns Assertion string or null if not available
 */
export async function generateAssertion(requestData: string): Promise<string | null> {
  if (Platform.OS !== "ios" || !iosKeyId) {
    return null
  }

  try {
    const assertion = await AppIntegrity.generateAssertionAsync(iosKeyId, requestData)
    return assertion
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error("Failed to generate assertion", { error: message })
    return null
  }
}
