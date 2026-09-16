/**
 * billingHealthLogic — decisions for a store (Google Play Billing / StoreKit)
 * that has stopped answering.
 *
 * ADDED 2026-09-15. A subscribe attempt on a Pixel hung mid-purchase, and
 * every launch afterwards — including two fresh reinstalls — hung at whatever
 * RevenueCat call first touched the store: `Purchases.configure()` never
 * logged "initialized", then `syncPurchases()` never returned. None of them
 * rejected; the promises simply stayed open, so `SubscriptionContext` sat on
 * `isLoading = true` and Settings showed "..." indefinitely. A device reboot
 * cleared it: the wedge was the Play Store service on the device, not app
 * state (`allowBackup` is false, so nothing of ours survives an uninstall).
 *
 * The app cannot fix the store, but it can (a) stop waiting on it forever and
 * (b) tell the user the one thing that works — restart the device — while
 * making clear which store is at fault. Every RevenueCat call that reaches the
 * store goes through `raceStoreCall`; a timeout surfaces as the sentinel
 * `BILLING_UNRESPONSIVE_ERROR` on the service's normal `Result`, so callers
 * that don't care still see an ordinary failure.
 *
 * Pure module, no `@/` imports, so vitest can reach it (CLAUDE.md, "Test
 * Runner Split"). Copy is returned as i18n KEYS; the context translates.
 */

/**
 * Ceiling on any single call that reaches the store. Generous on purpose:
 * a cold Play Billing connection on a slow device can take several seconds,
 * and a false timeout would tell a user to reboot for nothing. The paywall
 * sheet itself is never raced — once it is open the user may be typing card
 * details — only the offerings fetch that precedes it.
 */
export const STORE_CALL_TIMEOUT_MS = 20_000

/** `error` value on a service Result whose store call timed out. */
export const BILLING_UNRESPONSIVE_ERROR = "billing_unresponsive"

export type StoreCallOutcome<T> = { kind: "ok"; value: T } | { kind: "timeout" }

/**
 * Race a store call against the ceiling. A rejection is passed through: the
 * store answering with an error is still the store answering, and callers
 * already handle those.
 */
export async function raceStoreCall<T>(
  call: Promise<T>,
  ms: number = STORE_CALL_TIMEOUT_MS,
): Promise<StoreCallOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<StoreCallOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), ms)
  })
  try {
    return await Promise.race([call.then((value) => ({ kind: "ok" as const, value })), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The shape of a service Result this module needs to read. */
export interface StoreResultLike {
  ok: boolean
  error?: string
}

/**
 * Next value of the context's `billingUnresponsive` flag after a store call.
 * Latches on a timeout, clears on any success, and ignores ordinary errors —
 * a cancelled purchase or an "item unavailable" means the store is fine.
 */
export function nextBillingUnresponsive(prev: boolean, result: StoreResultLike): boolean {
  if (result.ok) return false
  if (result.error === BILLING_UNRESPONSIVE_ERROR) return true
  return prev
}

export interface BillingUnresponsiveCopy {
  /** Alert title. */
  title: string
  /** Alert body: which store, restart the device, come back and confirm. */
  message: string
  /** Short form for the Settings status row. */
  status: string
}

/**
 * i18n keys for the user-facing copy, by platform. The message names the
 * store (Google Play / App Store) so the failure reads as the store's, which
 * it is, and asks the user to confirm the subscription after the restart —
 * a purchase that hung may or may not have completed on the store's side.
 */
export function billingUnresponsiveCopy(platform: string): BillingUnresponsiveCopy {
  const ios = platform === "ios"
  return {
    title: "subscription:billingUnresponsiveTitle",
    message: ios
      ? "subscription:billingUnresponsiveIos"
      : "subscription:billingUnresponsiveAndroid",
    status: ios
      ? "subscription:billingUnresponsiveStatusIos"
      : "subscription:billingUnresponsiveStatusAndroid",
  }
}
