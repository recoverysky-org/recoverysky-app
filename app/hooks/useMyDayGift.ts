/**
 * useMyDayGift — the My Day gift as the screens show it (ADDED 2026-11-19, Jenova). Every existing
 * account is given My Day free until one shared date; `myDayGiftLogic.ts` says what counts as the
 * gift and why subscribers and comps never see it.
 *
 * Readers: the announcement when it starts (`AnnouncementGate`), the bar in the My Day tab
 * (`MyDayTab`), the "ends soon" alert (`MyDayGiftEndingAlert`), and the ended copy in the tab's
 * alert and locked page (`useMyDayPaywallPrompt`, `MyDayTab`).
 *
 * `now` is refreshed on every foreground, so the phase and days left move on without a refetch of
 * customer info: an app left open across the end date stops calling it free.
 */
import { useEffect, useMemo, useState } from "react"
import { AppState } from "react-native"
import { DateTime } from "@recoverysky-org/common/browser"
import { useTranslation } from "react-i18next"

import { useSubscription } from "@/context/SubscriptionContext"
import {
  myDayGiftDaysLeft,
  myDayGiftPhase,
  type MyDayGift,
  type MyDayGiftPhase,
} from "@/services/purchases"

export interface MyDayGiftView {
  gift: MyDayGift | null
  /** null when this account is not on the gift. */
  phase: MyDayGiftPhase | null
  daysLeft: number
  /** The end as "December 19" in the app's language; "" without a gift. */
  endDate: string
  now: Date
}

export function useMyDayGift(): MyDayGiftView {
  const { subscriptionInfo } = useSubscription()
  const { i18n } = useTranslation()
  const gift = subscriptionInfo?.myDayGift ?? null
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(new Date())
    })
    return () => sub.remove()
  }, [])

  // A new customer info answer is a fresh look at the clock too.
  useEffect(() => setNow(new Date()), [gift])

  const endDate = useMemo(
    () =>
      gift
        ? DateTime.fromJSDate(gift.endsAt)
            .setLocale(i18n.language)
            .toLocaleString({ month: "long", day: "numeric" })
        : "",
    [gift, i18n.language],
  )

  return {
    gift,
    phase: gift ? myDayGiftPhase(gift, now) : null,
    daysLeft: gift ? myDayGiftDaysLeft(gift, now) : 0,
    endDate,
    now,
  }
}
