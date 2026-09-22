/**
 * OTLP-compatible logger for React Native
 *
 * Features:
 * - Batches logs and flushes periodically
 * - Ships to OTLP endpoint when configured
 * - Falls back to console in dev when no endpoint
 * - Supports trace context correlation
 * - Child loggers with inherited attributes
 */

import { sendToOtlp } from "./otlp"
import type {
  Logger,
  LoggerConfig,
  LoggerContext,
  LogLevel,
  LogAttributes,
  LogRecord,
} from "./types"

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
}

const CONSOLE_METHODS: Record<LogLevel, keyof Console> = {
  trace: "log",
  debug: "log",
  info: "info",
  warn: "warn",
  error: "error",
  fatal: "error",
}

/**
 * Attribute keys owned by `LoggerContext`. Only the logger may set them, from
 * context — see the RS-043 note in `log()`. `user_id` is the spelling Loki
 * derives from the `user.id` resource attribute, reserved so no caller can
 * forge that one either.
 */
const CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "sessionId",
  "appVersion",
  "deviceId",
  "userId",
  "user_id",
])

function withoutContextKeys(attributes: LogAttributes): LogAttributes {
  let out: LogAttributes | undefined
  for (const key of Object.keys(attributes)) {
    if (!CONTEXT_KEYS.has(key)) continue
    out ??= { ...attributes }
    delete out[key]
  }
  return out ?? attributes
}

