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
  // The gap goes ABOVE, as everywhere in the Meetings header: each element
  // spaces itself from the one before it (MeetingFilterBar's $row carries
  // marginTop), and the header's own bottom padding spaces the last one from
  // the content. A bottom margin left the card flush under the filter cells.
  marginTop: spacing.sm,
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

// Near-black in both themes, from palette tokens. The pill is colors.tint, which
// is Electric Pink (#FF10F0) in both palettes, so the label needs a dark colour
// in each. No single token is dark in both (neutral900 is black in light and
// white in dark; neutral100 is the reverse), so the theme picks one:
// neutral900 in light (#000000, 6.58:1) and neutral100 in dark (#0D0D0D,
// 6.09:1). Both clear WCAG AA's 4.5:1 for 16 px text. It was neutral100 in
// both themes, the SegmentedPill pairing, which is white in light theme
// (3.19:1). A user-picked tint would change the maths, but the guest-mode spec
// gives a guest the default theme, never the device owner's tint
// (2026-09-27-guest-mode-design.md, leaks table).
const $buttonText: ThemedStyle<TextStyle> = ({ colors, isDark }) => ({
  fontWeight: "600",
  color: isDark ? colors.palette.neutral100 : colors.palette.neutral900,
})
