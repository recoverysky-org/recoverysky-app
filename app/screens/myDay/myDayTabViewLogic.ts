/**
 * What the My Day tab draws (ADDED 2026-11-19), and whether a tap on it should show the
 * "Premium Feature" alert instead. Pure, for vitest; `MyDayTab` and `MainNavigator` supply the
 * inputs from the subscription context.
 *
 * `answered` is whether RevenueCat has given this install's customer info at least once. Until it
 * has, `hasMyDay` is false for everyone, subscribers included, so neither the alert nor the locked
 * page may show: a subscriber tapping My Day in the first second after launch would be asked to
 * pay for what they have.
 *
 * No `@/` imports.
 */

export interface MyDayTabViewInputs {
  /** RevenueCat's `myday` entitlement. */
  hasMyDay: boolean
  /** Customer info has loaded at least once (`subscriptionInfo !== null`). */
  answered: boolean
  /** The subscription context is loading. */
  loading: boolean
}

export type MyDayTabView = "myDay" | "checking" | "locked"

export function decideMyDayTabView({
  hasMyDay,
  answered,
  loading,
}: MyDayTabViewInputs): MyDayTabView {
  if (hasMyDay) return "myDay"
  // Unanswered and still trying: wait. Unanswered and done (offline, store down): the locked page,
  // whose See Premium reports the store problem itself, rather than a spinner forever.
  if (!answered && loading) return "checking"
  return "locked"
}

/** A tap on the tab shows the alert only when RevenueCat has answered and said no. */
export function shouldPromptOnMyDayTap({ hasMyDay, answered }: MyDayTabViewInputs): boolean {
  return answered && !hasMyDay
}
