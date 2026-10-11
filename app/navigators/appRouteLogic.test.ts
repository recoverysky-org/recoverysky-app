import { describe, expect, it } from "vitest"

import { decideAppRoute } from "./appRouteLogic"

const base = {
  outage: false,
  isAuthenticated: false,
  needsOnboarding: false,
  hasForeignSession: false,
  isGuest: false,
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
  // (a guest never runs onboarding). Onboarding belongs to an authenticated
  // session only: hoisting that check above the isAuthenticated branch would
  // send every Android guest to Onboarding while the cases above stay green.
  it("routes a guest to Guest even though onboarding never ran", () => {
    expect(decideAppRoute({ ...base, isGuest: true, needsOnboarding: true })).toBe("Guest")
  })
  it("routes a signed-out fresh install to Login, not Onboarding", () => {
    expect(decideAppRoute({ ...base, needsOnboarding: true })).toBe("Login")
  })
})
