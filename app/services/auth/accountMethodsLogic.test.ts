import { describe, expect, it } from "vitest"

import {
  IDENTITIES_CLAIM,
  describeAccount,
  isApplePrivateRelay,
  providerToMethod,
} from "./accountMethodsLogic"

/** Build an unsigned three-segment JWT. The signature segment is never inspected. */
function idToken(payload: Record<string, unknown>) {
  const seg = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url")
  return `${seg({ alg: "RS256", typ: "JWT" })}.${seg(payload)}.sig`
}

describe("providerToMethod", () => {
  it("maps each Auth0 provider to the method the user recognises", () => {
    expect(providerToMethod("google-oauth2")).toBe("google")
    expect(providerToMethod("apple")).toBe("apple")
    expect(providerToMethod("email")).toBe("email")
    // The retired database (password) connection is still "Email" to the user.
    expect(providerToMethod("auth0")).toBe("email")
  })

  it("returns null for a provider this app never offers", () => {
    expect(providerToMethod("github")).toBeNull()
    expect(providerToMethod(undefined)).toBeNull()
  })
})

describe("isApplePrivateRelay", () => {
  it("recognises Hide My Email addresses, case-insensitively", () => {
    expect(isApplePrivateRelay("abc123@privaterelay.appleid.com")).toBe(true)
    expect(isApplePrivateRelay("ABC@PrivateRelay.AppleID.com")).toBe(true)
    expect(isApplePrivateRelay("me@icloud.com")).toBe(false)
    expect(isApplePrivateRelay(undefined)).toBe(false)
  })
})

describe("describeAccount", () => {
  it("uses the recorded loginMethod for the active row, not the sub prefix", () => {
    // Linked account: the sub is the Google primary's, but the user signed in by email code.
    const result = describeAccount({
      loginMethod: "email",
      sub: "google-oauth2|111",
      authEmail: "primary@gmail.com",
      idToken: idToken({
        sub: "google-oauth2|111",
        [IDENTITIES_CLAIM]: [
          { provider: "google-oauth2", email: "primary@gmail.com" },
          { provider: "email", email: "code@proton.me" },
        ],
      }),
    })
    expect(result.active).toEqual({
      method: "email",
      email: "code@proton.me",
      hiddenByApple: false,
    })
    expect(result.linked).toEqual([
      { method: "google", email: "primary@gmail.com", hiddenByApple: false },
    ])
  })

  it("falls back to the sub prefix when loginMethod was never recorded", () => {
    const result = describeAccount({
      loginMethod: undefined,
      sub: "apple|001",
      authEmail: "me@icloud.com",
      idToken: undefined,
    })
    expect(result.active).toEqual({ method: "apple", email: "me@icloud.com", hiddenByApple: false })
    expect(result.linked).toEqual([])
  })

  it("treats a legacy auth0| sub as Email", () => {
    const result = describeAccount({
      loginMethod: undefined,
      sub: "auth0|abc",
      authEmail: "old@example.com",
      idToken: undefined,
    })
    expect(result.active?.method).toBe("email")
  })

  it("shows only the active row when the identities claim is missing", () => {
    const result = describeAccount({
      loginMethod: "google",
      sub: "google-oauth2|111",
      authEmail: "me@gmail.com",
      idToken: idToken({ sub: "google-oauth2|111" }),
    })
    expect(result.active).toEqual({ method: "google", email: "me@gmail.com", hiddenByApple: false })
    expect(result.linked).toEqual([])
  })

  it("collapses a migrated password user's auth0 + email pair into one Email row", () => {
    const result = describeAccount({
      loginMethod: "email",
      sub: "auth0|abc",
      authEmail: "Me@Example.com",
      idToken: idToken({
        sub: "auth0|abc",
        [IDENTITIES_CLAIM]: [
          { provider: "auth0", email: "Me@Example.com" },
          { provider: "email", email: "me@example.com" },
        ],
      }),
    })
    expect(result.active?.method).toBe("email")
    expect(result.linked).toEqual([])
  })

  it("flags an Apple private relay address instead of showing it", () => {
    const result = describeAccount({
      loginMethod: "email",
      sub: "email|1",
      authEmail: "me@proton.me",
      idToken: idToken({
        sub: "email|1",
        [IDENTITIES_CLAIM]: [
          { provider: "email", email: "me@proton.me" },
          { provider: "apple", email: "x9y8@privaterelay.appleid.com" },
        ],
      }),
    })
    expect(result.linked).toEqual([{ method: "apple", email: undefined, hiddenByApple: true }])
  })

  it("prefers the identity whose email matches authEmail when two share the active method", () => {
    const result = describeAccount({
      loginMethod: "google",
      sub: "google-oauth2|1",
      authEmail: "second@gmail.com",
      idToken: idToken({
        sub: "google-oauth2|1",
        [IDENTITIES_CLAIM]: [
          { provider: "google-oauth2", email: "first@gmail.com" },
          { provider: "google-oauth2", email: "second@gmail.com" },
        ],
      }),
    })
    expect(result.active?.email).toBe("second@gmail.com")
    expect(result.linked).toEqual([
      { method: "google", email: "first@gmail.com", hiddenByApple: false },
    ])
  })

  it("ignores malformed claim entries and unknown providers", () => {
    const result = describeAccount({
      loginMethod: "email",
      sub: "email|1",
      authEmail: "me@proton.me",
      idToken: idToken({
        sub: "email|1",
        [IDENTITIES_CLAIM]: [null, "junk", { provider: "github", email: "x@y.z" }, { email: 3 }],
      }),
    })
    expect(result.linked).toEqual([])
  })

  it("tolerates a claim that is not an array", () => {
    const result = describeAccount({
      loginMethod: "email",
      sub: "email|1",
      authEmail: "me@proton.me",
      idToken: idToken({ sub: "email|1", [IDENTITIES_CLAIM]: { provider: "apple" } }),
    })
    expect(result.linked).toEqual([])
  })

  it("returns no active row when there is no session to describe", () => {
    const result = describeAccount({
      loginMethod: undefined,
      sub: undefined,
      authEmail: "",
      idToken: undefined,
    })
    expect(result).toEqual({ active: null, linked: [] })
  })
})
