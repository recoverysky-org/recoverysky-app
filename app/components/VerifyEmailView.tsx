/**
 * The presentational half of VerifyEmailGate (legacy email verification spec
 * §5). Every decision arrives as a prop and every action leaves as a
 * callback, so jest mounts it bare — no stores, no API, no Modal.
 *
 * Three steps: review the address on the account → (optionally) change it →
 * enter the code. The change and code steps reuse the login steps so the two
 * flows look and behave the same.
 *
 * The account address is shown IN FULL on the review step, unlike everywhere
 * else in the app: the whole point is for its owner to eyeball it for typos,
 * on their own device.
 */
import { Pressable, View, type TextStyle, type ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import type { TxKeyPath } from "@/i18n"
import { CodeStep, EmailStep } from "@/screens/login/LoginSteps"
import type { EmailVerifyProblem } from "@/services/api/emailVerifyProblem"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export type VerifyStep = "review" | "change" | "code"

export interface VerifyEmailViewProps {
  mode: "skippable" | "mandatory"
  /** Shown on skippable showings: 6 on the first, 1 on the sixth. */
  skipsLeft?: number
  step: VerifyStep
  /** The address on the account, in full. */
  accountEmail: string
  /**
   * The address a code was last sent to, in full. CHANGED 2026-10-02: was
   * `targetEmailMasked`; the device pass showed "We sent a code to j***@…",
   * which hides the very typo this screen exists to catch.
   */
  targetEmail: string
  newEmail: string
  onChangeNewEmail: (value: string) => void
  code: string
  onChangeCode: (value: string) => void
  resendWaitSeconds: number
  isBusy: boolean
  problem: EmailVerifyProblem | null
  onSendToAccount: () => void
  onSendToNew: () => void
  onGoToChange: () => void
  onBackToReview: () => void
  onVerify: () => void
  onResend: () => void
  onNotNow: () => void
  onWhy: () => void
  onSupport: () => void
}

const PROBLEM_TX: Record<EmailVerifyProblem, TxKeyPath> = {
  email_in_use: "verifyEmailScreen:errorEmailInUse",
  invalid_code: "verifyEmailScreen:errorInvalidCode",
  code_expired: "verifyEmailScreen:errorCodeExpired",
  too_many_attempts: "verifyEmailScreen:errorTooManyAttempts",
  rate_limited: "verifyEmailScreen:errorRateLimited",
  inactive_recipient: "verifyEmailScreen:errorInactiveRecipient",
  not_password_account: "verifyEmailScreen:errorNotPasswordAccount",
  unavailable: "verifyEmailScreen:errorUnavailable",
}

/**
 * The text-only links are one line of text tall, well under the 44 pt touch
 * target; the slop makes up the difference without moving the layout.
 */
const LINK_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 }

