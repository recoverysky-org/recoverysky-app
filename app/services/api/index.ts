/**
 * This Api class lets you define an API endpoint and methods to request
 * data and process it.
 *
 * See the [Backend API Integration](https://docs.infinite.red/ignite-cli/boilerplate/app/services/#backend-api-integration)
 * documentation for more details.
 */
import { type meeting } from "@recoverysky-org/common/browser"
import { ApiResponse, ApisauceInstance, create } from "apisauce"

import Config from "@/config"
import type { AttendanceRecord } from "@/db"
import type { ServerAttendanceRecord, ServerReportRecord } from "@/services/sync/syncLogic"
import { trackEvent } from "@/services/tracking"
import type { AtNextOffset } from "@/utils/atNextLogic"
import { delay } from "@/utils/delay"
import { logger } from "@/utils/logger"

import {
  getGeneralApiProblem as classifyApiProblem,
  isReadyBody,
  shouldTrackApiProblem,
  type GeneralApiProblem,
} from "./apiProblem"
import {
  bearerRejectionCode,
  deviceJwtRejected,
  noDeviceCredentialAdapter,
  readHeader,
} from "./bearerRejectionLogic"
import { fetchWithContentRetry } from "./contentRetryLogic"
import { emailVerifyProblemFrom, type EmailVerifyProblem } from "./emailVerifyProblem"
import { classifyNewsPayload, type NewsPayloadOutcome } from "./newsLogic"
import {
  makeTraceContext,
  traceIdFromTraceparent,
  TRACE_CONTEXT_BYTES,
  TRACEPARENT_HEADER,
} from "./traceparentLogic"
import type { ApiConfig, LinkIdentityResponse } from "./types"

/**
 * A fresh W3C `traceparent` value for one outbound request, or undefined when
 * no CSPRNG is reachable. `crypto.getRandomValues` is expo-crypto's, installed
 * by app/utils/cryptoPolyfill.ts as the first import in index.tsx (Hermes has
 * no global crypto); web has the real thing. Never throws: this runs inside
 * the async request transform, where a rejection would fail the request
 * itself — a missing trace id is worth nothing, a failed request is worth
 * less than nothing.
 */
function newTraceparent(): string | undefined {
  try {
    const bytes = new Uint8Array(TRACE_CONTEXT_BYTES)
    globalThis.crypto.getRandomValues(bytes)
    return makeTraceContext(bytes).traceparent
  } catch {
    return undefined
  }
}

/**
 * Classifies an api response's problem and tracks an `api_error` analytics
 * event when one is found. Wraps the pure classifier in ./apiProblem, which
 * is kept free of @/ imports so it's unit-testable under Vitest — see
 * [[vitest-no-path-alias]]. Same name/signature as before so none of this
 * file's 27+ call sites need to change.
 *
 * CHANGED 2026-09-14: only 5xx problems are tracked now (see
 * shouldTrackApiProblem). Every classified problem used to fire, so expected
 * 404s — one per never-fetchable report body per foreground — dominated the
 * metric and cost an analytics POST each.
 */
function getGeneralApiProblem(response: ApiResponse<any>): GeneralApiProblem | null {
  const problem = classifyApiProblem(response)

  if (problem && shouldTrackApiProblem(problem)) {
    // CHANGED 2026-10-01: carries the sanitized failure detail (status,
    // error, code, subsystem, upstreamCode — see describeServerFailure) so a
    // dependency outage (TREX/Redis down behind a "ready" API) is
    // distinguishable from the API itself failing, in analytics AND in Loki.
    // One warn per 5xx response: these are rare outside an outage, and in one
    // they're exactly the signal we want.
    const detail = problem.kind === "server" ? problem.detail : undefined
    const endpoint = response.config?.url || ""
    trackEvent("api_error", { kind: problem.kind, endpoint, ...detail })
    log.warn("API server error", { endpoint, ...detail })
  }

  return problem
}

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
  /**
   * Nonce from GET /attest/challenge. ADDED 2026-09-09. Always sent by this
   * build; the server keeps a legacy branch for older clients that omit it.
   */
  nonce?: string
}

/** Response from GET /attest/challenge */
export interface AttestChallengeResult {
  nonce: string
  expiresAt: number
}

