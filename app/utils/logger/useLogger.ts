/**
 * React hook for component-level logging with automatic context
 *
 * Usage:
 * ```typescript
 * function MyScreen() {
 *   const log = useLogger("MyScreen")
 *
 *   useEffect(() => {
 *     log.info("Screen mounted")
 *     return () => log.info("Screen unmounted")
 *   }, [])
 *
 *   const handlePress = () => {
 *     log.debug("Button pressed", { buttonId: "submit" })
 *   }
 * }
 * ```
 */

import { useMemo, useEffect, useRef } from "react"
import { useRoute } from "@react-navigation/native"

import type { Logger, LogAttributes } from "./types"

import { logger } from "./index"

interface UseLoggerOptions {
  /** Additional attributes to include with every log */
  attributes?: LogAttributes
  /** Log mount/unmount lifecycle events */
  logLifecycle?: boolean
  /** Auto-detect route name from React Navigation (default: true) */
  useRouteName?: boolean
}

/**
 * Hook that provides a logger with automatic component/screen context
 *
 * @param componentName - Name of the component (falls back to route name if available)
 * @param options - Configuration options
 * @returns Logger instance with component context
 *
 * @example
 * // Basic usage
 * const log = useLogger("LoginScreen")
 * log.info("User tapped login")
 *
 * @example
 * // With lifecycle logging
 * const log = useLogger("ProfileScreen", { logLifecycle: true })
 * // Automatically logs mount/unmount
 *
 * @example
 * // With extra attributes
 * const log = useLogger("ItemCard", {
 *   attributes: { itemId: item.id }
 * })
 */
export function useLogger(componentName?: string, options: UseLoggerOptions = {}): Logger {
  const { attributes = {}, logLifecycle = false, useRouteName = true } = options

  // Try to get route name from React Navigation
  let routeName: string | undefined
  try {
    if (useRouteName) {
      // This will throw if not inside a navigator - that's fine
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const route = useRoute()
      routeName = route.name
    }
  } catch {
    // Not inside a navigator, ignore
  }

  const resolvedName = componentName ?? routeName ?? "Unknown"

  // Memoize the child logger to prevent recreation on every render
  const childLogger = useMemo(() => {
    return logger.child({
      component: resolvedName,
      ...attributes,
    })
  }, [resolvedName, JSON.stringify(attributes)])

  // Track if this is the first render for lifecycle logging
  const isMounted = useRef(false)

  useEffect(() => {
    if (!logLifecycle) return

    if (!isMounted.current) {
      childLogger.debug("Component mounted")
      isMounted.current = true
    }

    return () => {
      childLogger.debug("Component unmounted")
    }
  }, [childLogger, logLifecycle])

  return childLogger
}

/**
 * Lightweight hook when you don't need React Navigation integration
 * Avoids the try/catch overhead if you know you're not in a navigator
 */
export function useSimpleLogger(name: string, attributes: LogAttributes = {}): Logger {
  return useMemo(() => {
    return logger.child({ component: name, ...attributes })
  }, [name, JSON.stringify(attributes)])
}
