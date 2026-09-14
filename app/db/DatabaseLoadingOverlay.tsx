/**
 * Database Loading Overlay
 *
 * Shows a loading overlay during database initialization and seeding.
 * Displays appropriate message based on current database status.
 * Also controls splash screen visibility.
 *
 * CHANGED 2026-09-14 (RS-024): the error state is no longer a dead end. It
 * shows copy keyed on why the open failed (`errorKind`), a Retry button, and —
 * for a wrong or missing SQLCipher key, which no retry can fix — a confirmed
 * "Reset local data" action. Before this the user saw "Database error" with a
 * raw DrizzleError under it, forever, while the provider hammered the
 * database behind it.
 */

import { useCallback, useEffect, useRef } from "react"
import { Alert, Modal, Platform, View, ViewStyle, TextStyle, ActivityIndicator } from "react-native"
import * as SplashScreen from "expo-splash-screen"
import { observer } from "mobx-react-lite"

import { Button } from "@/components/Button"
import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useAuthenticationStore } from "@/models"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

import { useDatabase } from "./DatabaseProvider"

const log = logger.child({ module: "DatabaseLoadingOverlay" })

/**
 * Overlay component that shows during database initialization.
 * Place inside DatabaseProvider to access database status.
 * Also controls splash screen — waits for both DB seeded AND auth resolved.
 */
export const DatabaseLoadingOverlay = observer(function DatabaseLoadingOverlay() {
  const { themed, theme } = useAppTheme()
  const { status, error, errorKind, retry, resetLocalData } = useDatabase()
  const authStore = useAuthenticationStore()
  const hasHiddenSplash = useRef(false)

  // Hide splash screen only once when database is fully seeded AND auth is resolved.
  // Delay hide by one frame so React can paint the correct screen first.
  useEffect(() => {
    if (status === "seeded" && authStore.authReady && !hasHiddenSplash.current) {
      hasHiddenSplash.current = true
      log.info("Database seeded and auth ready, hiding splash screen")
      SplashScreen.hideAsync().catch((err) => {
        log.warn("Failed to hide splash screen", { error: String(err) })
      })
    }
  }, [status, authStore.authReady])

  // The error overlay draws on top of the splash. Hide the splash when we
  // land in "error" too, or the Retry / Reset buttons sit behind the launch
  // image and the user still sees a frozen app (the pre-fix RS-024 symptom).
  useEffect(() => {
    if (status === "error" && !hasHiddenSplash.current) {
      hasHiddenSplash.current = true
      SplashScreen.hideAsync().catch(() => {})
    }
  }, [status])

  const confirmReset = useCallback(() => {
    const title = translate("database:resetConfirmTitle")
    const body = translate("database:resetConfirmBody")
    // react-native-web's Alert is a no-op; window.confirm is the web
    // equivalent of a two-button Alert (same pattern as useLocationGate).
    if (Platform.OS === "web") {
      if (window.confirm(`${title}\n\n${body}`)) void resetLocalData()
      return
    }
    Alert.alert(title, body, [
      { text: translate("common:cancel"), style: "cancel" },
      {
        text: translate("database:resetLocalData"),
        style: "destructive",
        onPress: () => void resetLocalData(),
      },
    ])
  }, [resetLocalData])

  // Only show overlay during opening, reencrypting, or error states
  // Note: "seeding" is instant (no data to seed) so no overlay needed
  const showOverlay = status === "opening" || status === "reencrypting" || status === "error"

  if (!showOverlay) {
    return null
  }

  const isKeyProblem = errorKind === "key-mismatch" || errorKind === "key-missing"
  const isWaitingForUnlock = errorKind === "keychain-unavailable"

  // Determine message based on status
  const getTxKey = () => {
    if (status === "error") {
      if (isKeyProblem) return "database:keyLostTitle"
      if (isWaitingForUnlock) return "database:keychainUnavailable"
      return "database:error"
    }
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
          {status === "error" && isKeyProblem && (
            <Text tx="database:keyLostBody" style={themed($body)} />
          )}
          {status === "error" && !isKeyProblem && !isWaitingForUnlock && error && (
            <Text style={themed($errorText)}>{error}</Text>
          )}
          {status === "error" && (
            <View style={themed($actions)}>
              <Button
                tx="common:retry"
                preset="default"
                onPress={retry}
                style={themed($button)}
                accessibilityRole="button"
                accessibilityLabel={translate("common:retry")}
              />
              {isKeyProblem && (
                <Button
                  tx="database:resetLocalData"
                  preset="filled"
                  onPress={confirmReset}
                  style={themed($button)}
                  accessibilityRole="button"
                  accessibilityLabel={translate("database:resetLocalData")}
                  accessibilityHint={translate("database:resetConfirmBody")}
                />
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
})

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

const $body: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  fontSize: 14,
  textAlign: "center",
  marginTop: spacing.sm,
})

const $errorText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.error,
  fontSize: 14,
  textAlign: "center",
  marginTop: spacing.sm,
})

const $actions: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignSelf: "stretch",
  marginTop: spacing.lg,
  gap: spacing.sm,
})

const $button: ThemedStyle<ViewStyle> = () => ({
  minHeight: 44,
})
