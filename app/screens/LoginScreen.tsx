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
import { classifyAuthError } from "@/services/auth/authErrorLogic"
import {
  maskEmail,
  nextStep,
  resendWaitSeconds,
  type LoginEvent,
  type LoginStep,
} from "@/services/auth/loginFlowLogic"
import { ownerProofMethod } from "@/services/auth/ownerLogic"
import { hasAcceptedTerms, setTermsAccepted } from "@/services/auth/secureStorage"
import { useAuth0Wrapper, type ProviderConnection } from "@/services/auth/useAuth0Wrapper"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

import { ChooseStep, CodeStep, EmailStep } from "./login/LoginSteps"

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

/**
 * What the legal-agreements modal will run once accepted. CHANGED 2026-09-17:
 * was a `"authenticated" | "signup" | "anonymous"` string; the passwordless
 * screen has more entry points, each carrying its own argument.
 */
type PendingAction =
  | { kind: "email" }
  | { kind: "ownerEmail" }
  | { kind: "provider"; connection: ProviderConnection }
  | { kind: "anonymous" }
  | null

/** The `kind` of whatever action is currently in flight — see `inFlight` below. */
type ActionKind = NonNullable<PendingAction>["kind"]

/**
 * LoginScreen — three ways in (spec 1 §1): an in-app email code, Apple, Google.
 * Login and sign-up are one path, so the old two-button screen is gone.
 *
 * CHANGED 2026-09-17: the original doc comment read "OAuth login via Auth0 …
 * Shows End User Agreement popup before allowing login". The second half still
 * holds and is load-bearing — the legal-agreements modal gates every method
 * exactly as it gated the two buttons — but Universal Login is no longer the
 * only way in, so the first half is replaced.
 */
