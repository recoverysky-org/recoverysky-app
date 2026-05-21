/**
 * Sentry initialization, PII scrubbing, and OTLP-logger bridge.
 *
 * Loaded once at app cold start (see app.tsx) BEFORE any other init so
 * Sentry can capture crashes that happen during bootstrap itself —
 * including the bootstrap functions Sentry instruments (fetch, console).
 *
 * Why a wrapper file instead of calling Sentry.init in app.tsx directly:
 *   - PII scrubbing rules live with the integration, not the entrypoint.
 *   - The OTLP→Sentry bridge below means the rest of the app continues to
 *     call `logger.error` / `logger.fatal` and we forward those calls into
 *     Sentry as captureException / captureMessage. Bridge stays here so it
 *     can be tweaked without touching every call site.
 *   - Tests / dev builds can stub this module to no-op without affecting
 *     the rest of the bootstrap.
 *
 * What we DO NOT capture:
 *   - User email or short name. `Sentry.setUser` only ever receives the
 *     opaque deviceId / userId (stable but non-personal).
 *   - `?pwd=` query params on Zoom URLs. Stripped from breadcrumbs and
 *     event request URLs in beforeBreadcrumb / beforeSend.
 *   - `Authorization` headers. Stripped from request breadcrumbs.
 */

import * as Sentry from "@sentry/react-native"
import * as Updates from "expo-updates"

import { logger } from "@/utils/logger"
import type { LogAttributes } from "@/utils/logger"

const log = logger.child({ module: "sentry" })

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN

/**
 * OTA counter baked into this JS bundle (the `update` field in package.json,
 * reset to "0" on each native version bump). Combined with `runtimeVersion`
 * as the Sentry release, the pair `4.5.0` + `0` uniquely and *readably*
 * identifies a build — far easier to reason about than the opaque
 * `Updates.updateId` UUID we used to pass as `dist`. Always populated
 * (even for embedded, non-OTA launches), unlike `updateId` which is null
 * until an OTA is applied.
 */
const OTA_COUNTER: string = require("../../../package.json").update ?? "0"

// Sensitive query params we strip from any URL Sentry sees (breadcrumbs +
// event request data). Kept narrow on purpose — over-eager scrubbing makes
// stack traces useless. Add new keys here as the threat surface grows.
const SENSITIVE_QUERY_KEYS = new Set([
  "pwd", // Zoom join URL passcode (encrypted or plaintext)
  "password",
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "code", // OAuth authorization codes
  "api_key",
  "key",
])

const SENSITIVE_HEADER_KEYS = new Set([
  "authorization",
  "x-device-token",
  "x-api-key",
  "cookie",
  "set-cookie",
])

function scrubUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== "string") return url
  try {
    const parsed = new URL(url)
    let mutated = false
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[Filtered]")
        mutated = true
      }
    }
    return mutated ? parsed.toString() : url
  } catch {
    // Not a parseable URL (e.g., a custom scheme path); leave alone.
    return url
  }
}

function scrubHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") return headers
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? "[Filtered]" : value
  }
  return out
}

/**
 * Initialize Sentry. Call once, as early as possible in app.tsx — before
 * any code that might throw or before any data we want as breadcrumbs.
 * Safe to call when DSN is unset (no-op + log).
 */
