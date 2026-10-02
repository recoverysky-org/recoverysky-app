import { describe, expect, it } from "vitest"

import { emailVerifyProblemFrom } from "./emailVerifyProblem"

describe("emailVerifyProblemFrom", () => {
  it.each([
    "email_in_use",
    "invalid_code",
    "code_expired",
    "too_many_attempts",
    "inactive_recipient",
    "not_password_account",
  ] as const)("passes the API's own code through: %s", (code) => {
    expect(emailVerifyProblemFrom(400, code)).toBe(code)
  })
  it("reads a 429 as rate_limited whatever the body says", () => {
    expect(emailVerifyProblemFrom(429, undefined)).toBe("rate_limited")
    expect(emailVerifyProblemFrom(429, "anything")).toBe("rate_limited")
  })
  it("treats an address the API's validator refuses as one we can't mail", () => {
    expect(emailVerifyProblemFrom(400, "invalid_email")).toBe("inactive_recipient")
  })
  it("falls back to unavailable for everything else", () => {
    expect(emailVerifyProblemFrom(503, "unavailable")).toBe("unavailable")
    expect(emailVerifyProblemFrom(502, "update_failed")).toBe("unavailable")
    expect(emailVerifyProblemFrom(undefined, undefined)).toBe("unavailable")
    expect(emailVerifyProblemFrom(400, { not: "a string" })).toBe("unavailable")
  })
})
