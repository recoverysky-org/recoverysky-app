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
 * 1. deviceToken.ts asks the server for a challenge
 * 2. this module produces an attestation object or an assertion for it
 * 3. deviceToken.ts exchanges it for a device JWT
 */
import { Platform } from "react-native"
import * as Device from "expo-device"
import * as AppIntegrity from "@expo/app-integrity"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "attestation" })

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
  const code =
    typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined
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
    // the caller silently falls back to a full attestation. Spread into a
    // literal — LogAttributes has a string index signature that a
    // NativeFailure-typed variable doesn't structurally satisfy on its own.
    log.info("Native assertion failed — key will be regenerated", { ...failure })
    return { ok: false, failure }
  }
}
