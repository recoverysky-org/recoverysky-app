/**
 * Shown instead of Login when the SDK holds a session for an account that is
 * not this device's owner (spec 2 §2.3). Two exits only: prove you are the
 * owner, or Cancel. Nothing here can delete, rekey, or overwrite local data.
 *
 * The wrapper is mounted WITHOUT `onSqliteKeyChange`, which is NOT a guard
 * against a stranger's rekey — `handleSqliteKeyFromJwt` runs only after the
 * ownership gate has already ACCEPTED the session, so a foreign session never
 * reaches it. CHANGED 2026-09-18 (the original comment claimed otherwise).
 * The real effect: when the owner signs back in from here, this instance takes
 * the bare `setSqliteEncryptionKey` fallback branch rather than a rekey
 * callback — the same branch the AppStack instance takes on the normal login
 * path, since it mounts the hook bare too.
 *
 * This file is the observer shell: it reads the store and calls the auth
 * wrapper. The presentational half lives in WrongAccountView.tsx (jest-
 * covered) and is re-exported below so both symbols are importable from here,
 * as the task brief specified.
 */
import { FC, useCallback, useEffect, useRef, useState } from "react"
import { View, type TextStyle, type ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"

import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useAuthenticationStore } from "@/models"
import type { AppStackScreenProps } from "@/navigators/navigationTypes"
import { classifyAuthError } from "@/services/auth/authErrorLogic"
import { maskEmail, resendWaitSeconds } from "@/services/auth/loginFlowLogic"
import { ownerProofMethod } from "@/services/auth/ownerLogic"
import { useAuth0Wrapper, type ProviderConnection } from "@/services/auth/useAuth0Wrapper"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { logger } from "@/utils/logger"

import { WrongAccountView } from "./WrongAccountView"

export { WrongAccountView, type WrongAccountViewProps } from "./WrongAccountView"

const log = logger.child({ module: "WrongAccountScreen" })

/** Six digits, nothing else — the shape Auth0's email OTP always takes. */
const SIX_DIGITS = /^\d{6}$/

interface WrongAccountScreenProps extends AppStackScreenProps<"WrongAccount"> {}

