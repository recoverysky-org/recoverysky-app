import { describe, expect, it } from "vitest"

import { decideMyDayTabView, shouldPromptOnMyDayTap } from "./myDayTabViewLogic"

describe("decideMyDayTabView", () => {
  it("opens My Day with the entitlement, whatever else", () => {
    expect(decideMyDayTabView({ hasMyDay: true, answered: true, loading: false })).toBe("myDay")
    expect(decideMyDayTabView({ hasMyDay: true, answered: false, loading: true })).toBe("myDay")
  })

  it("waits while RevenueCat has not answered yet", () => {
    expect(decideMyDayTabView({ hasMyDay: false, answered: false, loading: true })).toBe("checking")
  })

  it("shows the locked page once RevenueCat said no", () => {
    expect(decideMyDayTabView({ hasMyDay: false, answered: true, loading: false })).toBe("locked")
    // A refresh in flight after an answer does not hide the page behind a spinner.
    expect(decideMyDayTabView({ hasMyDay: false, answered: true, loading: true })).toBe("locked")
  })

  it("shows the locked page when RevenueCat never answered and stopped trying", () => {
    expect(decideMyDayTabView({ hasMyDay: false, answered: false, loading: false })).toBe("locked")
  })
})

describe("shouldPromptOnMyDayTap", () => {
  it("prompts only when RevenueCat answered and the entitlement is missing", () => {
    expect(shouldPromptOnMyDayTap({ hasMyDay: false, answered: true, loading: false })).toBe(true)
  })

  it("never prompts a subscriber, or anyone before RevenueCat answers", () => {
    expect(shouldPromptOnMyDayTap({ hasMyDay: true, answered: true, loading: false })).toBe(false)
    expect(shouldPromptOnMyDayTap({ hasMyDay: false, answered: false, loading: true })).toBe(false)
    expect(shouldPromptOnMyDayTap({ hasMyDay: false, answered: false, loading: false })).toBe(false)
  })
})
