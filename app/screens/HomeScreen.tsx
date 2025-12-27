import { FC, useState } from "react"
import { View, ViewStyle, TextStyle, Pressable } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

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
  const { logout, error: authError, clearError } = useZitadelAuth()
  const { apiStatus, liveSource, liveMeetings, lastRefresh } = useMeetings()
  const [debugExpanded, setDebugExpanded] = useState(false)

  const handleLogout = async () => {
    clearError()
    await logout()
  }

  return (
    <Screen
      preset="scroll"
      safeAreaEdges={["top"]}
      contentContainerStyle={[$styles.container, themed($container)]}
    >
      {/* Header with title and logout */}
      <View style={$header}>
        <Text preset="heading" tx="homeScreen:title" />
        {authStore.isAuthenticated && (
          <Pressable onPress={handleLogout}>
            <Text style={themed($logoutLink)}>Logout</Text>
          </Pressable>
        )}
      </View>

      {/* Debug Data - Expandable */}
      <View style={themed($debugContainer)}>
        <Pressable style={$debugHeader} onPress={() => setDebugExpanded(!debugExpanded)}>
          <Text style={themed($debugTitle)}>Debug Data</Text>
          <Ionicons
            name={debugExpanded ? "chevron-up" : "chevron-down"}
            size={20}
            color={theme.colors.textDim}
          />
        </Pressable>

        {debugExpanded && (
          <View style={themed($debugContent)}>
            {/* API Status */}
            <View style={themed($statusSection)}>
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
            <View style={themed($statusSection)}>
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
          </View>
        )}
      </View>

    </Screen>
  )
})

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingBottom: spacing.xxl,
})

const $header: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
}

const $logoutLink: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontSize: 14,
  fontWeight: "500",
})

const $debugContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginTop: spacing.xl,
})

const $debugHeader: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: 8,
}

const $debugTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 14,
  fontWeight: "500",
})

const $debugContent: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  gap: spacing.md,
  marginTop: spacing.xs,
})

const $statusSection: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.sm,
  backgroundColor: "rgba(0,0,0,0.1)",
  borderRadius: 8,
})

const $statusLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 13,
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
  fontSize: 16,
  fontWeight: "600",
})

const $sourceText: ThemedStyle<TextStyle> = ({ colors, spacing }) => ({
  color: colors.textDim,
  fontSize: 12,
  marginTop: spacing.xs,
})

const $emailText: ThemedStyle<TextStyle> = ({ spacing, colors }) => ({
  color: colors.textDim,
  marginTop: spacing.xs,
  fontSize: 13,
})

const $errorText: ThemedStyle<TextStyle> = ({ spacing, colors }) => ({
  color: colors.error,
  marginTop: spacing.xs,
  fontSize: 13,
})
