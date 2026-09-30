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

  it("uses the Action's current tag when two identities share the active method", () => {
    // Regression: the old tie-break matched authEmail, which is always the
    // PRIMARY's email on a linked session, so it picked first@ here.
    const result = describeAccount({
      loginMethod: "google",
      sub: "google-oauth2|1",
      authEmail: "first@gmail.com",
      idToken: idToken({
        sub: "google-oauth2|1",
        [IDENTITIES_CLAIM]: [
          { provider: "google-oauth2", email: "first@gmail.com" },
          { provider: "google-oauth2", email: "second@gmail.com", current: true },
        ],
      }),
    })
    expect(result.active?.email).toBe("second@gmail.com")
    expect(result.linked).toEqual([
      { method: "google", email: "first@gmail.com", hiddenByApple: false },
    ])
  })

  it("shows no email on the active row when two same-method identities are untagged", () => {
    const result = describeAccount({
      loginMethod: "google",
      sub: "google-oauth2|1",
      authEmail: "first@gmail.com",
      idToken: idToken({
        sub: "google-oauth2|1",
        [IDENTITIES_CLAIM]: [
          { provider: "google-oauth2", email: "first@gmail.com" },
          { provider: "google-oauth2", email: "second@gmail.com" },
        ],
      }),
    })
    expect(result.active).toEqual({ method: "google", email: undefined, hiddenByApple: false })
    expect(result.linked.map((id) => id.email)).toEqual(["first@gmail.com", "second@gmail.com"])
  })

  it("picks the typed address among email identities the Action tagged alike", () => {
    // Code sign-in with the secondary address: every code identity is on the one
    // `email` connection, so the Action tags them all current.
    const result = describeAccount({
      loginMethod: "email",
      sub: "email|1",
      authEmail: "primary@gmail.com",
      codeEmail: "Second@Proton.me",
      idToken: idToken({
        sub: "email|1",
        [IDENTITIES_CLAIM]: [
          { provider: "email", email: "primary@gmail.com", current: true },
          { provider: "google-oauth2", email: "primary@gmail.com" },
          { provider: "email", email: "second@proton.me", current: true },
        ],
      }),
    })
    expect(result.active).toEqual({
      method: "email",
      email: "second@proton.me",
      hiddenByApple: false,
    })
    expect(result.linked.map((id) => `${id.method}:${id.email}`)).toEqual([
      "email:primary@gmail.com",
      "google:primary@gmail.com",
    ])
  })

  it("ignores codeEmail for a non-email session", () => {
    const result = describeAccount({
      loginMethod: "google",
      sub: "google-oauth2|1",
      authEmail: "first@gmail.com",
      codeEmail: "first@gmail.com",
      idToken: idToken({
        sub: "google-oauth2|1",
        [IDENTITIES_CLAIM]: [
          { provider: "google-oauth2", email: "first@gmail.com" },
          { provider: "google-oauth2", email: "second@gmail.com" },
        ],
      }),
    })
    expect(result.active?.email).toBeUndefined()
  })

  it("never puts the primary's email on a non-primary active row when the claim is missing", () => {
    // Email-code sign-in into a Google-primary account on a tenant without the Action.
    const result = describeAccount({
      loginMethod: "email",
      sub: "google-oauth2|111",
      authEmail: "primary@gmail.com",
      idToken: idToken({ sub: "google-oauth2|111" }),
    })
    expect(result.active).toEqual({ method: "email", email: undefined, hiddenByApple: false })
    expect(result.linked).toEqual([])
  })

  it("never puts the primary's email on the active row when the claim predates the link", () => {
    // Link made during this login: the claim lists only the primary.
    const result = describeAccount({
      loginMethod: "email",
      sub: "google-oauth2|111",
      authEmail: "primary@gmail.com",
      idToken: idToken({
        sub: "google-oauth2|111",
        [IDENTITIES_CLAIM]: [{ provider: "google-oauth2", email: "primary@gmail.com" }],
      }),
    })
    expect(result.active?.email).toBeUndefined()
    expect(result.linked).toEqual([
      { method: "google", email: "primary@gmail.com", hiddenByApple: false },
    ])
  })

  it("does not fall back to authEmail when the active identity has no email", () => {
    const result = describeAccount({
      loginMethod: "apple",
      sub: "google-oauth2|111",
      authEmail: "primary@gmail.com",
      idToken: idToken({
        sub: "google-oauth2|111",
        [IDENTITIES_CLAIM]: [
          { provider: "google-oauth2", email: "primary@gmail.com" },
          { provider: "apple", current: true },
        ],
      }),
    })
    expect(result.active).toEqual({ method: "apple", email: undefined, hiddenByApple: false })
  })

  it("keeps two email-less identities of the same method as separate rows", () => {
    const result = describeAccount({
      loginMethod: "email",
      sub: "email|1",
      authEmail: "me@proton.me",
      idToken: idToken({
        sub: "email|1",
        [IDENTITIES_CLAIM]: [
          { provider: "email", email: "me@proton.me", current: true },
          { provider: "apple" },
          { provider: "apple" },
        ],
      }),
    })
    expect(result.linked).toHaveLength(2)
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
