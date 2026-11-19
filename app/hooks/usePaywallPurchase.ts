/**
 * usePaywallPurchase — open the paywall where the person is, and confirm a purchase.
 *
 * ADDED 2026-11-19 (Jenova): the upsells used to send the person to Settings → Subscription with a
 * `returnTo`, and Settings ran the purchase follow-up. They now open the paywall in place, so the
 * follow-up moved here, out of SettingsScreen, and every purchase path shares it:
 * - Settings' Upgrade button and its Notifications gate;
 * - the reminder grid's "See Premium" in SchedulePopup and InPersonPopup;
 * - the Attendance tab's "See Premium" under Send Report.
 *
 * `purchase(source)`: the paywall, then on a purchase the cloud-backup offer, or the plain
 * "Welcome to Premium!" when the offer does not apply (`useCloudBackupPrompt` returns whether it
 * showed). It resolves true only once that dialog has been tapped, so a caller can open its own
 * modal next (the reminder editor) without iOS refusing to present it over a dialog still on
 * screen. A cancelled paywall resolves false with nothing shown.
 *
 * Presenting RevenueCat's sheet from an Alert button over an RN `<Modal>` (the meeting popups)
 * was tried on the iOS simulator on 2026-11-19 and presents fine.
 */
import { useCallback } from "react"
import { Alert } from "react-native"

import { useSubscription } from "@/context/SubscriptionContext"
import { translate } from "@/i18n"
import { trackEvent } from "@/services/tracking"

import { useCloudBackupPrompt } from "./useCloudBackupPrompt"

/** Where the paywall was opened from; sent with the Umami events so upsells can be compared. */
export type PaywallSource = "settings" | "notifications" | "attendance" | "reminder" | "myday"

export function usePaywallPurchase() {
  const { showPaywall } = useSubscription()
  const { promptCloudBackup } = useCloudBackupPrompt()

  /**
   * The "Welcome to Premium!" dialog for a buyer the backup offer skipped. Awaits the tap for the
   * same reason the backup offer does: callers open a modal or navigate right after.
   * `cancelable: false` plus `onDismiss` make sure it always settles on Android.
   */
  const confirmPurchase = useCallback(async () => {
    const prompted = await promptCloudBackup()
    if (prompted) return

    await new Promise<void>((resolve) => {
      Alert.alert(
        translate("settingsScreen:subscriptionSuccess"),
        translate("settingsScreen:subscriptionSuccessMessage"),
        [{ text: translate("common:ok"), onPress: () => resolve() }],
        { cancelable: false, onDismiss: () => resolve() },
      )
    })
  }, [promptCloudBackup])

  const purchase = useCallback(
    async (source: PaywallSource): Promise<boolean> => {
      trackEvent("upgrade_tapped", { source })
      const purchased = await showPaywall()
      if (!purchased) return false
      trackEvent("upgrade_purchased", { source })
      await confirmPurchase()
      return true
    },
    [showPaywall, confirmPurchase],
  )

  return { purchase }
}
