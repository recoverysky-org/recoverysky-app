/**
 * Logger module - OTLP-compatible logging for RecoverySky
 *
 * Usage:
 * ```typescript
 * import { logger, useLogger } from "@/utils/logger"
 *
 * // Direct logging
 * logger.info("User logged in", { userId: "123" })
 * logger.error("API call failed", { endpoint: "/users", status: 500 })
 *
 * // In React components
 * function MyScreen() {
 *   const log = useLogger("MyScreen")
 *   log.info("Screen loaded")
 * }
 *
 * // Child logger with context
 * const authLogger = logger.child({ module: "auth" })
 * authLogger.info("Token refreshed")
 *
 * // Set persistent context (userId, deviceId, sessionId, appVersion)
 * logger.setContext({ userId: "user_123", deviceId: "device_abc" })
 * logger.info("Action") // includes userId and deviceId automatically
 * ```
 *
 * Configuration:
 * - Set EXPO_PUBLIC_OTLP_ENDPOINT in .env when Alloy is online
 * - API key is fetched from /config endpoint and applied via logger.updateConfig()
 * - Logs buffer until API key arrives, then flush automatically
 * - Console output is always available (all levels in dev, info+ in prod)
 */

import { createLogger } from "./logger"
import type { LogLevel } from "./types"

export { createLogger } from "./logger"
export { useLogger, useSimpleLogger } from "./useLogger"
export type { Logger, LoggerConfig, LoggerContext, LogLevel, LogAttributes } from "./types"

/**
 * Default logger instance
 *
 * Reads config from environment:
 * - EXPO_PUBLIC_OTLP_ENDPOINT: OTLP collector URL (optional until Alloy is online)
 * - EXPO_PUBLIC_LOG_LEVEL: Minimum log level (trace, debug, info, warn, error, fatal)
 *
 * API key is provided at runtime via updateConfig() after /config endpoint responds.
 * Logs buffer in memory until the key arrives, then flush automatically.
 */
export const logger = createLogger({
  endpoint: process.env.EXPO_PUBLIC_OTLP_ENDPOINT,
  minLevel: (process.env.EXPO_PUBLIC_LOG_LEVEL as LogLevel) || undefined,
  serviceName: "recoverysky-app",
  serviceVersion: require("../../../package.json").version,
  batchSize: __DEV__ ? 10 : 10,
  flushIntervalMs: __DEV__ ? 3000 : 5000,
})

// Log instrumentation scope once at startup
logger.logStartup()
