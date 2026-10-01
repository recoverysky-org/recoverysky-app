import { describe, expect, it } from "vitest"

import { decideOwnership, ownerEmailAfterLogin, ownerProofMethod } from "./ownerLogic"

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
  // ADDED 2026-09-30 (spec 2 §7): the owner's identity was linked into another
  // account from a different device, so Auth0 now answers with the primary's sub.
  it("recognises the owner inside a linked account as relinked", () => {
    expect(
      decideOwnership({
        ownerSub: "email|jm",
        sessionSub: "google-oauth2|mm",
        isAnonymous: false,
        linkedSubs: ["google-oauth2|mm", "email|jm"],
      }),
    ).toBe("relinked")
  })
  it("still flags a stranger whose account has other links", () => {
    expect(
      decideOwnership({
        ownerSub: "email|jm",
        sessionSub: "google-oauth2|mm",
        isAnonymous: false,
        linkedSubs: ["google-oauth2|mm", "email|someone-else"],
      }),
    ).toBe("mismatch")
  })
  it("is a plain match, not relinked, when the owner is the primary", () => {
    expect(
      decideOwnership({
        ownerSub: "google-oauth2|mm",
        sessionSub: "google-oauth2|mm",
        isAnonymous: false,
        linkedSubs: ["google-oauth2|mm", "email|jm"],
      }),
    ).toBe("match")
  })
  it("adopts, not relinked, on a device with no owner", () => {
    expect(
      decideOwnership({
        ownerSub: undefined,
        sessionSub: "google-oauth2|mm",
        isAnonymous: false,
        linkedSubs: ["google-oauth2|mm", "email|jm"],
      }),
    ).toBe("adopt")
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

describe("ownerEmailAfterLogin (ADDED 2026-09-30)", () => {
  const base = {
    typedEmail: "jenova@proton.me",
    tokenEmail: "primary@gmail.com",
    currentOwnerEmail: "primary@gmail.com",
  }
  it("uses the typed address for a code sign-in, not the linked primary's", () => {
    expect(ownerEmailAfterLogin({ ...base, decision: "match", loginMethod: "email" })).toBe(
      "jenova@proton.me",
    )
    expect(ownerEmailAfterLogin({ ...base, decision: "adopt", loginMethod: "email" })).toBe(
      "jenova@proton.me",
    )
  })
  it("falls back to the token email when adopting by a provider", () => {
    expect(ownerEmailAfterLogin({ ...base, decision: "adopt", loginMethod: "google" })).toBe(
      "primary@gmail.com",
    )
  })
  it("keeps the stored address when the owner signs in by a provider", () => {
    expect(
      ownerEmailAfterLogin({
        ...base,
        currentOwnerEmail: "jenova@proton.me",
        decision: "match",
        loginMethod: "apple",
      }),
    ).toBe("jenova@proton.me")
  })
  it("uses the token email on a cold-start restore adoption (nothing typed)", () => {
    expect(
      ownerEmailAfterLogin({
        ...base,
        typedEmail: undefined,
        decision: "adopt",
        loginMethod: undefined,
      }),
    ).toBe("primary@gmail.com")
  })
})
