/**
 * Database Provider Component
 *
 * Wraps the app to ensure the database is ready before rendering children.
 * Handles schema creation and migrations using Drizzle ORM.
 *
 * @example
 * // In app/_layout.tsx or App.tsx
 * import { DatabaseProvider } from "@/db"
 *
 * export default function RootLayout() {
 *   return (
 *     <DatabaseProvider>
 *       <AppNavigator />
 *     </DatabaseProvider>
 *   )
 * }
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { Text, View, ActivityIndicator, StyleSheet } from "react-native"
import { expoDb } from "./provider"
import { seedDatabase, isDatabaseSeeded } from "./seedDatabase"

// Import SQLite schemas for table creation
import {
  meetings,
  schedules,
  meetingTypes,
  meetingTags,
  scheduleMeetings,
  syncQueue,
} from "@common/sqlite"

interface DatabaseContextValue {
  isReady: boolean
  error: Error | null
}

const DatabaseContext = createContext<DatabaseContextValue>({
  isReady: false,
  error: null,
})

/**
 * Hook to check if the database is ready
 */
export function useDatabaseReady(): DatabaseContextValue {
  return useContext(DatabaseContext)
}

interface DatabaseProviderProps {
  children: ReactNode
}

/**
 * Create tables using raw SQL
 * This is a simple approach that creates tables if they don't exist
 */
async function initializeTables(): Promise<void> {
  // Create meetings table
  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      iid TEXT NOT NULL DEFAULT '',
      uid TEXT NOT NULL DEFAULT '',
      zid TEXT NOT NULL DEFAULT '',
      sid TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      verified TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      url TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL DEFAULT '',
      passwordEnc TEXT NOT NULL DEFAULT '',
      fellowship TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT '',
      closed INTEGER NOT NULL DEFAULT 0,
      requiresLogin INTEGER NOT NULL DEFAULT 0,
      restricted INTEGER NOT NULL DEFAULT 0,
      restrictedDescription TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      conferencePhone TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT ''
    )
  `)

  // Create meeting_types junction table
  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS meeting_types (
      id TEXT PRIMARY KEY NOT NULL,
      meeting_id TEXT NOT NULL,
      type TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      UNIQUE(meeting_id, type)
    )
  `)

  // Create meeting_tags junction table
  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS meeting_tags (
      id TEXT PRIMARY KEY NOT NULL,
      meeting_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      UNIQUE(meeting_id, tag)
    )
  `)

  // Create schedules table
  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      zids TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      fellowship TEXT NOT NULL,
      created TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT ''
    )
  `)

  // Create schedule_meetings junction table
  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS schedule_meetings (
      schedule_id TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      PRIMARY KEY (schedule_id, meeting_id),
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    )
  `)

  // Create sync_queue table
  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      retry_count INTEGER DEFAULT 0
    )
  `)

  // Create trexes table
  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS trexes (
      id TEXT PRIMARY KEY NOT NULL,
      coordinate INTEGER NOT NULL DEFAULT 0,
      coordinate_end INTEGER NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL DEFAULT '',
      periodicity INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      dtstart TEXT NOT NULL DEFAULT '',
      dtend TEXT,
      rrule_str TEXT NOT NULL DEFAULT '',
      rrule_json TEXT NOT NULL,
      hour INTEGER,
      minute INTEGER,
      dow INTEGER,
      dom INTEGER,
      month INTEGER
    )
  `)

  // Create indexes for better query performance
  expoDb.execSync(`
    CREATE INDEX IF NOT EXISTS idx_meetings_sid ON meetings(sid);
    CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
    CREATE INDEX IF NOT EXISTS idx_meetings_fellowship ON meetings(fellowship);
    CREATE INDEX IF NOT EXISTS idx_meeting_types_meeting_id ON meeting_types(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_meeting_tags_meeting_id ON meeting_tags(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_meetings_schedule_id ON schedule_meetings(schedule_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_meetings_meeting_id ON schedule_meetings(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_table_record ON sync_queue(table_name, record_id);
    CREATE INDEX IF NOT EXISTS idx_trexes_periodicity ON trexes(periodicity);
    CREATE INDEX IF NOT EXISTS idx_trexes_dow ON trexes(dow);
  `)
}

/**
 * Database Provider Component
 *
 * Initializes the database schema and provides loading/error states.
 */
export function DatabaseProvider({ children }: DatabaseProviderProps): ReactNode {
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [loadingMessage, setLoadingMessage] = useState("Initializing database...")

  useEffect(() => {
    async function init() {
      try {
        await initializeTables()

        // Seed database on first launch
        if (!isDatabaseSeeded()) {
          setLoadingMessage("Loading meeting data...")
          await seedDatabase(expoDb)
        }

        setIsReady(true)
      } catch (e) {
        console.error("[DatabaseProvider] Failed to initialize database:", e)
        setError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    init()
  }, [])

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Database Error</Text>
        <Text style={styles.errorMessage}>{error.message}</Text>
      </View>
    )
  }

  if (!isReady) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>{loadingMessage}</Text>
      </View>
    )
  }

  return (
    <DatabaseContext.Provider value={{ isReady, error }}>
      {children}
    </DatabaseContext.Provider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  errorText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#ff3b30",
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    paddingHorizontal: 32,
  },
})
