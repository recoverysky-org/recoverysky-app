import { describe, expect, it } from "vitest"

import { MY_DAY_WELCOME_SEEN_KEY, shouldShowMyDayWelcome } from "./myDayWelcomeLogic"

describe("shouldShowMyDayWelcome", () => {
  it("shows on a production first visit", () => {
    expect(shouldShowMyDayWelcome({ isDev: false, seen: false, dismissedThisMount: false })).toBe(
      true,
    )
  })

  it("stays hidden in production once seen", () => {
    expect(shouldShowMyDayWelcome({ isDev: false, seen: true, dismissedThisMount: false })).toBe(
      false,
    )
  })

  it("shows in dev builds even when seen", () => {
    expect(shouldShowMyDayWelcome({ isDev: true, seen: true, dismissedThisMount: false })).toBe(
      true,
    )
  })

  it("stays hidden for the rest of the mount after Get started in dev", () => {
    expect(shouldShowMyDayWelcome({ isDev: true, seen: true, dismissedThisMount: true })).toBe(
      false,
    )
  })

  it("stays hidden after Get started even if the flag was not read as seen", () => {
    expect(shouldShowMyDayWelcome({ isDev: false, seen: false, dismissedThisMount: true })).toBe(
      false,
    )
  })

  it("uses the agreed MMKV key", () => {
    expect(MY_DAY_WELCOME_SEEN_KEY).toBe("myDay.welcomeSeen")
  })
})
