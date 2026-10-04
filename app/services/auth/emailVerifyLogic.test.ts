import { describe, expect, it } from "vitest"

import {
  EMPTY_VERIFY_STATE,
  MAX_SKIPS,
  decideVerifyPrompt,
  emailChanged,
  mustCloseShownGate,
  needsEmailVerification,
  recordShowing,
  stepAfterVerifyProblem,
  verifyGateBlocked,
} from "./emailVerifyLogic"

describe("needsEmailVerification", () => {
  const base = {
    sub: "auth0|abc",
    emailVerifiedClaim: false as boolean | undefined,
    loginMethod: undefined as "email" | "apple" | "google" | undefined,
    locallyVerified: false,
  }
  it("asks an unverified password account", () => {
    expect(needsEmailVerification(base)).toBe(true)
  })
  // CHANGED 2026-10-04 (RS-054): undefined means "not read yet", not "missing".
  // A cold start hydrates tokens before the ID token is read, and asking in
  // that window prompted accounts Auth0 already had as verified.
  it("waits while the claim has not been read yet", () => {
    expect(needsEmailVerification({ ...base, emailVerifiedClaim: undefined })).toBe(false)
  })
  it("leaves a verified password account alone", () => {
    expect(needsEmailVerification({ ...base, emailVerifiedClaim: true })).toBe(false)
  })
  it("never asks Google, Apple or email-code accounts", () => {
    for (const sub of ["google-oauth2|1", "apple|1", "email|1", undefined]) {
      expect(needsEmailVerification({ ...base, sub })).toBe(false)
    }
  })
  it("trusts this install's own record over a stale token (Review Focus 1)", () => {
    expect(needsEmailVerification({ ...base, locallyVerified: true })).toBe(false)
  })
  it("does not ask a session started by an email code (Review Focus 2)", () => {
    expect(needsEmailVerification({ ...base, loginMethod: "email" })).toBe(false)
  })
  it("does not ask a Google session into a linked password account", () => {
    expect(needsEmailVerification({ ...base, loginMethod: "google" })).toBe(false)
  })
  it("does not ask an Apple session into a linked password account", () => {
    expect(needsEmailVerification({ ...base, loginMethod: "apple" })).toBe(false)
  })
  it("asks a session with no recorded login method (password, or an old build's)", () => {
    expect(needsEmailVerification({ ...base, loginMethod: undefined })).toBe(true)
  })
})

describe("decideVerifyPrompt", () => {
  const state = (count: number, lastDay: string | null) => ({
    ...EMPTY_VERIFY_STATE,
    count,
    lastDay,
  })

  it("first showing is skippable with all six skips left", () => {
    expect(decideVerifyPrompt(state(0, null), "2026-10-01")).toEqual({
      mode: "skippable",
      skipsLeft: 6,
    })
  })
  it("counts the skips down, one showing a day", () => {
    expect(decideVerifyPrompt(state(1, "2026-10-01"), "2026-10-02")).toEqual({
      mode: "skippable",
      skipsLeft: 5,
    })
    expect(decideVerifyPrompt(state(5, "2026-10-05"), "2026-10-06")).toEqual({
      mode: "skippable",
      skipsLeft: 1,
    })
  })
  it("hides for the rest of a day already shown", () => {
    expect(decideVerifyPrompt(state(1, "2026-10-01"), "2026-10-01")).toEqual({ mode: "hidden" })
    expect(decideVerifyPrompt(state(MAX_SKIPS, "2026-10-06"), "2026-10-06")).toEqual({
      mode: "hidden",
    })
  })
  it("is mandatory on the seventh showing", () => {
    expect(decideVerifyPrompt(state(MAX_SKIPS, "2026-10-06"), "2026-10-07")).toEqual({
      mode: "mandatory",
    })
  })
  it("stays mandatory on every later launch, even the same day", () => {
    expect(decideVerifyPrompt(state(MAX_SKIPS + 1, "2026-10-07"), "2026-10-07")).toEqual({
      mode: "mandatory",
    })
    expect(decideVerifyPrompt(state(MAX_SKIPS + 1, "2026-10-07"), "2026-11-01")).toEqual({
      mode: "mandatory",
    })
  })
  it("treats a clock set backwards as a new day, not as hidden forever", () => {
    expect(decideVerifyPrompt(state(1, "2026-10-09"), "2026-10-02")).toEqual({
      mode: "skippable",
      skipsLeft: 5,
    })
  })
})