export const WrongAccountScreen: FC<WrongAccountScreenProps> = observer(
  function WrongAccountScreen() {
    const { themed } = useAppTheme()
    const authStore = useAuthenticationStore()
    const {
      sendCode,
      verifyCode,
      loginWithProvider,
      abandonForeignSession,
      isLoading,
      error,
      clearError,
    } = useAuth0Wrapper()

    const proofMethod = ownerProofMethod(authStore.ownerSub)
    const ownerEmail = authStore.ownerEmail
    const foreignMethod = authStore.foreignSession?.loginMethod

    const [step, setStep] = useState<"prompt" | "code">("prompt")
    const [code, setCode] = useState("")
    const [lastSentAt, setLastSentAt] = useState<number | null>(null)
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
      if (proofMethod === "unknown") {
        // Never the sub or the address: both are identifiers.
        log.warn("Owner has an unrecognised sub prefix", { hasEmail: !!ownerEmail })
      }
      trackEvent("wrong_account_shown", { proof: proofMethod })
    }, [proofMethod, ownerEmail])

    // One-second tick for the Resend countdown, only while the code step is
    // up. Anywhere else it would re-render the screen once a second for
    // nothing (same rule as LoginScreen).
    useEffect(() => {
      if (step !== "code") return
      const id = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(id)
    }, [step])

    /**
     * ONE error surface, exactly as on LoginScreen: `sendCode` / `verifyCode`
     * fail twice over — they reject with the raw SDK error AND the SDK's own
     * reducer dispatches ERROR, which the wrapper turns into its `error`
     * state. The strip below renders that and nothing else; these catch
     * blocks only classify for step routing and for the log line, and must
     * never set a second message of their own, or one failure paints two.
     */
    const handleSendCode = useCallback(async () => {
      if (!ownerEmail) return
      clearError()
      try {
        await sendCode(ownerEmail)
        setLastSentAt(Date.now())
        // Seed the clock in the same tick so the countdown starts at the full
        // cooldown rather than at whatever the last tick left behind.
        setNow(Date.now())
        setStep("code")
      } catch (err) {
        const key = classifyAuthError(err)
        // Never the address: an email in a log line is an identifier.
        log.warn("Send code failed", { key: key ?? "unclassified" })
        // Auth0 is holding this address down. Mirrors LoginScreen's handling
        // of the same refusal, and `nextStep("code", "sendRateLimited")`,
        // which now keeps the user on the code step: a refused RESEND says
        // nothing about the code Auth0 already delivered, so the step is left
        // alone and the code being typed survives. The cooldown is re-armed
        // rather than left elapsed — the refusal only arrives once the
        // previous cooldown has run out, so a Resend link left hot would be
        // tappable again immediately and would do nothing but feed the edge's
        // 429 counter (this repo has a CrowdSec history with that shape).
        if (key === "sendRateLimited") {
          setLastSentAt(Date.now())
          setNow(Date.now())
        }
      }
    }, [ownerEmail, sendCode, clearError])

    /**
     * Guards the one-render window between "six digits are present" and
     * `isLoading` turning true, in which the auto-submit effect and the
     * still-enabled Verify button are both live — a fast tap would otherwise
     * spend two of Auth0's `too_many_attempts` budget on one code. A ref, not
     * state: it has to be readable and writable synchronously.
     */
    const verifyInFlight = useRef(false)

    const handleVerify = useCallback(async () => {
      if (!ownerEmail) return
      if (verifyInFlight.current) return
      verifyInFlight.current = true
      clearError()
      try {
        // Success needs no navigation: the SDK sets `user`, the wrapper's
        // ownership gate says `match`, the wrapper links the foreign identity
        // itself, and AppNavigator swaps this screen out for Main.
        await verifyCode(ownerEmail, code)
      } catch (err) {
        const key = classifyAuthError(err)
        // Never the code: it is a live credential until it expires.
        log.warn("Verify code failed", { key: key ?? "unclassified" })
        // Clear the field so the auto-submit effect can fire again on the next
        // six digits instead of sitting on a known-bad value. An expired code
        // is as dead as a wrong one.
        if (key === "wrongCode" || key === "codeExpired") setCode("")
        if (key === "tooManyAttempts") {
          // Here the CODE is locked out, so unlike a refused resend there is
          // nothing to come back to — drop to the prompt and a fresh send.
          setCode("")
          setStep("prompt")
        }
      } finally {
        verifyInFlight.current = false
      }
    }, [ownerEmail, code, verifyCode, clearError])

    // Auto-submit the moment six digits are present, autofilled or typed — the
    // OS one-time-code suggestion fills the field in one go and an extra
    // Verify tap after that reads as a bug.
    useEffect(() => {
      if (step === "code" && SIX_DIGITS.test(code) && !isLoading) void handleVerify()
      // Keyed on `code` alone on purpose: `handleVerify` changes identity with
      // every keystroke, so depending on it would re-fire mid-request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code])

    const handleProvider = useCallback(() => {
      const connection: ProviderConnection = proofMethod === "apple" ? "apple" : "google-oauth2"
      clearError()
      void loginWithProvider(connection, {
        // The owner's address only prefills the provider's own account
        // chooser; it is never drawn on this screen for a social owner.
        loginHint: ownerEmail,
        // The cookie trap (spec 2 §2.3): a browser-established foreign
        // session — or one we cannot classify, which a cold-start restore
        // always is — must be logged out of Auth0 first, or the provider
        // hands that same wrong account straight back.
        clearBrowserSessionFirst: foreignMethod !== "email",
      })
    }, [proofMethod, ownerEmail, foreignMethod, loginWithProvider, clearError])

    const handleCancel = useCallback(() => {
      trackEvent("wrong_account_cancelled")
      // Drops the foreign session and the SDK's credentials, plus Auth0's
      // browser cookie when the session may have come through it. Never the
      // owner record, never local data.
      void abandonForeignSession()
    }, [abandonForeignSession])

    return (
      <Screen
        preset="auto"
        contentContainerStyle={themed($screen)}
        safeAreaEdges={["top", "bottom"]}
      >
        {/* Live-region semantics for the same reason LoginScreen's strip has
            them: this is the only error surface and it appears with no focus
            change, so a screen-reader user would otherwise never learn that
            the code was rejected. `alert` is what iOS announces;
            `accessibilityLiveRegion` is the Android half. */}
        {error && (
          <View
            style={themed($errorContainer)}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text style={themed($errorText)}>{error}</Text>
          </View>
        )}

        <WrongAccountView
          proofMethod={proofMethod}
          // Only the code path ever receives an address (spec 2 §2.3). The
          // view refuses one for a social method too — belt and braces, since
          // an Apple relay alias leaking here is not recoverable.
          ownerEmailMasked={
            (proofMethod === "code" || proofMethod === "unknown") && ownerEmail
              ? maskEmail(ownerEmail)
              : undefined
          }
          step={step}
          code={code}
          onChangeCode={setCode}
          resendWaitSeconds={resendWaitSeconds(lastSentAt, now)}
          isBusy={isLoading}
          onSendCode={() => void handleSendCode()}
          onVerify={() => void handleVerify()}
          onResend={() => void handleSendCode()}
          onProvider={handleProvider}
          onCancel={handleCancel}
        />
      </Screen>
    )
  },
)

const $screen: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  paddingVertical: spacing.xxl,
  paddingHorizontal: spacing.lg,
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
