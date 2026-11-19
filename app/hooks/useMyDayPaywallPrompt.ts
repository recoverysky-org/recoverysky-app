/**
 * useMyDayPaywallPrompt — the "Premium Feature" alert for a tap on the My Day tab without the
 * `myday` entitlement. ADDED 2026-11-19 (Jenova): the tab's icon shows for every signed-in account
 * (`decideMyDayTabShown`), and this stands in for the tab until the account has My Day.
 *
 * The same shape as the reminder grid's alert: the alert says why, "See Premium" opens the paywall
 * in place (`usePaywallPurchase`), and after a purchase `onUnlocked` runs, which goes to the tab.
 * The entitlement is read again from RevenueCat first: an Attendance-only plan is a purchase too,
 * and `hasMyDay` in the caller's closure still holds the pre-purchase value.
 */
import { useCallback } from "react"
import { Alert } from "react-native"

import { translate } from "@/i18n"
import { ENTITLEMENTS, hasEntitlement } from "@/services/purchases"

import { usePaywallPurchase } from "./usePaywallPurchase"

export function useMyDayPaywallPrompt() {
  const { purchase } = usePaywallPurchase()

  /** The paywall, then `onUnlocked` if the account now has My Day. Resolves whether it does. */
  const unlock = useCallback(
    async (onUnlocked: () => void): Promise<boolean> => {
      const bought = await purchase("myday")
      if (!bought) return false
      const unlocked = await hasEntitlement(ENTITLEMENTS.MY_DAY)
      if (unlocked) onUnlocked()
      return unlocked
    },
    [purchase],
  )

  const prompt = useCallback(
    (onUnlocked: () => void) => {
      Alert.alert(
        translate("subscription:premiumFeatureTitle"),
        translate("subscription:myDayPremiumMessage"),
        [
          { text: translate("common:cancel"), style: "cancel" },
          { text: translate("subscription:seePremium"), onPress: () => void unlock(onUnlocked) },
        ],
      )
    },
    [unlock],
  )

  return { prompt, unlock }
}
