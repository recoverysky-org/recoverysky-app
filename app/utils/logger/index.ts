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
 * ```
 *
 * Configuration:
 * - Set EXPO_PUBLIC_OTLP_ENDPOINT in .env when Alloy is online
 * - Set EXPO_PUBLIC_OTLP_API_KEY for authentication
 * - Until configured, logs go to console (dev) or are dropped (prod)
 */

import { createLogger } from "./logger"
import type { LogLevel } from "./types"

export { createLogger } from "./logger"
export { useLogger, useSimpleLogger } from "./useLogger"
export type { Logger, LoggerConfig, LogLevel, LogAttributes } from "./types"

/**
 * Default logger instance
 *
 * Reads config from environment:
 * - EXPO_PUBLIC_OTLP_ENDPOINT: OTLP collector URL (optional until Alloy is online)
 * - EXPO_PUBLIC_OTLP_API_KEY: API key for auth (optional)
 * - EXPO_PUBLIC_LOG_LEVEL: Minimum log level (trace, debug, info, warn, error, fatal)
 */
console.log(
  "[Logger] EXPO_PUBLIC_LOG_LEVEL:",
  process.env.EXPO_PUBLIC_LOG_LEVEL,
  "__DEV__:",
  __DEV__,
)

export const logger = createLogger({
  endpoint: process.env.EXPO_PUBLIC_OTLP_ENDPOINT,
  apiKey: process.env.EXPO_PUBLIC_OTLP_API_KEY,
  minLevel: (process.env.EXPO_PUBLIC_LOG_LEVEL as LogLevel) || undefined,
  serviceName: "recoverysky-hybrid",
  serviceVersion: require("../../../package.json").version,
})
