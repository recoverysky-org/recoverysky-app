/**
 * This Api class lets you define an API endpoint and methods to request
 * data and process it.
 *
 * See the [Backend API Integration](https://docs.infinite.red/ignite-cli/boilerplate/app/services/#backend-api-integration)
 * documentation for more details.
 */
import { type meeting } from "@recoverysky-org/common/browser"
import { ApisauceInstance, create } from "apisauce"

import Config from "@/config"
import { logger } from "@/utils/logger"

import { getGeneralApiProblem, type GeneralApiProblem } from "./apiProblem"
import type { ApiConfig } from "./types"

// =============================================================================
// Attestation Types
// =============================================================================

/**
 * Response from /attest endpoint
 */
export interface AttestationVerifyResult {
  deviceJwt: string
  expiresAt: number // Unix timestamp (ms)
}

/**
 * Request body for /attest endpoint
 */
export interface AttestationVerifyRequest {
  token: string
  platform: "ios" | "android"
  deviceId: string
  /** iOS only: Key ID from DCAppAttestService.generateKey() */
  keyId?: string
}

/**
 * Schedule data row - 7 columns for Sun-Sat, value is time string or null
 */
export type ScheduleDataRow = (number | null)[]

/**
 * Live schedule from /schedules/live API
 * Contains full meeting object and pre-computed grid data
 */
export interface LiveSchedule {
  /** Schedule ID */
  sid: string
  /** Full meeting object */
  meeting: meeting
  /** Current meeting time in UTC milliseconds */
  millis: number
  /** Meeting duration in milliseconds */
  duration_ms: number
  /** Pre-computed schedule grid data for SchedulePopup (values are UTC millis) */
  data: ScheduleDataRow[]
}

// Re-export for convenience
export { GeneralApiProblem, getGeneralApiProblem } from "./apiProblem"
export type { ApiConfig } from "./types"

const log = logger.child({ module: "Api" })

/** Default API base URL (used before ConfigStore loads) */
const DEFAULT_API_URL = "https://api.recoverysky.app"

/**
 * Configuring the apisauce instance.
 */
export const DEFAULT_API_CONFIG: ApiConfig = {
  url: Config.API_URL,
  timeout: 10000,
}

/**
 * Manages all requests to the API. You can use this class to build out
 * various requests that you need to call from your backend API.
 */
export class Api {
  apisauce: ApisauceInstance
  config: ApiConfig

  /** Dedicated instance for RecoverySky API */
  private recoverySkyApi: ApisauceInstance

  /** Current auth key for simulator fallback */
  private authKey: string = ""

  /** Device JWT for production (physical devices) - kept in memory only */
  private deviceJwt: string | null = null

  /** Promise that resolves when attestation completes - used for request queueing */
  private attestationPromise: Promise<void> | null = null

  /**
   * Set up our API instance. Keep this lightweight!
   */
  constructor(config: ApiConfig = DEFAULT_API_CONFIG) {
    this.config = config
    this.apisauce = create({
      baseURL: this.config.url,
      timeout: this.config.timeout,
      headers: {
        Accept: "application/json",
      },
    })

    // Create dedicated instance for RecoverySky API
    // Use config URL (from env) so local dev works, falls back to hardcoded default
    this.recoverySkyApi = create({
      baseURL: this.config.url || DEFAULT_API_URL,
      timeout: 10000,
      headers: {
        Accept: "application/json",
      },
    })
  }

  // ===========================================================================
  // Device Authorization Methods
  // ===========================================================================

  /**
   * Set device JWT for production use (physical devices)
   * This clears any X-API-Key fallback and uses the device token instead
   */
  setDeviceJwt(jwt: string | null) {
    this.deviceJwt = jwt
    this.recoverySkyApi.deleteHeader("X-API-Key") // Clear simulator fallback
    if (jwt) {
      log.debug("Setting X-Device-Token header")
      this.recoverySkyApi.setHeader("X-Device-Token", jwt)
    } else {
      log.debug("Clearing X-Device-Token header")
      this.recoverySkyApi.deleteHeader("X-Device-Token")
    }
  }

