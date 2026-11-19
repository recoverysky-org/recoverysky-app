/**
 * The My Day gift (ADDED 2026-11-19, Jenova): every existing account is given My Day free until
 * one shared end date, as a RevenueCat promotional grant of the `myday` entitlement with an end
 * time. The app tells the person three times: an announcement when it starts, a bar in the My Day
 * tab while it lasts, an alert a few days before it ends; and after it ends the tab's alert and
 * locked page say the free time is over rather than the plain Premium pitch.
 *
 * This module decides, from RevenueCat's entitlement records, whether this account is on such a
 * gift. Pure, for vitest; `revenueCatService.getSubscriptionInfo` feeds it.
 *
 * What counts as the gift: `myday` unlocked by the PROMOTIONAL store, with an end date, and no paid
 * Premium beside it. RevenueCat reports one record per entitlement, the product with the latest
 * expiry, so a monthly subscriber whose renewal falls before the gift's end shows `myday` as
 * PROMOTIONAL; the paid Premium check is what keeps "free until" away from people who pay. A grant
 * with no end (a lifetime comp) is never a gift, and neither is one ending more than
 * `GIFT_MAX_DAYS` out (a long comp), so comped accounts get no countdown.
 *
 * No `@/` imports.
 */

/** The slice of RevenueCat's `EntitlementInfo` this module reads. */
export interface GiftEntitlementLike {
  isActive: boolean
  store: string
  expirationDate: string | null
}

export interface MyDayGift {
  /** When the grant ends (RevenueCat's expiration). */
  endsAt: Date
  /** RevenueCat still reports the grant active. */
  granted: boolean
}

export type MyDayGiftPhase = "active" | "ended"

const DAY_MS = 24 * 60 * 60 * 1000

/** A promotional `myday` ending further out than this is a comp, not the gift. */
export const GIFT_MAX_DAYS = 45

/** The "ends soon" alert shows once this many days (or fewer) are left. */
export const GIFT_WARN_DAYS = 3

export function decideMyDayGift(
  input: {
    /** `entitlements.all.myday`, active or not. */
    myDay: GiftEntitlementLike | undefined
    /** `entitlements.active["recoverysky-premium"]`. */
    premium: GiftEntitlementLike | undefined
  },
  now: Date,
): MyDayGift | null {
  const { myDay, premium } = input
  if (!myDay || myDay.store !== "PROMOTIONAL" || !myDay.expirationDate) return null
  const endsAt = new Date(myDay.expirationDate)
  if (Number.isNaN(endsAt.getTime())) return null
  if (premium?.isActive && premium.store !== "PROMOTIONAL") return null
  if (myDay.isActive && endsAt.getTime() - now.getTime() > GIFT_MAX_DAYS * DAY_MS) return null
  return { endsAt, granted: myDay.isActive }
}

/**
 * Active while RevenueCat reports the grant and its end is still ahead. The second check matters
 * while the app stays open past the end: customer info is not refetched at that moment.
 */
export function myDayGiftPhase(gift: MyDayGift, now: Date): MyDayGiftPhase {
  return gift.granted && gift.endsAt.getTime() > now.getTime() ? "active" : "ended"
}

/** Whole days left, rounded up: 1 on the last day, 0 once it has ended. */
export function myDayGiftDaysLeft(gift: MyDayGift, now: Date): number {
  return Math.max(0, Math.ceil((gift.endsAt.getTime() - now.getTime()) / DAY_MS))
}

/**
 * The "ends soon" alert: once per gift (keyed by its end time, so a later gift warns again), while
 * the gift is active and `GIFT_WARN_DAYS` or fewer days are left.
 */
export function shouldWarnGiftEnding(
  gift: MyDayGift,
  now: Date,
  warnedFor: string | null,
): boolean {
  if (myDayGiftPhase(gift, now) !== "active") return false
  if (myDayGiftDaysLeft(gift, now) > GIFT_WARN_DAYS) return false
  return warnedFor !== giftKey(gift)
}

/** What the "ends soon" alert records as shown. */
export function giftKey(gift: MyDayGift): string {
  return gift.endsAt.toISOString()
}
