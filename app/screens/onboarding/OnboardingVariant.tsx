/**
 * Which onboarding card set the current flow is walking: "full" for a real
 * sign-in, "guest" for a guest's first visit. ADDED 2026-10-11 (Jenova).
 *
 * OnboardingNavigator provides it; every card and ProgressDots read it, and
 * pass it to onboardingStepsLogic.ts for the next card, the dots and the
 * finish. Defaults to "full", so a card rendered outside a provider behaves
 * exactly as before this existed.
 */
import { createContext, useContext } from "react"

import type { OnboardingVariant } from "./onboardingStepsLogic"

const OnboardingVariantContext = createContext<OnboardingVariant>("full")

export const OnboardingVariantProvider = OnboardingVariantContext.Provider

export function useOnboardingVariant(): OnboardingVariant {
  return useContext(OnboardingVariantContext)
}
