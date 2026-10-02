/**
 * The presentational half of WrongAccountScreen (spec 2 §2.3, §4). Every
 * decision arrives as a prop and every action leaves as a callback, so jest
 * can mount it bare — no navigation, no SDK, no MST tree.
 *
 * ADAPTED from the task brief, which put this in WrongAccountScreen.tsx
 * alongside the observer shell: importing that file pulls in `@/components/
 * Screen` (react-native-keyboard-controller throws at import time without its
 * native module) and `@/models` → `@/db` → `@/services/sync` →
 * react-native-purchases (ESM, untransformed). Neither is mockable in a way
 * worth maintaining. Splitting it is also the pattern the sibling login steps
 * already use (LoginSteps.tsx / LoginSteps.test.tsx), and WrongAccountScreen
 * re-exports both symbols so the brief's export surface is unchanged.
 *
 * A plain View, not <Screen>: nothing in the jest suite provides a
 * SafeAreaProvider, and the shell owns the Screen wrapper.
 *
 * Nothing here can delete, rekey, or overwrite local data. Two exits only:
 * prove you are the owner, or Cancel.
 */
import { Pressable, View, type TextStyle, type ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import type { ProofMethod } from "@/services/auth/ownerLogic"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { CodeStep } from "./login/LoginSteps"

export interface WrongAccountViewProps {
  proofMethod: ProofMethod
  /** Shown only for the code path. Social owners never see an address (Apple relay). */
  ownerEmailMasked?: string
  step: "prompt" | "code"
  code: string
  onChangeCode: (value: string) => void
  resendWaitSeconds: number
  isBusy: boolean
  onSendCode: () => void
  onVerify: () => void
  onResend: () => void
  onProvider: () => void
  /**
   * ADDED 2026-10-01: given only when the owner is a legacy password account
   * (ownerHasPassword). Such an owner may be unable to receive the code.
   */
  onPassword?: () => void
  onCancel: () => void
}

export function WrongAccountView(props: WrongAccountViewProps) {
  const { themed } = useAppTheme()
  const { proofMethod, ownerEmailMasked, step, isBusy } = props

  // An `unknown` sub prefix with a stored address still gets the code path:
  // spec 1's post-login Action links an `email|` login into an account with a
  // matching address, so a code can resolve to the owner's sub. If it does
  // not, the ownership gate refuses again and the user lands back here — no
  // worse off, and better than a screen whose only control is Cancel.
  const showCode = proofMethod === "code" || (proofMethod === "unknown" && !!ownerEmailMasked)
  const showProvider = proofMethod === "google" || proofMethod === "apple"
  // Single source for the address, so a social proof method cannot leak one
  // through any branch below — an Apple owner's relay alias is meaningless to
  // them and identifying to anyone reading over their shoulder (spec 2 §2.3).
  const emailMasked = showCode ? ownerEmailMasked : undefined
  const providerTx =
    proofMethod === "apple"
      ? ("wrongAccountScreen:signInWithApple" as const)
      : ("wrongAccountScreen:signInWithGoogle" as const)

  return (
    <View style={themed($container)}>
      <Text
        testID="wrong-account-title"
        accessibilityRole="header"
        preset="heading"
        style={themed($title)}
        tx="wrongAccountScreen:title"
      />
      <Text style={themed($body)} tx="wrongAccountScreen:body" />

      <View style={themed($controls)}>
        {step === "code" && emailMasked ? (
          <CodeStep
            email={emailMasked}
            code={props.code}
            onChangeCode={props.onChangeCode}
            isVerifying={isBusy}
            onVerify={props.onVerify}
            resendWaitSeconds={props.resendWaitSeconds}
            onResend={props.onResend}
            // "Wrong email? Go back" makes no sense here — the address is the
            // owner's and cannot be edited. Back out of the flow entirely.
            onWrongEmail={props.onCancel}
          />
        ) : (
          <>
            {emailMasked && (
              <Pressable
                testID="wrong-account-send-code"
                accessibilityRole="button"
                accessibilityLabel={translate("wrongAccountScreen:sendCodeTo", {
                  email: emailMasked,
                })}
                accessibilityState={{ disabled: isBusy }}
                style={[themed($button), isBusy && themed($buttonDisabled)]}
                onPress={props.onSendCode}
                disabled={isBusy}
              >
                <Text
                  style={themed($buttonText)}
                  tx="wrongAccountScreen:sendCodeTo"
                  txOptions={{ email: emailMasked }}
                />
              </Pressable>
            )}
            {showCode && props.onPassword && (
              <Pressable
                testID="wrong-account-password"
                accessibilityRole="link"
                accessibilityLabel={translate("wrongAccountScreen:passwordSignIn")}
                // ADDED 2026-10-01: it leaves the app for the browser; say so.
                accessibilityHint={translate("wrongAccountScreen:passwordSignInHint")}
                accessibilityState={{ disabled: isBusy }}
                // A one-line text link is well under the 44 pt touch target.
                hitSlop={12}
                onPress={props.onPassword}
                disabled={isBusy}
              >
                <Text style={themed($cancelText)} tx="wrongAccountScreen:passwordSignIn" />
              </Pressable>
            )}
            {showProvider && (
              <Pressable
                testID="wrong-account-provider"
                accessibilityRole="button"
                accessibilityLabel={translate(providerTx)}
                accessibilityState={{ disabled: isBusy }}
                style={[themed($button), isBusy && themed($buttonDisabled)]}
                onPress={props.onProvider}
                disabled={isBusy}
              >
                <Text style={themed($buttonText)} tx={providerTx} />
              </Pressable>
            )}
          </>
        )}

        <Pressable
          testID="wrong-account-cancel"
          accessibilityRole="button"
          accessibilityLabel={translate("wrongAccountScreen:cancel")}
          accessibilityState={{ disabled: isBusy }}
          onPress={props.onCancel}
          disabled={isBusy}
        >
          <Text style={themed($cancelText)} tx="wrongAccountScreen:cancel" />
        </Pressable>
      </View>

      {/* The only other way out of this screen, and deliberately not a
          control: support has to verify identity out of band before it can
          move a device's owner. */}
      <Text style={themed($support)} tx="wrongAccountScreen:support" />
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flex: 1,
  justifyContent: "center",
  gap: spacing.lg,
})

const $title: ThemedStyle<TextStyle> = () => ({ textAlign: "center" })

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
})

const $controls: ThemedStyle<ViewStyle> = ({ spacing }) => ({ gap: spacing.md })

const $support: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
  fontSize: 13,
})

const $cancelText: ThemedStyle<TextStyle> = ({ colors }) => ({
  textAlign: "center",
  color: colors.textDim,
  fontSize: 16,
  fontWeight: "600",
})

// Same outline-with-glow shape LoginSteps uses, so the two screens read as one
// flow. Not imported from there: those styles are module-private, and the
// buttons here are not steps.
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
