/**
 * Platform-Aware Secure Storage
 *
 * - Native: expo-secure-store (encrypted keychain/keystore)
 * - Web: Encrypted localStorage using tweetnacl
 */

import { Platform } from "react-native"

import { logger } from "@/utils/logger"

const log = logger.child({ module: "secureStorage" })

/**
 * expo-secure-store's documented per-value ceiling. Today (SDK 54,
 * expo-secure-store 15) an oversized write only logs a console warning; Expo
 * has said a future SDK will reject it. Mirrored here so the app's own log
 * carries the key and the size — the SDK warning names neither.
 */
const SECURE_STORE_VALUE_LIMIT_BYTES = 2048

function utf8ByteLength(value: string): number {
  // TextEncoder is available on Hermes (RN 0.74+) and every web target.
  return new TextEncoder().encode(value).length
}

/**
 * Get item from secure storage
 */
export async function getItemAsync(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    const vault = await import("./vault")
    return vault.get(key)
  } else {
    const SecureStore = await import("expo-secure-store")
    return SecureStore.getItemAsync(key)
  }
}

/**
 * Set item in secure storage
 */
export async function setItemAsync(key: string, value: string): Promise<void> {
  // ADDED 2026-09-14: size accounting per key, never the value. The
  // auth_credentials_v1 record silently crossed the limit once the ID token
  // was persisted beside the access token; the SDK warning that surfaced it
  // did not say which key. Warn at the ceiling so growth (e.g. new claims on
  // the access token) is visible before an SDK upgrade turns it into a throw.
  const bytes = utf8ByteLength(value)
  if (bytes > SECURE_STORE_VALUE_LIMIT_BYTES) {
    log.warn("SecureStore value exceeds size limit", {
      key,
      bytes,
      limit: SECURE_STORE_VALUE_LIMIT_BYTES,
    })
  } else {
    log.debug("SecureStore write", { key, bytes })
  }
  if (Platform.OS === "web") {
    const vault = await import("./vault")
    vault.put(key, value)
  } else {
    const SecureStore = await import("expo-secure-store")
    await SecureStore.setItemAsync(key, value)
  }
}

/**
 * Delete item from secure storage
 */
export async function deleteItemAsync(key: string): Promise<void> {
  if (Platform.OS === "web") {
    const vault = await import("./vault")
    vault.remove(key)
  } else {
    const SecureStore = await import("expo-secure-store")
    await SecureStore.deleteItemAsync(key)
  }
}

// --- Auth Credential Helpers ---

const AUTH_CREDENTIALS_KEY = "auth_credentials_v1"

/**
 * The persisted slice of the Auth0 session.
 *
 * CHANGED 2026-09-14: `idToken` is no longer part of this record. It was
 * the largest of the three tokens (profile claims, picture URL, our
 * `metadata.sqliteKey` claim, RS256 signature — ~1.3 KB) and pushed the
 * JSON past expo-secure-store's 2048-byte limit. Nothing ever read the
 * persisted copy: the SQLite key is extracted from the fresh SDK token at
 * login, and the refresher never consults an ID token. Old records that
 * still carry `idToken` parse fine — the extra property is ignored — and are
 * rewritten without it on the next refresh.
 */
export interface StoredAuthCredentials {
  accessToken: string
  refreshToken?: string
  /** Expiry timestamp in milliseconds */
  expiresAt: number
}

export async function loadAuthCredentials(): Promise<StoredAuthCredentials | undefined> {
  const raw = await getItemAsync(AUTH_CREDENTIALS_KEY)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as StoredAuthCredentials
  } catch {
    return undefined
  }
}

export async function saveAuthCredentials(creds: StoredAuthCredentials): Promise<void> {
  await setItemAsync(AUTH_CREDENTIALS_KEY, JSON.stringify(creds))
}

export async function clearAuthCredentials(): Promise<void> {
  await deleteItemAsync(AUTH_CREDENTIALS_KEY)
}

// --- Terms Acceptance ---

const TERMS_ACCEPTED_KEY = "terms_accepted_v2"

/**
 * Get the ISO date string when terms were last accepted.
 * Returns null if never accepted.
 */
export async function getTermsAcceptedDate(): Promise<string | null> {
  return await getItemAsync(TERMS_ACCEPTED_KEY)
}

/**
 * Check if terms were accepted and are still current.
 * If documentDate is provided, returns false if the document was updated after acceptance.
 */
export async function hasAcceptedTerms(documentDate?: string): Promise<boolean> {
  const acceptedDate = await getTermsAcceptedDate()
  if (!acceptedDate) return false
  if (documentDate && new Date(documentDate) > new Date(acceptedDate)) return false
  return true
}

/**
 * Record terms acceptance with current timestamp.
 */
export async function setTermsAccepted(): Promise<void> {
  await setItemAsync(TERMS_ACCEPTED_KEY, new Date().toISOString())
}

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

/**
 * Clear all secure storage data managed by this module.
 * Deletes auth credentials and terms acceptance.
 * Deliberately leaves the device credentials (device_jwt_v1, app_attest_key_id_v1) alone — see the section above.
 */
export async function clearAllSecureData(): Promise<void> {
  await Promise.all([deleteItemAsync(AUTH_CREDENTIALS_KEY), deleteItemAsync(TERMS_ACCEPTED_KEY)])
}
