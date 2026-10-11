import { describe, expect, it } from "vitest"

import { decideAppRoute } from "./appRouteLogic"

const base = {
  outage: false,
  isAuthenticated: false,
  needsOnboarding: false,
  hasForeignSession: false,
  isGuest: false,
  needsGuestOnboarding: false,
  platform: "android",
}

describe("decideAppRoute", () => {
  it("routes a signed-out user to Login", () => {
    expect(decideAppRoute(base)).toBe("Login")
  })
  it("routes an Android guest to Guest, across relaunches (isGuest is persisted)", () => {
    expect(decideAppRoute({ ...base, isGuest: true })).toBe("Guest")
  })
  it("never routes to Guest off Android — iOS requires an account", () => {
    expect(decideAppRoute({ ...base, isGuest: true, platform: "ios" })).toBe("Login")
    expect(decideAppRoute({ ...base, isGuest: true, platform: "web" })).toBe("Login")
  })
  it("outage wins over everything", () => {
    expect(decideAppRoute({ ...base, outage: true, isGuest: true })).toBe("Maintenance")
    expect(decideAppRoute({ ...base, outage: true, isAuthenticated: true })).toBe("Maintenance")
  })
  it("a real session wins over a stale guest flag", () => {
    expect(decideAppRoute({ ...base, isAuthenticated: true, isGuest: true })).toBe("Main")
    expect(
      decideAppRoute({ ...base, isAuthenticated: true, needsOnboarding: true, isGuest: true }),
    ).toBe("Onboarding")
  })
  it("a wrong-account session is never masked by guest mode", () => {
    expect(decideAppRoute({ ...base, hasForeignSession: true, isGuest: true })).toBe("WrongAccount")
  })
  // ADDED 2026-10-11: these are the inputs a real device sends. AppNavigator
  // computes needsOnboarding as !profileStore.onboardingCompleted, so a
  // signed-out fresh install arrives with it true, and so does every guest
  // (a guest never runs the full onboarding). Onboarding belongs to an authenticated
  // session only: hoisting that check above the isAuthenticated branch would
  // send every Android guest to Onboarding while the cases above stay green.
  it("routes a guest to Guest even though onboarding never ran", () => {
    expect(decideAppRoute({ ...base, isGuest: true, needsOnboarding: true })).toBe("Guest")
  })
  it("routes a signed-out fresh install to Login, not Onboarding", () => {
    expect(decideAppRoute({ ...base, needsOnboarding: true })).toBe("Login")
  })

  // ADDED 2026-10-11 (Jenova): a guest's first visit shows four guest
  // onboarding cards before guest Meetings. Their own flag, not
  // onboardingCompleted, so a later real sign-in still gets all six.
  describe("guest onboarding", () => {
    it("shows a first-time Android guest the guest cards", () => {
      expect(decideAppRoute({ ...base, isGuest: true, needsGuestOnboarding: true })).toBe(
        "GuestOnboarding",
      )
    })
    it("sends a guest who finished them straight to guest Meetings", () => {
      expect(decideAppRoute({ ...base, isGuest: true, needsGuestOnboarding: false })).toBe("Guest")
    })
    it("never shows them off Android", () => {
      expect(
        decideAppRoute({ ...base, isGuest: true, needsGuestOnboarding: true, platform: "ios" }),
      ).toBe("Login")
    })
    it("never shows them to someone who isn't a guest", () => {
      expect(decideAppRoute({ ...base, needsGuestOnboarding: true })).toBe("Login")
    })
    it("still gives a real session the full onboarding, whatever the guest flags say", () => {
      const signedIn = { ...base, isAuthenticated: true, needsOnboarding: true }
      expect(decideAppRoute({ ...signedIn, isGuest: true, needsGuestOnboarding: true })).toBe(
        "Onboarding",
      )
      expect(decideAppRoute({ ...signedIn, needsGuestOnboarding: false })).toBe("Onboarding")
    })
    it("never hides a wrong-account session behind guest onboarding", () => {
      expect(
        decideAppRoute({
          ...base,
          hasForeignSession: true,
          isGuest: true,
          needsGuestOnboarding: true,
        }),
      ).toBe("WrongAccount")
    })
  })
})
