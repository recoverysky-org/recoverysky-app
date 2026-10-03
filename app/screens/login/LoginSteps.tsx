/**
 * The three states of the login screen (spec 1 §1). Presentational: every
 * decision arrives as a prop, every action leaves as a callback, so the jest
 * test can mount them without navigation, the SDK, or the MST tree — and so
 * WrongAccountScreen can reuse CodeStep unchanged (spec 2 §2.3).
 *
 * Nothing here calls `isPlausibleEmail`'s caller or the step machine: the
 * screen owns the flow. These components only know how to draw one state.
 */
import {
  ActivityIndicator,
  Platform,
  Pressable,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import { Text } from "@/components/Text"
import { TextField } from "@/components/TextField"
import { translate } from "@/i18n"
import { isPlausibleEmail } from "@/services/auth/loginFlowLogic"
import type { ProviderConnection } from "@/services/auth/useAuth0Wrapper"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/** Six digits, nothing else — the shape Auth0's email OTP always takes. */
const SIX_DIGITS = /^\d{6}$/

export interface ChooseStepProps {
  /** `j***@proton.me` when the device owner uses the code path (spec 2 §2.6); absent otherwise. */
  ownerEmailMasked?: string
  isLoading: boolean
  onEmail: () => void
  onOwnerEmail: () => void
  onProvider: (connection: ProviderConnection) => void
}

export function ChooseStep({
  ownerEmailMasked,
  isLoading,
  onEmail,
  onOwnerEmail,
  onProvider,
}: ChooseStepProps) {
  const { themed, theme } = useAppTheme()

  // Apple above Google on iOS: App Store guideline 4.8 wants the Apple button
  // at least as prominent as other third-party logins. Android leads with
  // Google (spec 1 §1.1). Built as variables and ordered below rather than
  // duplicated per branch, so the two platforms can never drift apart.
  const apple = (
    <Pressable
      key="apple"
      testID="login-apple"
      accessibilityRole="button"
      accessibilityLabel={translate("loginScreen:continueWithApple")}
      style={[themed($button), isLoading && themed($buttonDisabled)]}
      onPress={() => onProvider("apple")}
      disabled={isLoading}
    >
      <Text style={themed($buttonText)} tx="loginScreen:continueWithApple" />
    </Pressable>
  )
  const google = (
    <Pressable
      key="google"
      testID="login-google"
      accessibilityRole="button"
      accessibilityLabel={translate("loginScreen:continueWithGoogle")}
      style={[themed($button), isLoading && themed($buttonDisabled)]}
      onPress={() => onProvider("google-oauth2")}
      disabled={isLoading}
    >
      <Text style={themed($buttonText)} tx="loginScreen:continueWithGoogle" />
    </Pressable>
  )

  return (
    <View style={themed($stack)}>
      {Platform.OS === "ios" ? [apple, google] : [google, apple]}

      {ownerEmailMasked ? (
        // The owner of this device already told us their address, so the code
        // path is one tap (spec 2 §2.6). The plain email button is replaced,
        // not added to — two email buttons would read as two accounts — and
        // "Use a different email" is the way out for a borrowed device.
        <>
          <Pressable
            testID="login-owner-email"
            accessibilityRole="button"
            accessibilityLabel={translate("loginScreen:sendCodeTo", { email: ownerEmailMasked })}
            style={[themed($button), isLoading && themed($buttonDisabled)]}
            onPress={onOwnerEmail}
            disabled={isLoading}
          >
            <Text
              style={themed($buttonText)}
              tx="loginScreen:sendCodeTo"
              txOptions={{ email: ownerEmailMasked }}
            />
          </Pressable>
          <Pressable
            testID="login-use-different-email"
            accessibilityRole="link"
            accessibilityLabel={translate("loginScreen:useDifferentEmail")}
            onPress={onEmail}
            disabled={isLoading}
          >
            <Text style={themed($linkText)} tx="loginScreen:useDifferentEmail" />
          </Pressable>
        </>
      ) : (
        <Pressable
          testID="login-email"
          accessibilityRole="button"
          accessibilityLabel={translate("loginScreen:continueWithEmail")}
          style={[themed($button), isLoading && themed($buttonDisabled)]}
          onPress={onEmail}
          disabled={isLoading}
        >
          <Text style={themed($buttonText)} tx="loginScreen:continueWithEmail" />
        </Pressable>
      )}

      {isLoading && (
        <ActivityIndicator size="small" color={theme.colors.tint} style={themed($spinner)} />
      )}
    </View>
  )
}

export interface EmailStepProps {
  email: string
  onChangeEmail: (value: string) => void
  isSending: boolean
  onSend: () => void
  onBack: () => void
}

export function EmailStep({ email, onChangeEmail, isSending, onSend, onBack }: EmailStepProps) {
  const { themed } = useAppTheme()
  const canSend = isPlausibleEmail(email) && !isSending

  return (
    <View style={themed($stack)}>
      <TextField
        testID="login-email-field"
        labelTx="loginScreen:emailLabel"
        placeholderTx="loginScreen:emailPlaceholder"
        value={email}
        onChangeText={onChangeEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        // textContentType/autoComplete are what put the address in the iOS
        // QuickType bar and the Android autofill sheet. Without both, most
        // users type their email by hand on a phone keyboard.
        textContentType="emailAddress"
        autoComplete="email"
        returnKeyType="send"
        // Only wired when the address is usable, so the keyboard's Send key
        // can never fire a request the button itself refuses.
        onSubmitEditing={canSend ? onSend : undefined}
        editable={!isSending}
      />
      <Pressable
        testID="login-send-code"
        accessibilityRole="button"
        accessibilityLabel={translate("loginScreen:sendCode")}
        accessibilityState={{ disabled: !canSend }}
        style={[themed($button), !canSend && themed($buttonDisabled)]}
        onPress={onSend}
        disabled={!canSend}
      >
        <Text style={themed($buttonText)} tx="loginScreen:sendCode" />
        {isSending && <ActivityIndicator size="small" style={themed($spinner)} />}
      </Pressable>
      <Pressable
        testID="login-back"
        accessibilityRole="button"
        accessibilityLabel={translate("common:back")}
        onPress={onBack}
        disabled={isSending}
      >
        <Text style={themed($linkText)} tx="common:back" />
      </Pressable>
    </View>
  )
}

export interface CodeStepProps {
  /**
   * The address shown in "We sent a code to …", exactly as the caller wants it
   * shown. Login and the wrong-account screen pass it masked; the verify-email
   * flow passes it in full. CHANGED 2026-10-02: was `emailMasked`, renamed when
   * the verify flow stopped masking (catching a typo is its whole job).
   * CHANGED 2026-10-03: Login passes it in full too; only the wrong-account
   * screen still masks.
   */
  email: string
  code: string
  onChangeCode: (value: string) => void
  isVerifying: boolean
  onVerify: () => void
  /** 0 = Resend allowed now; otherwise the countdown shown on the link. */
  resendWaitSeconds: number
  onResend: () => void
  onWrongEmail: () => void
}

export function CodeStep({
  email,
  code,
  onChangeCode,
  isVerifying,
  onVerify,
  resendWaitSeconds,
  onResend,
  onWrongEmail,
}: CodeStepProps) {
  const { themed } = useAppTheme()
  const canVerify = SIX_DIGITS.test(code) && !isVerifying
  const canResend = resendWaitSeconds === 0 && !isVerifying

  return (
    <View style={themed($stack)}>
      {/* Masked, never the full address: this screen is often read over a
          shoulder, and the user only needs to recognise their own inbox.
          CHANGED 2026-10-02: the masking now happens at the sign-in call sites
          (LoginScreen, WrongAccountView), which still pass a masked address.
          The verify-email flow passes the full one: there the user is checking
          the address for a typo, and a mask hides exactly that.
          CHANGED 2026-10-03: LoginScreen passes the full address as well, for
          the same reason. WrongAccountView is the one caller left that masks
          (it shows the owner's address, which nobody typed). */}
      <Text
        preset="subheading"
        style={themed($centered)}
        tx="loginScreen:codeSentTo"
        txOptions={{ email }}
      />
      <TextField
        testID="login-code-field"
        labelTx="loginScreen:codeLabel"
        value={code}
        // Digits only: OS autofill hands us "123456"; a pasted "123 456" is
        // normalised rather than rejected. The slice is belt-and-braces next
        // to maxLength, which Android soft keyboards do not always honour.
        onChangeText={(v) => onChangeCode(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        // The pair that makes iOS offer the code straight off the mail
        // notification and Android autofill it from SMS/email retrievers.
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        editable={!isVerifying}
      />
      <Pressable
        testID="login-verify"
        accessibilityRole="button"
        accessibilityLabel={translate("loginScreen:verify")}
        accessibilityState={{ disabled: !canVerify }}
        style={[themed($button), !canVerify && themed($buttonDisabled)]}
        onPress={onVerify}
        disabled={!canVerify}
      >
        <Text style={themed($buttonText)} tx="loginScreen:verify" />
        {isVerifying && <ActivityIndicator size="small" style={themed($spinner)} />}
      </Pressable>
      <Pressable
        testID="login-resend"
        accessibilityRole="button"
        // The countdown has to be in the spoken label too — a screen-reader
        // user gets no other signal that the control is temporarily inert.
        accessibilityLabel={
          canResend
            ? translate("loginScreen:resendCode")
            : translate("loginScreen:resendIn", { seconds: resendWaitSeconds })
        }
        accessibilityState={{ disabled: !canResend }}
        onPress={onResend}
        disabled={!canResend}
      >
        {canResend ? (
          <Text style={themed($linkText)} tx="loginScreen:resendCode" />
        ) : (
          <Text
            style={themed($linkTextDim)}
            tx="loginScreen:resendIn"
            txOptions={{ seconds: resendWaitSeconds }}
          />
        )}
      </Pressable>
      <Pressable
        testID="login-wrong-email"
        accessibilityRole="button"
        accessibilityLabel={translate("loginScreen:wrongEmailGoBack")}
        onPress={onWrongEmail}
        disabled={isVerifying}
      >
        <Text style={themed($linkText)} tx="loginScreen:wrongEmailGoBack" />
      </Pressable>
    </View>
  )
}

const $stack: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.md })

const $centered: ThemedStyle<TextStyle> = () => ({ textAlign: "center" })

// Same outline-with-glow button LoginScreen has always used; moved here with
// the buttons (2026-09-17) so the two screens that render steps share it.
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

const $buttonDisabled: ThemedStyle<ViewStyle> = () => ({ opacity: 0.7 })

const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 18,
  fontWeight: "600",
  color: colors.tint,
})

const $linkText: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.tint,
  fontSize: 15,
})

const $linkTextDim: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
  fontSize: 15,
})

const $spinner: ThemedStyle<ViewStyle> = ({ spacing }) => ({ marginLeft: spacing.sm })