export const LoginScreen: FC<LoginScreenProps> = observer(function LoginScreen(_props) {
  const { themed, theme } = useAppTheme()
  const { rekeyDb } = useDatabase()
  const authStore = useAuthenticationStore()
  const {
    sendCode,
    verifyCode,
    loginWithProvider,
    loginAnonymously,
    isLoading,
    error,
    clearError,
  } = useAuth0Wrapper({
    onSqliteKeyChange: rekeyDb,
  })

  // spec 2 §2.6: a returning owner on their own device taps once and gets a
  // code. Only the code path prefills — an owner who signed in with Apple or
  // Google gets the plain provider buttons, because sending them a code would
  // create a second identity for the same person.
  const ownerEmail =
    ownerProofMethod(authStore.ownerSub) === "code" ? authStore.ownerEmail : undefined

  const [step, setStep] = useState<LoginStep>("choose")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // What the hook's `isLoading` is currently loading. CHANGED 2026-09-17: the
  // "Opening browser…" line used to key off `isLoading` alone, which was
  // accurate when every login opened a browser. An email code never does, so
  // the copy is now tied to the action that actually leaves the app.
  const [inFlight, setInFlight] = useState<ActionKind | null>(null)

  // Agreement modal state
  const [showEuaModal, setShowEuaModal] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
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

  // One-second tick for the Resend countdown, only while the code step is up.
  // Anywhere else it would re-render the screen once a second for nothing.
  useEffect(() => {
    if (step !== "code") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [step])

  /**
   * ONE error surface, deliberately.
   *
   * `sendCode` / `verifyCode` fail twice over: they reject with the raw SDK
   * error AND the SDK's own reducer dispatches ERROR, which the wrapper's
   * effect turns into its `error` state via `authErrorMessage()`. The strip
   * below renders that `error` and nothing else — these catch blocks only
   * classify for step routing and for the log line, and must never set a
   * second message of their own, or one failure paints two.
   *
   * (`loginWithProvider` does not reject at all; it swallows and sets the same
   * `error`, so the provider path already had exactly one surface.)
   */
  const runSend = useCallback(
    async (address: string, event: LoginEvent) => {
      clearError()
      try {
        await sendCode(address)
        setLastSentAt(Date.now())
        // Seed the clock in the same tick so the countdown starts at the full
        // cooldown rather than at whatever the last tick left behind.
        setNow(Date.now())
        trackEvent("login_code_sent")
        setStep((s) => nextStep(s, event))
      } catch (err) {
        const key = classifyAuthError(err)
        // Never the address: an email in a log line is an identifier.
        log.warn("Send code failed", { key: key ?? "unclassified" })
        // Auth0 is holding this address down. From the email step that means
        // there is nothing to do but wait; from the code step `nextStep` keeps
        // the user where they are, because a refused RESEND says nothing about
        // the code already in their inbox (see loginFlowLogic.ts). Neither
        // `code` nor `lastSentAt` is touched here, so the field they were
        // typing into and the running cooldown both survive.
        if (key === "sendRateLimited") setStep((s) => nextStep(s, "sendRateLimited"))
      }
    },
    [sendCode, clearError],
  )

  /**
   * Guards the one-render window between "six digits are present" and
   * `isLoading` turning true. In that frame the auto-submit effect below and
   * the still-enabled Verify button are both live, and a fast tap could spend
   * two of Auth0's `too_many_attempts` budget on one code. A ref, not state:
   * it has to be readable and writable synchronously, before React re-renders.
   */
  const verifyInFlight = useRef(false)

  const handleVerify = useCallback(async () => {
    if (verifyInFlight.current) return
    verifyInFlight.current = true
    clearError()
    try {
      await verifyCode(email, code)
      trackEvent("login_completed", { method: "email" })
      // NOTE: a successful verify does not always mean a session. The
      // wrapper's ownership gate (spec 2 §2.1) can refuse a foreign account,
      // in which case no tokens are written and AppNavigator routes to
      // WrongAccount instead. Nothing is left spinning either way — the hook
      // clears its own loading state in a `finally`.
    } catch (err) {
      const key = classifyAuthError(err)
      // Never the code: it is a live credential until it expires.
      log.warn("Verify code failed", { key: key ?? "unclassified" })
      // Clear the field so the auto-submit effect below can fire again on the
      // next six digits instead of sitting on a known-bad value. An expired
      // code is as dead as a wrong one — leaving it in place would strand the
      // user on a field that can never auto-submit again.
      if (key === "wrongCode" || key === "codeExpired") setCode("")
      if (key === "tooManyAttempts") {
        setCode("")
        setStep((s) => nextStep(s, "tooManyAttempts"))
      }
    } finally {
      verifyInFlight.current = false
    }
  }, [verifyCode, email, code, clearError])

  // Auto-submit the moment six digits are present, autofilled or typed
  // (spec 1 §1.3) — the OS one-time-code suggestion fills the field in one go
  // and an extra Verify tap after that reads as a bug.
  useEffect(() => {
    if (step === "code" && /^\d{6}$/.test(code) && !isLoading) void handleVerify()
    // Keyed on `code` alone on purpose: `handleVerify` changes identity with
    // every keystroke, so depending on it would re-fire the submit mid-request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const runAction = useCallback(
    async (action: PendingAction) => {
      if (!action) return
      clearError()
      setInFlight(action.kind)
      try {
        switch (action.kind) {
          case "email":
            setStep((s) => nextStep(s, "chooseEmail"))
            return
          case "ownerEmail":
            if (!ownerEmail) return
            // Seed the field too: the code step masks it, and "Wrong email?"
            // drops the user onto the email step with it already filled in.
            setEmail(ownerEmail)
            await runSend(ownerEmail, "chooseOwnerEmail")
            return
          case "provider":
            await loginWithProvider(action.connection)
            trackEvent("login_completed", {
              method: action.connection === "apple" ? "apple" : "google",
            })
            return
          case "anonymous":
            loginAnonymously()
            trackEvent("login_completed", { method: "anonymous" })
            return
        }
      } finally {
        setInFlight(null)
      }
    },
    [clearError, ownerEmail, runSend, loginWithProvider, loginAnonymously],
  )

  // Every entry point goes through the legal gate first — unchanged in
  // substance from the two-button screen, just one funnel instead of three
  // near-identical handlers.
  const gated = useCallback(
    (action: PendingAction) => {
      log.info("Login action", { kind: action?.kind ?? "none" })
      if (termsAlreadyAccepted) {
        void runAction(action)
      } else {
        // Clear here too, not just in runAction: the modal covers the screen
        // but the strip is still behind it, so a previous failure would be the
        // first thing the user sees again after accepting.
        clearError()
        setPendingAction(action)
        setShowEuaModal(true)
      }
    },
    [termsAlreadyAccepted, runAction, clearError],
  )

  // Kept for the commented-out anonymous-login button further down (see the
  // comment above that block). Disabling the rule rather than renaming to
  // `_handleAnonymousPress` keeps re-enabling a literal one-block uncomment.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleAnonymousPress = useCallback(() => gated({ kind: "anonymous" }), [gated])

  const handleEuaAgree = useCallback(async () => {
    // Belt-and-braces alongside the button's `disabled` prop: acceptance is
    // persisted to SecureStore and never re-asked, so a single slip here would
    // permanently record consent to documents the user was never shown.
    if (!canAgree) {
      log.warn("EUA accept blocked — legal content not displayed")
      return
    }

    log.info("EUA accepted", { action: pendingAction?.kind ?? "none" })
    setShowEuaModal(false)

    // Persist acceptance to SecureStore
    setTermsAlreadyAccepted(true)
    setTermsAccepted().catch((err) =>
      log.error("Failed to persist terms acceptance", { error: String(err) }),
    )

    await runAction(pendingAction)
    setPendingAction(null)
  }, [canAgree, pendingAction, runAction])

  const handleEuaCancel = useCallback(() => {
    log.info("EUA cancelled", { action: pendingAction?.kind ?? "none" })
    setShowEuaModal(false)
    setPendingAction(null)
  }, [pendingAction])

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
        {/* CHANGED 2026-09-18: given live-region semantics. This strip is now
            the ONLY error surface for all three steps (see runSend), and it
            appears without any focus change — a screen-reader user would
            otherwise never learn that the code was rejected. `alert` is what
            iOS announces; `accessibilityLiveRegion` is the Android half. */}
        {error && (
          <View
            style={themed($errorContainer)}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text style={themed($errorText)}>{error}</Text>
          </View>
        )}

        {/* REMOVED 2026-08-09: the "This is the updated AA/NA Live app" notice banner.
            It announced the AA/NA Live → RecoverySky rename to migrating users and has
            outlived that transition — same reason the matching HomeScreen card is gone. */}

        {step === "choose" && (
          <ChooseStep
            ownerEmailMasked={ownerEmail ? maskEmail(ownerEmail) : undefined}
            isLoading={isLoading}
            onEmail={() => gated({ kind: "email" })}
            onOwnerEmail={() => gated({ kind: "ownerEmail" })}
            onProvider={(connection) => gated({ kind: "provider", connection })}
          />
        )}

        {step === "email" && (
          <EmailStep
            email={email}
            onChangeEmail={setEmail}
            isSending={isLoading}
            onSend={() => void runSend(email, "codeSent")}
            onBack={() => {
              clearError()
              setStep((s) => nextStep(s, "back"))
            }}
          />
        )}

        {step === "code" && (
          <CodeStep
            emailMasked={maskEmail(email)}
            code={code}
            onChangeCode={setCode}
            isVerifying={isLoading}
            onVerify={() => void handleVerify()}
            resendWaitSeconds={resendWaitSeconds(lastSentAt, now)}
            onResend={() => void runSend(email, "codeSent")}
            onWrongEmail={() => {
              clearError()
              // Drop the code with the address: it was issued for the old one.
              setCode("")
              setStep((s) => nextStep(s, "wrongEmail"))
            }}
          />
        )}

        {/* Anonymous login intentionally disabled in the UI. We're keeping the
            handler + state plumbing (handleAnonymousPress, loginAnonymously,
            the "anonymous" PendingAction) so re-enabling is a one-block
            uncomment. Hidden because the anonymous-user experience doesn't
            meet the bar we want for new installs — bring it back only when
            paired with a clear upgrade path.
            CHANGED 2026-09-17: also gated on the choose step, so re-enabling
            it cannot put an anonymous button under the code field. */}
        {/* {Platform.OS !== "ios" && step === "choose" && (
          <Pressable
            testID="anonymous-button"
            accessibilityRole="button"
            accessibilityLabel={translate("loginScreen:continueAnonymously")}
            onPress={handleAnonymousPress}
            disabled={isLoading}
          >
            <Text style={themed($loadingText)} tx="loginScreen:continueAnonymously" />
          </Pressable>
        )} */}

        {/* Only the provider path leaves the app, so only it gets this copy —
            an email code never opens a browser. */}
        {isLoading && inFlight === "provider" && (
          <Text style={themed($loadingText)} tx="loginScreen:openingBrowser" />
        )}
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

// MOVED 2026-09-17 to app/screens/login/LoginSteps.tsx: $button, $buttonDisabled,
// $buttonText, $buttonTextSecondary and $spinner now live with the buttons that
// use them, so WrongAccountScreen gets the same look for free.

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
