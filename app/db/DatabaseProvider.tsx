/**
 * Database Provider Component
 *
 * Automatically initializes and seeds the database on app startup.
 * Shows loading overlay during initialization via DatabaseLoadingOverlay.
 */

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react"
import type { SQLiteDatabase } from "expo-sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"
import { openDb as openDbProvider } from "./provider"
import { seedDatabase, isDatabaseSeeded } from "./seedDatabase"
import { feedbackCache } from "./feedbackCache"
import { migrations } from "@sqlite"
import type * as schema from "@sqlite"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "DatabaseProvider" })

type DbStatus = "closed" | "opening" | "open" | "seeding" | "seeded" | "error"

interface DatabaseContextValue {
  /** Current database status */
  status: DbStatus
  /** Error message if status is "error" */
  error: string | null
  /** Run migrations to create tables */
  openDb: () => Promise<void>
  /** Seed the database with initial data */
  seedDb: () => Promise<void>
}

const DatabaseContext = createContext<DatabaseContextValue>({
  status: "closed",
  error: null,
  openDb: async () => {},
  seedDb: async () => {},
})

/**
 * Hook to access database controls
 */
export function useDatabase(): DatabaseContextValue {
  return useContext(DatabaseContext)
}

/**
 * @deprecated Use useDatabase() instead
 */
export function useDatabaseReady(): { isReady: boolean; error: Error | null } {
  const { status, error } = useDatabase()
  return {
    isReady: status === "open" || status === "seeded",
    error: error ? new Error(error) : null,
  }
}

interface DatabaseProviderProps {
  children: ReactNode
}

/**
 * Database Provider Component
 *
 * Automatically opens database and runs migrations on mount.
 * Auto-seeds if not already seeded (checked via MMKV flag).
 */
export function DatabaseProvider({ children }: DatabaseProviderProps): ReactNode {
  log.debug("DatabaseProvider initializing")

  const [status, setStatus] = useState<DbStatus>("closed")
  const [error, setError] = useState<string | null>(null)
  const dbRef = useRef<{
    expoDb: SQLiteDatabase
    db: ExpoSQLiteDatabase<typeof schema>
  } | null>(null)

  useEffect(() => {
    log.info("DatabaseProvider mounted", { status })
    return () => {
      log.debug("DatabaseProvider unmounting")
    }
  }, [])

  useEffect(() => {
    log.debug("DatabaseProvider status changed", { status, error: error ?? undefined })
  }, [status, error])

  const openDb = useCallback(async () => {
    if (status !== "closed" && status !== "error") {
      log.debug("Already opened or opening", { status })
      return
    }

    try {
      setStatus("opening")
      setError(null)
      log.info("Opening database...")

      // Open the database (this is where expo-sqlite is actually used)
      dbRef.current = await openDbProvider()
      log.debug("Database opened, running migrations...")

      // Dynamically import migrator to avoid loading expo-sqlite at startup
      const { migrate } = await import("drizzle-orm/expo-sqlite/migrator")
      await migrate(dbRef.current.db, migrations)

      log.info("Migrations complete")
      setStatus("open")
    } catch (e) {
      log.error("Database open failed", { error: String(e) })
      setError(e instanceof Error ? e.message : String(e))
      setStatus("error")
    }
  }, [status])

  const seedDb = useCallback(async () => {
    if (status !== "open" || !dbRef.current) {
      log.warn("Database not open, cannot seed", { status })
      setError("Open database first")
      return
    }

    if (isDatabaseSeeded()) {
      log.debug("Database already seeded")
      setStatus("seeded")
      return
    }

    try {
      setStatus("seeding")
      setError(null)
      log.info("Seeding database...")

      await seedDatabase(dbRef.current.expoDb)

      log.info("Seeding complete")
      setStatus("seeded")
    } catch (e) {
      log.error("Seeding failed", { error: String(e) })
      setError(e instanceof Error ? e.message : String(e))
      setStatus("error")
    }
  }, [status])

  // Auto-initialize database on mount
  useEffect(() => {
    log.info("Auto-initializing database...")
    openDb()
  }, [openDb])

  // Auto-seed when database is open
  useEffect(() => {
    if (status === "open") {
      log.info("Database open, auto-seeding...")
      seedDb()
    }
  }, [status, seedDb])

  // Load feedback cache when database is seeded
  useEffect(() => {
    if (status === "seeded" && !feedbackCache.isLoaded()) {
      log.info("Database seeded, loading feedback cache...")
      feedbackCache.loadAll()
    }
  }, [status])

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<DatabaseContextValue>(
    () => ({ status, error, openDb, seedDb }),
    [status, error, openDb, seedDb],
  )

  log.debug("DatabaseProvider rendering", { status })

  // Block children until database is fully ready (seeded)
  // This prevents "database not ready" errors in child components
  const isReady = status === "seeded"

  return (
    <DatabaseContext.Provider value={contextValue}>
      {isReady ? children : null}
    </DatabaseContext.Provider>
  )
}
