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
 * NEVER MOUNT `MyDayNavigator` WITHOUT THE ENTITLEMENT. It wraps the stack in `DailyDashClient`,
 * whose `ClientProvider` calls `session.start()`, and the Daily Dash session must exist only while
 * the gate holds (CLAUDE.md "My Day (Daily Dash)", "One gate, two readers").
 */
import { FC } from "react"
import { ActivityIndicator, View, ViewStyle, TextStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Button } from "@/components/Button"
import { Screen } from "@/components/Screen"
import { Text } from "@/components/Text"
import { useSubscription } from "@/context/SubscriptionContext"
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
  if (view === "myDay") return <MyDayNavigator />
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

/** What My Day is, and "See Premium". The app's own look: My Day's theme lives in the package. */
const MyDayLocked: FC = () => {
  const { themed, theme } = useAppTheme()
  const { unlock } = useMyDayPaywallPrompt()
  return (
    <Screen preset="fixed" safeAreaEdges={["top"]} contentContainerStyle={themed($center)}>
      <Ionicons name="today" size={48} color={theme.colors.tint} />
      <Text preset="subheading" tx="mainNavigator:myDayTab" accessibilityRole="header" />
      <Text tx="subscription:myDayPremiumMessage" style={themed($message)} />
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

const $message: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  textAlign: "center",
})

const $button: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignSelf: "stretch",
  marginTop: spacing.sm,
})
