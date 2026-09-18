/**
 * Database Provider Component
 *
 * Automatically initializes the database on app startup.
 * Shows loading overlay during initialization via DatabaseLoadingOverlay.
 * Uses encrypted SQLite with key from SecureStore.
 *
 * CHANGED 2026-09-14 (RS-024): the open runs once per mount and, on failure,
 * classifies the error (`dbOpenLogic.ts`), releases the connection, and either
 * schedules a bounded back-off retry (transient kinds: locked keychain,
 * unknown) or stops and waits for the user (wrong / missing key → the overlay
 * offers "Reset local data"). It used to have `status` in `openDb`'s deps and
 * `openDb` in the mount effect's deps, so every failure re-fired the effect
 * instantly: ~29 attempts a second on the same poisoned connection, 320 ERROR
 * lines per device, and no way out but deleting the app.
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
import { AppState, type AppStateStatus } from "react-native"
import type { SQLiteDatabase } from "expo-sqlite"
import { migrations } from "@recoverysky-org/common/sqlite"
import type * as schema from "@recoverysky-org/common/sqlite"
import type { ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite"

import { useAuthenticationStore } from "@/models"
import { setSqliteEncryptionKey } from "@/services/encryption/sqliteKey"
import { logger } from "@/utils/logger"

import { acquireSqliteEncryptionKey } from "./acquireKey"
import {
  classifyDbOpenFailure,
  isTransientFailure,
  nextAutoRetryDelayMs,
  type DbOpenFailureKind,
} from "./dbOpenLogic"
import { feedbackCache } from "./feedbackCache"
import {
  closeDb,
  encryptedDatabaseBytes,
  getDb,
  openDb as openDbProvider,
  rekeyDatabase,
} from "./provider"
import { resetLocalDatabase } from "./resetLocalDatabase"

const log = logger.child({ module: "DatabaseProvider" })

type DbStatus = "closed" | "opening" | "open" | "seeded" | "reencrypting" | "error"

interface DatabaseContextValue {
  /** Current database status */
  status: DbStatus
  /** Error message if status is "error" */
  error: string | null
  /** Why the last open failed, when status is "error" */
  errorKind: DbOpenFailureKind | null
  /** Re-encrypt database with new key (for auth upgrade) */
  rekeyDb: (newKey: string) => Promise<void>
  /** Manual retry of the open (Retry button). No-op unless status is "error". */
  retry: () => void
  /**
   * Delete the local database and its key, then open fresh. The only way out
   * of a wrong/missing-key state; destroys local data, so callers confirm
   * with the user first.
   */
  resetLocalData: () => Promise<void>
}

