/**
 * GuestPromoBar — the guest Meetings screen's house-ad slot + Sign-in action.
 *
 * ADDED 2026-10-11 (spec 2026-09-27-guest-mode-design.md,
 * decision 3). v1 ships one static house ad: RecoverySky's own copy for an
 * account, no ad network. Content/rotation is a later design pass; keep this
 * presentational (everything arrives as a prop) so that pass can swap the
 * body without touching navigation or the store.
 */
import { FC } from "react"
import { Pressable, TextStyle, View, ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import { translate } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

export interface GuestPromoBarProps {
  onSignIn: () => void
}

export const GuestPromoBar: FC<GuestPromoBarProps> = ({ onSignIn }) => {
  const { themed } = useAppTheme()
  return (
    <View style={themed($container)}>
      <View style={$copy}>
        <Text style={themed($title)} tx="guestPromo:title" />
        <Text style={themed($body)} tx="guestPromo:body" />
      </View>
      <Pressable
        testID="guest-sign-in"
        onPress={onSignIn}
        style={themed($button)}
        accessibilityRole="button"
        accessibilityLabel={translate("guestPromo:signIn")}
      >
        <Text style={themed($buttonText)} tx="guestPromo:signIn" />
      </Pressable>
    </View>
  )
}

const $container: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
  padding: spacing.sm,
  borderRadius: 12,
  backgroundColor: colors.card,
})

const $copy: ViewStyle = { flex: 1 }

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontWeight: "600",
  color: colors.text,
})

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 13,
  color: colors.textDim,
})

const $button: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  marginLeft: spacing.sm,
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.md,
  borderRadius: 16,
  backgroundColor: colors.tint,
})

const $buttonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontWeight: "600",
  color: colors.palette.neutral100,
})