describe("recordShowing", () => {
  it("counts a showing and stamps the day", () => {
    expect(recordShowing(EMPTY_VERIFY_STATE, "2026-10-01")).toEqual({
      count: 1,
      lastDay: "2026-10-01",
      verified: false,
    })
  })
  it("stops counting once mandatory", () => {
    const latched = { count: MAX_SKIPS + 1, lastDay: "2026-10-07", verified: false }
    expect(recordShowing(latched, "2026-10-08")).toEqual({ ...latched, lastDay: "2026-10-08" })
  })
})

describe("verifyGateBlocked (Review Focus 5)", () => {
  const clear = {
    isAuthenticated: true,
    isAnonymous: false,
    onboardingCompleted: true,
    offline: false,
    maintenanceMode: false,
    outageMode: false,
    timerSessionActive: false,
    deviceAuthDegraded: false,
  }
  it("is open for a signed-in user with nothing in the way", () => {
    expect(verifyGateBlocked(clear)).toBe(false)
  })
  it.each([
    ["signed out", { isAuthenticated: false }],
    ["anonymous", { isAnonymous: true }],
    ["mid-onboarding", { onboardingCompleted: false }],
    ["offline", { offline: true }],
    ["maintenance", { maintenanceMode: true }],
    ["outage", { outageMode: true }],
    ["a running timer", { timerSessionActive: true }],
    ["a degraded device lane", { deviceAuthDegraded: true }],
  ])("is blocked when %s", (_name, over) => {
    expect(verifyGateBlocked({ ...clear, ...over })).toBe(true)
  })
})

describe("stepAfterVerifyProblem", () => {
  it("sends a dead code back to review, where a new one can be sent", () => {
    expect(stepAfterVerifyProblem("code_expired")).toBe("review")
    expect(stepAfterVerifyProblem("too_many_attempts")).toBe("review")
  })
  it("sends an address already in use to the change step", () => {
    expect(stepAfterVerifyProblem("email_in_use")).toBe("change")
  })
  it.each([
    "invalid_code",
    "rate_limited",
    "inactive_recipient",
    "not_password_account",
    "unavailable",
  ] as const)("stays on the current step for %s", (problem) => {
    expect(stepAfterVerifyProblem(problem)).toBeNull()
  })
})

describe("emailChanged", () => {
  it("is false for the same address", () => {
    expect(emailChanged("me@example.com", "me@example.com")).toBe(false)
  })
  it("ignores case and surrounding whitespace", () => {
    expect(emailChanged(" Me@Example.com ", "me@example.com")).toBe(false)
    expect(emailChanged("me@example.com", " ME@example.COM ")).toBe(false)
  })
  it("is true for a different address", () => {
    expect(emailChanged("new@example.com", "me@example.com")).toBe(true)
  })
  it("counts an empty or missing account email as changed", () => {
    expect(emailChanged("me@example.com", "")).toBe(true)
    expect(emailChanged("me@example.com", undefined)).toBe(true)
  })
})

describe("mustCloseShownGate", () => {
  it("closes in both modes when the account is gone", () => {
    expect(
      mustCloseShownGate({
        mode: "skippable",
        hasAccount: false,
        blocked: false,
        claimVerified: false,
      }),
    ).toBe(true)
    expect(
      mustCloseShownGate({
        mode: "mandatory",
        hasAccount: false,
        blocked: false,
        claimVerified: false,
      }),
    ).toBe(true)
  })
  it("closes a mandatory screen that is blocked (it cannot send a code)", () => {
    expect(
      mustCloseShownGate({
        mode: "mandatory",
        hasAccount: true,
        blocked: true,
        claimVerified: false,
      }),
    ).toBe(true)
  })
  it("keeps a mandatory screen that is not blocked", () => {
    expect(
      mustCloseShownGate({
        mode: "mandatory",
        hasAccount: true,
        blocked: false,
        claimVerified: false,
      }),
    ).toBe(false)
  })
  it("closes in both modes once the claim reads verified (RS-054)", () => {
    for (const mode of ["skippable", "mandatory"] as const) {
      expect(
        mustCloseShownGate({ mode, hasAccount: true, blocked: false, claimVerified: true }),
      ).toBe(true)
    }
  })
  it("keeps a skippable screen even when blocked (it has Not now)", () => {
    expect(
      mustCloseShownGate({
        mode: "skippable",
        hasAccount: true,
        blocked: true,
        claimVerified: false,
      }),
    ).toBe(false)
    expect(
      mustCloseShownGate({
        mode: "skippable",
        hasAccount: true,
        blocked: false,
        claimVerified: false,
      }),
    ).toBe(false)
  })
})
