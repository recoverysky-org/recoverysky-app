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
        style={themed($signInTarget)}
        accessibilityRole="button"
        accessibilityLabel={translate("guestPromo:signIn")}
      >
        <View style={themed($button)}>
          <Text style={themed($buttonText)} tx="guestPromo:signIn" />
        </View>
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

// The touch target, not the pill: a transparent box at Material's 48 dp minimum
// around the 40 dp pill below (8 + 24 + 8), so the design is unchanged. A box
// rather than hitSlop because it is also the accessibility node, whose bounds
// are what Play's pre-launch scanner measures; slop stretches only the touch.
const $signInTarget: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  marginLeft: spacing.sm,
  minHeight: 48,
  justifyContent: "center",
})

const $button: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.md,
  borderRadius: 16,
  backgroundColor: colors.tint,
})

// Black, the pairing AgentScreen's consent button uses on colors.tint. The tint
// is Electric Pink (#FF10F0) in both palettes and black on it is 6.6:1, above
// WCAG AA's 4.5:1 for 16 px text in both themes. It was palette.neutral100, the
// SegmentedPill pairing: white in light theme (3.2:1) and #0D0D0D in dark. Not a
// theme token on purpose, because no token is dark in both themes (neutral900
// is black in light and white in dark). A user-picked tint would change the
// maths, but the guest-mode spec gives a guest the default theme, never the
// device owner's tint (2026-09-27-guest-mode-design.md, leaks table).
const $buttonText: ThemedStyle<TextStyle> = () => ({
  fontWeight: "600",
  color: "#000",
})
