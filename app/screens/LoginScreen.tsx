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
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useDatabase } from "@/db/DatabaseProvider"
import { translate } from "@/i18n"
import { useAuthenticationStore } from "@/models"
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
  const authStore = useAuthenticationStore()
  const { login, signup, loginAnonymously, isLoading, error, clearError } = useAuth0Wrapper({
    onSqliteKeyChange: rekeyDb,
  })

  // ADDED 2026-09-19 (RS-036): a forced logout (permanent refresh failure —
  // see performForcedLogout in app.tsx) used to land here with no explanation.
  // The flag is read once at mount into local state and cleared from the
  // store straight away, so a re-render or a later visit never re-shows it;
  // the notice itself goes away when the user taps a sign-in button.
  const [showForcedLogoutNotice, setShowForcedLogoutNotice] = useState(
    () => authStore.forcedLogoutNotice,
  )
  useEffect(() => {
    if (!authStore.forcedLogoutNotice) return
    log.info("Showing forced-logout notice")
    authStore.setForcedLogoutNotice(false)
    // Mount-only by design: the flag is consumed exactly once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Agreement modal state
  const [showEuaModal, setShowEuaModal] = useState(false)
  const [pendingLoginType, setPendingLoginType] = useState<LoginType>(null)
  const [termsAlreadyAccepted, setTermsAlreadyAccepted] = useState(false)
  const [activeTab, setActiveTab] = useState<"disclaimer" | "eula">("disclaimer")

  // Dynamic content from API
  const [disclaimerContent, setDisclaimerContent] = useState("")
  const [eulaContent, setEulaContent] = useState("")
  // Starts true, not false: the fetch effect runs *after* the modal's first
  // render, so a false start would paint one frame of the "couldn't load"
  // error before the request had even been made. Harmless while the modal is
  // closed — nothing reads it until then.
  const [contentLoading, setContentLoading] = useState(true)
  const contentLoaded = useRef(false)

  // Both documents have to be on screen for an acceptance to mean anything, so
  // the gate is the rendered text rather than a "the fetch said ok" flag — that
  // also catches a document whose markup strips down to nothing.
  const canAgree = disclaimerContent.length > 0 && eulaContent.length > 0

  // Check if terms were previously accepted
  useEffect(() => {
    hasAcceptedTerms()
      .then(setTermsAlreadyAccepted)
      .catch(() => {})
  }, [])

  /**
   * Fetch both legal documents.
   *
   * Always fetches BOTH, even when only one previously failed. They are
   * versioned together upstream, so refetching the pair keeps the disclaimer
   * and the EULA the user accepts from drifting out of step across a retry.
   * `api.getContent` already rides out transient upstream failures on its own
   * retry ladder; this is the manual escape hatch for when that isn't enough.
   */
  const loadLegalContent = useCallback(async () => {
    setContentLoading(true)
    try {
      const [disclaimerResult, eulaResult] = await Promise.all([
        api.getContent("disclaimer"),
        api.getContent("EULA"),
      ])
      if (disclaimerResult.kind === "ok") setDisclaimerContent(htmlToText(disclaimerResult.content))
      if (eulaResult.kind === "ok") setEulaContent(htmlToText(eulaResult.content))

      // CHANGED 2026-08-09: the latch used to be set unconditionally, so a
      // single transient 500 on one document (Directus does this — it 500'd
      // EULA while disclaimer succeeded in the same tick) left that tab blank
      // for the life of the screen with no retry and no error, while the
      // Accept button stayed live. Latching only on a complete success means a
      // reopen of the modal tries again.
      const bothOk = disclaimerResult.kind === "ok" && eulaResult.kind === "ok"
      contentLoaded.current = bothOk
      if (!bothOk) {
        log.warn("Legal content incomplete", {
          disclaimer: disclaimerResult.kind,
          eula: eulaResult.kind,
        })
      }
    } catch (err) {
      log.error("Failed to fetch legal content", { error: String(err) })
    } finally {
      setContentLoading(false)
    }
  }, [])

  // Fetch content when modal opens
  useEffect(() => {
    if (!showEuaModal || contentLoaded.current) return
    loadLegalContent()
  }, [showEuaModal, loadLegalContent])

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
      setShowForcedLogoutNotice(false)
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

  // Kept for the commented-out anonymous-login button further down (see the
  // comment above that block). Disabling the rule rather than renaming to
  // `_handleAnonymousPress` keeps re-enabling a literal one-block uncomment.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    // Belt-and-braces alongside the button's `disabled` prop: acceptance is
    // persisted to SecureStore and never re-asked, so a single slip here would
    // permanently record consent to documents the user was never shown.
    if (!canAgree) {
      log.warn("EUA accept blocked — legal content not displayed")
      return
    }

    log.info("EUA accepted", { loginType: pendingLoginType ?? "none" })
    setShowEuaModal(false)

    // Persist acceptance to SecureStore
    setTermsAlreadyAccepted(true)
    setTermsAccepted().catch((err) =>
      log.error("Failed to persist terms acceptance", { error: String(err) }),
    )

    await proceedWithLogin(pendingLoginType)
    setPendingLoginType(null)
  }, [canAgree, pendingLoginType, proceedWithLogin])

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
        {!error && showForcedLogoutNotice && (
          <View style={themed($errorContainer)} accessibilityRole="alert">
            <Text style={themed($errorText)} tx="loginScreen:sessionUnrecoverable" />
          </View>
        )}

        {/* REMOVED 2026-08-09: the "This is the updated AA/NA Live app" notice banner.
            It announced the AA/NA Live → RecoverySky rename to migrating users and has
            outlived that transition — same reason the matching HomeScreen card is gone. */}

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

        {/* Anonymous login intentionally disabled in the UI. We're keeping the
            handler + state plumbing (handleAnonymousPress, loginAnonymously,
            "anonymous" branches in proceedWithLogin) so re-enabling is a
            one-block uncomment. Hidden because the anonymous-user experience
            doesn't meet the bar we want for new installs — bring it back only
            when paired with a clear upgrade path. */}
        {/* {Platform.OS !== "ios" && (
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
        )} */}

        {isLoading && <Text style={themed($loadingText)} tx="loginScreen:openingBrowser" />}
      </View>

      {/* EUA Modal */}
      <Modal
        visible={showEuaModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleEuaCancel}
      >
        <View style={themed($modalContainer)} accessibilityViewIsModal>
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
              <ActivityIndicator size="large" color={theme.colors.tint} style={$contentSpinner} />
            ) : canAgree ? (
              <Text style={themed($agreementText)}>
                {activeTab === "disclaimer" ? disclaimerContent : eulaContent}
              </Text>
            ) : (
              // A blank panel reads as "this agreement is empty" and invites a
              // blind Accept. Say the documents are missing and offer a way out.
              <View style={themed($contentErrorContainer)}>
                <Text style={themed($errorText)} tx="loginScreen:euaLoadFailed" />
                <Pressable
                  style={[themed($retryButton), { borderColor: theme.colors.tint }]}
                  onPress={loadLegalContent}
                  accessibilityRole="button"
                  accessibilityLabel={translate("loginScreen:euaRetry")}
                >
                  <Text
                    style={[themed($agreeButtonText), { color: theme.colors.tint }]}
                    tx="loginScreen:euaRetry"
                  />
                </Pressable>
              </View>
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
                // Accepting an agreement the app never managed to display is not
                // a valid acceptance, so the button is inert until both
                // documents are on screen. Greyed rather than hidden so the
                // reason stays visible next to the error above.
                !canAgree && $disabledButton,
              ]}
              onPress={handleEuaAgree}
              disabled={!canAgree}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canAgree }}
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

// Kept for the commented-out anonymous-login button — same reasoning as
// handleAnonymousPress above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const $buttonTextSecondary: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.textDim,
})

const $spinner: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginLeft: spacing.sm,
})

// Breathing room above the spinner while the disclaimer/EULA text loads. Was an
// inline `{ marginTop: 40 }`, which trips react-native/no-inline-styles.
const $contentSpinner: ViewStyle = {
  marginTop: 40,
}

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

// Same 0.4 dim SettingsScreen uses for a row it has switched off, so a blocked
// Accept reads the same as every other disabled control in the app.
const $disabledButton: ViewStyle = {
  opacity: 0.4,
}

// Shown in place of the agreement text when either document failed to load.
const $contentErrorContainer: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  gap: spacing.lg,
  paddingVertical: spacing.xl,
})

const $retryButton: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.xl,
  borderRadius: 12,
  backgroundColor: colors.background,
  borderWidth: 1.5,
})