export function VerifyEmailView(props: VerifyEmailViewProps) {
  const { themed } = useAppTheme()
  const { mode, step, isBusy, problem } = props

  return (
    <View style={themed($container)}>
      <Text
        testID="verify-email-title"
        accessibilityRole="header"
        preset="heading"
        style={themed($title)}
        tx="verifyEmailScreen:title"
      />

      {/* The only error surface. Live-region for the same reason as Login's
          strip: it appears with no focus change, so a screen-reader user would
          otherwise never learn the code was refused. */}
      {problem && (
        <View
          testID="verify-email-error"
          style={themed($errorBox)}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={themed($errorText)} tx={PROBLEM_TX[problem]} />
        </View>
      )}

      {step === "review" && (
        <View style={themed($controls)}>
          <Text style={themed($body)} tx="verifyEmailScreen:body" />
          <Text testID="verify-email-address" style={themed($address)} selectable>
            {props.accountEmail}
          </Text>
          <Pressable
            testID="verify-email-send"
            accessibilityRole="button"
            accessibilityLabel={translate("verifyEmailScreen:sendCode")}
            accessibilityState={{ disabled: isBusy }}
            style={[themed($button), isBusy && themed($disabled)]}
            onPress={props.onSendToAccount}
            disabled={isBusy}
          >
            <Text style={themed($buttonText)} tx="verifyEmailScreen:sendCode" />
          </Pressable>
          <Pressable
            testID="verify-email-change"
            accessibilityRole="link"
            accessibilityLabel={translate("verifyEmailScreen:changeEmail")}
            // Explicit even though Pressable derives it from `disabled`: it is
            // the a11y contract this screen promises, and it matches its siblings.
            accessibilityState={{ disabled: isBusy }}
            hitSlop={LINK_HIT_SLOP}
            onPress={props.onGoToChange}
            disabled={isBusy}
          >
            <Text style={themed($link)} tx="verifyEmailScreen:changeEmail" />
          </Pressable>
        </View>
      )}

      {step === "change" && (
        <EmailStep
          email={props.newEmail}
          onChangeEmail={props.onChangeNewEmail}
          isSending={isBusy}
          onSend={props.onSendToNew}
          onBack={props.onBackToReview}
        />
      )}

      {step === "code" && (
        <CodeStep
          email={props.targetEmail}
          code={props.code}
          onChangeCode={props.onChangeCode}
          isVerifying={isBusy}
          onVerify={props.onVerify}
          resendWaitSeconds={props.resendWaitSeconds}
          onResend={props.onResend}
          // "Wrong email?" here means: go and type a different one.
          onWrongEmail={props.onGoToChange}
        />
      )}

      <View style={themed($footer)}>
        <Pressable
          testID="verify-email-why"
          accessibilityRole="link"
          accessibilityLabel={translate("verifyEmailScreen:why")}
          accessibilityHint={translate("verifyEmailScreen:whyHint")}
          hitSlop={LINK_HIT_SLOP}
          onPress={props.onWhy}
        >
          <Text style={themed($link)} tx="verifyEmailScreen:why" />
        </Pressable>

        {mode === "skippable" ? (
          <>
            <Text
              style={themed($note)}
              tx="verifyEmailScreen:requiredWarning"
              txOptions={{ count: props.skipsLeft ?? 0 }}
            />
            <Pressable
              testID="verify-email-not-now"
              accessibilityRole="button"
              accessibilityLabel={translate("verifyEmailScreen:notNow")}
              accessibilityState={{ disabled: isBusy }}
              hitSlop={LINK_HIT_SLOP}
              onPress={props.onNotNow}
              disabled={isBusy}
            >
              <Text style={themed($notNow)} tx="verifyEmailScreen:notNow" />
            </Pressable>
          </>
        ) : (
          <>
            <Text style={themed($note)} tx="verifyEmailScreen:mandatory" />
            <Pressable
              testID="verify-email-support"
              accessibilityRole="link"
              accessibilityLabel={translate("verifyEmailScreen:contactSupport")}
              accessibilityHint={translate("verifyEmailScreen:contactSupportHint")}
              hitSlop={LINK_HIT_SLOP}
              onPress={props.onSupport}
            >
              <Text style={themed($link)} tx="verifyEmailScreen:contactSupport" />
            </Pressable>
          </>
        )}
      </View>
    </View>
  )
}

// CHANGED 2026-10-01: flexGrow, not flex. The gate now renders this inside a
// scrolling Screen; flexGrow still fills and centres when the content fits,
// but lets it grow past the viewport (small phone, large text, keyboard up)
// so the scroll view can reach every control — flex:1 would pin it to the
// viewport and clip it, as LoginScreen learned (see its $screenContentContainer).
const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexGrow: 1,
  justifyContent: "center",
  gap: spacing.lg,
})

const $title: ThemedStyle<TextStyle> = () => ({ textAlign: "center" })

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
})

const $address: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.text,
  fontSize: 20,
  fontWeight: "600",
})

const $controls: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.md })

const $footer: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.sm, alignItems: "center" })

const $note: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
  fontSize: 13,
})

const $link: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.tint,
  fontSize: 15,
  fontWeight: "600",
})

const $notNow: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
  fontSize: 16,
  fontWeight: "600",
})

const $errorBox: ThemedStyle<ViewStyle> = ({ spacing, colors }) => ({
  padding: spacing.md,
  backgroundColor: colors.errorBackground,
  borderRadius: 8,
})

const $errorText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.error,
  textAlign: "center",
})

// The same outline-with-glow shape WrongAccountView and LoginSteps use.
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

const $disabled: ThemedStyle<ViewStyle> = () => ({ opacity: 0.7 })

const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.tint,
})
