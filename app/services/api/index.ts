/**
 * This Api class lets you define an API endpoint and methods to request
 * data and process it.
 *
 * See the [Backend API Integration](https://docs.infinite.red/ignite-cli/boilerplate/app/services/#backend-api-integration)
 * documentation for more details.
 */
import { type meeting } from "@common"
import { ApisauceInstance, create } from "apisauce"

import Config from "@/config"
import { logger } from "@/utils/logger"

import { getGeneralApiProblem, type GeneralApiProblem } from "./apiProblem"
import type { ApiConfig } from "./types"

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

/** RecoverySky API base URL - configurable via EXPO_PUBLIC_API_URL */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "https://api.recoverysky.app"

/** API key for anonymous users (X-API-Key header) */
const AUTH_KEY = process.env.EXPO_PUBLIC_AUTH_KEY || ""

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
    this.recoverySkyApi = create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      headers: {
        Accept: "application/json",
      },
    })

    // Set default auth to anonymous API key
    this.setAnonymousAuth()
  }

  /**
   * Set authorization header for authenticated users (OAuth token)
   */
  setAuthToken(token: string) {
    log.debug("Setting Bearer token auth")
    this.recoverySkyApi.deleteHeader("X-API-Key")
    this.recoverySkyApi.setHeader("Authorization", `Bearer ${token}`)
  }

  /**
   * Set X-API-Key header for anonymous users
   */
  setAnonymousAuth() {
    log.debug("Setting X-API-Key auth")
    this.recoverySkyApi.deleteHeader("Authorization")
    this.recoverySkyApi.setHeader("X-API-Key", AUTH_KEY)
  }

  /**
   * Update auth based on current authentication state
   * Call this when auth state changes
   */
  updateAuth(isAnonymous: boolean, accessToken?: string) {
    if (isAnonymous || !accessToken) {
      this.setAnonymousAuth()
    } else {
      this.setAuthToken(accessToken)
    }
  }

  /**
   * Check API status/health
   * GET /status
   */
  async getStatus(): Promise<{ kind: "ok"; status: string } | GeneralApiProblem> {
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
}

// Singleton instance of the API for convenience
export const api = new Api()
