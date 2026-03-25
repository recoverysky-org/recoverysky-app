import { FC, useState, useCallback, useEffect, useRef } from "react"
import {
  View,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  Platform,
  Pressable,
  Modal,
  ScrollView,
  Linking,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useDatabase } from "@/db/DatabaseProvider"
import { translate } from "@/i18n"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { api } from "@/services/api"
import { hasAcceptedTerms, setTermsAccepted } from "@/services/auth/secureStorage"
import { useAuth0Wrapper } from "@/services/auth/useAuth0Wrapper"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "LoginScreen" })

/** Strip HTML tags and convert to readable plain text */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

interface LoginScreenProps extends AppStackScreenProps<"Login"> {}

type LoginType = "authenticated" | "signup" | "anonymous" | null

/**
 * LoginScreen - OAuth login via Auth0
 *
 * Provides login options with EUA agreement requirement.
 * Shows End User Agreement popup before allowing login.
 */
export const LoginScreen: FC<LoginScreenProps> = observer(function LoginScreen(_props) {
  const { themed, theme } = useAppTheme()
  const { rekeyDb } = useDatabase()
  const { login, signup, loginAnonymously, isLoading, error, clearError } = useAuth0Wrapper({
    onSqliteKeyChange: rekeyDb,
  })

  // Agreement modal state
  const [showEuaModal, setShowEuaModal] = useState(false)
  const [pendingLoginType, setPendingLoginType] = useState<LoginType>(null)
  const [termsAlreadyAccepted, setTermsAlreadyAccepted] = useState(false)
  const [activeTab, setActiveTab] = useState<"disclaimer" | "eula">("disclaimer")

  // Dynamic content from API
  const [disclaimerContent, setDisclaimerContent] = useState("")
  const [eulaContent, setEulaContent] = useState("")
  const [contentLoading, setContentLoading] = useState(false)
  const contentLoaded = useRef(false)

  // Check if terms were previously accepted
  useEffect(() => {
    hasAcceptedTerms()
      .then(setTermsAlreadyAccepted)
      .catch(() => {})
  }, [])

  // Fetch content when modal opens
  useEffect(() => {
    if (!showEuaModal || contentLoaded.current) return
    setContentLoading(true)
    Promise.all([api.getContent("disclaimer"), api.getContent("EULA")])
      .then(([disclaimerResult, eulaResult]) => {
        if (disclaimerResult.kind === "ok") setDisclaimerContent(htmlToText(disclaimerResult.content))
        if (eulaResult.kind === "ok") setEulaContent(htmlToText(eulaResult.content))
        contentLoaded.current = true
      })
      .catch((err) => log.error("Failed to fetch legal content", { error: String(err) }))
      .finally(() => setContentLoading(false))
  }, [showEuaModal])

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

  const proceedWithLogin = useCallback(
    async (type: LoginType) => {
      clearError()
      if (type === "authenticated") await login()
      else if (type === "signup") await signup()
      else if (type === "anonymous") await loginAnonymously()
      trackEvent("login_completed", { method: type === "anonymous" ? "anonymous" : "oauth" })
    },
    [login, signup, loginAnonymously, clearError],
  )

  const handleLoginPress = useCallback(() => {
    log.info("Login button pressed", { type: "authenticated" })
    if (termsAlreadyAccepted) {
      proceedWithLogin("authenticated")
    } else {
      setPendingLoginType("authenticated")
      setShowEuaModal(true)
    }
  }, [termsAlreadyAccepted, proceedWithLogin])

  const handleSignupPress = useCallback(() => {
    log.info("Login button pressed", { type: "signup" })
    if (termsAlreadyAccepted) {
      proceedWithLogin("signup")
    } else {
      setPendingLoginType("signup")
      setShowEuaModal(true)
    }
  }, [termsAlreadyAccepted, proceedWithLogin])

  const handleAnonymousPress = useCallback(() => {
    log.info("Login button pressed", { type: "anonymous" })
    if (termsAlreadyAccepted) {
      proceedWithLogin("anonymous")
    } else {
      setPendingLoginType("anonymous")
      setShowEuaModal(true)
    }
  }, [termsAlreadyAccepted, proceedWithLogin])

  const handleEuaAgree = useCallback(async () => {
    log.info("EUA accepted", { loginType: pendingLoginType ?? "none" })
    setShowEuaModal(false)

    // Persist acceptance to SecureStore
    setTermsAlreadyAccepted(true)
    setTermsAccepted().catch((err) =>
      log.error("Failed to persist terms acceptance", { error: String(err) }),
    )

    await proceedWithLogin(pendingLoginType)
    setPendingLoginType(null)
  }, [pendingLoginType, proceedWithLogin])

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
        <Text
          tx={
            Platform.OS === "ios" ? "loginScreen:enterDetails" : "loginScreen:enterDetailsAndroid"
          }
          preset="subheading"
          style={themed($enterDetails)}
        />
      </View>

      <View style={themed($contentContainer)}>
        {error && (
          <View style={themed($errorContainer)}>
            <Text style={themed($errorText)}>{error}</Text>
          </View>
        )}

        {Platform.OS === "ios" && (
          <View style={themed($noticeBanner)}>
            <Ionicons
              name="information-circle"
              size={22}
              color={theme.colors.tint}
              style={$noticeIcon}
            />
            <Text style={themed($noticeText)}>
              This is the updated AA/NA Live app. If you are an existing user, log in with the same
              credentials you used with AA/NA Live. If you need help, please contact{" "}
              <Text
                style={themed($noticeLink)}
                onPress={() => Linking.openURL("https://www.recoverysky.org/support")}
                accessibilityRole="link"
              >
                support
              </Text>
              .
            </Text>
          </View>
        )}

        {/* Auth0 OAuth Login */}
        <Pressable
          testID="login-button"
          accessibilityRole="button"
          accessibilityLabel={translate("loginScreen:loginButton")}
          style={[themed($button), isLoading && themed($buttonDisabled)]}
          onPress={handleLoginPress}
          disabled={isLoading}
        >
          <Text style={themed($buttonText)} tx="loginScreen:loginButton" />
          {isLoading && pendingLoginType === "authenticated" && (
            <ActivityIndicator size="small" color={theme.colors.tint} style={themed($spinner)} />
          )}
        </Pressable>

        {/* Auth0 OAuth Signup */}
        <Pressable
          testID="signup-button"
          accessibilityRole="button"
          accessibilityLabel={translate("loginScreen:signupButton")}
          style={[themed($button), isLoading && themed($buttonDisabled)]}
          onPress={handleSignupPress}
          disabled={isLoading}
        >
          <Text style={themed($buttonText)} tx="loginScreen:signupButton" />
          {isLoading && pendingLoginType === "signup" && (
            <ActivityIndicator size="small" color={theme.colors.tint} style={themed($spinner)} />
          )}
        </Pressable>

        {Platform.OS !== "ios" && (
          <Pressable
            testID="anonymous-button"
            accessibilityRole="button"
            accessibilityLabel={translate("loginScreen:continueAnonymously")}
            style={[themed($button), isLoading && themed($buttonDisabled)]}
            onPress={handleAnonymousPress}
            disabled={isLoading}
          >
            <Text style={themed($buttonTextSecondary)} tx="loginScreen:continueAnonymously" />
          </Pressable>
        )}

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
            <Pressable
              onPress={handleEuaCancel}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={translate("common:close")}
            >
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </Pressable>
          </View>

          {/* Tabs */}
          <View style={themed($tabBar)}>
            <Pressable
              style={[themed($tab), activeTab === "disclaimer" && themed($tabActive)]}
              onPress={() => setActiveTab("disclaimer")}
            >
              <Text
                style={[
                  themed($tabText),
                  activeTab === "disclaimer" && { color: theme.colors.tint },
                ]}
              >
                Disclaimer
              </Text>
            </Pressable>
            <Pressable
              style={[themed($tab), activeTab === "eula" && themed($tabActive)]}
              onPress={() => setActiveTab("eula")}
            >
              <Text
                style={[themed($tabText), activeTab === "eula" && { color: theme.colors.tint }]}
              >
                EULA
              </Text>
            </Pressable>
          </View>

          {/* Agreement Content */}
          <ScrollView
            style={themed($modalContentScroll)}
            contentContainerStyle={themed($modalContentInner)}
            showsVerticalScrollIndicator
          >
            {contentLoading ? (
              <ActivityIndicator size="large" color={theme.colors.tint} style={{ marginTop: 40 }} />
            ) : (
              <Text style={themed($agreementText)}>
                {activeTab === "disclaimer" ? disclaimerContent : eulaContent}
              </Text>
            )}
          </ScrollView>

          {/* Modal Footer */}
          <View style={themed($modalFooter)}>
            <Pressable
              style={themed($cancelButton)}
              onPress={handleEuaCancel}
              accessibilityRole="button"
              accessibilityLabel={translate("loginScreen:euaCancel")}
            >
              <Text style={themed($cancelButtonText)} tx="loginScreen:euaCancel" />
            </Pressable>
            <Pressable
              style={[
                themed($agreeButton),
                { borderColor: theme.colors.tint, shadowColor: theme.colors.tint },
              ]}
              onPress={handleEuaAgree}
              accessibilityRole="button"
              accessibilityLabel={translate("loginScreen:euaAgree")}
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

const $noticeBanner: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  flexDirection: "row",
  alignItems: "flex-start",
  backgroundColor: colors.card,
  borderWidth: 1.5,
  borderColor: colors.tint,
  borderRadius: 12,
  padding: spacing.md,
  shadowColor: colors.tint,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.3,
  shadowRadius: 6,
  elevation: 4,
})

const $noticeIcon: ViewStyle = {
  marginRight: 10,
  marginTop: 2,
}

const $noticeText: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 15,
  fontWeight: "600",
  lineHeight: 22,
  color: colors.text,
})

const $noticeLink: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
  fontWeight: "700",
  textDecorationLine: "underline",
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
  backgroundColor: colors.card,
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

const $tabBar: ThemedStyle<ViewStyle> = ({ colors }) => ({
  flexDirection: "row",
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
})

const $tab: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  alignItems: "center",
  paddingVertical: spacing.sm,
})

const $tabActive: ThemedStyle<ViewStyle> = ({ colors }) => ({
  borderBottomWidth: 2,
  borderBottomColor: colors.tint,
})

const $tabText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  fontWeight: "600",
  color: colors.textDim,
})

const $modalContentScroll: ThemedStyle<ViewStyle> = () => ({
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
