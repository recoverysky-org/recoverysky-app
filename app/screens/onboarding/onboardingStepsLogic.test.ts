import { describe, expect, it, vi } from "vitest"

import { finishOnboarding, nextOnboardingCard, onboardingCards } from "./onboardingStepsLogic"

describe("onboardingCards", () => {
  it("is the six-card set for a signed-in user", () => {
    expect(onboardingCards("full")).toEqual([
      "OnboardingWelcome",
      "OnboardingRecovery",
      "OnboardingZoom",
      "OnboardingTheme",
      "OnboardingPrivacy",
      "OnboardingOSS",
    ])
  })

  it("is the four-card guest set: Welcome, Install Zoom, Privacy, Open Source", () => {
    expect(onboardingCards("guest")).toEqual([
      "OnboardingWelcome",
      "OnboardingZoom",
      "OnboardingPrivacy",
      "OnboardingOSS",
    ])
  })

  it("never shows a guest the cards that save personal data or the owner's settings", () => {
    // Recovery saves the name, fellowship and clean date; Theme saves the
    // look and the notifications choice. A guest has none of those.
    expect(onboardingCards("guest")).not.toContain("OnboardingRecovery")
    expect(onboardingCards("guest")).not.toContain("OnboardingTheme")
  })
})

describe("nextOnboardingCard", () => {
  it("walks the full set in order and ends after Open Source", () => {
    expect(nextOnboardingCard("full", "OnboardingWelcome")).toBe("OnboardingRecovery")
    expect(nextOnboardingCard("full", "OnboardingRecovery")).toBe("OnboardingZoom")
    expect(nextOnboardingCard("full", "OnboardingZoom")).toBe("OnboardingTheme")
    expect(nextOnboardingCard("full", "OnboardingTheme")).toBe("OnboardingPrivacy")
    expect(nextOnboardingCard("full", "OnboardingPrivacy")).toBe("OnboardingOSS")
    expect(nextOnboardingCard("full", "OnboardingOSS")).toBeNull()
  })

  it("walks the guest set, skipping Recovery and Theme", () => {
    expect(nextOnboardingCard("guest", "OnboardingWelcome")).toBe("OnboardingZoom")
    expect(nextOnboardingCard("guest", "OnboardingZoom")).toBe("OnboardingPrivacy")
    expect(nextOnboardingCard("guest", "OnboardingPrivacy")).toBe("OnboardingOSS")
    expect(nextOnboardingCard("guest", "OnboardingOSS")).toBeNull()
  })

  it("has no next card for a card outside the set", () => {
    expect(nextOnboardingCard("guest", "OnboardingTheme")).toBeNull()
  })
})

describe("finishOnboarding", () => {
  const actions = () => ({ completeOnboarding: vi.fn(), completeGuestOnboarding: vi.fn() })

  it("a guest finish records only the guest flag, never full onboarding", () => {
    // completeOnboarding() also saves the recovery date and marks every
    // announcement seen; a guest finish must do neither, and a later real
    // sign-in must still get all six cards.
    const a = actions()
    finishOnboarding("guest", a)
    expect(a.completeGuestOnboarding).toHaveBeenCalledTimes(1)
    expect(a.completeOnboarding).not.toHaveBeenCalled()
  })

  it("a full finish completes onboarding and leaves the guest flag alone", () => {
    const a = actions()
    finishOnboarding("full", a)
    expect(a.completeOnboarding).toHaveBeenCalledTimes(1)
    expect(a.completeGuestOnboarding).not.toHaveBeenCalled()
  })
})
