import { describe, expect, it } from "vitest"

import { decideMyDayTabVisible } from "./myDayTabLogic"

const base = {
  isAuthenticated: true,
  isGuest: false,
  isPremium: true,
  dailyDashUrlEnv: "https://api.the-daily-dash.com",
  platform: "ios",
}

describe("decideMyDayTabVisible (spec D2, D12, §4.5)", () => {
  it("shows for a signed-in premium owner on a phone with a URL", () => {
    expect(decideMyDayTabVisible(base)).toBe(true)
    expect(decideMyDayTabVisible({ ...base, platform: "android" })).toBe(true)
  })

  it.each([
    ["signed out", { isAuthenticated: false }],
    ["a guest", { isGuest: true }],
    ["free", { isPremium: false }],
    ["no URL", { dailyDashUrlEnv: undefined }],
    ["a bad URL", { dailyDashUrlEnv: "api.the-daily-dash.com?x=1" }],
    ["web", { platform: "web" }],
  ])("hides when %s", (_name, over) => {
    expect(decideMyDayTabVisible({ ...base, ...over })).toBe(false)
  })

  it("does not show in dev without premium (unlike the Agent tab)", () => {
    expect(decideMyDayTabVisible({ ...base, isPremium: false })).toBe(false)
  })
})
