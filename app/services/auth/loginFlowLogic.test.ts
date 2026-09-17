import { describe, expect, it } from "vitest"

import {
  RESEND_COOLDOWN_MS,
  isPlausibleEmail,
  maskEmail,
  nextStep,
  resendWaitSeconds,
} from "./loginFlowLogic"

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("jenova@proton.me")).toBe("j***@proton.me")
  })
  it("handles a one-character local part", () => {
    expect(maskEmail("j@proton.me")).toBe("j***@proton.me")
  })
  it("returns the input unchanged when there is no @", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email")
  })
  it("trims and lowercases before masking", () => {
    expect(maskEmail("  Jenova@Proton.me ")).toBe("j***@proton.me")
  })
})

describe("isPlausibleEmail", () => {
  it("accepts x@y.z shapes and nothing stricter", () => {
    expect(isPlausibleEmail("a@b.c")).toBe(true)
    expect(isPlausibleEmail("first.last+tag@sub.example.org")).toBe(true)
  })
  it("rejects missing parts and whitespace", () => {
    expect(isPlausibleEmail("")).toBe(false)
    expect(isPlausibleEmail("a@b")).toBe(false)
    expect(isPlausibleEmail("a b@c.d")).toBe(false)
    expect(isPlausibleEmail("@b.c")).toBe(false)
  })
})

describe("resendWaitSeconds", () => {
  it("allows a first send", () => {
    expect(resendWaitSeconds(null, 1_000)).toBe(0)
  })
  it("counts down whole seconds inside the cooldown", () => {
    expect(resendWaitSeconds(0, 1_000)).toBe(29)
    expect(resendWaitSeconds(0, RESEND_COOLDOWN_MS - 1)).toBe(1)
  })
  it("is 0 at exactly the cooldown boundary", () => {
    expect(resendWaitSeconds(0, RESEND_COOLDOWN_MS)).toBe(0)
  })
})

describe("nextStep", () => {
  it("walks choose → email → code", () => {
    expect(nextStep("choose", "chooseEmail")).toBe("email")
    expect(nextStep("email", "codeSent")).toBe("code")
  })
  it("skips the email step for the owner-aware button", () => {
    expect(nextStep("choose", "chooseOwnerEmail")).toBe("code")
  })
  it("goes back one step, and from code to email on wrongEmail", () => {
    expect(nextStep("email", "back")).toBe("choose")
    expect(nextStep("code", "back")).toBe("email")
    expect(nextStep("code", "wrongEmail")).toBe("email")
    expect(nextStep("choose", "back")).toBe("choose")
  })
  it("returns to email when the only remedy is waiting", () => {
    expect(nextStep("code", "tooManyAttempts")).toBe("email")
    expect(nextStep("code", "sendRateLimited")).toBe("email")
    expect(nextStep("email", "sendRateLimited")).toBe("email")
  })
})
