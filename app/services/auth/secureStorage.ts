/**
 * Platform-Aware Secure Storage
 *
 * - Native: expo-secure-store (encrypted keychain/keystore)
 * - Web: Encrypted localStorage using tweetnacl
 */

import { Platform } from "react-native"

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

export interface StoredAuthCredentials {
  accessToken: string
  refreshToken?: string
  idToken?: string
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

/**
 * Clear all secure storage data managed by this module.
 * Deletes auth credentials and terms acceptance.
 */
export async function clearAllSecureData(): Promise<void> {
  await Promise.all([deleteItemAsync(AUTH_CREDENTIALS_KEY), deleteItemAsync(TERMS_ACCEPTED_KEY)])
}
