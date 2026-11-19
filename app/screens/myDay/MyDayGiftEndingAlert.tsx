/**
 * MyDayGiftEndingAlert — "My Day's Free Time Ends Soon" (ADDED 2026-11-19, Jenova). Draws nothing
 * itself: it shows a native alert once per gift when `GIFT_WARN_DAYS` or fewer days of the My Day
 * gift are left (`shouldWarnGiftEnding`), with "Not now" and "See Premium" (the paywall in place).
 *
 * Mounted in MainNavigator, so only for a signed-in, onboarded account. Checked on mount, on every
 * foreground (`useMyDayGift` moves `now` on), and whenever another overlay lets go.
 *
 * - **Once per gift.** MMKV `myDayGift.endingWarnedFor` holds the gift's end time, written as the
 *   alert shows (not on a tap), so a killed app does not ask again and a later gift does.
 * - **One overlay at a time** (`overlayGate.ts`): it waits while the announcement or the
 *   verify-email gate is up, and holds the overlay until a button settles it.
 * - **Never over a running attendance timer**, the same rule as the announcements.
 */
import { FC, useEffect } from "react"
import { Alert } from "react-native"
import { observer } from "mobx-react-lite"

import { useMyDayGift } from "@/hooks/useMyDayGift"
import { useMyDayPaywallPrompt } from "@/hooks/useMyDayPaywallPrompt"
import { translate } from "@/i18n"
import { loadTimerSession } from "@/services/attendance"
import { giftKey, shouldWarnGiftEnding } from "@/services/purchases"
import { claimOverlay, overlayOwner, releaseOverlay } from "@/utils/overlayGate"
import { loadString, saveString } from "@/utils/storage"

const WARNED_KEY = "myDayGift.endingWarnedFor"
const OVERLAY = "myDayGiftEnding"

export const MyDayGiftEndingAlert: FC = observer(function MyDayGiftEndingAlert() {
  const { gift, now, endDate } = useMyDayGift()
  const { unlock } = useMyDayPaywallPrompt()
  // Read in render so this observer re-checks when another gate releases the overlay.
  const overlay = overlayOwner()

  useEffect(() => {
    if (!gift || !shouldWarnGiftEnding(gift, now, loadString(WARNED_KEY))) return
    if (overlay !== null) return
    if (loadTimerSession() !== null) return
    if (!claimOverlay(OVERLAY)) return
    // Recorded before it shows: this also stops a second effect run (a re-render, dev's double
    // effects) from showing it twice.
    saveString(WARNED_KEY, giftKey(gift))
    const release = () => releaseOverlay(OVERLAY)
    Alert.alert(
      translate("myDayGift:endingTitle"),
      translate("myDayGift:endingMessage", { date: endDate }),
      [
        { text: translate("myDayGift:notNow"), style: "cancel", onPress: release },
        {
          text: translate("subscription:seePremium"),
          onPress: () => {
            release()
            void unlock(() => {})
          },
        },
      ],
      { cancelable: true, onDismiss: release },
    )
  }, [gift, now, endDate, overlay, unlock])

  // An unmount (sign-out) must not leave the overlay held.
  useEffect(() => () => releaseOverlay(OVERLAY), [])

  return null
})