class LoggerImpl implements Logger {
  private buffer: LogRecord[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private traceId?: string
  private spanId?: string
  private baseAttributes: LogAttributes
  /**
   * Shared by reference with every child (see `child()`), and only ever
   * mutated in place — never reassigned. `setContext` / `clearContext` on
   * the root must be visible to a child created at module scope, long
   * before app.tsx fills in sessionId/appVersion, deviceId and the hashed
   * userId. CHANGED 2026-09-16 (RS-026): `setContext` used to build a new
   * object, which silently detached every existing child; 12 % of app lines
   * (all of `App`, `deviceId`, `ErrorHandler`, `sentry`) carried no version
   * or session, and only 45 % carried a userId, because module-scope loggers
   * kept a snapshot from import time. Don't "simplify" this back to
   * `this.context = { ...this.context, ...ctx }`.
   */
  private readonly context: LoggerContext
  private hasLoggedStartup = false

  constructor(
    private config: LoggerConfig,
    baseAttributes: LogAttributes = {},
    context: LoggerContext = {},
  ) {
    this.baseAttributes = baseAttributes
    this.context = context
    this.startFlushTimer()
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return

    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Silently ignore flush errors - logs aren't critical path
      })
    }, this.config.flushIntervalMs)
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.minLevel]
  }

  private log(level: LogLevel, message: string, attributes: LogAttributes = {}): void {
    if (!this.shouldLog(level)) return

    // Build context attributes, filtering undefined values
    const contextAttrs: LogAttributes = {}
    if (this.context.sessionId) contextAttrs.sessionId = this.context.sessionId
    if (this.context.appVersion) contextAttrs.appVersion = this.context.appVersion
    if (this.context.deviceId) contextAttrs.deviceId = this.context.deviceId
    // Hashed, never raw — see hashUserId.ts and the LoggerContext doc comment.
    if (this.context.userId) contextAttrs.userId = this.context.userId

    // ADDED 2026-09-22 (RS-043): per-call and child attributes can no longer
    // set the context keys. They used to win the spread below, and the push
    // path's `userId: sub.slice(0, 8) + "..."` replaced the hashed userId on
    // ~950 lines a day — unattributable, and part of the raw sub in Loki.
    // Stripping (rather than just spreading context last) also covers an
    // anonymous user, whose context has no userId for a caller's to lose to.
    // `traceId` is deliberately NOT reserved: the per-request "API request"
    // line carries it as an attribute (see the Tracing note in CLAUDE.md).
    const record: LogRecord = {
      timestamp: Date.now(),
      level,
      message,
      attributes: {
        ...contextAttrs,
        ...withoutContextKeys(this.baseAttributes),
        ...withoutContextKeys(attributes),
      },
      ...(this.traceId && { traceId: this.traceId }),
      ...(this.spanId && { spanId: this.spanId }),
    }

    // Console output — gated on consoleInDev, which was previously dead: this
    // condition's second half was always true (shouldLog() already filtered
    // out anything below minLevel above), so every log hit console regardless
    // of consoleInDev. CHANGED 2026-07-09: actually read consoleInDev so
    // callers can silence console output in dev (e.g. noisy test suites)
    // while still shipping to OTLP.
    if (__DEV__ && this.config.consoleInDev) {
      const method = CONSOLE_METHODS[level]
      const fn = console[method] as (...args: unknown[]) => void
      if (Object.keys(record.attributes).length > 0) {
        fn(`[${level.toUpperCase()}] ${message} ${JSON.stringify(record.attributes)}`)
      } else {
        fn(`[${level.toUpperCase()}] ${message}`)
      }
    }

    // Buffer for OTLP shipping
    this.buffer.push(record)

    // Flush if buffer is full
    if (this.buffer.length >= this.config.batchSize) {
      this.flush().catch(() => {
        // Silently ignore
      })
    }
  }

  trace(message: string, attributes?: LogAttributes): void {
    this.log("trace", message, attributes)
  }

  debug(message: string, attributes?: LogAttributes): void {
    this.log("debug", message, attributes)
  }

  info(message: string, attributes?: LogAttributes): void {
    this.log("info", message, attributes)
  }

  warn(message: string, attributes?: LogAttributes): void {
    this.log("warn", message, attributes)
  }

  error(message: string, attributes?: LogAttributes): void {
    this.log("error", message, attributes)
  }

  fatal(message: string, attributes?: LogAttributes): void {
    this.log("fatal", message, attributes)
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    // No endpoint = OTLP not configured, discard buffer
    if (!this.config.endpoint) {
      this.buffer = []
      return
    }

    // Endpoint configured but no API key yet — hold buffer until updateConfig provides it
    if (!this.config.apiKey) return

    const records = [...this.buffer]
    this.buffer = []

    // Pass current LoggerContext to OTLP so deviceId/sessionId/appVersion are
    // emitted as canonical OTel resource attributes (device.id, session.id,
    // service.version). This lets server-side bridges (Alloy → Loki) promote
    // them to labels / structured metadata without custom transforms. The
    // same fields stay on each LogRecord's attributes too — see otlp.ts.
    const result = await sendToOtlp(records, this.config, this.context)

    if (!result.ok) {
      // Re-queue failed records for retry on next flush
      this.buffer = [...records, ...this.buffer]

      // Cap buffer to prevent unbounded growth if endpoint is persistently down
      if (this.buffer.length > 500) {
        this.buffer = this.buffer.slice(-500)
      }

      if (__DEV__) {
        console.warn(`[Logger] Failed to send ${records.length} logs, re-queued: ${result.error}`)
      }
    }
  }

  setTraceContext(traceId: string, spanId: string): void {
    this.traceId = traceId
    this.spanId = spanId
  }

  clearTraceContext(): void {
    this.traceId = undefined
    this.spanId = undefined
  }

  setContext(context: Partial<LoggerContext>): void {
    // In place, so children created earlier see it (RS-026 — see the field
    // doc). A key explicitly passed as `undefined` still lands as undefined,
    // which `log()` filters out; that is how app.tsx clears userId on
    // sign-out.
    Object.assign(this.context, context)
  }

  getContext(): LoggerContext {
    return { ...this.context }
  }

  clearContext(): void {
    // Delete keys rather than reassign — same sharing rule as setContext.
    for (const key of Object.keys(this.context)) {
      delete this.context[key as keyof LoggerContext]
    }
  }

  child(attributes: LogAttributes): Logger {
    // The child receives the SAME context object, not a copy — that is the
    // whole mechanism by which a module-scope child stays current.
    return new LoggerImpl(this.config, { ...this.baseAttributes, ...attributes }, this.context)
  }

  logStartup(): void {
    if (this.hasLoggedStartup) return
    this.hasLoggedStartup = true

    this.info("Logger initialized", {
      instrumentationScope: "recoverysky-logger",
      instrumentationVersion: "1.0.0",
      serviceName: this.config.serviceName,
      serviceVersion: this.config.serviceVersion,
    })
  }

  updateConfig(config: Partial<Pick<LoggerConfig, "apiKey" | "endpoint">>): void {
    if (config.apiKey !== undefined) this.config.apiKey = config.apiKey
    if (config.endpoint !== undefined) this.config.endpoint = config.endpoint
    // Flush buffered logs now that config may be complete
    this.flush().catch(() => {})
  }

  /**
   * Cleanup - call on app unmount
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    // Final flush
    this.flush().catch(() => {})
  }
}

/**
 * Create a configured logger instance
 */
export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
  const fullConfig: LoggerConfig = {
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    minLevel: config.minLevel ?? (__DEV__ ? "debug" : "info"),
    batchSize: config.batchSize ?? 10,
    flushIntervalMs: config.flushIntervalMs ?? 5000,
    consoleInDev: config.consoleInDev ?? true,
    serviceName: config.serviceName ?? "recoverysky-app",
    serviceVersion: config.serviceVersion ?? "0.0.1",
  }

  return new LoggerImpl(fullConfig)
}
