/**
 * Database Provider Component
 *
 * Provides manual database control via context.
 * App boots immediately - user clicks "Open Db" to run migrations,
 * then "Seed Db" to populate data.
 */

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react"
import type { SQLiteDatabase } from "expo-sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"
import { migrate } from "drizzle-orm/expo-sqlite/migrator"
import { openDb as openDbProvider } from "./provider"
import { seedDatabase, isDatabaseSeeded } from "./seedDatabase"
import { migrations } from "@sqlite"
import type * as schema from "@sqlite"

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
 * Renders children immediately. Exposes openDb() and seedDb() for manual control.
 */
export function DatabaseProvider({ children }: DatabaseProviderProps): ReactNode {
  const [status, setStatus] = useState<DbStatus>("closed")
  const [error, setError] = useState<string | null>(null)
  const dbRef = useRef<{
    expoDb: SQLiteDatabase
    db: ExpoSQLiteDatabase<typeof schema>
  } | null>(null)

  const openDb = useCallback(async () => {
    if (status !== "closed" && status !== "error") {
      console.log("[DatabaseProvider] Already opened or opening")
      return
    }

    try {
      setStatus("opening")
      setError(null)
      console.log("[DatabaseProvider] Opening database...")

      // Open the database (this is where expo-sqlite is actually used)
      dbRef.current = await openDbProvider()

      console.log("[DatabaseProvider] Running migrations...")
      await migrate(dbRef.current.db, migrations)

      console.log("[DatabaseProvider] Migrations complete")
      setStatus("open")
    } catch (e) {
      console.error("[DatabaseProvider] Failed:", e)
      setError(e instanceof Error ? e.message : String(e))
      setStatus("error")
    }
  }, [status])

  const seedDb = useCallback(async () => {
    if (status !== "open" || !dbRef.current) {
      console.log("[DatabaseProvider] Database not open, cannot seed")
      setError("Open database first")
      return
    }

    if (isDatabaseSeeded()) {
      console.log("[DatabaseProvider] Already seeded")
      setStatus("seeded")
      return
    }

    try {
      setStatus("seeding")
      setError(null)
      console.log("[DatabaseProvider] Seeding database...")

      await seedDatabase(dbRef.current.expoDb)

      console.log("[DatabaseProvider] Seeding complete")
      setStatus("seeded")
    } catch (e) {
      console.error("[DatabaseProvider] Seeding failed:", e)
      setError(e instanceof Error ? e.message : String(e))
      setStatus("error")
    }
  }, [status])

  return (
    <DatabaseContext.Provider value={{ status, error, openDb, seedDb }}>
      {children}
    </DatabaseContext.Provider>
  )
}
