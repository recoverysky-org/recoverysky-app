/**
 * Database Loading Overlay
 *
 * Shows a loading overlay during database initialization and seeding.
 * Displays appropriate message based on current database status.
 * Also controls splash screen visibility.
 */

import { useEffect, useRef } from "react"
import { Modal, View, ViewStyle, TextStyle, ActivityIndicator } from "react-native"
import * as SplashScreen from "expo-splash-screen"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "DatabaseLoadingOverlay" })

/**
 * Overlay component that shows during database initialization.
 * Place inside DatabaseProvider to access database status.
 */
export function DatabaseLoadingOverlay() {
  const { themed, theme } = useAppTheme()
  const { status, error } = useDatabase()
  const hasHiddenSplash = useRef(false)

  // Hide splash screen only once when database is fully seeded
  useEffect(() => {
    if (status === "seeded" && !hasHiddenSplash.current) {
      hasHiddenSplash.current = true
      log.info("Database seeded, hiding splash screen")
      SplashScreen.hideAsync().catch((err) => {
        log.warn("Failed to hide splash screen", { error: String(err) })
      })
    }
  }, [status])

  // Only show overlay during opening, reencrypting, or error states
  // Note: "seeding" is instant (no data to seed) so no overlay needed
  const showOverlay = status === "opening" || status === "reencrypting" || status === "error"

  if (!showOverlay) {
    return null
  }

  // Determine message based on status
  const getTxKey = () => {
    if (status === "error") return "database:error"
    if (status === "reencrypting") return "database:reencrypting"
    return "database:initializing"
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={themed($overlay)}>
        <View style={themed($content)}>
          {status !== "error" && (
            <ActivityIndicator size="large" color={theme.colors.tint} style={themed($spinner)} />
          )}
          <Text tx={getTxKey()} style={themed($message)} />
          {status === "error" && error && <Text style={themed($errorText)}>{error}</Text>}
        </View>
      </View>
    </Modal>
  )
}

const $overlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  justifyContent: "center",
  alignItems: "center",
})

const $content: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.background,
  borderRadius: 16,
  padding: spacing.xl,
  alignItems: "center",
  minWidth: 200,
  maxWidth: "80%",
})

const $spinner: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginBottom: spacing.md,
})

const $message: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  fontSize: 16,
  textAlign: "center",
})

const $errorText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.error,
  fontSize: 14,
  textAlign: "center",
  marginTop: spacing.sm,
})