/** Request body for POST /attest/assert (iOS only) */
export interface AttestationAssertRequest {
  deviceId: string
  keyId: string
  nonce: string
  /** Base64 CBOR from AppIntegrity.generateAssertionAsync */
  assertion: string
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
 * App-side venue filter for the schedules endpoints (server param
 * `venueType`). Omitted = the server serves online (its default — protects
 * deployed builds). The server also accepts a vestigial `hybrid` value
 * (pre-common-v2.0.0 leftover); the app intentionally does not model it —
 * hybrid is a boolean field on the meeting now, not a venue pool.
 */
export type VenueFilter = "online" | "in_person"

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
  /**
   * Meters from the query point — present only on /schedules/nearby
   * responses. Emitted as number-or-omitted, never null (API tightened
   * 2026-08-03); treat missing as "no distance", sort last.
   */
  distance_m?: number
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

// =============================================================================
// Sync Types
// =============================================================================

/** One rejected record from POST /sync/attendance. "stale" = server already
 * has a newer version (success for our purposes); "invalid" = failed schema
 * validation (a client bug worth logging). */
export interface SyncRejectedRecord {
  id: string
  reason: "stale" | "invalid"
}

/** Response of POST /sync/attendance. */
export interface SyncPushResult {
  accepted: number
  rejected: SyncRejectedRecord[]
}

/** Envelope of GET /sync/attendance and GET /sync/reports. `cursor` is opaque —
 * persist it and echo it back as `since`; never compute it client-side. */
export interface SyncPullEnvelope<T> {
  records: T[]
  cursor: number
  hasMore: boolean
}

/** Full report from GET /reports/:id — used by backfillReportBodies() during
 * sync to complete reports that arrived via the metadata-only /sync/reports
 * pull. Only the fields we consume. */
export interface ReportDetail {
  id: string
  html: string
  text: string
}

/** A CMS document fetched from Directus via the API's /content proxy. */
export interface ContentResult {
  kind: "ok"
  content: string
  updatedAt?: string
}

// Re-export for convenience
export type { GeneralApiProblem } from "./apiProblem"

/**
 * Outcome of `Api.getNews`. `no-content` is the server's idle state (204,
 * nothing published) — the common case, not a fault. See newsLogic.ts.
 */
export type NewsResult = NewsPayloadOutcome | GeneralApiProblem
export { getGeneralApiProblem }
export type { ApiConfig } from "./types"

const log = logger.child({ module: "Api" })
// CHANGED 2026-09-21 (RS-039): every "<thing> failed { problem }" line in this
// module is now `debug`, not `warn`. This layer only knows a request did not
// succeed — it cannot know whether the user was waiting on it (a report send)
// or a background pass will retry (a report-body backfill), so it cannot pick
// a severity. The caller owns the level and logs one contextual line for every
// non-ok result that matters; before this both layers logged the same event
// at WARN and ~2,000 of 4,205 weekly WARN lines were that duplicate. The lines
// that stay `warn` here are the ones only this module can see: a 2xx with the
// wrong shape ("Invalid … response format"), the auth gate's own decisions,
// and getContent's terminal "unavailable after retries" (it owns that ladder).
// Policy: docs/DIAGNOSTICS.md "Log levels".

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
 * Header that tells the auth gate to leave a request alone.
 *
 * A sentinel rather than a URL allow-list because getPublicStatus() and the
 * authenticated getStatus() hit the SAME /status path — a URL match cannot
 * tell them apart, and would silently start bypassing the gate for both.
 */
export const SKIP_AUTH_GATE_HEADER = "X-Skip-Auth-Gate"

/**
 * Token providers injected at startup.
 *
 * Injected rather than imported so this module gains no edge into
 * services/auth or services/attestation. The existing direction is
 * attestation → api; importing back would make depcruise see a cycle.
 */
export interface TokenRefreshers {
  /** Fresh device JWT, or null when running the X-API-Key fallback. */
  device: () => Promise<string | null>
  /** Fresh access token, or null when anonymous / signed out. */
  user: () => Promise<string | null>
  /**
   * ADDED 2026-09-10: the server answered a bearer with a code meaning it can
   * never work (see bearerRejectionLogic.ts). Wired to the user refresher's
   * markRejected() so the session is ejected exactly like a dead refresh
   * token. Optional: tests and early cold start have no refresher yet.
   */
  onBearerRejected?: () => void
  /**
   * ADDED 2026-09-14: the server answered 401 to a request that carried this
   * device JWT (code-less body — see deviceJwtRejected()). Wired to
   * markDeviceJwtRejected() in services/attestation/deviceToken so the token
   * is dropped and the next request goes through the refresher's single-flight
   * assert instead of re-sending a JWT we now know is dead. Optional for the
   * same reason as onBearerRejected.
   */
  onDeviceJwtRejected?: (token: string) => void
}

/**
 * Raw /config response shape. Exported (rather than left inline in
 * getConfig's signature) because the startup config cache stores this
 * payload verbatim — ConfigStore.applyServerConfig and
 * utils/configCacheLogic.ts both consume the same type.
 * Spec: docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md
 */
export interface ServerConfig {
  AGENT_URL: string
  SOCIAL_URL?: string
  REVENUE_CAT_API_TEST_KEY: string
  REVENUE_CAT_API_APPLE_KEY: string
  REVENUE_CAT_API_GOOGLE_KEY: string
  OTLP_API_KEY: string
  UMAMI_URL: string
  UMAMI_WEBSITE_ID: string
  UMAMI_X_API_KEY: string
  REVIEW_ENABLED?: boolean
  MAINTENANCE_MODE?: boolean
  MAINTENANCE_MESSAGE?: string
  MAINTENANCE_UNTIL?: string
  LATEST_VERSION?: string
  PRESENCE_RADIUS_M?: number
  /** Dev-build-only presence radius; ignored entirely in production. */
  DEV_PRESENCE_RADIUS_M?: number
  /** In-Person map style URLs (keyed MapTiler URLs); absent = map off */
  MAP_STYLE_URL_LIGHT?: string
  MAP_STYLE_URL_DARK?: string
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

  /**
   * Token providers. No-ops until registerTokenRefreshers() runs, so a call
   * made during early cold start degrades rather than throwing.
   *
   * CHANGED 2026-08-07: this comment used to claim such a call "simply goes out
   * unauthorized". That was wrong in a way that hid a real bug. device()
   * returning null makes the gate fall through to the X-API-Key branch, so the
   * request goes out with the API key when authKey is set (dev/simulator) and
   * with NO credential at all when it isn't (production, where
   * EXPO_PUBLIC_AUTH_KEY is absent). Neither is "unauthorized" in the harmless
   * sense the old wording implied — hence the hard ordering requirement on
   * registerTokenRefreshers() in app.tsx.
   */
  private refreshers: TokenRefreshers = {
    device: async () => null,
    user: async () => null,
  }

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

    this.installAuthGate()
    this.installBearerRejectionMonitor()
    this.installRequestTraceMonitor()
  }

