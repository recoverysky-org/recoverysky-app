import { FC } from "react"
import { View, ViewStyle, TextStyle, ActivityIndicator } from "react-native"
import { observer } from "mobx-react-lite"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useDatabase } from "@/db"
import { useAuthenticationStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useZitadelAuth } from "@/services/auth"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * HomeScreen - Dashboard/home screen
 *
 * Provides manual database control buttons and OAuth login for development.
 */
export const HomeScreen: FC<MainTabScreenProps<"Home">> = observer(function HomeScreen(_props) {
  const { themed, theme } = useAppTheme()
  const { status, error: dbError, openDb, seedDb } = useDatabase()
  const authStore = useAuthenticationStore()
  const { login, logout, isLoading: authLoading, error: authError, clearError } = useZitadelAuth()

  const handleAuthPress = async () => {
    clearError()
    if (authStore.isAuthenticated) {
      await logout()
    } else {
      await login()
    }
  }

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      <Text preset="heading" tx="homeScreen:title" />

      {/* Database Status */}
      <View style={themed($statusContainer)}>
        <Text style={themed($statusLabel)}>Database Status:</Text>
        <Text style={themed($statusValue)}>{status}</Text>
        {dbError && <Text style={themed($errorText)}>{dbError}</Text>}
      </View>

      {/* Database Controls */}
      <View style={themed($buttonContainer)}>
        <Button
          text="Open Db"
          preset="filled"
          onPress={openDb}
          disabled={status !== "closed" && status !== "error"}
          style={themed($button)}
        />
        <Button
          text="Seed Db"
          preset="filled"
          onPress={seedDb}
          disabled={status !== "open"}
          style={themed($button)}
        />
      </View>

      {/* Auth Status */}
      <View style={themed($statusContainer)}>
        <Text style={themed($statusLabel)}>Auth Status:</Text>
        <Text style={themed($statusValue)}>
          {authStore.isAuthenticated ? "Authenticated" : "Not authenticated"}
        </Text>
        {authStore.isAuthenticated && authStore.authEmail && (
          <Text style={themed($emailText)}>{authStore.authEmail}</Text>
        )}
        {authError && <Text style={themed($errorText)}>{authError}</Text>}
      </View>

      {/* Auth Controls */}
      <View style={themed($buttonContainer)}>
        <Button
          text={authStore.isAuthenticated ? "Logout" : "Login"}
          preset="filled"
          onPress={handleAuthPress}
          disabled={authLoading}
          style={themed($button)}
          RightAccessory={
            authLoading
              ? () => <ActivityIndicator size="small" color={theme.colors.background} />
              : undefined
          }
        />
      </View>
    </Screen>
  )
})

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $statusContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.xl,
  padding: spacing.md,
  backgroundColor: "rgba(0,0,0,0.05)",
  borderRadius: 8,
})

const $statusLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 14,
})

const $statusValue: ThemedStyle<TextStyle> = ({ spacing }) => ({
  fontSize: 18,
  fontWeight: "600",
  marginTop: spacing.xs,
})

const $emailText: ThemedStyle<TextStyle> = ({ spacing, colors }) => ({
  color: colors.textDim,
  marginTop: spacing.xs,
  fontSize: 14,
})

const $errorText: ThemedStyle<TextStyle> = ({ spacing, colors }) => ({
  color: colors.error,
  marginTop: spacing.xs,
  fontSize: 14,
})

const $buttonContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.xl,
  gap: spacing.md,
})

const $button: ThemedStyle<ViewStyle> = () => ({
  minWidth: 150,
})
