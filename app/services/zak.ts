/**
 * ZAK Token Service
 *
 * Unified service for fetching ZAK tokens from the zak service.
 * Handles both authenticated and anonymous users via a single endpoint.
 */

import { zoomAuthRepo, type ZoomAuthRecord } from "@/db"
import { logger } from "@/utils/logger"

import { ZOOM_ENDPOINTS, type ZakMeResponse } from "./auth/zoomOAuth"

const log = logger.child({ module: "zak" })

/**
 * Fetch ZAK token for meeting join.
 *
 * @param zoomAuth - User's Zoom auth (if logged in), or null for anonymous
 * @param deviceId - Device ID for updating tokens if refreshed
 * @returns ZAK token string, or null on failure
 */
export async function getZakToken(
  zoomAuth: ZoomAuthRecord | null,
  deviceId?: string,
): Promise<string | null> {
  if (!ZOOM_ENDPOINTS.zakMe) {
    log.error("EXPO_PUBLIC_ZAK_ME_ENDPOINT not configured")
    return null
  }

  const isAuthenticated = !!zoomAuth

  try {
    log.info("Fetching ZAK token", { mode: isAuthenticated ? "authenticated" : "anonymous" })

    const response = await fetch(ZOOM_ENDPOINTS.zakMe, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": ZOOM_ENDPOINTS.apiKey,
      },
      body: JSON.stringify({
        access_token: zoomAuth?.accessToken ?? null,
        refresh_token: zoomAuth?.refreshToken ?? null,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))

      if (response.status === 401 && errorData.error_code === "invalid_grant") {
        log.warn("User refresh token expired, must re-authenticate")
        return null
      }

      if (response.status === 503) {
        log.warn("Service account expired, retry shortly")
        return null
      }

      log.error("ZAK request failed", { status: response.status, error: errorData })
      return null
    }

    const data: ZakMeResponse = await response.json()

    // Update local storage if user tokens were refreshed
    if (data.was_refreshed && deviceId && data.access_token && data.refresh_token) {
      log.info("User tokens refreshed, updating storage")
      await zoomAuthRepo.update(deviceId, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      })
    }

    log.info("ZAK token retrieved", {
      mode: isAuthenticated ? "authenticated" : "anonymous",
      wasRefreshed: data.was_refreshed,
    })

    return data.zak
  } catch (err) {
    log.error("ZAK request error", { error: String(err) })
    return null
  }
}
