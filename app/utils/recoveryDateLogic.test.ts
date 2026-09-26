import { describe, expect, it } from "vitest"

import { decideRecoveryDateHydration, mayImportRecoveryDate } from "./recoveryDateLogic"

const base = {
  storedDate: undefined,
  source: "" as const,
  onboardingCompleted: true,
  installDate: "2026-09-25",
  today: "2026-09-26",
}

describe("decideRecoveryDateHydration", () => {
  it("regression: onboarded with nothing stored backfills the install day, not today", () => {
    // The bug: the default was never persisted, so the day after install the
    // date re-read as today and clean time sat at 0 days.
    expect(decideRecoveryDateHydration(base)).toEqual({ kind: "backfill", date: "2026-09-25" })
  })

  it("backfills today when the install time is unknown (web)", () => {
    expect(decideRecoveryDateHydration({ ...base, installDate: null })).toEqual({
      kind: "backfill",
      date: "2026-09-26",
    })
  })

  it("never backfills a future date when the clock moved back after install", () => {
    expect(decideRecoveryDateHydration({ ...base, installDate: "2026-10-01" })).toEqual({
      kind: "backfill",
      date: "2026-09-26",
    })
  })

  it("leaves the default alone mid-onboarding", () => {
    expect(decideRecoveryDateHydration({ ...base, onboardingCompleted: false })).toEqual({
      kind: "keep-default",
    })
  })

  it("migrates an unmigrated install with a stored date to user-chosen", () => {
    // Before the fix only a date picker could store a date.
    expect(decideRecoveryDateHydration({ ...base, storedDate: "2020-01-01" })).toEqual({
      kind: "use-stored",
      source: "user",
    })
  })

  it("keeps an already-migrated source for a stored date", () => {
    expect(
      decideRecoveryDateHydration({ ...base, storedDate: "2026-09-25", source: "default" }),
    ).toEqual({ kind: "use-stored", source: "default" })
  })

  it("backfills even when already migrated if the stored date went missing", () => {
    expect(decideRecoveryDateHydration({ ...base, source: "default" })).toEqual({
      kind: "backfill",
      date: "2026-09-25",
    })
  })
})

describe("mayImportRecoveryDate", () => {
  it("lets a Firebase import replace an app-chosen or unmigrated date", () => {
    expect(mayImportRecoveryDate("default")).toBe(true)
    expect(mayImportRecoveryDate("")).toBe(true)
  })

  it("never overwrites a date the user picked", () => {
    expect(mayImportRecoveryDate("user")).toBe(false)
  })
})
