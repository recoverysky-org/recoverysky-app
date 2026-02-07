import { FC, useState, useCallback, useEffect } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  Pressable,
  Modal,
  ScrollView,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { disclaimerText } from "@assets/content/disclaimer"
import { euaText } from "@assets/content/eua"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useDatabase } from "@/db/DatabaseProvider"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { useAuth0Wrapper } from "@/services/auth/useAuth0Wrapper"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "LoginScreen" })

// Import agreement texts

interface LoginScreenProps extends AppStackScreenProps<"Login"> {}

type LoginType = "authenticated" | "anonymous" | null

/**
 * LoginScreen - OAuth login via Auth0
 *
 * Provides login options with EUA agreement requirement.
 * Shows End User Agreement popup before allowing login.
 */
export const LoginScreen: FC<LoginScreenProps> = observer(function LoginScreen(_props) {
  const { themed, theme } = useAppTheme()
  const { rekeyDb } = useDatabase()
  const { login, loginAnonymously, isLoading, error, clearError } = useAuth0Wrapper({
    onSqliteKeyChange: rekeyDb,
  })

  // EUA modal state
  const [showEuaModal, setShowEuaModal] = useState(false)
  const [pendingLoginType, setPendingLoginType] = useState<LoginType>(null)

  useEffect(() => {
    log.info("LoginScreen mounted")
    return () => log.debug("LoginScreen unmounted")
  }, [])

  // Log auth errors when they occur
  useEffect(() => {
    if (error) {
      log.warn("Auth error displayed to user", { error })
    }
  }, [error])

  const handleLoginPress = useCallback(() => {
    log.info("Login button pressed", { type: "authenticated" })
    setPendingLoginType("authenticated")
    setShowEuaModal(true)
  }, [])

  const handleAnonymousPress = useCallback(() => {
    log.info("Login button pressed", { type: "anonymous" })
    setPendingLoginType("anonymous")
    setShowEuaModal(true)
  }, [])

  const handleEuaAgree = useCallback(async () => {
    log.info("EUA accepted", { loginType: pendingLoginType ?? "none" })
    setShowEuaModal(false)
    clearError()

    if (pendingLoginType === "authenticated") {
      await login()
    } else if (pendingLoginType === "anonymous") {
      await loginAnonymously()
    }

    setPendingLoginType(null)
  }, [pendingLoginType, login, loginAnonymously, clearError])

  const handleEuaCancel = useCallback(() => {
    log.info("EUA cancelled", { loginType: pendingLoginType ?? "none" })
    setShowEuaModal(false)
    setPendingLoginType(null)
  }, [pendingLoginType])

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

        {/* Auth0 OAuth Login */}
        <Pressable
          testID="login-button"
          style={[themed($button), isLoading && themed($buttonDisabled)]}
          onPress={handleLoginPress}
          disabled={isLoading}
        >
          <Text style={themed($buttonText)} tx="loginScreen:loginButton" />
          {isLoading && pendingLoginType === "authenticated" && (
            <ActivityIndicator size="small" color={theme.colors.tint} style={themed($spinner)} />
          )}
        </Pressable>

        <Pressable
          testID="anonymous-button"
          style={[themed($button), isLoading && themed($buttonDisabled)]}
          onPress={handleAnonymousPress}
          disabled={isLoading}
        >
          <Text style={themed($buttonTextSecondary)} tx="loginScreen:continueAnonymously" />
        </Pressable>

        {isLoading && <Text style={themed($loadingText)} tx="loginScreen:openingBrowser" />}
      </View>

      {/* EUA Modal */}
      <Modal
        visible={showEuaModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleEuaCancel}
      >
        <View style={themed($modalContainer)}>
          {/* Modal Header */}
          <View style={themed($modalHeader)}>
            <Text style={themed($modalTitle)} tx="loginScreen:euaTitle" />
            <Pressable onPress={handleEuaCancel} hitSlop={8}>
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </Pressable>
          </View>

          {/* Agreement Content */}
          <ScrollView
            style={themed($modalContent)}
            contentContainerStyle={themed($modalContentInner)}
            showsVerticalScrollIndicator
          >
            <Text style={themed($agreementText)}>{euaText}</Text>
            <View style={themed($agreementDivider)} />
            <Text style={themed($agreementText)}>{disclaimerText}</Text>
          </ScrollView>

          {/* Modal Footer */}
          <View style={themed($modalFooter)}>
            <Pressable style={themed($cancelButton)} onPress={handleEuaCancel}>
              <Text style={themed($cancelButtonText)} tx="loginScreen:euaCancel" />
            </Pressable>
            <Pressable
              style={[
                themed($agreeButton),
                { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
              ]}
              onPress={handleEuaAgree}
            >
              <Text
                style={[themed($agreeButtonText), { color: theme.colors.tint }]}
                tx="loginScreen:euaAgree"
              />
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  )
})

// ============================================================================
// Styles
// ============================================================================

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

// Modal styles
const $modalContainer: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flex: 1,
  backgroundColor: colors.background,
  paddingTop: spacing.lg,
})

const $modalHeader: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: spacing.lg,
  paddingBottom: spacing.md,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
})

const $modalTitle: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 20,
  fontWeight: "700",
  color: colors.text,
})

const $modalContent: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
})

const $modalContentInner: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  padding: spacing.lg,
})

const $agreementText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  lineHeight: 22,
  color: colors.text,
})

const $agreementDivider: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  height: 1,
  backgroundColor: colors.border,
  marginVertical: spacing.xl,
})

const $modalFooter: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  gap: spacing.md,
  padding: spacing.lg,
  borderTopWidth: 1,
  borderTopColor: colors.border,
})

const $cancelButton: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.md,
  borderRadius: 12,
  backgroundColor: colors.card,
})

const $cancelButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 16,
  fontWeight: "600",
  color: colors.textDim,
})

const $agreeButton: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.md,
  borderRadius: 12,
  backgroundColor: colors.background,
  borderWidth: 1.5,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.6,
  shadowRadius: 8,
  elevation: 8,
})

const $agreeButtonText: ThemedStyle<TextStyle> = () => ({
  fontSize: 16,
  fontWeight: "600",
})
