import { FC } from "react"
import { View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import { translate, type TxKeyPath } from "@/i18n"
import type { AccountIdentity, AccountMethod } from "@/services/auth/accountMethodsLogic"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

interface AccountMethodRowProps {
  identity: AccountIdentity
  /** "active" = how this session signed in; "linked" = another identity on the same account. */
  status: "active" | "linked"
}

const METHOD_ICON: Record<AccountMethod, keyof typeof Ionicons.glyphMap> = {
  email: "mail-outline",
  google: "logo-google",
  apple: "logo-apple",
}

const METHOD_LABEL: Record<AccountMethod, TxKeyPath> = {
  email: "settingsScreen:accountMethodEmail",
  google: "settingsScreen:accountMethodGoogle",
  apple: "settingsScreen:accountMethodApple",
}

/**
 * One sign-in method row in Settings → Account (ADDED 2026-09-29).
 * Presentational only — the decision of what to show lives in the pure
 * `accountMethodsLogic.ts`; this just renders an AccountIdentity.
 *
 * The full email is shown on purpose (decided 2026-09-28): the row exists so
 * the owner can tell WHICH account they are in, and a masked address can't
 * distinguish two same-provider accounts. An Apple relay address is replaced
 * by "Hidden by Apple" because the relay string means nothing to the user.
 *
 * The row is one accessibility element with a composed label, so VoiceOver /
 * TalkBack read "Signed in with Google: me@gmail.com" rather than three
 * disconnected fragments.
 */
export const AccountMethodRow: FC<AccountMethodRowProps> = ({ identity, status }) => {
  const { themed, theme } = useAppTheme()
  const method = translate(METHOD_LABEL[identity.method])
  const email = identity.hiddenByApple
    ? translate("settingsScreen:accountHiddenByApple")
    : (identity.email ?? "")
  const a11yLabel = translate(
    status === "active" ? "settingsScreen:accountActiveA11y" : "settingsScreen:accountLinkedA11y",
    { method, email },
  )

  return (
    <View
      style={themed($row)}
      accessible
      accessibilityLabel={a11yLabel}
      testID={`account-method-${status}-${identity.method}`}
    >
      <View style={themed($labelGroup)}>
        <Ionicons name={METHOD_ICON[identity.method]} size={16} color={theme.colors.textDim} />
        <Text style={themed($label)} text={method} />
      </View>
      <View style={themed($valueGroup)}>
        {email ? (
          <Text
            style={[themed($email), identity.hiddenByApple && themed($emailHidden)]}
            text={email}
            numberOfLines={1}
            ellipsizeMode="middle"
          />
        ) : null}
        <Text
          style={[
            themed($badge),
            status === "active" ? themed($badgeActive) : themed($badgeLinked),
          ]}
          tx={status === "active" ? "settingsScreen:accountActive" : "settingsScreen:accountLinked"}
        />
      </View>
    </View>
  )
}

const $row: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  paddingVertical: spacing.sm,
  gap: spacing.sm,
})

const $labelGroup: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $label: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  color: colors.textDim,
})

// flexShrink lets a long address ellipsize instead of pushing the badge off-screen.
const $valueGroup: ThemedStyle<ViewStyle> = () => ({
  flexShrink: 1,
  alignItems: "flex-end",
})

const $email: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  fontWeight: "500",
  color: colors.tint,
})

const $emailHidden: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontStyle: "italic",
  color: colors.textDim,
})

const $badge: ThemedStyle<TextStyle> = () => ({
  fontSize: 11,
  fontWeight: "600",
  textTransform: "uppercase",
})

const $badgeActive: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
})

const $badgeLinked: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
})