  /**
   * One debug line per RecoverySky response carrying the trace id the auth
   * gate stamped on the request, so `{module="Api"} | traceId="…"` in Loki
   * finds the app's side of a Tempo trace and vice versa.
   *
   * ADDED 2026-09-21. The id goes on the line as an ordinary attribute, NOT
   * through `logger.setTraceContext()`: that setter is instance-wide and
   * requests overlap, so a per-request id set there would be stamped on
   * whichever unrelated lines happened to be written before the next request
   * overwrote it. Loki's native OTLP ingestion lands attributes and the OTLP
   * trace field in structured metadata alike, so nothing is lost query-wise.
   *
   * Debug, per the RS-039 policy (transport detail; the caller owns the
   * user-facing level). Production ships LOG_LEVEL=trace, so it reaches Loki.
   * The query string is stripped from the url on purpose — DELETE /reminders
   * carries the uid there.
   */
  /**
   * ADDED 2026-09-28: extra attributes for the "API request" line, injected
   * by services/network (which the Api must not import — it stays a
   * dependency leaf, same reason as registerTokenRefreshers). Empty until
   * network monitoring starts.
   */
  private logContextProvider: () => Record<string, string | number> = () => ({})

  setLogContextProvider(provider: () => Record<string, string | number>): void {
    this.logContextProvider = provider
  }

  private installRequestTraceMonitor() {
    this.recoverySkyApi.addMonitor((response) => {
      const traceId = traceIdFromTraceparent(
        readHeader(response.config?.headers, TRACEPARENT_HEADER),
      )
      log.debug("API request", {
        method: response.config?.method?.toUpperCase(),
        url: response.config?.url?.split("?")[0],
        status: response.status,
        durationMs: response.duration,
        ...(response.problem && { problem: response.problem }),
        ...(traceId && { traceId }),
        // ADDED 2026-09-28: the network this request went over (netType,
        // cellGen/carrier, wifiStrength) — the per-device latency baseline.
        ...this.logContextProvider(),
      })
    })
  }

  // ===========================================================================
  // Auth Gate
  // ===========================================================================

  /**
   * Install the token providers. Called once from app.tsx during init.
   */
  registerTokenRefreshers(refreshers: TokenRefreshers) {
    log.debug("Registering token refreshers")
    this.refreshers = refreshers
  }