  /**
   * Set X-API-Key header for simulator fallback
   * Only used in development when attestation isn't available
   */
  setApiKeyAuth() {
    this.deviceJwt = null
    this.recoverySkyApi.deleteHeader("X-Device-Token") // Clear device JWT
    if (this.authKey) {
      log.debug("Setting X-API-Key header (simulator fallback)")
      this.recoverySkyApi.setHeader("X-API-Key", this.authKey)
    } else {
      log.warn("No auth key available for simulator fallback")
    }
  }

  /**
   * Signal that attestation is in progress
   * API calls will wait for this promise to resolve before proceeding
   */
  setAttestationInProgress(promise: Promise<void>) {
    this.attestationPromise = promise
    promise.finally(() => {
      this.attestationPromise = null
    })
  }

  /**
   * Wait for any in-progress attestation to complete
   * Called before API requests to queue them during re-attestation
   */
  private async waitForAttestation(): Promise<void> {
    if (this.attestationPromise) {
      log.debug("Waiting for attestation to complete")
      await this.attestationPromise
    }
  }

  /**
   * Update API configuration from ConfigStore
   * Call this after ConfigStore loads from server
   */
  updateConfig(apiUrl: string, authKey: string) {
    log.debug("Updating API config", { apiUrl: apiUrl.slice(0, 30) })
    this.recoverySkyApi.setBaseURL(apiUrl)
    this.authKey = authKey
  }

  // ===========================================================================
  // User Authentication Methods (OAuth)
  // ===========================================================================

  /**
   * Set authorization header for authenticated users (OAuth token)
   * This is separate from device authorization (X-Device-Token)
   */
  setAuthToken(token: string) {
    log.debug("Setting Bearer token auth")
    this.recoverySkyApi.setHeader("Authorization", `Bearer ${token}`)
  }

  /**
   * Clear OAuth authorization header
   * Device authorization (X-Device-Token or X-API-Key) remains unchanged
   */
  clearAuthToken() {
    log.debug("Clearing Bearer token auth")
    this.recoverySkyApi.deleteHeader("Authorization")
  }

  /**
   * Update OAuth auth based on current authentication state
   * Note: This only handles user authentication (OAuth), not device authorization
   * Device authorization is handled separately via setDeviceJwt/setApiKeyAuth
   */
  updateAuth(isAnonymous: boolean, accessToken?: string) {
    if (isAnonymous || !accessToken) {
      this.clearAuthToken()
    } else {
      this.setAuthToken(accessToken)
    }
  }

  // ===========================================================================
  // Attestation Endpoint
  // ===========================================================================

  /**
   * Verify device attestation and exchange for JWT
   * POST /attest
   *
   * Note: This endpoint is called WITHOUT device authorization headers
   * since we're in the process of obtaining them
   */
  async verifyAttestation(
    params: AttestationVerifyRequest,
  ): Promise<{ kind: "ok"; data: AttestationVerifyResult } | GeneralApiProblem> {
    log.debug("Verifying attestation with backend", { platform: params.platform })

    const response = await this.recoverySkyApi.post<AttestationVerifyResult>("/attest", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Attestation verification failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || typeof response.data.deviceJwt !== "string") {
      log.warn("Invalid attestation response format")
      return { kind: "bad-data" }
    }

    log.debug("Attestation verified successfully")
    return { kind: "ok", data: response.data }
  }

  // ===========================================================================
  // API Endpoints
  // ===========================================================================

  /**
   * Check API status/health
   * GET /status
   */
  async getStatus(): Promise<{ kind: "ok"; status: string } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Checking API status")

    const response = await this.recoverySkyApi.get<{ status: string }>("/status")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("API status check failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.debug("API status OK", { status: response.data?.status })
    return { kind: "ok", status: response.data?.status || "ok" }
  }

