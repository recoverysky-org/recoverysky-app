/**
 * The two onboarding card sets, and the one rule for walking them.
 *
 * ADDED 2026-10-11 (Jenova): a guest's first visit shows a subset of the
 * onboarding cards; a real sign-in still shows all six. Every card asks this
 * module for its next card, ProgressDots asks it for the set to draw, and the
 * last card asks it how to finish, so the two sets can never drift apart.
 *
 * The guest set leaves out Recovery (name, fellowship, clean date) and Theme
 * (the look and notifications): both save personal data or the device owner's
 * settings, and guest mode records nothing personal.
 *
 * OnboardingImport is not in either set. It is a side card the full flow's
 * Welcome opens when the old app holds the account's data; a guest has no
 * account, so the guest Welcome never checks.
 *
 * Pure, no imports (CLAUDE.md "Test Runner Split").
 */
export type OnboardingVariant = "full" | "guest"

export type OnboardingCard =
  | "OnboardingWelcome"
  | "OnboardingRecovery"
  | "OnboardingZoom"
  | "OnboardingTheme"
  | "OnboardingPrivacy"
  | "OnboardingOSS"

const FULL: readonly OnboardingCard[] = [
  "OnboardingWelcome",
  "OnboardingRecovery",
  "OnboardingZoom",
  "OnboardingTheme",
  "OnboardingPrivacy",
  "OnboardingOSS",
]

const GUEST: readonly OnboardingCard[] = [
  "OnboardingWelcome",
  "OnboardingZoom",
  "OnboardingPrivacy",
  "OnboardingOSS",
]

/** The cards a variant shows, in order. */
export function onboardingCards(variant: OnboardingVariant): readonly OnboardingCard[] {
  return variant === "guest" ? GUEST : FULL
}

/** The card after `current` in this variant, or null when `current` is the last (or not in the set). */
export function nextOnboardingCard(
  variant: OnboardingVariant,
  current: OnboardingCard,
): OnboardingCard | null {
  const cards = onboardingCards(variant)
  const i = cards.indexOf(current)
  return i >= 0 && i < cards.length - 1 ? cards[i + 1] : null
}

/**
 * Finish the flow. A guest finish records only the guest flag: the full
 * `completeOnboarding()` also saves the recovery date and marks every bundled
 * announcement seen, which a guest must never do, and a later real sign-in
 * must still get all six cards.
 */
export function finishOnboarding(
  variant: OnboardingVariant,
  actions: { completeOnboarding: () => void; completeGuestOnboarding: () => void },
): void {
  if (variant === "guest") actions.completeGuestOnboarding()
  else actions.completeOnboarding()
}
