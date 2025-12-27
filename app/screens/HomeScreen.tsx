import { FC } from "react"
import { View, ViewStyle, TextStyle, ActivityIndicator } from "react-native"
import { observer } from "mobx-react-lite"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useMeetings } from "@/context/MeetingContext"
import { useAuthenticationStore } from "@/models"
import { MainTabScreenProps } from "@/navigators/navigationTypes"
import { useZitadelAuth } from "@/services/auth"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme/styles"
import type { ThemedStyle } from "@/theme/types"

/**
 * HomeScreen - Dashboard/home screen
 */
export const HomeScreen: FC<MainTabScreenProps<"Home">> = observer(function HomeScreen(_props) {
  const { themed, theme } = useAppTheme()
  const authStore = useAuthenticationStore()
  const { login, logout, isLoading: authLoading, error: authError, clearError } = useZitadelAuth()
  const { apiStatus, liveSource, liveMeetings, lastRefresh } = useMeetings()

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

      {/* API Status */}
      <View style={themed($statusContainer)}>
        <Text style={themed($statusLabel)}>API Status:</Text>
        <View style={$statusRow}>
          <View
            style={[
              $statusDot,
              {
                backgroundColor:
                  apiStatus === "connected"
                    ? "#22c55e"
                    : apiStatus === "disconnected"
                      ? "#ef4444"
                      : "#f59e0b",
              },
            ]}
          />
          <Text style={themed($statusValue)}>
            {apiStatus === "connected"
              ? "Connected"
              : apiStatus === "disconnected"
                ? "Disconnected"
                : "Unknown"}
          </Text>
        </View>
        <Text style={themed($sourceText)}>
          Live source: {liveSource === "api" ? "API" : "Local calculation"}
        </Text>
        <Text style={themed($sourceText)}>
          Live meetings: {liveMeetings.length}
        </Text>
        {lastRefresh && (
          <Text style={themed($sourceText)}>
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </Text>
        )}
      </View>

      {/* Auth Status */}
      <View style={themed($statusContainer)}>
        <Text style={themed($statusLabel)}>Auth Status:</Text>
        <Text style={themed($statusValue)}>
          {authStore.isAuthenticated
            ? authStore.isAnonymous
              ? "Anonymous"
              : "Authenticated"
            : "Not authenticated"}
        </Text>
        {authStore.isAuthenticated && !authStore.isAnonymous && authStore.authEmail && (
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

const $statusRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  marginTop: 4,
}

const $statusDot: ViewStyle = {
  width: 10,
  height: 10,
  borderRadius: 5,
}

const $statusValue: ThemedStyle<TextStyle> = () => ({
  fontSize: 18,
  fontWeight: "600",
})

const $sourceText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  fontSize: 13,
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
