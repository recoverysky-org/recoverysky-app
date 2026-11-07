import { describe, expect, it } from "vitest"

import { decideMyDayTabVisible } from "./myDayTabLogic"

const base = {
  isAuthenticated: true,
  isGuest: false,
  hasMyDay: true,
  dailyDashUrlEnv: "https://api.the-daily-dash.com",
  platform: "ios",
}

describe("decideMyDayTabVisible (spec D2, D12, §4.5)", () => {
  it("shows for a signed-in owner with the myday entitlement on a phone with a URL", () => {
    expect(decideMyDayTabVisible(base)).toBe(true)
    expect(decideMyDayTabVisible({ ...base, platform: "android" })).toBe(true)
  })

  it.each([
    ["signed out", { isAuthenticated: false }],
    ["a guest", { isGuest: true }],
    ["without the myday entitlement", { hasMyDay: false }],
    ["no URL", { dailyDashUrlEnv: undefined }],
    ["a bad URL", { dailyDashUrlEnv: "api.the-daily-dash.com?x=1" }],
    ["web", { platform: "web" }],
  ])("hides when %s", (_name, over) => {
    expect(decideMyDayTabVisible({ ...base, ...over })).toBe(false)
  })

  // CHANGED 2026-11-07: gated on RevenueCat's `myday`, not premium.
  it("does not show with premium alone, only with the myday entitlement", () => {
    expect(decideMyDayTabVisible({ ...base, hasMyDay: false })).toBe(false)
  })
})
