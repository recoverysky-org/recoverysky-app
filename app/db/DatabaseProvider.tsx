/**
 * Database Provider Component
 *
 * Wraps the app to ensure the database is ready before rendering children.
 * Uses Drizzle ORM migrations from @common/sqlite for schema management.
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
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator"
import { db, expoDb } from "./provider"
import { seedDatabase, isDatabaseSeeded } from "./seedDatabase"
import { migrations } from "@common/sqlite"

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
 * Database Provider Component
 *
 * Runs Drizzle migrations from @common/sqlite, then seeds data on first launch.
 */
export function DatabaseProvider({ children }: DatabaseProviderProps): ReactNode {
  const { success: migrationSuccess, error: migrationError } = useMigrations(db, migrations)
  const [isSeeded, setIsSeeded] = useState(false)
  const [seedError, setSeedError] = useState<Error | null>(null)
  const [loadingMessage, setLoadingMessage] = useState("Running migrations...")

  // After migrations succeed, seed database if needed
  useEffect(() => {
    if (!migrationSuccess) return

    async function runSeeding() {
      try {
        if (!isDatabaseSeeded()) {
          setLoadingMessage("Loading meeting data...")
          await seedDatabase(expoDb)
        }
        setIsSeeded(true)
      } catch (e) {
        console.error("[DatabaseProvider] Failed to seed database:", e)
        setSeedError(e instanceof Error ? e : new Error(String(e)))
      }
    }

    runSeeding()
  }, [migrationSuccess])

  // Handle migration error
  if (migrationError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Migration Error</Text>
        <Text style={styles.errorMessage}>{migrationError.message}</Text>
      </View>
    )
  }

  // Handle seed error
  if (seedError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Database Error</Text>
        <Text style={styles.errorMessage}>{seedError.message}</Text>
      </View>
    )
  }

  // Show loading while migrations or seeding in progress
  if (!migrationSuccess || !isSeeded) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>{loadingMessage}</Text>
      </View>
    )
  }

  return (
    <DatabaseContext.Provider value={{ isReady: true, error: null }}>
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
