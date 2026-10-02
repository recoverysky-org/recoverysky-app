/**
 * VerifyEmailGate (legacy email verification spec §3–5)
 *
 * A full-screen modal asking an unverified legacy PASSWORD account to confirm
 * or correct its email, so passwordless sign-in can find the account later.
 * Built like AnnouncementGate: it checks on mount and on every foreground,
 * and additionally whenever the things it depends on change (a sign-in, the
 * end of onboarding, coming back online, a timer ending, the other gate
 * letting go of the overlay).
 *
 * A Modal, NOT a navigator state: it can appear mid-session (the user comes
 * back to the app a day later), and swapping the navigator would unmount
 * whatever they had open. Nothing underneath is touched.
 *
 * This shell only does I/O. Who is asked, when, and how often are pure
 * functions in services/auth/emailVerifyLogic.ts (vitest-covered).
 */
import { FC, useCallback, useEffect, useState } from "react"
import { AppState, Linking, Modal, Platform, View, type ViewStyle } from "react-native"
import { observer } from "mobx-react-lite"
import { useAuth0 } from "react-native-auth0"

import { useAuthenticationStore, useConfigStore, useNetworkStore, useProfileStore } from "@/models"
import { api } from "@/services/api"
import type { EmailVerifyProblem } from "@/services/api/emailVerifyProblem"
import { isTimerSessionActive } from "@/services/attendance/timerSession"
import { renewStoredCredentials } from "@/services/auth/auth0Client"
import {
  SUPPORT_EMAIL,
  VERIFY_RESEND_COOLDOWN_MS,
  WHY_VERIFY_URL,
  decideVerifyPrompt,
  emailChanged,
  mustCloseShownGate,
  needsEmailVerification,
  recordShowing,
  stepAfterVerifyProblem,
  verifyGateBlocked,
} from "@/services/auth/emailVerifyLogic"
import { loadVerifyState, saveVerifyState } from "@/services/auth/emailVerifyState"
import { maskEmail, resendWaitSeconds } from "@/services/auth/loginFlowLogic"
import { setUserEmail } from "@/services/purchases/revenueCatService"
import { trackEvent } from "@/services/tracking"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { todayLocalISODate } from "@/utils/localDate"
import { logger } from "@/utils/logger"
import { claimOverlay, overlayOwner, releaseOverlay } from "@/utils/overlayGate"

import { RootModalScroll } from "./RootModalScroll"
import { VerifyEmailView, type VerifyStep } from "./VerifyEmailView"

const log = logger.child({ module: "VerifyEmailGate" })
const OVERLAY = "verifyEmail"
const SIX_DIGITS = /^\d{6}$/

type Shown = { mode: "skippable"; skipsLeft: number } | { mode: "mandatory" }

