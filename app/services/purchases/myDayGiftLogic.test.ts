import { describe, expect, it } from "vitest"

import {
  decideMyDayGift,
  giftKey,
  myDayGiftDaysLeft,
  myDayGiftPhase,
  shouldWarnGiftEnding,
} from "./myDayGiftLogic"

const NOW = new Date("2026-11-20T12:00:00Z")
const END = "2026-12-19T12:00:00Z"

const promo = (over: Partial<{ isActive: boolean; expirationDate: string | null }> = {}) => ({
  isActive: true,
  store: "PROMOTIONAL",
  expirationDate: END,
  ...over,
})

describe("decideMyDayGift", () => {
  it("is the gift: a promotional myday with an end date and no paid Premium", () => {
    expect(decideMyDayGift({ myDay: promo(), premium: undefined }, NOW)).toEqual({
      endsAt: new Date(END),
      granted: true,
    })
  })

  it("is not a gift without myday, or when a store unlocked it", () => {
    expect(decideMyDayGift({ myDay: undefined, premium: undefined }, NOW)).toBeNull()
    expect(
      decideMyDayGift({ myDay: { ...promo(), store: "APP_STORE" }, premium: undefined }, NOW),
    ).toBeNull()
  })

  it("is not a gift for someone paying for Premium, even when myday shows the promotion", () => {
    const paid = { isActive: true, store: "PLAY_STORE", expirationDate: "2026-12-05T00:00:00Z" }
    expect(decideMyDayGift({ myDay: promo(), premium: paid }, NOW)).toBeNull()
  })

  it("is still the gift when Premium itself is promotional", () => {
    const comp = { isActive: true, store: "PROMOTIONAL", expirationDate: END }
    expect(decideMyDayGift({ myDay: promo(), premium: comp }, NOW)).not.toBeNull()
  })

  it("is not a gift for a lifetime or long comp", () => {
    expect(
      decideMyDayGift({ myDay: promo({ expirationDate: null }), premium: undefined }, NOW),
    ).toBeNull()
    expect(
      decideMyDayGift(
        { myDay: promo({ expirationDate: "2027-11-20T12:00:00Z" }), premium: undefined },
        NOW,
      ),
    ).toBeNull()
  })

  it("keeps an ended gift, so the app can say the free time is over", () => {
    const ended = promo({ isActive: false, expirationDate: "2026-11-01T00:00:00Z" })
    expect(decideMyDayGift({ myDay: ended, premium: undefined }, NOW)).toEqual({
      endsAt: new Date("2026-11-01T00:00:00Z"),
      granted: false,
    })
  })

  it("ignores an unreadable date", () => {
    expect(
      decideMyDayGift({ myDay: promo({ expirationDate: "soon" }), premium: undefined }, NOW),
    ).toBeNull()
  })
})

describe("myDayGiftPhase / myDayGiftDaysLeft", () => {
  const gift = { endsAt: new Date(END), granted: true }

  it("is active with days left rounded up", () => {
    expect(myDayGiftPhase(gift, NOW)).toBe("active")
    expect(myDayGiftDaysLeft(gift, NOW)).toBe(29)
    expect(myDayGiftDaysLeft(gift, new Date("2026-12-19T11:00:00Z"))).toBe(1)
  })

  it("has ended once the end passes, even before RevenueCat says so", () => {
    const after = new Date("2026-12-19T12:00:01Z")
    expect(myDayGiftPhase(gift, after)).toBe("ended")
    expect(myDayGiftDaysLeft(gift, after)).toBe(0)
  })

  it("has ended when RevenueCat no longer grants it", () => {
    expect(myDayGiftPhase({ ...gift, granted: false }, NOW)).toBe("ended")
  })
})

describe("shouldWarnGiftEnding", () => {
  const gift = { endsAt: new Date(END), granted: true }
  const threeDaysBefore = new Date("2026-12-16T12:00:00Z")

  it("warns once three or fewer days are left", () => {
    expect(shouldWarnGiftEnding(gift, NOW, null)).toBe(false)
    expect(shouldWarnGiftEnding(gift, new Date("2026-12-16T11:59:00Z"), null)).toBe(false)
    expect(shouldWarnGiftEnding(gift, threeDaysBefore, null)).toBe(true)
  })

  it("warns once per gift", () => {
    expect(shouldWarnGiftEnding(gift, threeDaysBefore, giftKey(gift))).toBe(false)
    expect(shouldWarnGiftEnding(gift, threeDaysBefore, "2026-01-01T00:00:00.000Z")).toBe(true)
  })

  it("never warns after the end", () => {
    expect(shouldWarnGiftEnding(gift, new Date("2026-12-20T00:00:00Z"), null)).toBe(false)
  })
})