export function initSentry(): void {
  if (!DSN) {
    log.info("Sentry DSN not configured, skipping init")
    return
  }

  Sentry.init({
    dsn: DSN,

    // Tracks crashes against the OTA bundle the user is running. `release`
    // is the native runtimeVersion (e.g. "4.5.0"); `dist` is the OTA counter
    // ("0", "1", …) baked into the JS bundle. Together they read as
    // "4.5.0-0" in Sentry — human-readable and stable, instead of the opaque
    // updateId hash we used before.
    release: Updates.runtimeVersion ?? undefined,
    dist: OTA_COUNTER,

    // Tracing off by default to keep cost predictable. Flip to 0.1 when
    // you want span data in the Performance dashboard.
    tracesSampleRate: 0,
    enableAutoPerformanceTracing: false,

    // Auto-capture is fine for breadcrumbs; the PII filter below scrubs
    // sensitive data before send.
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30_000,

    // Sentry's default integrations include native-crash capture, JS error
    // capture, unhandled-rejection capture, and the React Native console
    // breadcrumb integration. We don't disable any here — they're the
    // whole reason we installed Sentry.

    beforeBreadcrumb: (breadcrumb) => {
      // Scrub URLs in fetch / xhr / navigation breadcrumbs.
      if (breadcrumb.data && typeof breadcrumb.data === "object") {
        const data = breadcrumb.data as Record<string, unknown>
        if (typeof data.url === "string") {
          data.url = scrubUrl(data.url)
        }
        if (typeof data.to === "string") {
          data.to = scrubUrl(data.to)
        }
        if (typeof data.from === "string") {
          data.from = scrubUrl(data.from)
        }
      }
      return breadcrumb
    },

    beforeSend: (event) => {
      // Strip request URLs + headers from event-level request data.
      if (event.request) {
        if (event.request.url) {
          event.request.url = scrubUrl(event.request.url)
        }
        if (event.request.headers) {
          event.request.headers = scrubHeaders(
            event.request.headers as Record<string, unknown>,
          ) as typeof event.request.headers
        }
      }
      // Defensive: ensure user object never contains email / name even if
      // someone calls Sentry.setUser elsewhere with bad data.
      if (event.user) {
        delete event.user.email
        delete event.user.username
        delete event.user.ip_address
      }
      return event
    },
  })

  // Tag every event with the env-flavored channel so we can slice
  // dev / preview / production crashes in the Sentry UI.
  Sentry.setTag("environment", __DEV__ ? "development" : "production")

  bridgeLoggerToSentry()

  log.info("Sentry initialized", {
    release: Updates.runtimeVersion ?? "",
    dist: OTA_COUNTER,
  })
}

/**
 * Set the (opaque) user ID on Sentry events. Call after auth resolves.
 * NEVER pass email, name, or any PII — beforeSend strips them anyway, but
 * we want the call sites themselves to be honest about what we send.
 */
export function setSentryUser(userId: string | null): void {
  if (!DSN) return
  if (userId) {
    Sentry.setUser({ id: userId })
  } else {
    Sentry.setUser(null)
  }
}

/**
 * Bridges OTLP logger events into Sentry. The two systems serve different
 * purposes: OTLP is the canonical operational log sink (Alloy → Loki),
 * Sentry is the crash + structured error event store with stacks and
 * breadcrumbs. We want every error/fatal log to ALSO surface as a Sentry
 * event so the alert pipeline catches it without duplicate call sites.
 *
 * info/warn/debug calls become breadcrumbs so the timeline leading up to
 * a crash is reconstructable in Sentry's UI.
 */
function bridgeLoggerToSentry(): void {
  const original = {
    error: logger.error.bind(logger),
    fatal: logger.fatal.bind(logger),
    warn: logger.warn.bind(logger),
    info: logger.info.bind(logger),
    debug: logger.debug.bind(logger),
  }

  logger.error = (message: string, attributes?: LogAttributes) => {
    original.error(message, attributes)
    try {
      Sentry.captureMessage(message, {
        level: "error",
        contexts: attributes ? { logAttributes: attributes } : undefined,
      })
    } catch {
      // Sentry capture must never throw back into the logger.
    }
  }

  logger.fatal = (message: string, attributes?: LogAttributes) => {
    original.fatal(message, attributes)
    try {
      Sentry.captureMessage(message, {
        level: "fatal",
        contexts: attributes ? { logAttributes: attributes } : undefined,
      })
    } catch {
      // No-op.
    }
  }

  logger.warn = (message: string, attributes?: LogAttributes) => {
    original.warn(message, attributes)
    Sentry.addBreadcrumb({
      level: "warning",
      message,
      data: attributes,
      category: "log",
    })
  }

  logger.info = (message: string, attributes?: LogAttributes) => {
    original.info(message, attributes)
    Sentry.addBreadcrumb({
      level: "info",
      message,
      data: attributes,
      category: "log",
    })
  }

  logger.debug = (message: string, attributes?: LogAttributes) => {
    original.debug(message, attributes)
    Sentry.addBreadcrumb({
      level: "debug",
      message,
      data: attributes,
      category: "log",
    })
  }
}

/**
 * Higher-order component to wrap the App root. Sentry uses this to attach
 * the React error boundary + touch event tracking. Pass through when DSN
 * is unset.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapApp<P extends Record<string, any>>(
  component: React.ComponentType<P>,
): React.ComponentType<P> {
  if (!DSN) return component
  return Sentry.wrap(component) as unknown as React.ComponentType<P>
}
