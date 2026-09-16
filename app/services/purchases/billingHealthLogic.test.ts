import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  BILLING_UNRESPONSIVE_ERROR,
  billingUnresponsiveCopy,
  nextBillingUnresponsive,
  raceStoreCall,
  STORE_CALL_TIMEOUT_MS,
} from "./billingHealthLogic"

describe("raceStoreCall", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("resolves with the store's answer when it arrives in time", async () => {
    const result = raceStoreCall(Promise.resolve(42), 1000)
    await expect(result).resolves.toEqual({ kind: "ok", value: 42 })
  })

  it("reports a timeout when the store never answers", async () => {
    // 2026-09-15: Purchases.syncPurchases() (and configure(), and the paywall's
    // offerings fetch) sat unresolved indefinitely while Google Play Billing
    // was wedged on the device. Every RevenueCat call that reaches the store
    // now has a ceiling, so a stuck store can't hold the subscription UI open
    // forever.
    const never = new Promise<number>(() => {})
    const pending = raceStoreCall(never, 1000)
    vi.advanceTimersByTime(1001)
    await expect(pending).resolves.toEqual({ kind: "timeout" })
  })

  it("propagates a rejection unchanged — an error IS an answer from the store", async () => {
    const pending = raceStoreCall(Promise.reject(new Error("ITEM_UNAVAILABLE")), 1000)
    await expect(pending).rejects.toThrow("ITEM_UNAVAILABLE")
  })

  it("defaults to the shared store-call ceiling", () => {
    expect(STORE_CALL_TIMEOUT_MS).toBe(20_000)
  })
})

describe("nextBillingUnresponsive", () => {
  it("latches on a timeout", () => {
    expect(nextBillingUnresponsive(false, { ok: false, error: BILLING_UNRESPONSIVE_ERROR })).toBe(
      true,
    )
  })

  it("clears on any successful store call", () => {
    expect(nextBillingUnresponsive(true, { ok: true })).toBe(false)
  })

  it("leaves the flag alone on an ordinary error — the store answered, it just said no", () => {
    expect(nextBillingUnresponsive(true, { ok: false, error: "Purchase cancelled" })).toBe(true)
    expect(nextBillingUnresponsive(false, { ok: false, error: "Purchase cancelled" })).toBe(false)
  })
})

describe("billingUnresponsiveCopy", () => {
  it("names Google Play on Android", () => {
    expect(billingUnresponsiveCopy("android")).toEqual({
      title: "subscription:billingUnresponsiveTitle",
      message: "subscription:billingUnresponsiveAndroid",
      status: "subscription:billingUnresponsiveStatusAndroid",
    })
  })

  it("names the App Store on iOS", () => {
    expect(billingUnresponsiveCopy("ios")).toEqual({
      title: "subscription:billingUnresponsiveTitle",
      message: "subscription:billingUnresponsiveIos",
      status: "subscription:billingUnresponsiveStatusIos",
    })
  })

  it("falls back to the Android copy on anything else", () => {
    expect(billingUnresponsiveCopy("web").message).toBe("subscription:billingUnresponsiveAndroid")
  })
})