  /**
   * Install the proactive auth gate on the RecoverySky client.
   *
   * CHANGED 2026-08-06: replaces setDeviceJwt/setAuthToken/updateAuth, which
   * wrote *sticky instance headers*. Sticky headers meant a request that
   * started before a refresh could still go out carrying the old token, and
   * they meant the Auth0 access token was only ever updated when the
   * useAuth0Wrapper `[user]` effect happened to re-run — which is to say,
   * essentially never after login. Stamping per-request makes both problems
   * structurally impossible.
   */
  private installAuthGate() {
    this.recoverySkyApi.addAsyncRequestTransform(async (request) => {
      // Exact-case bracket access and `delete` are correct here because
      // apisauce merges the instance and per-request headers into a PLAIN
      // OBJECT before running async request transforms — axios's AxiosHeaders
      // (which lower-cases names and would make exact-case lookup unreliable)
      // is only constructed later, downstream of this hook. Verified against
      // apisauce 3.1.1 / axios 1.16.1. If an apisauce bump ever starts handing
      // this transform an AxiosHeaders instance, the sentinel strip below
      // breaks SILENTLY — the bypass would stop matching and the sentinel would
      // leak to the wire. Re-verify the header type on upgrade.
      const headers = (request.headers ?? {}) as Record<string, string>
      request.headers = headers as typeof request.headers

      // ADDED 2026-09-21: start a trace for every request, BEFORE the bypass
      // below so the attest exchanges and the /status/ready probe — the
      // requests we most often need to see server-side — are traced too. The
      // API's http instrumentation continues this id into Tempo, and the
      // response monitor (installRequestTraceMonitor) logs the same id so a
      // Loki line for this request links to that trace. See
      // traceparentLogic.ts for why the app starts traces but records no spans.
      const traceparent = newTraceparent()
      if (traceparent) headers[TRACEPARENT_HEADER] = traceparent

      // Bypass. The three attest exchanges — getAttestChallenge(),
      // verifyAttestation(), assertAttestation() — are called while we are
      // still obtaining device credentials, and getPublicStatus() runs before
      // any credential exists. This is ALSO the recursion guard: the device
      // refresher drives those three exchanges, and each comes straight back
      // through this transform.
      //
      // CHANGED 2026-08-07: presence check, not truthiness. A sentinel value of
      // "" or "0" previously failed to bypass AND leaked the header onward,
      // which is the worst of both outcomes.
      if (SKIP_AUTH_GATE_HEADER in headers) {
        delete headers[SKIP_AUTH_GATE_HEADER]
        return
      }

      // Neither refresher may throw: a rejection here escapes Promise.all and
      // rejects the whole request, making API methods THROW instead of
      // returning a GeneralApiProblem, which every call site destructures.
      // Both are internally try/caught — keep it that way.
      const [deviceJwt, accessToken] = await Promise.all([
        this.refreshers.device(),
        this.refreshers.user(),
      ])

      if (deviceJwt) {
        headers["X-Device-Token"] = deviceJwt
      } else if (this.authKey) {
        headers["X-API-Key"] = this.authKey
      } else {
        // No device JWT and no API key — this request carries no device
        // credential at all and the server will almost certainly reject it.
        // Restored 2026-08-07: the deleted setApiKeyAuth() logged an
        // equivalent warning, and its absence is what let a cold-start
        // ordering bug (refreshers registered after /config) reach review
        // undetected. It is the only field-visible signal of that class of
        // failure, since it is invisible on dev builds where .env supplies
        // EXPO_PUBLIC_AUTH_KEY.
        //
        // CHANGED 2026-09-14: "almost certainly reject it" was a certainty in
        // production (no EXPO_PUBLIC_AUTH_KEY in eas.json), and a device in
        // attestation backoff or outage mode emitted that guaranteed 401 on
        // every /config poll, MeetingProvider mount and foreground — the
        // edge's 401 brute-force scenario bans on six. The request now
        // resolves as the same 401 locally via a per-request axios adapter:
        // call sites still get `{ kind: "unauthorized" }`, nothing reaches
        // the wire, and the marker body says no server was involved. A local
        // API with attestation disabled would have accepted the bare request;
        // that setup needs EXPO_PUBLIC_AUTH_KEY in .env, which dev already has.
        log.warn("No device credential — answering 401 locally", { url: request.url })
        request.adapter = noDeviceCredentialAdapter
      }

      if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`
      }
    })
  }

  /**
   * Watch every RecoverySky response for a bearer the server says can never
   * work and hand the verdict to the user refresher.
   *
   * ADDED 2026-09-10. A monitor rather than a response transform because it
   * must not alter the response — the call site still gets its
   * `{ kind: "unauthorized" }` and shows the sign-in-again toast; the eject
   * happens beside it. The decision is in bearerRejectionLogic.ts (pure,
   * vitest-covered); this only logs and forwards. Dedupe is the refresher's
   * latch, not ours.
   */
  private installBearerRejectionMonitor() {
    this.recoverySkyApi.addMonitor((response) => {
      // ADDED 2026-09-14: the device-lane twin. A code-less 401 on a request
      // that carried X-Device-Token means the DEVICE token was refused (the
      // user lane always answers with a code). Hand the exact token over so
      // the drop is identity-checked against whatever the module holds now.
      const rejectedJwt = deviceJwtRejected(
        response.status,
        response.config?.headers,
        response.data,
      )
      if (rejectedJwt) {
        log.warn("Server rejected the device token — dropping it for re-attestation", {
          url: response.config?.url,
        })
        this.refreshers.onDeviceJwtRejected?.(rejectedJwt)
        return
      }

      const code = bearerRejectionCode(response.status, response.config?.headers, response.data)
      if (!code) return
      log.error("Server rejected the bearer as unusable", {
        source: "server-401",
        code,
        url: response.config?.url,
      })
      this.refreshers.onBearerRejected?.()
    })
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

    const response = await this.recoverySkyApi.post<AttestationVerifyResult>("/attest", params, {
      headers: { [SKIP_AUTH_GATE_HEADER]: "1" },
    })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Attestation verification failed", { problem: problem?.kind })
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

  /**
   * GET /attest/challenge — a nonce for the next attestation or assertion.
   * Bypasses the auth gate: it runs before any device JWT exists.
   */
  async getAttestChallenge(
    deviceId: string,
  ): Promise<{ kind: "ok"; data: AttestChallengeResult } | GeneralApiProblem> {
    const response = await this.recoverySkyApi.get<AttestChallengeResult>(
      "/attest/challenge",
      { deviceId },
      { headers: { [SKIP_AUTH_GATE_HEADER]: "1" } },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Attestation challenge failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }
    if (!response.data || typeof response.data.nonce !== "string") {
      log.warn("Invalid attestation challenge response format")
      return { kind: "bad-data" }
    }
    return { kind: "ok", data: response.data }
  }

  /**
   * POST /attest/assert — exchange an App Attest assertion for a device JWT.
   * Any 4xx here means "the server does not know this key"; the caller falls
   * back to a full attestation rather than surfacing it.
   */
  async assertAttestation(
    params: AttestationAssertRequest,
  ): Promise<{ kind: "ok"; data: AttestationVerifyResult } | GeneralApiProblem> {
    const response = await this.recoverySkyApi.post<AttestationVerifyResult>(
      "/attest/assert",
      params,
      { headers: { [SKIP_AUTH_GATE_HEADER]: "1" } },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Attestation assert failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }
    if (!response.data || typeof response.data.deviceJwt !== "string") {
      log.warn("Invalid attestation assert response format")
      return { kind: "bad-data" }
    }
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
    log.debug("Checking API status")

    const response = await this.recoverySkyApi.get<{ status: string }>("/status")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("API status check failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.debug("API status OK", { status: response.data?.status })
    return { kind: "ok", status: response.data?.status || "ok" }
  }

  /**
   * Public health probe used at cold start, BEFORE attestation runs.
   *
   * Bypasses the auth gate entirely (see SKIP_AUTH_GATE_HEADER below) — that's
   * the whole point: we need to know whether the API is reachable before we
   * attempt /attest. If the API is down, attestation would fail with a
   * misleading "Device Verification Failed" alert; this precheck lets us
   * route directly to the outage MaintenanceScreen instead.
   *
   * Binary pass/fail. /status/ready doesn't require auth, and at cold start
   * no X-Device-Token / X-API-Key has been set yet, so the request goes out
   * unauthenticated.
   *
   * CHANGED 2026-08-06: no longer relies on "no headers have been set yet" —
   * it passes SKIP_AUTH_GATE_HEADER so the auth gate leaves it alone
   * explicitly. The old implicit version broke the moment anything set a
   * header earlier in cold start.
   *
   * CHANGED 2026-09-14: probes GET /status/ready instead of GET /status and
   * requires the `{ status: "ready" }` body (isReadyBody), not just a 2xx.
   * Same gate on the server — both answer 503 when the database or the TREX
   * engine is down — but the readiness route returns a few bytes instead of
   * the full per-check report, and the body check keeps a captive portal's
   * 200 from reading as "API healthy". The authenticated getStatus() above
   * still uses /status for the connectivity indicator.
   */
  async getPublicStatus(timeoutMs = 2500): Promise<{ kind: "ok" } | GeneralApiProblem> {
    log.debug("Checking API public status (pre-attestation)")

    // Override the client's default 10s timeout with a short per-request one.
    // This call gates cold start (the outage precheck awaits it before any
    // other init), so on a flaky/unreachable network the full 10s timeout
    // per attempt × retries stretched startup to 25-47s — long enough that
    // users backgrounded the app mid-init and tripped Background ANRs. A 2.5s
    // ceiling fails fast so we route to MaintenanceScreen quickly instead.
    // CHANGED 2026-08-14: the cold-start precheck in app.tsx now passes an
    // escalating ladder (2.5s → 4s → 6s) per attempt so slow-but-alive
    // networks aren't misread as outages; the 2500 default still serves the
    // outage-recovery poll, which runs every 15s and wants to stay cheap.
    const response = await this.recoverySkyApi.get<{ status: string }>("/status/ready", undefined, {
      timeout: timeoutMs,
      headers: { [SKIP_AUTH_GATE_HEADER]: "1" },
    })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("API readiness check failed", {
        problem: problem?.kind,
        status: response.status ?? 0,
      })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!isReadyBody(response.data)) {
      // 2xx without the readiness payload: something answered, but not our
      // API. Treated as temporary so the precheck retries on its ladder.
      log.warn("API readiness check returned an unexpected body", {
        status: response.status ?? 0,
        bodyType: typeof response.data,
      })
      return { kind: "unknown", temporary: true }
    }

    log.info("API ready")
    return { kind: "ok" }
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
      log.debug("API request failed", { problem: problem?.kind })
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
  async getLiveSchedules(
    venueType?: VenueFilter,
  ): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    // Get device timezone in IANA format (e.g., "America/New_York")
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    log.debug("Fetching live schedules from API", { tz, venueType })

    const params: Record<string, string> = { tz }
    if (venueType) params.venueType = venueType

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/live", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("API request failed", { problem: problem?.kind })
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
   * Get online meetings starting within `offset` minutes of `startsAt`.
   *
   * ADDED 2026-09-26 for Live's "Starts In" selector. Same response shape as
   * /schedules/live, but `millis` is each meeting's upcoming start. The API
   * owns the window math. Fellowship is deliberately NOT sent: the Meetings
   * filter bar applies it on-device, so switching fellowship never refetches.
   * Callers gate on `startsInVisible` until the route is deployed; a 404 from
   * an older API build is the caller's signal to hide the selector.
   *
   * CHANGED 2026-09-27: aligned with the deployed contract (api repo
   * src/openapi.ts, operationId `getAtNextSchedules`). We had coded against
   * the design draft, which differed in every way that matters:
   * - the route is `/schedules/at-next` (hyphen); `/schedules/at_next` 404s,
   *   which would have hidden the selector for the session;
   * - `starts_at` is a BOOLEAN (default true: only meetings starting exactly
   *   at the mark), not a reference timestamp — the ISO string we sent was a
   *   400 — and there is no `tz` param;
   * - `offset` picks one quarter-hour mark (15 = the next :00/:15/:30/:45
   *   strictly after now; 30/45/60 = 15/30/45 min past it), and the response
   *   adds `at` (that mark) and `offset`.
   * `starts_at=true` is sent explicitly rather than relying on the default,
   * so a server-side default change can't silently turn "starting at 7:30"
   * into "in session at 7:30". `at` is returned so the caller can label the
   * list and refetch when the mark passes (atNextLogic.refetchDelayMs).
   *
   * @param offset - 15 | 30 | 45 | 60 — which coming quarter-hour mark
   */
  async getAtNextSchedules(
    offset: AtNextOffset,
  ): Promise<
    { kind: "ok"; schedules: LiveSchedule[]; count: number; at: string } | GeneralApiProblem
  > {
    log.debug("Fetching at-next schedules from API", { offset })

    const params: Record<string, string | number> = {
      offset,
      starts_at: "true",
      venueType: "online",
    }

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      at: string
      offset: AtNextOffset
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/at-next", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("API request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    // `at` is required too: without it the caller can neither label the list
    // nor know when to refetch, so a response missing it is bad data.
    if (
      !response.data ||
      !Array.isArray(response.data.schedules) ||
      typeof response.data.at !== "string"
    ) {
      log.warn("Invalid at-next response data format")
      return { kind: "bad-data" }
    }

    return {
      kind: "ok",
      schedules: response.data.schedules,
      count: response.data.count,
      at: response.data.at,
    }
  }

  /**
   * Get daily schedules for a specific day of week and fellowship
   *
   * @param iso_dow - ISO day of week (1=Monday, 7=Sunday)
   * @param fellowship - Fellowship code (e.g., "AA", "NA", "CMA"); any
   *   `Fellowship` enum value is accepted server-side as a free string
   * @param venueType - Restrict to one venue pool ("online" | "in_person");
   *   omitted defaults to the server's own default (online)
   * @returns Schedules for the specified day/fellowship
   */
  async getDailySchedules(
    iso_dow: number,
    fellowship: string,
    venueType?: VenueFilter,
  ): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    log.debug("Fetching daily schedules from API", { iso_dow, fellowship, tz, venueType })

    const params: Record<string, string | number> = { iso_dow, fellowship, tz }
    if (venueType) params.venueType = venueType

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/daily", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("API request failed", { problem: problem?.kind })
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
   * Get in-person schedules near a point, for the In-Person segment.
   *
   * Server contract (confirmed with API team 2026-08-03):
   * - Sends EXACTLY lat/lon/radius/iso_dow(+fellowship). No `limit`
   *   (removed — it capped geo candidates before the day filter and
   *   silently truncated results), no `venueType` (in_person is the
   *   default and only accepted value), no `tz` (not accepted here,
   *   unlike /schedules/daily). Unknown params are silently stripped.
   * - Response is /schedules/daily-shaped with distance_m added,
   *   millis-ascending; callers re-sort by distance client-side.
   *
   * PRIVACY: never log lat/lon — logs ship to Loki. Radius/iso_dow only.
   */
  async getNearbySchedules(params: {
    lat: number
    lon: number
    radius: number
    iso_dow: number
    fellowship?: string
  }): Promise<{ kind: "ok"; schedules: LiveSchedule[]; count: number } | GeneralApiProblem> {
    log.debug("Fetching nearby schedules from API", {
      radius: params.radius,
      iso_dow: params.iso_dow,
      fellowship: params.fellowship,
    })

    const query: Record<string, string | number> = {
      lat: params.lat,
      lon: params.lon,
      radius: params.radius,
      iso_dow: params.iso_dow,
    }
    if (params.fellowship) query.fellowship = params.fellowship

    const response = await this.recoverySkyApi.get<{
      timestamp: string
      iso_dow: number
      count: number
      schedules: LiveSchedule[]
    }>("/schedules/nearby", query)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("API request failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || !Array.isArray(response.data.schedules)) {
      log.warn("Invalid response data format")
      return { kind: "bad-data" }
    }

    log.debug("Received nearby schedules", {
      count: response.data.count,
      iso_dow: params.iso_dow,
    })

    return {
      kind: "ok",
      schedules: response.data.schedules,
      count: response.data.count,
    }
  }

  /**
   * Get a single schedule by meeting ID
   *
   * Used when navigating to a specific meeting (e.g., from notification or post-subscription return)
   * that may not be currently live in the MeetingContext.
   *
   * @param mid - The meeting ID (UUID)
   * @param venueType - Restrict to one venue pool ("online" | "in_person");
   *   omitted defaults to the server's own default (online)
   * @returns The schedule containing the meeting
   */
  async getScheduleByMeetingId(
    mid: string,
    venueType?: VenueFilter,
  ): Promise<{ kind: "ok"; schedule: LiveSchedule } | GeneralApiProblem> {
    log.debug("Fetching schedule by meeting ID", { mid, venueType })

    const response = await this.recoverySkyApi.get<{
      schedules: LiveSchedule[]
    }>(`/schedules/meeting/${mid}`, venueType ? { venueType } : undefined)

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
   * Look up a schedule by meeting ID across both venue pools.
   *
   * The server's venueType param defaults to online and cross-pool lookups
   * 404 — but deep-link callers (push notification → meeting popup) only
   * have a mid and don't know which pool it lives in. Try online first
   * (overwhelmingly the common case for anything reachable today), then
   * retry in_person on a miss. Only "not-found" / "bad-data" trigger the
   * retry: transport-level failures (timeout, cannot-connect, server) would
   * fail identically on the second call, so retrying would just double the
   * user's wait.
   */
  async getScheduleByMeetingIdAnyVenue(
    mid: string,
  ): Promise<{ kind: "ok"; schedule: LiveSchedule } | GeneralApiProblem> {
    const online = await this.getScheduleByMeetingId(mid, "online")
    if (online.kind === "ok") return online
    if (online.kind !== "not-found" && online.kind !== "bad-data") return online

    log.debug("Meeting not in online pool, retrying in_person", { mid })
    return this.getScheduleByMeetingId(mid, "in_person")
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
      log.debug("Zoom JWT request failed", { problem: problem?.kind })
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
    log.debug("Fetching Replyke token from API")

    const response = await this.recoverySkyApi.post<{ token: string }>("/api/replyke/sign-token")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Replyke token request failed", { problem: problem?.kind })
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
  async updateAuth0Profile(fields: { name: string }): Promise<{ kind: "ok" } | GeneralApiProblem> {
    log.debug("Updating Auth0 profile", { hasName: !!fields.name })

    const response = await this.recoverySkyApi.post("/auth0/profile", fields)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Auth0 profile update failed", { problem: problem?.kind })
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
  async getConfig(): Promise<{ kind: "ok"; config: ServerConfig } | GeneralApiProblem> {
    log.debug("Fetching config from API")

    const response = await this.recoverySkyApi.get<ServerConfig>("/config")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Config request failed", {
        problem: problem?.kind,
        url: `${this.recoverySkyApi.getBaseURL()}/config`,
        status: response.status ?? 0,
      })
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
   * One attempt at a content document. Retry policy lives in getContent.
   */
  private async fetchContentOnce(
    document: string,
    collection: string,
  ): Promise<ContentResult | GeneralApiProblem> {
    const response = await this.recoverySkyApi.get<{
      data: {
        content: string
        date_updated?: string
      }
    }>(`/content/${collection}/${document}`)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Content fetch failed", { collection, document, problem: problem?.kind })
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
   * Get content document from Directus CMS
   * GET /content/:collection/:document
   *
   * Retries transient failures on the ladder in ./contentRetryLogic.
   * ADDED 2026-08-09: Directus intermittently 500s a single document while a
   * sibling document requested in the same tick succeeds — seen live on the
   * login screen, where `disclaimer` loaded and `EULA` did not, leaving the
   * user staring at a blank legal agreement they were still able to accept.
   * The upstream fault is server-side and did not reproduce under a 112-request
   * soak, so riding out the blip here is the only reliable mitigation.
   *
   * The retry is inside getContent rather than at the call sites so all three
   * consumers (LoginScreen, TermsScreen, AgentScreen) inherit it.
   */
  async getContent(
    document: string,
    collection = "RecoverySky_Content",
  ): Promise<ContentResult | GeneralApiProblem> {
    log.debug("Fetching content from API", { collection, document })

    const result = await fetchWithContentRetry<ContentResult>(
      () => this.fetchContentOnce(document, collection),
      delay,
      ({ problem, attempt, waitMs }) =>
        log.debug("Retrying content fetch", { collection, document, problem, attempt, waitMs }),
    )

    if (result.kind !== "ok") {
      log.warn("Content unavailable after retries", {
        collection,
        document,
        problem: result.kind,
      })
    }

    return result
  }

  /**
   * Delete all reminders for a user
   * DELETE /reminders?uid=...
   */
  async deleteReminders(uid: string): Promise<{ kind: "ok" } | GeneralApiProblem> {
    log.debug("Deleting remote reminders", { uid })

    const response = await this.recoverySkyApi.delete(`/reminders?uid=${encodeURIComponent(uid)}`)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Delete reminders failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.info("Remote reminders deleted", { uid })
    return { kind: "ok" }
  }

  /**
   * Fold a foreign identity into the signed-in account (spec 2 §3). The body
   * carries the foreign session's ID token; the server verifies it against the
   * Native app's client id before touching anything. Goes through the token
   * freshness gate like every call, so the bearer is the OWNER's.
   * ADDED 2026-09-17.
   */
  async linkIdentity(
    idToken: string,
  ): Promise<{ kind: "ok"; data: LinkIdentityResponse } | GeneralApiProblem> {
    log.info("Linking foreign identity")
    const response = await this.recoverySkyApi.post<LinkIdentityResponse>("/auth0/link", {
      linkWith: idToken,
    })
    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.warn("Link identity failed", { problem: problem?.kind, status: response.status })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }
    if (!response.data || typeof response.data.linked !== "boolean") {
      log.warn("Invalid link identity response format")
      return { kind: "bad-data" }
    }
    return { kind: "ok", data: response.data }
  }

  /**
   * POST /auth0/email/start — email a verification code to `email` for the
   * signed-in password account (legacy email verification spec §6). The
   * address is NEVER logged.
   * ADDED 2026-10-01.
   */
  async startEmailVerification(
    email: string,
  ): Promise<{ kind: "ok" } | { kind: "problem"; code: EmailVerifyProblem }> {
    log.info("Starting email verification")
    const response = await this.recoverySkyApi.post<{ sent?: boolean; code?: unknown }>(
      "/auth0/email/start",
      { email },
    )
    if (!response.ok) {
      const code = emailVerifyProblemFrom(response.status, response.data?.code)
      log.warn("Email verification start failed", { code, status: response.status })
      return { kind: "problem", code }
    }
    return { kind: "ok" }
  }

  /**
   * POST /auth0/email/verify — on a matching code the API sets the account's
   * email and marks it verified. Returns the address as Auth0 now stores it.
   * Neither the address nor the code is logged.
   * ADDED 2026-10-01.
   */
  async confirmEmailVerification(
    email: string,
    code: string,
  ): Promise<{ kind: "ok"; email: string } | { kind: "problem"; code: EmailVerifyProblem }> {
    log.info("Confirming email verification")
    const response = await this.recoverySkyApi.post<{ email?: unknown; code?: unknown }>(
      "/auth0/email/verify",
      { email, code },
    )
    if (!response.ok) {
      const problem = emailVerifyProblemFrom(response.status, response.data?.code)
      log.warn("Email verification confirm failed", { code: problem, status: response.status })
      return { kind: "problem", code: problem }
    }
    if (typeof response.data?.email !== "string") {
      log.warn("Invalid email verification response format")
      return { kind: "problem", code: "unavailable" }
    }
    return { kind: "ok", email: response.data.email }
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
    // The recipient address is NEVER logged (RS-025, 2026-09-15). It is the
    // one raw identifier the app used to ship to Loki, and it belongs to a
    // third party (sponsor, court officer, employer) who never consented to
    // our telemetry. `reportId` already resolves to the recipient via the
    // encrypted report row / the API, so support loses nothing. `hasEmail`
    // keeps the "sent with a blank address" failure mode visible.
    log.info("Sending attendance report to API", {
      reportId: params.id,
      hasEmail: Boolean(params.email),
      fid: params.fid ?? "none",
      attendanceCount: params.attendance?.length ?? 0,
    })

    const response = await this.recoverySkyApi.post<SendReportResponse>("/reports", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Send report failed", {
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

    // No `email` here either — see the note on sendReport's first log line.
    log.info("Report sent successfully", {
      reportId: params.id,
      confirmed: response.data.confirmed,
      error: response.data.error,
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
    log.info("Resending attendance report", { reportId: params.id, uid: params.uid })

    const response = await this.recoverySkyApi.post<SendReportResponse>("/reports", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Resend report failed", {
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
    log.debug("Polling report status", { reportId: params.id })

    const response = await this.recoverySkyApi.post<SendReportResponse>("/reports/status", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Report status poll failed", { problem: problem?.kind, reportId: params.id })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data) {
      log.warn("Invalid report status response format", { reportId: params.id })
      return { kind: "bad-data" }
    }

    // No `email` here — this line fires on every delivery poll (10–60 s
    // until confirmation), so it was the biggest single source of the
    // recipient address in Loki. See the note on sendReport's first log line.
    log.debug("Report status received", {
      reportId: params.id,
      confirmed: response.data.confirmed,
      error: response.data.error,
      confirmation: response.data.confirmation || "none",
    })
    return { kind: "ok", data: response.data }
  }
  /**
   * Check if a user has data in the old Firebase app
   * GET /firebase/user — uid extracted from OAuth token server-side
   */
  async checkFirebaseUser(): Promise<{ kind: "ok" } | GeneralApiProblem> {
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
   * Push new/changed attendance records to cloud backup.
   * POST /sync/attendance — max 200 records per call (SYNC_PUSH_BATCH_MAX);
   * uid/updated are server-stamped. Idempotent: retry freely.
   */
  async pushSyncAttendance(
    records: ServerAttendanceRecord[],
  ): Promise<{ kind: "ok"; data: SyncPushResult } | GeneralApiProblem> {
    log.debug("Pushing sync attendance", { count: records.length })

    const response = await this.recoverySkyApi.post<SyncPushResult>("/sync/attendance", {
      records,
    })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Sync push failed", { problem: problem?.kind, count: records.length })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || typeof response.data.accepted !== "number") {
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }

  /**
   * Pull attendance changes since a cursor.
   * GET /sync/attendance?since=<ms>&limit=<n> — includes deleted:true tombstones.
   */
  async pullSyncAttendance(
    since: number,
    limit = 500,
  ): Promise<{ kind: "ok"; data: SyncPullEnvelope<ServerAttendanceRecord> } | GeneralApiProblem> {
    log.debug("Pulling sync attendance", { since, limit })

    const response = await this.recoverySkyApi.get<SyncPullEnvelope<ServerAttendanceRecord>>(
      "/sync/attendance",
      { since, limit },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Sync attendance pull failed", { problem: problem?.kind, since })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || !Array.isArray(response.data.records)) {
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }

  /**
   * Pull report metadata since a cursor (read-only; reports have no push path).
   * GET /sync/reports?since=<ms>&limit=<n> — html/text never included.
   */
  async pullSyncReports(
    since: number,
    limit = 500,
  ): Promise<{ kind: "ok"; data: SyncPullEnvelope<ServerReportRecord> } | GeneralApiProblem> {
    log.debug("Pulling sync reports", { since, limit })

    const response = await this.recoverySkyApi.get<SyncPullEnvelope<ServerReportRecord>>(
      "/sync/reports",
      { since, limit },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Sync reports pull failed", { problem: problem?.kind, since })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || !Array.isArray(response.data.records)) {
      return { kind: "bad-data" }
    }

    return { kind: "ok", data: response.data }
  }

  /**
   * Fetch one full report (including rendered html/text bodies).
   * GET /reports/:id — the /sync/reports pull is metadata-only, so
   * backfillReportBodies() calls this during sync to complete the local copy.
   */
  async getReport(params: {
    id: string
  }): Promise<{ kind: "ok"; data: ReportDetail } | GeneralApiProblem> {
    log.debug("Fetching report detail", { reportId: params.id })

    const response = await this.recoverySkyApi.get<ReportDetail>(`/reports/${params.id}`)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Report detail fetch failed", { problem: problem?.kind, reportId: params.id })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    if (!response.data || typeof response.data.html !== "string") {
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
      log.debug("Transcription failed", { problem: problem?.kind, status: response.status })
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
    log.debug("Creating reminder", { mid: input.mid, scope: input.scope })

    const response = await this.recoverySkyApi.post<ReminderApiResponse>("/reminders", input)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Create reminder failed", { problem: problem?.kind, mid: input.mid })
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
    log.debug("Updating reminder", { id })

    const response = await this.recoverySkyApi.patch<ReminderApiResponse>(`/reminders/${id}`, input)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Update reminder failed", { problem: problem?.kind, id })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.debug("Reminder updated", { id })
    return { kind: "ok" }
  }

  async deleteReminder(id: string, uid: string): Promise<{ kind: "ok" } | GeneralApiProblem> {
    log.debug("Deleting reminder", { id })

    const response = await this.recoverySkyApi.delete<ReminderApiResponse>(
      `/reminders/${id}`,
      {},
      { data: { uid } },
    )

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Delete reminder failed", { problem: problem?.kind, id })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.debug("Reminder deleted", { id })
    return { kind: "ok" }
  }

  async getReminders(
    uid: string,
  ): Promise<{ kind: "ok"; reminders: ReminderApiResponse[] } | GeneralApiProblem> {
    log.debug("Fetching reminders", { uid })

    const response = await this.recoverySkyApi.get<ReminderApiResponse[]>("/reminders", { uid })

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Fetch reminders failed", { problem: problem?.kind })
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
    // CHANGED 2026-09-22 (RS-043): no `userId` field — it was the first eight
    // characters of the raw Auth0 sub and overwrote the logger's hashed
    // userId on this line. The hashed identity is already on every record.
    log.debug("Registering push token")

    const response = await this.recoverySkyApi.post("/push-tokens/", input)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Push token registration failed", { problem: problem?.kind })
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
    log.info("Sending bug report", { deviceId: params.deviceId, sessionId: params.sessionId })

    const response = await this.recoverySkyApi.post("/issues", params)

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("Bug report send failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    log.info("Bug report sent successfully")
    return { kind: "ok" }
  }

  /**
   * Get current news/announcement for the home screen
   * GET /news
   *
   * CHANGED 2026-09-26: returns `{ kind: "no-content" }` for the server's idle
   * state. The API answers `204 No Content` when nothing is published
   * (api/src/routes/news.ts) — nearly every call in production — and this
   * used to fold that into `bad-data`, so HomeScreen logged a fault kind on
   * 144 of 145 loads in a 6h window and a truly malformed payload was
   * invisible. The split lives in the vitest-covered `classifyNewsPayload`.
   */
  async getNews(): Promise<NewsResult> {
    log.debug("Fetching news from API")

    const response = await this.recoverySkyApi.get<unknown>("/news")

    if (!response.ok) {
      const problem = getGeneralApiProblem(response)
      log.debug("News fetch failed", { problem: problem?.kind })
      if (problem) return problem
      return { kind: "unknown", temporary: true }
    }

    const outcome = classifyNewsPayload(response.status, response.data)

    if (outcome.kind === "no-content") {
      // DEBUG: the normal idle state — a 204 (or an empty 200) outside any
      // news start/end window. HomeScreen just leaves the card hidden.
      log.debug("No active news")
      return outcome
    }

    if (outcome.kind === "bad-data") {
      // WARN, not DEBUG: since 2026-09-26 the idle state is classified
      // separately above, so reaching here means a 2xx with content that is
      // not a news item — a server or proxy fault worth seeing in Loki.
      log.warn("Malformed news payload", { status: response.status })
      return outcome
    }

    log.debug("News received", { title: outcome.title })
    return outcome
  }
}

// Singleton instance of the API for convenience
export const api = new Api()
