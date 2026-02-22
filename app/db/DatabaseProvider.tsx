/**
 * Database Provider Component
 *
 * Automatically initializes the database on app startup.
 * Shows loading overlay during initialization via DatabaseLoadingOverlay.
 * Uses encrypted SQLite with key from SecureStore.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type ReactNode,
} from "react"
import type { SQLiteDatabase } from "expo-sqlite"
import { migrations } from "@recoverysky-org/common/sqlite"
import type * as schema from "@recoverysky-org/common/sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"

import { getSqliteEncryptionKey, setSqliteEncryptionKey } from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { feedbackCache } from "./feedbackCache"
import { openDb as openDbProvider, rekeyDatabase } from "./provider"

const log = logger.child({ module: "DatabaseProvider" })

type DbStatus = "closed" | "opening" | "open" | "seeded" | "reencrypting" | "error"

interface DatabaseContextValue {
  /** Current database status */
  status: DbStatus
  /** Error message if status is "error" */
  error: string | null
  /** Re-encrypt database with new key (for auth upgrade) */
  rekeyDb: (newKey: string) => Promise<void>
}

const DatabaseContext = createContext<DatabaseContextValue>({
  status: "closed",
  error: null,
  rekeyDb: async () => {},
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
    isReady: status === "seeded",
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

      // Get or generate encryption key from SecureStore
      log.info("Getting SQLite encryption key...")
      const encryptionKey = await getSqliteEncryptionKey()

      // Open the encrypted database
      log.info("Opening encrypted database...")
      dbRef.current = await openDbProvider(encryptionKey)
      log.debug("Database opened, running migrations...")

      // Dynamically import migrator to avoid loading expo-sqlite at startup
      const { migrate } = await import("drizzle-orm/expo-sqlite/migrator")
      await migrate(dbRef.current.db, migrations)

      log.info("Migrations complete")
      setStatus("seeded")
    } catch (e) {
      log.error("Database open failed", { error: String(e) })
      setError(e instanceof Error ? e.message : String(e))
      setStatus("error")
    }
  }, [status])

  const rekeyDb = useCallback(
    async (newKey: string) => {
      if (status !== "seeded" || !dbRef.current) {
        log.warn("Database not ready for rekey", { status })
        setError("Database must be seeded before rekeying")
        return
      }

      try {
        setStatus("reencrypting")
        setError(null)
        log.info("Re-encrypting database with new key...")

        await rekeyDatabase(newKey)

        // Update SecureStore with the new key
        await setSqliteEncryptionKey(newKey)

        log.info("Database re-encrypted successfully")
        setStatus("seeded")
      } catch (e) {
        log.error("Rekey failed", { error: String(e) })
        setError(e instanceof Error ? e.message : String(e))
        setStatus("error")
      }
    },
    [status],
  )

  // Auto-initialize database on mount
  useEffect(() => {
    log.info("Auto-initializing database...")
    openDb()
  }, [openDb])

  // Load feedback cache when database is ready
  useEffect(() => {
    if (status === "seeded" && !feedbackCache.isLoaded()) {
      log.info("Database seeded, loading feedback cache...")
      feedbackCache.loadAll()
    }
  }, [status])

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<DatabaseContextValue>(
    () => ({ status, error, rekeyDb }),
    [status, error, rekeyDb],
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
