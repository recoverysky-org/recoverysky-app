import { describe, expect, it } from "vitest"

import { decideOwnership, ownerProofMethod } from "./ownerLogic"

describe("decideOwnership", () => {
  it("adopts when the device has no owner yet", () => {
    expect(
      decideOwnership({ ownerSub: undefined, sessionSub: "email|1", isAnonymous: false }),
    ).toBe("adopt")
  })
  it("matches the owner", () => {
    expect(
      decideOwnership({ ownerSub: "auth0|a", sessionSub: "auth0|a", isAnonymous: false }),
    ).toBe("match")
  })
  it("flags a different account", () => {
    expect(
      decideOwnership({ ownerSub: "auth0|a", sessionSub: "google-oauth2|b", isAnonymous: false }),
    ).toBe("mismatch")
  })
  it("never stamps or blocks an anonymous session", () => {
    expect(
      decideOwnership({ ownerSub: undefined, sessionSub: "device-1", isAnonymous: true }),
    ).toBe("match")
    expect(
      decideOwnership({ ownerSub: "auth0|a", sessionSub: "device-1", isAnonymous: true }),
    ).toBe("match")
  })
})

describe("ownerProofMethod", () => {
  it("sends a code for email and legacy password owners", () => {
    expect(ownerProofMethod("email|abc")).toBe("code")
    expect(ownerProofMethod("auth0|abc")).toBe("code")
  })
  it("uses the provider button for social owners", () => {
    expect(ownerProofMethod("google-oauth2|123")).toBe("google")
    expect(ownerProofMethod("apple|000123.abc")).toBe("apple")
  })
  it("is unknown for anything else", () => {
    expect(ownerProofMethod("sms|1")).toBe("unknown")
    expect(ownerProofMethod("")).toBe("unknown")
    expect(ownerProofMethod(undefined)).toBe("unknown")
  })
})
