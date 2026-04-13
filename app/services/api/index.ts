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
import type { AttendanceRecord } from "@/db"
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
 * Response from POST /reports endpoint
 * Returns the full attendance_report record after server processing
 */
export interface SendReportResponse {
  id: string
  uid: string
  error: boolean
  retry: number
  generated: number
  confirmed: number
  confirmation: string
  email: string
  html: string
  text: string
}

/**
 * Input for syncing a reminder to the server
 */
export interface ReminderApiInput {
  id: string
  uid: string
  did: string
  mid: string
  sid?: string
  scope?: string
  name?: string
  timezone: string
  dow?: number
  time?: number
  minutes_before: number
  at_start: boolean
  enabled: boolean
}

export interface ReminderApiResponse {
  id: string
  uid: string
  sid: string
  mid: string
  scope: string
  dow: number
  time: number
  name: string
  timezone: string
  minutes_before: number
  at_start: boolean
  enabled: boolean
  created: number
  updated: number
}

/**
 * A single cell in the schedule grid — millis + meeting ID, or null for empty slots
 */
export type ScheduleCell = { millis: number; id: string } | null

/**
 * Schedule data row - 7 columns for Mon-Sun
 */
export type ScheduleDataRow = ScheduleCell[]

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
  /** Plain text meeting password */
  password?: string
  /** Encrypted meeting password */
  passwordEnc?: string
}

// =============================================================================
// Firebase Import Types
// =============================================================================

export interface FirebaseUserData {
  profile: {
    shortName: string
    pronouns: string
    recoveryDate: string
    fellowship: string
  }
  preferences: {
    showCleanDate: boolean
    showCleanDays: boolean
    showPronouns: boolean
    ninetyStart: number
  }
}

export interface FirebaseAttendanceRecord {
  id: string
  iid: string
  uid: string
  mid: string
  zid: string
  created: number
  valid: boolean
  uzid: string
  zpid: string
  zuid: string
  meetingHost: string
  meetingName: string
  archived: boolean
  events: unknown[]
  processed: number
  start: number
  end: number
  credit: number
  produced: number
  arid: string
}

// =============================================================================
// Transcription Types
// =============================================================================

export interface TranscribeResponse {
  transcript: string
  language: string
  duration_ms: number
}

export interface FirebaseReportRecord {
  id: string
  iid: string
  uid: string
  fid: string
  messageId: string
  name: string
  userEmail: string
  error: boolean
  retry: number
  generated: number
  confirmed: number
  confirmation: string
  email: string
  html: string
  text: string
  credit: number
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

  /** Auth key for simulator fallback (from env var) */
  private authKey: string = process.env.EXPO_PUBLIC_AUTH_KEY || ""

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
  async getLiveSchedules(options?: {
    includeExternal?: boolean
  }): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    await this.waitForAttestation()
    // Get device timezone in IANA format (e.g., "America/New_York")
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    log.debug("Fetching live schedules from API", { tz })

