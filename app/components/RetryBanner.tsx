/**
 * RetryBanner — the slim amber "Couldn't load … — tap to retry" strip.
 *
 * ADDED 2026-10-01 (Jenova): the In-Person segment's nearby-failed banner
 * (InPersonListHeader's `$banner`) became the house look for a failed
 * request, and Live + Search now show the same strip when their schedule
 * fetch comes back non-ok. Before this, Live swallowed the failure entirely
 * and kept serving its last good list (a 1:31 AM list at 2 PM, during a
 * TREX outage where /status/ready still said "ready"), and Search printed
 * the raw problem kind ("Error: timeout") as its empty state.
 *
 * Only for a request that FAILED. A successful answer with zero rows is an
 * honest empty list and keeps each screen's own empty copy.
 *
 * Metrics deliberately mirror InPersonListHeader's `$banner` / `$bannerText`
 * (not imported — that header keeps its own icon-switching banner). If you
 * restyle one, restyle both. Horizontal inset is the caller's job: inside a
 * FlatList header the list's padding supplies it; outside one, pass `style`.
 */
import { FC } from "react"
import { StyleProp, TextStyle, TouchableOpacity, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components/Text"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

/** Amber accent shared with the In-Person banner and the reminder bell. */
const BANNER_ACCENT = "#f59e0b"

export interface RetryBannerProps {
  /** Already-translated copy; also the screen-reader label. */
  text: string
  onPress: () => void
  /** Disable while the retry is in flight so taps don't stack requests. */
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

export const RetryBanner: FC<RetryBannerProps> = function RetryBanner({
  text,
  onPress,
  disabled = false,
  style,
}) {
  const { themed } = useAppTheme()
  return (
    <TouchableOpacity
      style={[themed($banner), style]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled }}
    >
      <Ionicons name="refresh-outline" size={14} color={BANNER_ACCENT} />
      <Text style={themed($bannerText)}>{text}</Text>
    </TouchableOpacity>
  )
}

const $banner: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  marginBottom: spacing.sm,
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xs,
  borderRadius: 8,
  backgroundColor: colors.card,
  borderWidth: 1,
  borderColor: BANNER_ACCENT,
})

const $bannerText: ThemedStyle<TextStyle> = ({ colors }) => ({
  flex: 1,
  fontSize: 12,
  color: colors.textDim,
})
