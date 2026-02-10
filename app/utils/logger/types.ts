/**
 * Logger types for OTLP-compatible logging
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal"

export interface LogAttributes {
  [key: string]: string | number | boolean | undefined
}

export interface LogRecord {
  timestamp: number
  level: LogLevel
  message: string
  attributes: LogAttributes
  traceId?: string
  spanId?: string
}

export interface LoggerConfig {
  /** OTLP endpoint URL. If empty/undefined, logs are dropped (or console in dev) */
  endpoint?: string
  /** API key for authentication */
  apiKey?: string
  /** Minimum log level to capture */
  minLevel: LogLevel
  /** Max logs to batch before flush */
  batchSize: number
  /** Flush interval in ms */
  flushIntervalMs: number
  /** Include console output in dev */
  consoleInDev: boolean
  /** Service name for OTLP resource */
  serviceName: string
  /** Service version */
  serviceVersion: string
}

/** Context attributes that persist across all log calls */
export interface LoggerContext {
  sessionId?: string
  appVersion?: string
}

export interface Logger {
  trace(message: string, attributes?: LogAttributes): void
  debug(message: string, attributes?: LogAttributes): void
  info(message: string, attributes?: LogAttributes): void
  warn(message: string, attributes?: LogAttributes): void
  error(message: string, attributes?: LogAttributes): void
  fatal(message: string, attributes?: LogAttributes): void
  /** Force flush pending logs */
  flush(): Promise<void>
  /** Set trace context for correlation */
  setTraceContext(traceId: string, spanId: string): void
  /** Clear trace context */
  clearTraceContext(): void
  /** Set persistent context (userId, deviceId, sessionId, appVersion) */
  setContext(context: Partial<LoggerContext>): void
  /** Clear persistent context */
  clearContext(): void
  /** Create a child logger with additional attributes */
  child(attributes: LogAttributes): Logger
  /** Log instrumentation scope info once at startup */
  logStartup(): void
  /** Update config after initialization (e.g. server-provided API key) */
  updateConfig(config: Partial<Pick<LoggerConfig, "apiKey" | "endpoint">>): void
  /** Cleanup resources - call on app unmount */
  destroy(): void
}