    const params: Record<string, string | boolean> = { tz }
    if (options?.includeExternal) {
      params.includeExternal = true
    }

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/live", params)

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
    options?: { includeExternal?: boolean },
  ): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    await this.waitForAttestation()
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    log.debug("Fetching daily schedules from API", { iso_dow, fellowship, tz })

    const params: Record<string, string | number | boolean> = { iso_dow, fellowship, tz }
    if (options?.includeExternal) {
      params.includeExternal = true
    }

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/daily", params)

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
   * Get a single schedule by meeting ID
   *
   * Used when navigating to a specific meeting (e.g., from notification or post-subscription return)
   * that may not be currently live in the MeetingContext.
   *
   * @param mid - The meeting ID (UUID)
   * @returns The schedule containing the meeting
   */
  async getScheduleByMeetingId(
    mid: string,
  ): Promise<{ kind: "ok"; schedule: LiveSchedule } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching schedule by meeting ID", { mid })

    const response = await this.recoverySkyApi.get<{
      schedules: LiveSchedule[]
    }>(`/schedules/meeting/${mid}`)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    const schedule = response.data?.schedules?.[0]
    if (!schedule) {
      return { kind: "bad-data" }
    }

    return { kind: "ok", schedule }
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
   * Get a pre-signed Replyke JWT for the current authenticated user.
   *
   * The backend holds the Replyke secret key and signs a token scoped to
   * the user's Auth0 identity. The token is injected into the Social
   * WebView via postMessage({ type: "replyke_token", token }).
   */
  async getReplykeToken(): Promise<{ kind: "ok"; token: string } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching Replyke token from API")

    const response = await this.recoverySkyApi.post<{ token: string }>("/api/replyke/sign-token")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Replyke token request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || typeof response.data.token !== "string") {
      log.warn("Invalid Replyke token response format")
      return { kind: "bad-data" }
    }

    log.debug("Received Replyke token")
    return { kind: "ok", token: response.data.token }
  }

  /**
   * Update the user's Auth0 profile (name) via the backend.
   *
   * The backend proxies to the Auth0 Management API using its own
   * management token. The app passes the fields it wants persisted.
   */
  async updateAuth0Profile(
    fields: { name: string },
  ): Promise<{ kind: "ok" } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Updating Auth0 profile", { hasName: !!fields.name })

    const response = await this.recoverySkyApi.post("/auth0/profile", fields)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Auth0 profile update failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    return { kind: "ok" }
  }

  /**
   * Get app configuration from server
   *
   * Returns URLs and keys that may be updated server-side.
   */
  async getConfig(): Promise<
    | {
        kind: "ok"
        config: {
          AGENT_URL: string
          SOCIAL_URL?: string
          ZOOM_SDK_KEY: string
          ZOOM_SDK_SECRET: string
          REVENUE_CAT_API_TEST_KEY: string
          REVENUE_CAT_API_APPLE_KEY: string
          REVENUE_CAT_API_GOOGLE_KEY: string
          ZAK_API_KEY: string
          OTLP_API_KEY: string
          UMAMI_URL: string
          UMAMI_WEBSITE_ID: string
          UMAMI_X_API_KEY: string
          REVIEW_ENABLED?: boolean
          MAINTENANCE_MODE?: boolean
          MAINTENANCE_MESSAGE?: string
          MAINTENANCE_UNTIL?: string
          MAINTENANCE_UPDATE?: boolean
          LATEST_VERSION?: string
        }
      }
    | GeneralApiProblem
  > {
    await this.waitForAttestation()
    log.debug("Fetching config from API")

    const response = await this.recoverySkyApi.get<{
      AGENT_URL: string
      ZOOM_SDK_KEY: string
      ZOOM_SDK_SECRET: string
      REVENUE_CAT_API_TEST_KEY: string
      REVENUE_CAT_API_APPLE_KEY: string
      REVENUE_CAT_API_GOOGLE_KEY: string
      ZAK_API_KEY: string
      OTLP_API_KEY: string
      UMAMI_URL: string
      UMAMI_WEBSITE_ID: string
      UMAMI_X_API_KEY: string
      REVIEW_ENABLED?: boolean
      MAINTENANCE_MODE?: boolean
      MAINTENANCE_MESSAGE?: string
      MAINTENANCE_UNTIL?: string
      MAINTENANCE_UPDATE?: boolean
      LATEST_VERSION?: string
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

  /**
   * Get content document from Directus CMS
   * GET /content/:collection/:document
   */
  async getContent(
    document: string,
    collection = "RecoverySky_Content",
  ): Promise<{ kind: "ok"; content: string; updatedAt?: string } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching content from API", { collection, document })

    const response = await this.recoverySkyApi.get<{
      data: {
        content: string
        date_updated?: string
      }
    }>(`/content/${collection}/${document}`)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Content fetch failed", { collection, document, problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    const doc = response.data?.data
    if (!doc?.content) {
      log.warn("Empty content response", { collection, document })
      return { kind: "bad-data" }
    }

    log.debug("Content received", { collection, document })
    return {
      kind: "ok",
      content: doc.content,
      updatedAt: doc.date_updated,
    }
  }

  /**
   * Delete all reminders for a user
   * DELETE /reminders?uid=...
   */
  async deleteReminders(uid: string): Promise<{ kind: "ok" } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Deleting remote reminders", { uid })

    const response = await this.recoverySkyApi.delete(`/reminders?uid=${encodeURIComponent(uid)}`)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Delete reminders failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.info("Remote reminders deleted", { uid })
    return { kind: "ok" }
  }

  /**
   * Send attendance report to the backend for HTML generation and email delivery
   * POST /reports
   */
  async sendReport(params: {
    id: string
    uid: string
    email: string
    name?: string
    userEmail?: string
    userIdNum?: string
    timezone?: string
    fid?: string
    attendance?: AttendanceRecord[]
  }): Promise<{ kind: "ok"; data: SendReportResponse } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.info("Sending attendance report to API", {
      reportId: params.id,
      email: params.email,
      fid: params.fid ?? "none",
      attendanceCount: params.attendance?.length ?? 0,
    })

    const response = await this.recoverySkyApi.post<SendReportResponse>("/reports", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Send report failed", {
        reportId: params.id,
        problem: problem?.kind,
        status: response.status,
      })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data) {
      log.warn("Invalid report response format", { reportId: params.id })
      return { kind: "bad-data" }
    }

    log.info("Report sent successfully", {
      reportId: params.id,
      confirmed: response.data.confirmed,
      error: response.data.error,
      email: response.data.email,
    })
    return { kind: "ok", data: response.data }
  }

  /**
   * Resend an existing attendance report (same email)
   * POST /reports with only { id }
   */
  async resendReport(params: {
    id: string
    uid: string
  }): Promise<{ kind: "ok"; data: SendReportResponse } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.info("Resending attendance report", { reportId: params.id, uid: params.uid })

    const response = await this.recoverySkyApi.post<SendReportResponse>("/reports", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Resend report failed", {
        reportId: params.id,
        problem: problem?.kind,
        status: response.status,
      })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data) {
      log.warn("Invalid resend response format", { reportId: params.id })
      return { kind: "bad-data" }
    }

    log.info("Report resent successfully", {
      reportId: params.id,
      confirmed: response.data.confirmed,
      error: response.data.error,
    })
    return { kind: "ok", data: response.data }
  }

  /**
   * Poll report delivery status
   * POST /reports/status
   *
   * Returns the current state of the report including confirmed/error fields.
   * Poll until confirmed !== 0 to determine delivery success or failure.
   */
  async getReportStatus(params: {
    id: string
  }): Promise<{ kind: "ok"; data: SendReportResponse } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Polling report status", { reportId: params.id })

    const response = await this.recoverySkyApi.post<SendReportResponse>("/reports/status", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Report status poll failed", { problem: problem?.kind, reportId: params.id })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data) {
      log.warn("Invalid report status response format", { reportId: params.id })
      return { kind: "bad-data" }
    }

    log.debug("Report status received", {
      reportId: params.id,
      confirmed: response.data.confirmed,
      error: response.data.error,
      confirmation: response.data.confirmation || "none",
      email: response.data.email,
    })
    return { kind: "ok", data: response.data }
  }
  /**
   * Check if a user has data in the old Firebase app
   * GET /firebase/user — uid extracted from OAuth token server-side
   */
  async checkFirebaseUser(): Promise<{ kind: "ok" } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Checking Firebase user data")

    const response = await this.recoverySkyApi.get("/firebase/user")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("No Firebase data found", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.debug("Firebase user data exists")
    return { kind: "ok" }
  }

  /**
   * Fetch user profile from old Firebase app
   * GET /firebase/user — uid extracted from OAuth token server-side
   */
  async getFirebaseUser(): Promise<{ kind: "ok"; data: FirebaseUserData } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching Firebase user data")

    const response = await this.recoverySkyApi.get<FirebaseUserData>("/firebase/user")

    if (!response.ok || !response.data) {
      const problem = getGeneralApiProblem(response)
      if (problem) return problem
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }

  /**
   * Fetch attendance records from old Firebase app
   * GET /firebase/attendance — uid extracted from OAuth token server-side
   */
  async getFirebaseAttendance(): Promise<
    { kind: "ok"; data: FirebaseAttendanceRecord[] } | GeneralApiProblem
  > {
    await this.waitForAttestation()
    log.debug("Fetching Firebase attendance")

    const response =
      await this.recoverySkyApi.get<FirebaseAttendanceRecord[]>("/firebase/attendance")

    if (!response.ok || !response.data) {
      const problem = getGeneralApiProblem(response)
      if (problem) return problem
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }

  /**
   * Fetch attendance reports from old Firebase app
   * GET /firebase/reports — uid extracted from OAuth token server-side
   */
  async getFirebaseReports(): Promise<
    { kind: "ok"; data: FirebaseReportRecord[] } | GeneralApiProblem
  > {
    await this.waitForAttestation()
    log.debug("Fetching Firebase reports")

    const response = await this.recoverySkyApi.get<FirebaseReportRecord[]>("/firebase/reports")

    if (!response.ok || !response.data) {
      const problem = getGeneralApiProblem(response)
      if (problem) return problem
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }

  /**
   * Transcribe an audio recording to text
   * POST /api/v1/transcribe — multipart/form-data with audio file
   */
  async transcribeAudio(
    uri: string,
    language = "en-US",
  ): Promise<{ kind: "ok"; data: TranscribeResponse } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Transcribing audio", { language, uri: uri.slice(-20) })

    const formData = new FormData()
    formData.append("audio", {
      uri,
      name: "audio.m4a",
      type: "audio/mp4",
    } as unknown as Blob)
    formData.append("language", language)

    const response = await this.recoverySkyApi.post<TranscribeResponse>(
      "/api/v1/transcribe",
      formData,
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Transcription failed", { problem: problem?.kind, status: response.status })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data) {
      log.warn("Invalid transcription response")
      return { kind: "bad-data" }
    }

    log.info("Transcription complete", {
      language: response.data.language,
      duration_ms: response.data.duration_ms,
      length: response.data.transcript.length,
    })
    return { kind: "ok", data: response.data }
  }

  // ==========================================================================
  // Reminders
  // ==========================================================================

  async createReminder(input: ReminderApiInput): Promise<{ kind: "ok" } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Creating reminder", { mid: input.mid, scope: input.scope })

    const response = await this.recoverySkyApi.post<ReminderApiResponse>("/reminders", input)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Create reminder failed", { problem: problem?.kind, mid: input.mid })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.debug("Reminder created", { id: input.id })
    return { kind: "ok" }
  }

  async updateReminder(
    id: string,
    input: Partial<ReminderApiInput>,
  ): Promise<{ kind: "ok" } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Updating reminder", { id })

    const response = await this.recoverySkyApi.patch<ReminderApiResponse>(`/reminders/${id}`, input)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Update reminder failed", { problem: problem?.kind, id })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.debug("Reminder updated", { id })
    return { kind: "ok" }
  }

  async deleteReminder(id: string, uid: string): Promise<{ kind: "ok" } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Deleting reminder", { id })

    const response = await this.recoverySkyApi.delete<ReminderApiResponse>(
      `/reminders/${id}`,
      {},
      { data: { uid } },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Delete reminder failed", { problem: problem?.kind, id })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.debug("Reminder deleted", { id })
    return { kind: "ok" }
  }

  async getReminders(
    uid: string,
  ): Promise<{ kind: "ok"; reminders: ReminderApiResponse[] } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching reminders", { uid })

    const response = await this.recoverySkyApi.get<ReminderApiResponse[]>("/reminders", { uid })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Fetch reminders failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    return { kind: "ok", reminders: response.data ?? [] }
  }

  // ==========================================================================
  // Push Tokens
  // ==========================================================================

  /**
   * Register or update an Expo Push Token for the current device (upsert)
   * POST /push-tokens/
   */
  async registerPushToken(input: {
    userId: string
    deviceId: string
    token: string
    platform: "ios" | "android"
    language?: string
    enabled?: boolean
  }): Promise<{ kind: "ok" } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Registering push token", { userId: input.userId.slice(0, 8) + "..." })

    const response = await this.recoverySkyApi.post("/push-tokens/", input)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Push token registration failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.info("Push token registered")
    return { kind: "ok" }
  }
  // ==========================================================================
  // Bug Reports
  // ==========================================================================

  /**
   * Send a bug report with device and session context
   * POST /issues
   */
  async sendBugReport(params: {
    deviceId: string
    sessionId: string
    description: string
    email: string
  }): Promise<{ kind: "ok" } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.info("Sending bug report", { deviceId: params.deviceId, sessionId: params.sessionId })

    const response = await this.recoverySkyApi.post("/issues", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Bug report send failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.info("Bug report sent successfully")
    return { kind: "ok" }
  }

  /**
   * Get current news/announcement for the home screen
   * GET /news
   */
  async getNews(): Promise<{ kind: "ok"; title: string; body: string } | GeneralApiProblem> {
    await this.waitForAttestation()
    log.debug("Fetching news from API")

    const response = await this.recoverySkyApi.get<{
      id: string
      title: string
      body: string
      start: number
      end: number
    }>("/news")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("News fetch failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (
      !response.data ||
      typeof response.data.title !== "string" ||
      typeof response.data.body !== "string"
    ) {
      log.warn("Invalid news response format")
      return { kind: "bad-data" }
    }

    log.debug("News received", { title: response.data.title })
    return { kind: "ok", title: response.data.title, body: response.data.body }
  }
}

// Singleton instance of the API for convenience
export const api = new Api()
