import { FC } from "react"
import { View, ViewStyle, TextStyle, ActivityIndicator } from "react-native"
import { observer } from "mobx-react-lite"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
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
  const { login, isLoading, error, clearError } = useZitadelAuth()

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

        <Button
          testID="login-button"
          text="Login with Zitadel"
          style={themed($loginButton)}
          preset="filled"
          onPress={handleLogin}
          disabled={isLoading}
          RightAccessory={
            isLoading
              ? () => (
                  <ActivityIndicator
                    size="small"
                    color={theme.colors.background}
                    style={themed($spinner)}
                  />
                )
              : undefined
          }
        />

        {isLoading && (
          <Text style={themed($loadingText)}>Opening browser for authentication...</Text>
        )}
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

const $loginButton: ThemedStyle<ViewStyle> = () => ({
  width: "100%",
})

const $spinner: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginLeft: spacing.sm,
})

const $loadingText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  textAlign: "center",
  fontSize: 14,
})
