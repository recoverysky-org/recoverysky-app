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

class LoggerImpl implements Logger {
  private buffer: LogRecord[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private traceId?: string
  private spanId?: string
  private baseAttributes: LogAttributes
  private context: LoggerContext = {}
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

    const record: LogRecord = {
      timestamp: Date.now(),
      level,
      message,
      attributes: { ...contextAttrs, ...this.baseAttributes, ...attributes },
      ...(this.traceId && { traceId: this.traceId }),
      ...(this.spanId && { spanId: this.spanId }),
    }

    // Console output — enabled in dev always, in release for warn+ to aid debugging
    if ((__DEV__ && this.config.consoleInDev) || LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY["info"]) {
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

    const records = [...this.buffer]
    this.buffer = []

    const result = await sendToOtlp(records, this.config)

    if (!result.ok && __DEV__) {
      // In dev, warn about send failures (but don't lose logs)
      console.warn(`[Logger] Failed to send logs: ${result.error}`)
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
    this.context = { ...this.context, ...context }
  }

  clearContext(): void {
    this.context = {}
  }

  child(attributes: LogAttributes): Logger {
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