  /**
   * Get live meeting IDs from the RecoverySky API
   *
   * Returns array of meeting IDs that are currently live.
   * Falls back to local calculation if API fails.
   */
  async getLiveMeetingIds(): Promise<
    { kind: "ok"; ids: string[]; count: number } | GeneralApiProblem
  > {
    await this.waitForAttestation()
    log.debug("Fetching live meeting IDs from API")

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      count: number
      ids: string[]
    }>("/meetings/live/ids")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("API request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    // Validate response data
    if (!response.data || !Array.isArray(response.data.ids)) {
      log.warn("Invalid response data format")
      return { kind: "bad-data" }
    }

    log.debug("Received live meeting IDs", {
      count: response.data.count,
      timestamp: response.data.timestamp,
    })
    return { kind: "ok", ids: response.data.ids, count: response.data.count }
  }

  /**
   * Get live schedules from the RecoverySky API
   *
   * Returns schedules that are currently live with their meeting IDs.
   * Each schedule includes pre-computed grid data for display.
   */
  async getLiveSchedules(): Promise<
    { kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem
  > {
    await this.waitForAttestation()
    // Get device timezone in IANA format (e.g., "America/New_York")
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    log.debug("Fetching live schedules from API", { tz })

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/live", { tz })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("API request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    // Validate response data
    if (!response.data || !Array.isArray(response.data.schedules)) {
      log.warn("Invalid response data format")
      return { kind: "bad-data" }
    }

    log.debug("Received live schedules", {
      count: response.data.count,
      timestamp: response.data.timestamp,
    })
    return { kind: "ok", schedules: response.data.schedules, count: response.data.count }
  }

  /**
   * Get daily schedules for a specific day of week and fellowship
   *
   * @param iso_dow - ISO day of week (1=Monday, 7=Sunday)
   * @param fellowship - Fellowship code (e.g., "AA", "NA", "RD")
   * @returns Schedules for the specified day/fellowship
   */
  async getDailySchedules(
    iso_dow: number,
    fellowship: string,
  ): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    await this.waitForAttestation()
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    log.debug("Fetching daily schedules from API", { iso_dow, fellowship, tz })

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/daily", { iso_dow, fellowship, tz })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("API request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || !Array.isArray(response.data.schedules)) {
      log.warn("Invalid response data format")
      return { kind: "bad-data" }
    }

    log.debug("Received daily schedules", {
      count: response.data.count,
      iso_dow,
      fellowship,
    })
    return { kind: "ok", schedules: response.data.schedules, count: response.data.count }
  }

  /**
   * Get Zoom JWT token from the backend
   *
   * The backend generates the JWT using Zoom SDK credentials (kept secure server-side).
   * @param zid - The Zoom meeting ID to join
   */
  async getZoomJwt(zid: string): Promise<{ kind: "ok"; jwt: string } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching Zoom JWT from API", { zid })

    const response = await this.recoverySkyApi.post<{ jwt: string }>("/zoom/jwt", {
      zid,
    })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Zoom JWT request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || typeof response.data.jwt !== "string") {
      log.warn("Invalid Zoom JWT response format")
      return { kind: "bad-data" }
    }

    log.debug("Received Zoom JWT")
    return { kind: "ok", jwt: response.data.jwt }
  }

  /**
   * Get app configuration from server
   *
   * Returns URLs and keys that may be updated server-side.
   * Note: This does NOT wait for attestation since it may be called during init
   */
  async getConfig(): Promise<
    | {
        kind: "ok"
        config: {
          API_URL: string
          AGENT_URL: string
          ZOOM_SDK_KEY: string
          ZOOM_SDK_SECRET: string
          AUTH_KEY: string
        }
      }
    | GeneralApiProblem
  > {
    log.debug("Fetching config from API")

    const response = await this.recoverySkyApi.get<{
      API_URL: string
      AGENT_URL: string
      ZOOM_SDK_KEY: string
      ZOOM_SDK_SECRET: string
      AUTH_KEY: string
    }>("/config")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Config request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data) {
      log.warn("Invalid config response format")
      return { kind: "bad-data" }
    }

    log.debug("Received config from server")
    return { kind: "ok", config: response.data }
  }
}

// Singleton instance of the API for convenience
export const api = new Api()