export const VerifyEmailGate: FC = observer(function VerifyEmailGate() {
  const authStore = useAuthenticationStore()
  const profileStore = useProfileStore()
  const configStore = useConfigStore()
  const networkStore = useNetworkStore()
  const { themed } = useAppTheme()
  // The SDK hook directly, NOT useAuth0Wrapper: that hook registers the [user]
  // sync effect and already has five mount sites (see its pendingLoginMethod
  // comment). Only getCredentials is used, to publish a renewal (verify below).
  const { getCredentials } = useAuth0()

  const [shown, setShown] = useState<Shown | null>(null)
  const [step, setStep] = useState<VerifyStep>("review")
  const [newEmail, setNewEmail] = useState("")
  const [target, setTarget] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<EmailVerifyProblem | null>(null)
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Everything observable is read HERE, in render, so this observer re-renders
  // — and `evaluate` below gets a new identity and runs again — when any of it
  // changes. That is what makes the gate appear right after a password
  // sign-in, at the end of onboarding, or when the device comes back online.
  const sub = authStore.isAnonymous ? undefined : authStore.userId
  const accountEmail = authStore.authEmail
  const claim = authStore.emailVerified
  const loginMethod = authStore.loginMethod
  const blocked = verifyGateBlocked({
    isAuthenticated: authStore.isAuthenticated,
    isAnonymous: authStore.isAnonymous,
    onboardingCompleted: profileStore.onboardingCompleted,
    offline: networkStore.isOffline,
    maintenanceMode: configStore.maintenanceMode,
    outageMode: configStore.outageMode,
    timerSessionActive: isTimerSessionActive(),
    // ADDED 2026-10-01: every send is refused locally while the lane is
    // degraded, so a mandatory screen there could not be passed.
    deviceAuthDegraded: configStore.deviceAuthDegraded,
  })
  const overlay = overlayOwner()

  const evaluate = useCallback(() => {
    if (shown) return
    if (!sub || blocked) return
    const state = loadVerifyState(sub)
    if (
      !needsEmailVerification({
        sub,
        emailVerifiedClaim: claim,
        loginMethod,
        locallyVerified: state.verified,
      })
    ) {
      return
    }
    const today = todayLocalISODate()
    const prompt = decideVerifyPrompt(state, today)
    if (prompt.mode === "hidden") return
    // An announcement is up: wait. `overlay` in the deps re-runs this when it closes.
    if (!claimOverlay(OVERLAY)) return
    // Counted when DISPLAYED, not when "Not now" is tapped (spec §4).
    const next = recordShowing(state, today)
    saveVerifyState(sub, next)
    log.info("Verify email shown", { mode: prompt.mode, showing: next.count })
    trackEvent("verify_email_shown", { mode: prompt.mode })
    setStep("review")
    setProblem(null)
    setCode("")
    setNewEmail("")
    setShown(prompt)
    // `overlay` is listed only so a release by the other gate re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sub, blocked, claim, loginMethod, overlay])

  useEffect(() => {
    evaluate()
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") evaluate()
    })
    return () => subscription.remove()
  }, [evaluate])

  // The account signed out (or was switched) underneath the modal: close it.
  // CHANGED 2026-10-01: a MANDATORY screen also closes when the gate becomes
  // blocked (offline, maintenance, outage, a timer): it could not send a code
  // and has no "Not now", which would lock the user out of meetings. It
  // re-shows by itself once unblocked because mandatory latches. A SKIPPABLE
  // one stays, since it has "Not now" and its day is already counted.
  // (A degraded device lane joined the blocked list 2026-10-01.)
  useEffect(() => {
    if (shown && mustCloseShownGate({ mode: shown.mode, hasAccount: !!sub, blocked })) {
      releaseOverlay(OVERLAY)
      setShown(null)
    }
  }, [shown, sub, blocked])

  // ADDED 2026-10-01: an unmounted gate must not hold the overlay forever, or
  // the announcement gate would wait on it for the rest of the session. A
  // release by a non-owner is a no-op, so this is safe when nothing is shown.
  useEffect(() => () => releaseOverlay(OVERLAY), [])

  // One-second tick for the Resend countdown, only on the code step (the same
  // rule as LoginScreen: no re-render per second for nothing).
  useEffect(() => {
    if (!shown || step !== "code") return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [shown, step])

  const close = useCallback(() => {
    releaseOverlay(OVERLAY)
    setShown(null)
  }, [])

  const send = useCallback(async (email: string) => {
    setBusy(true)
    setProblem(null)
    const result = await api.startEmailVerification(email)
    setBusy(false)
    if (result.kind === "problem") {
      setProblem(result.code)
      // Re-arm the cooldown on a refusal, as WrongAccountScreen does: a hot
      // Resend link would only feed the rate limiter.
      if (result.code === "rate_limited") {
        setLastSentAt(Date.now())
        setNow(Date.now())
      }
      return
    }
    setTarget(email)
    setCode("")
    setLastSentAt(Date.now())
    setNow(Date.now())
    setStep("code")
  }, [])

  const verify = useCallback(async () => {
    if (!sub || busy || !SIX_DIGITS.test(code)) return
    setBusy(true)
    setProblem(null)
    const result = await api.confirmEmailVerification(target, code)
    setBusy(false)
    if (result.kind === "problem") {
      setProblem(result.code)
      setCode("")
      // The code is dead: back to where a new one can be sent. An address
      // already in use goes to the change step.
      const next = stepAfterVerifyProblem(result.code)
      if (next) setStep(next)
      return
    }
    const changed = emailChanged(result.email, accountEmail)
    // The local record first: it is what stops a stale cached ID token from
    // asking again on the next cold start.
    saveVerifyState(sub, { ...loadVerifyState(sub), verified: true })
    authStore.setEmailVerified(true)
    authStore.setAuthEmail(result.email)
    // The Login screen's "Send code to …" must offer the address that works.
    if (authStore.ownerSub === sub) authStore.setOwnerEmail(result.email)
    // RevenueCat's $email, so support finds the customer by the new address.
    void setUserEmail(result.email)
    // Never the address.
    log.info("Email verified", { changed })
    trackEvent("verify_email_done", { changed })
    // ADDED 2026-10-01 (final review I1): renew the SDK's credentials now. The
    // cached ID token still carries the OLD address, and on the next cold
    // start the [user] sync effect in useAuth0Wrapper would write it back
    // over authEmail (Settings, report sends and RevenueCat's $email would all
    // revert to the typo). The forced renewal stores a fresh ID token; the
    // hook's plain getCredentials() then dispatches SET_USER from it, and the
    // existing [user] effect writes the new address and email_verified: true
    // by itself. That effect sees the same sub (ownership "match") and the
    // same loginMethod inputs, so it cannot change loginMethod, re-run
    // onboarding, or open the wrong-account screen.
    // Fire-and-forget: the modal closes regardless, and a failure is logged
    // and nothing else (the local record above already stops a re-ask; the
    // address is fixed for good at the next natural renewal). The renewal is
    // on the standalone client so a failed one never reaches the provider's
    // error state (see renewStoredCredentials); the publish step only reads
    // the keychain entry the renewal just wrote. Never the
    // address or a token in the log. Native only: on web the SDK's cache is
    // memory-only, so a reload fetches the current profile anyway, and the
    // standalone client there is a separate cache that the provider never reads.
    if (Platform.OS !== "web") {
      void renewStoredCredentials()
        .then(() => getCredentials())
        .catch((err: unknown) => {
          const errCode = (err as { code?: unknown } | null)?.code
          log.warn("Credential renewal after verify failed", {
            code: typeof errCode === "string" ? errCode : "unknown",
          })
        })
    }
    close()
  }, [sub, busy, code, target, accountEmail, authStore, close, getCredentials])

  // Auto-submit on six digits, as on Login. Keyed on `code` alone: `verify`
  // changes identity with every keystroke.
  useEffect(() => {
    if (shown && step === "code" && SIX_DIGITS.test(code) && !busy) void verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const handleNotNow = useCallback(() => {
    trackEvent("verify_email_skipped")
    close()
  }, [close])

  if (!shown) return null

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      // Android back: "Not now" while skippable, nothing once mandatory.
      onRequestClose={shown.mode === "skippable" ? handleNotNow : () => undefined}
    >
      {/* CHANGED 2026-10-01 (final review I3): was a fixed SafeAreaView + View.
          The code step raises the keyboard and the change step's Send sits
          under the field, so on a small phone or at large text sizes a
          control — on the mandatory showing, the only ways forward — could
          sit off screen or under the keyboard. Screen's scroll preset
          (keyboard-aware scroll view, as on LoginScreen) fixes both; its
          safeAreaEdges replace the SafeAreaView. The outer View only carries
          accessibilityViewIsModal, which Screen does not take.
          CHANGED 2026-10-01 (device pass): <Screen preset="scroll"> crashed
          here — its useScrollToTop() needs a navigator screen above it, and
          this gate sits BESIDE <AppNavigator /> in app.tsx ("Couldn't find a
          route object"). RootModalScroll is the same scroll + keyboard +
          safe-area frame without the navigation hook. Never put <Screen>
          back in this Modal. */}
      <View style={$fill} accessibilityViewIsModal>
        <RootModalScroll contentContainerStyle={themed($content)}>
          <VerifyEmailView
            mode={shown.mode}
            skipsLeft={shown.mode === "skippable" ? shown.skipsLeft : undefined}
            step={step}
            accountEmail={accountEmail}
            targetEmailMasked={maskEmail(target)}
            newEmail={newEmail}
            onChangeNewEmail={setNewEmail}
            code={code}
            onChangeCode={setCode}
            resendWaitSeconds={resendWaitSeconds(lastSentAt, now, VERIFY_RESEND_COOLDOWN_MS)}
            isBusy={busy}
            problem={problem}
            onSendToAccount={() => void send(accountEmail)}
            onSendToNew={() => void send(newEmail.trim())}
            onGoToChange={() => {
              setProblem(null)
              setStep("change")
            }}
            onBackToReview={() => {
              setProblem(null)
              setStep("review")
            }}
            onVerify={() => void verify()}
            onResend={() => void send(target)}
            onNotNow={handleNotNow}
            onWhy={() => void Linking.openURL(WHY_VERIFY_URL)}
            onSupport={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          />
        </RootModalScroll>
      </View>
    </Modal>
  )
})

const $fill: ViewStyle = { flex: 1 }

// flexGrow, not flex: fills the viewport so a short screen stays centred, but
// may grow past it so the scroll view can reach every control (LoginScreen's
// $screenContentContainer, same reason). RootModalScroll paints the background.
const $content: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexGrow: 1,
  paddingVertical: spacing.xxl,
  paddingHorizontal: spacing.lg,
})
