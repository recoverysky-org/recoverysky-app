/**
 * API URL Generator for Vercel AI SDK
 *
 * Generates the correct API URL based on the environment.
 * Uses EXPO_PUBLIC_API_BASE_URL in production.
 */

import { Platform } from "react-native"

// Default development API URL (recoverysky-agent API)
const DEV_API_BASE_URL = Platform.select({
  // Android emulator uses 10.0.2.2 to reach host machine
  android: "http://10.0.2.2:3333",
  // iOS simulator uses localhost
  ios: "http://localhost:3333",
  // Web uses localhost
  web: "http://localhost:3333",
  default: "http://localhost:3333",
})

/**
 * Generate API URL for a given path
 *
 * @param relativePath - The API path (e.g., "/api/v1/chat")
 * @returns Full URL to the API endpoint
 */
export function generateApiUrl(relativePath: string): string {
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`

  // In development, use the dev API URL
  if (__DEV__) {
    return `${DEV_API_BASE_URL}${path}`
  }

  // In production, require EXPO_PUBLIC_API_BASE_URL
  const productionUrl = process.env.EXPO_PUBLIC_API_BASE_URL

  if (!productionUrl) {
    throw new Error("EXPO_PUBLIC_API_BASE_URL environment variable is not defined for production")
  }

  return `${productionUrl}${path}`
}

/**
 * Get the base API URL (without path)
 */
export function getApiBaseUrl(): string {
  if (__DEV__) {
    return DEV_API_BASE_URL!
  }

  const productionUrl = process.env.EXPO_PUBLIC_API_BASE_URL
  if (!productionUrl) {
    throw new Error("EXPO_PUBLIC_API_BASE_URL environment variable is not defined for production")
  }

  return productionUrl
}
