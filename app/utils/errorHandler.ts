/**
 * Global Error Handler
 *
 * Catches unhandled errors and promise rejections, logs them via OTLP,
 * and ensures logs are flushed before the app crashes.
 *
 * Usage: Call setupGlobalErrorHandler() early in app initialization.
 */

import { logger } from "./logger"

const log = logger.child({ module: "ErrorHandler" })

/** Error metadata for structured logging */
interface ErrorMeta {
  source: "uncaught" | "unhandledRejection" | "errorBoundary" | "native"
  componentStack?: string
  isFatal?: boolean
}

/** Track if handlers are already installed */
let isInstalled = false

/**
 * Normalize any thrown value to an Error object
 */
function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === "string") return new Error(value)
  if (value && typeof value === "object" && "message" in value) {
    const err = new Error(String((value as { message: unknown }).message))
    if ("stack" in value) err.stack = String((value as { stack: unknown }).stack)
    return err
  }
  return new Error(String(value))
}

/** Log attributes compatible type */
type ErrorAttributes = Record<string, string | number | boolean | undefined>

/**
 * Format error for logging with full context
 */
function formatError(error: Error, meta: ErrorMeta): ErrorAttributes {
  return {
    source: meta.source,
    name: error.name,
    message: error.message,
    stack: error.stack?.split("\n").slice(0, 10).join("\n"), // Limit stack depth
    componentStack: meta.componentStack,
    isFatal: meta.isFatal,
  }
}

/**
 * Log error and flush - the core handler
 */
async function handleError(error: Error, meta: ErrorMeta): Promise<void> {
  const level = meta.isFatal ? "fatal" : "error"
  const formatted = formatError(error, meta)

  if (level === "fatal") {
    log.fatal(`Unhandled ${meta.source}: ${error.message}`, formatted)
  } else {
    log.error(`Unhandled ${meta.source}: ${error.message}`, formatted)
  }

  // Flush immediately - we may crash soon
  try {
    await logger.flush()
  } catch {
    // Can't do much if flush fails
  }
}

/**
 * Handle uncaught synchronous errors
 */
function handleUncaughtError(event: ErrorEvent): void {
  const error = event.error ?? new Error(event.message)
  handleError(toError(error), { source: "uncaught", isFatal: true })
}

/**
 * Handle unhandled promise rejections
 */
function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  const error = toError(event.reason)
  handleError(error, { source: "unhandledRejection", isFatal: false })

  // Prevent default console error in development
  if (__DEV__) {
    event.preventDefault()
  }
}

/**
 * Setup global error handlers
 *
 * Safe to call multiple times - will only install once.
 */
export function setupGlobalErrorHandler(): void {
  if (isInstalled) return
  isInstalled = true

  // Web/Hermes global error handlers
  if (typeof globalThis !== "undefined") {
    // Uncaught errors
    globalThis.addEventListener?.("error", handleUncaughtError)

    // Unhandled promise rejections
    globalThis.addEventListener?.("unhandledrejection", handleUnhandledRejection)
  }

  // React Native specific: ErrorUtils for native error handling
  if (typeof ErrorUtils !== "undefined") {
    const originalHandler = ErrorUtils.getGlobalHandler()

    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      handleError(error, { source: "native", isFatal: isFatal ?? true })

      // Call original handler (usually shows red screen in dev)
      originalHandler?.(error, isFatal)
    })
  }

  log.info("Global error handlers installed")
}

/**
 * Report an error from ErrorBoundary
 *
 * Called when React catches a rendering error.
 */
export function reportErrorBoundary(error: Error, componentStack?: string): void {
  handleError(error, {
    source: "errorBoundary",
    componentStack,
    isFatal: false, // ErrorBoundary catches it, so not fatal to app
  })
}

/**
 * Wrap an async function with error handling
 *
 * Use for fire-and-forget operations that should still log errors.
 *
 * @example
 * ```ts
 * // Instead of .catch(() => {})
 * safeAsync(async () => {
 *   await someOperation()
 * })
 * ```
 */
export function safeAsync<T>(fn: () => Promise<T>, context?: string): Promise<T | undefined> {
  return fn().catch((error: unknown) => {
    const err = toError(error)
    log.error(context ?? "Async operation failed", {
      name: err.name,
      message: err.message,
    })
    return undefined
  })
}

/**
 * Wrap an async function, log errors, but rethrow
 *
 * Use when you want errors logged but still want to handle them upstream.
 *
 * @example
 * ```ts
 * const result = await traced(() => api.fetch(), "API fetch")
 * ```
 */
export async function traced<T>(fn: () => Promise<T>, context: string): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const err = toError(error)
    log.error(`${context} failed`, {
      name: err.name,
      message: err.message,
    })
    throw error
  }
}

// Re-export toError for use elsewhere
export { toError }
