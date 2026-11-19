/**
 * MyDayTab — the My Day tab's screen. ADDED 2026-11-19 (Jenova): the tab's icon now shows without
 * the `myday` entitlement (`decideMyDayTabShown`), so the screen decides what it draws:
 * - the entitlement holds: `MyDayNavigator`, the package's screens over the Daily Dash client;
 * - RevenueCat has not answered yet (cold start): a spinner, so a subscriber is never shown the
 *   upsell for the second before their entitlement arrives;
 * - otherwise: `MyDayLocked`, what My Day is and "See Premium".
 *
 * A tap on the tab without the entitlement normally never gets here: MainNavigator's tabPress
 * shows the "Premium Feature" alert instead. This covers every other way in (a lapsed subscription
 * while on the tab, a programmatic navigate, a tap before RevenueCat answered).
 *
 * ADDED 2026-11-19 (the My Day gift, `useMyDayGift`): while My Day is free until a date, a bar
 * under the package's screens says until when, with "See Premium"; once it has ended, the locked
 * page says the free time is over and what they added is kept.
 *
 * NEVER MOUNT `MyDayNavigator` WITHOUT THE ENTITLEMENT. It wraps the stack in `DailyDashClient`,
 * whose `ClientProvider` calls `session.start()`, and the Daily Dash session must exist only while
 * the gate holds (CLAUDE.md "My Day (Daily Dash)", "One gate, two readers").
 */
import { FC } from "react"
import { ActivityIndicator, Pressable, View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useSubscription } from "@/context/SubscriptionContext"
import { useMyDayGift } from "@/hooks/useMyDayGift"
import { useMyDayPaywallPrompt } from "@/hooks/useMyDayPaywallPrompt"
import { translate } from "@/i18n"
import { MyDayNavigator } from "@/navigators/MyDayNavigator"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

import { decideMyDayTabView } from "./myDayTabViewLogic"

export const MyDayTab: FC = observer(function MyDayTab() {
  const { hasMyDay, isLoading, subscriptionInfo } = useSubscription()
  const view = decideMyDayTabView({
    hasMyDay,
    answered: subscriptionInfo !== null,
    loading: isLoading,
  })
  if (view === "myDay") {
    return (
      <View style={$fill}>
        <MyDayNavigator />
        <MyDayGiftBar />
      </View>
    )
  }
  if (view === "checking") return <MyDayChecking />
  return <MyDayLocked />
})

const MyDayChecking: FC = () => {
  const { themed, theme } = useAppTheme()
  return (
    <View style={themed($center)}>
      <ActivityIndicator color={theme.colors.tint} />
    </View>
  )
}

/**
 * ADDED 2026-11-19: "My Day is free until December 19" and "See Premium", under the package's
 * screens and above the tab bar, only while the gift lasts. At the bottom, not the top: the
 * package pads its own glass header by the status bar inset, and a bar above it would double that.
 */
const MyDayGiftBar: FC = () => {
  const { themed, theme } = useAppTheme()
  const { phase, endDate } = useMyDayGift()
  const { unlock } = useMyDayPaywallPrompt()
  if (phase !== "active") return null
  return (
    <View style={themed($giftBar)}>
      <Ionicons
        name="gift-outline"
        size={16}
        color={theme.colors.tint}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text
        tx="myDayGift:bar"
        txOptions={{ date: endDate }}
        size="xs"
        style={themed($giftBarText)}
        numberOfLines={2}
      />
      <Pressable
        // Nothing to do after a purchase: the gift is no longer the gift, and the bar goes.
        onPress={() => void unlock(() => {})}
        accessibilityRole="button"
        accessibilityLabel={translate("subscription:seePremium")}
        hitSlop={8}
      >
        <Text
          tx="subscription:seePremium"
          size="xs"
          weight="semiBold"
          style={themed($giftBarLink)}
        />
      </Pressable>
    </View>
  )
}

/** What My Day is, and "See Premium". The app's own look: My Day's theme lives in the package. */
const MyDayLocked: FC = () => {
  const { themed, theme } = useAppTheme()
  const { unlock } = useMyDayPaywallPrompt()
  // ADDED 2026-11-19: after the My Day gift, say it ended and that what they added is kept.
  const giftEnded = useMyDayGift().phase === "ended"
  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($center)}>
      <Ionicons name="today" size={48} color={theme.colors.tint} />
      <Text
        preset="subheading"
        tx={giftEnded ? "myDayGift:endedTitle" : "mainNavigator:myDayTab"}
        accessibilityRole="header"
        style={themed($heading)}
      />
      <Text
        tx={giftEnded ? "myDayGift:endedMessage" : "subscription:myDayPremiumMessage"}
        style={themed($message)}
      />
      <Button
        tx="subscription:seePremium"
        preset="filled"
        // Nothing to do after a purchase: `hasMyDay` flips, and this screen gives way to My Day.
        onPress={() => void unlock(() => {})}
        accessibilityRole="button"
        accessibilityLabel={translate("subscription:seePremium")}
        style={themed($button)}
      />
    </Screen>
  )
}

const $center: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  alignItems: "center",
  backgroundColor: colors.background,
  flex: 1,
  gap: spacing.md,
  justifyContent: "center",
  paddingHorizontal: spacing.xl,
})

const $fill: ViewStyle = { flex: 1 }

const $heading: ThemedStyle<TextStyle> = () => ({ textAlign: "center" })

const $giftBar: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  alignItems: "center",
  backgroundColor: colors.card,
  borderTopColor: colors.separator,
  borderTopWidth: 1,
  flexDirection: "row",
  gap: spacing.xs,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.xs,
})

const $giftBarText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.text,
  flex: 1,
})

const $giftBarLink: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.tint,
})

const $message: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  textAlign: "center",
})

const $button: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignSelf: "stretch",
  marginTop: spacing.sm,
})
