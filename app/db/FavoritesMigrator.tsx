/**
 * FavoritesMigrator Component
 *
 * Runs the one-time favorites → schedule-wide-favorites migration on app
 * startup (see services/favorites/migrateFavorites.ts for the what and why —
 * including the done-flag semantics that make re-mounting harmless).
 * Headless component (renders null), same shape as ReportPollingResumer.
 *
 * Place inside DatabaseProvider:
 * <DatabaseProvider>
 *   ...
 *   <FavoritesMigrator />
 * </DatabaseProvider>
 */

import { useEffect, useRef } from "react"

import { migrateFavoritesToSchedules } from "@/services/favorites"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "FavoritesMigrator" })

export function FavoritesMigrator(): null {
  const { status } = useDatabase()
  const hasRun = useRef(false)

  useEffect(() => {
    if (status === "seeded" && !hasRun.current) {
      hasRun.current = true
      log.debug("Database ready, checking favorites migration")
      void migrateFavoritesToSchedules()
    }
  }, [status])

  return null
}
