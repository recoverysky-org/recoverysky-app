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
