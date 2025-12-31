import { FC } from "react"
import { View, ViewStyle, TextStyle, ActivityIndicator, Pressable } from "react-native"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useDatabase } from "@/db/DatabaseProvider"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useZitadelAuth } from "@/services/auth"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface LoginScreenProps extends AppStackScreenProps<"Login"> {}

/**
 * LoginScreen - OAuth login via Zitadel
 *
 * Provides a single "Login with Zitadel" button that initiates
 * the OAuth PKCE flow in a system browser.
 */
export const LoginScreen: FC<LoginScreenProps> = observer(function LoginScreen(_props) {
  const { themed, theme } = useAppTheme()
  const { rekeyDb } = useDatabase()
  const { login, loginAnonymously, isLoading, error, clearError } = useZitadelAuth({
    onSqliteKeyChange: rekeyDb,
  })

  const handleLogin = async () => {
    clearError()
    await login()
  }

  return (
    <Screen
      preset="auto"
      contentContainerStyle={themed($screenContentContainer)}
      safeAreaEdges={["top", "bottom"]}
    >
      <View style={themed($headerContainer)}>
        <Text
          testID="login-heading"
          tx="loginScreen:logIn"
          preset="heading"
          style={themed($logIn)}
        />
        <Text tx="loginScreen:enterDetails" preset="subheading" style={themed($enterDetails)} />
      </View>

      <View style={themed($contentContainer)}>
        {error && (
          <View style={themed($errorContainer)}>
            <Text style={themed($errorText)}>{error}</Text>
          </View>
        )}

        <Pressable
          testID="login-button"
          style={[themed($button), isLoading && themed($buttonDisabled)]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          <Text style={themed($buttonText)} tx="loginScreen:loginButton" />
          {isLoading && (
            <ActivityIndicator size="small" color={theme.colors.tint} style={themed($spinner)} />
          )}
        </Pressable>

        <Pressable
          testID="anonymous-button"
          style={[themed($button), isLoading && themed($buttonDisabled)]}
          onPress={loginAnonymously}
          disabled={isLoading}
        >
          <Text style={themed($buttonTextSecondary)} tx="loginScreen:continueAnonymously" />
        </Pressable>

        {isLoading && <Text style={themed($loadingText)} tx="loginScreen:openingBrowser" />}
      </View>
    </Screen>
  )
})

const $screenContentContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingVertical: spacing.xxl,
  paddingHorizontal: spacing.lg,
})

const $headerContainer: ThemedStyle<ViewStyle> = () => ({
  alignItems: "center",
})

const $logIn: ThemedStyle<TextStyle> = ({ spacing }) => ({
  marginBottom: spacing.sm,
  textAlign: "center",
})

const $enterDetails: ThemedStyle<TextStyle> = ({ spacing }) => ({
  marginBottom: spacing.lg,
  textAlign: "center",
})

const $contentContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  justifyContent: "center",
  gap: spacing.md,
})

const $errorContainer: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  padding: spacing.md,
  backgroundColor: colors.errorBackground,
  borderRadius: 8,
  marginBottom: spacing.md,
})

const $errorText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.error,
  textAlign: "center",
})

const $button: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.background,
  borderWidth: 1.5,
  borderColor: colors.tint,
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.5,
  shadowRadius: 8,
  elevation: 8,
})

const $buttonDisabled: ThemedStyle<ViewStyle> = () => ({
  opacity: 0.7,
})

const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.tint,
})

const $buttonTextSecondary: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.textDim,
})

const $spinner: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginLeft: spacing.sm,
})

const $loadingText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  textAlign: "center",
  fontSize: 14,
})