const DatabaseContext = createContext<DatabaseContextValue>({
  status: "closed",
  error: null,
  errorKind: null,
  rekeyDb: async () => {},
  retry: () => {},
  resetLocalData: async () => {},
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

  // ADDED 2026-09-17 (spec 2 §1.4): resetLocalDatabase() needs to clear the
  // device-owner record as part of teardown; passed in as a callback rather
  // than imported so app/db/ does not grow a runtime dependency on
  // app/models/ (dependency direction — see lint:deps).
  const authStore = useAuthenticationStore()

  const [status, setStatus] = useState<DbStatus>("closed")
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<DbOpenFailureKind | null>(null)
  const dbRef = useRef<{
    expoDb: SQLiteDatabase
    db: ExpoSQLiteDatabase<typeof schema>
  } | null>(null)
  // Mirrors `status` for the guards inside the stable callbacks below. Keeping
  // `status` out of their deps is the whole fix: a dep there recreates the
  // callback on every failure, and the mount effect re-fires with it.
  const statusRef = useRef<DbStatus>("closed")
  // Failed attempts since the last success or manual retry.
  const attemptRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorKindRef = useRef<DbOpenFailureKind | null>(null)

  const transition = useCallback((next: DbStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    log.info("DatabaseProvider mounted", { status })
    return () => {
      log.debug("DatabaseProvider unmounting")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    log.debug("DatabaseProvider status changed", { status, error: error ?? undefined })
  }, [status, error])

  const openDb = useCallback(async () => {
    if (statusRef.current !== "closed" && statusRef.current !== "error") {
      log.debug("Already opened or opening", { status: statusRef.current })
      return
    }
    clearRetryTimer()
    const attempt = attemptRef.current + 1
    // Whether a connection already existed (earlyOpen's singleton, or a
    // previous attempt that failed to release). Logged on failure so the next
    // RS-024 episode can tell a fresh open from a reused handle.
    const hadConnection = getDb().expoDb !== null

    try {
      transition("opening")
      setError(null)
      setErrorKind(null)
      errorKindRef.current = null

      // Load the key from SecureStore, or mint one on a genuine first launch.
      // Refuses to mint over an existing encrypted file (throws
      // SqliteKeyMissingError) — see acquireKey.ts.
      log.info("Getting SQLite encryption key...", { attempt })
      const encryptionKey = await acquireSqliteEncryptionKey()

      // Open the encrypted database
      log.info("Opening encrypted database...")
      dbRef.current = await openDbProvider(encryptionKey)
      log.debug("Database opened, running migrations...")

      // Dynamically import migrator to avoid loading expo-sqlite at startup
      const { migrate } = await import("drizzle-orm/expo-sqlite/migrator")
      await migrate(dbRef.current.db, migrations)

      log.info("Migrations complete", { attempt })
      attemptRef.current = 0
      transition("seeded")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const kind = classifyDbOpenFailure(String(e))
      attemptRef.current = attempt
      const retryInMs = nextAutoRetryDelayMs(kind, attempt)
      // One line per attempt, with the classification and the first line of
      // the error only — the DrizzleError message embeds the full migration
      // SQL, and 300 copies of it per device is what made RS-024 visible.
      log.error("Database open failed", {
        kind,
        attempt,
        hadConnection,
        encryptedFileBytes: encryptedDatabaseBytes(),
        retryInMs: retryInMs ?? undefined,
        error: message.split("\n")[0],
      })
      // Release the connection: SQLCipher latches a codec error on the
      // handle that hit it and expo-sqlite would hand the same cached native
      // handle back, so a retry on it can never succeed.
      dbRef.current = null
      await closeDb().catch((closeErr) => {
        log.warn("closeDb after failed open threw", { error: String(closeErr) })
      })
      setError(message.split("\n")[0])
      setErrorKind(kind)
      errorKindRef.current = kind
      transition("error")
      if (retryInMs !== null) {
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null
          void openDb()
        }, retryInMs)
      }
    }
  }, [clearRetryTimer, transition])

  const rekeyDb = useCallback(
    async (newKey: string) => {
      if (statusRef.current !== "seeded" || !dbRef.current) {
        log.warn("Database not ready for rekey", { status: statusRef.current })
        setError("Database must be seeded before rekeying")
        return
      }

      try {
        transition("reencrypting")
        setError(null)
        log.info("Re-encrypting database with new key...")

        await rekeyDatabase(newKey)

        // Update SecureStore with the new key
        await setSqliteEncryptionKey(newKey)

        log.info("Database re-encrypted successfully")
        transition("seeded")
      } catch (e) {
        log.error("Rekey failed", { error: String(e) })
        setError(e instanceof Error ? e.message : String(e))
        setErrorKind("unknown")
        errorKindRef.current = "unknown"
        transition("error")
      }
    },
    [transition],
  )

  /** Manual retry: resets the back-off budget and opens again. */
  const retry = useCallback(() => {
    if (statusRef.current !== "error") return
    log.info("Manual database open retry")
    attemptRef.current = 0
    void openDb()
  }, [openDb])

  /**
   * Delete the database + key and start fresh. Callers confirm with the user
   * first (DatabaseLoadingOverlay does). Allowed from "error" only — a
   * seeded database is reset through Settings → Delete User Data, which also
   * tears down auth and MMKV state.
   */
  const resetLocalData = useCallback(async () => {
    if (statusRef.current !== "error") {
      log.warn("resetLocalData ignored: database is not in an error state", {
        status: statusRef.current,
      })
      return
    }
    clearRetryTimer()
    try {
      await resetLocalDatabase({ clearOwner: () => authStore.clearOwner() })
    } catch (e) {
      log.error("Local database reset failed", { error: String(e) })
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    attemptRef.current = 0
    await openDb()
  }, [authStore, clearRetryTimer, openDb])

  // Auto-initialize database on mount — once. `openDb` is stable (no state in
  // its deps), so this effect runs exactly one time per mount.
  useEffect(() => {
    log.info("Auto-initializing database...")
    void openDb()
    return clearRetryTimer
  }, [openDb, clearRetryTimer])

  // A locked keychain (app launched in the background while the phone was
  // locked) unlocks with the phone, and the user opening the app is the
  // signal. Retry on the background→active edge for the transient kinds,
  // regardless of where the back-off budget stands.
  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState
    const subscription = AppState.addEventListener("change", (next) => {
      const cameToForeground = previous !== "active" && next === "active"
      previous = next
      if (!cameToForeground) return
      const kind = errorKindRef.current
      if (statusRef.current === "error" && kind && isTransientFailure(kind)) {
        log.info("App became active while database open had failed — retrying", { kind })
        attemptRef.current = 0
        void openDb()
      }
    })
    return () => subscription.remove()
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
    () => ({ status, error, errorKind, rekeyDb, retry, resetLocalData }),
    [status, error, errorKind, rekeyDb, retry, resetLocalData],
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
