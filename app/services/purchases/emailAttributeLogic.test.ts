import { describe, expect, it } from "vitest"

import { resolveEmailAttribute } from "./emailAttributeLogic"

const signedIn = { appUserId: "auth0|abc123", authEmail: "jenova@example.org" }

describe("resolveEmailAttribute", () => {
  // CHANGED 2026-10-11: the two cases that kept a device id out of this
  // attribute are gone with the old device-id login. `appUserId` comes from
  // rcIdentityFor, which can no longer be a device id.
  it("returns the email for a signed-in user", () => {
    expect(resolveEmailAttribute(signedIn)).toBe("jenova@example.org")
  })

  it("trims surrounding whitespace before sending", () => {
    expect(resolveEmailAttribute({ ...signedIn, authEmail: "  jenova@example.org\n" })).toBe(
      "jenova@example.org",
    )
  })

  it("sends nothing when there is no app user id yet", () => {
    // RC isn't identified — the attribute would land on an anonymous customer.
    expect(resolveEmailAttribute({ ...signedIn, appUserId: undefined })).toBeNull()
  })

  it("sends nothing when the email is blank", () => {
    expect(resolveEmailAttribute({ ...signedIn, authEmail: "" })).toBeNull()
    expect(resolveEmailAttribute({ ...signedIn, authEmail: "   " })).toBeNull()
  })

  it("sends nothing when the email is not shaped like an address", () => {
    // Some Auth0 connections hand back a placeholder instead of an email.
    expect(resolveEmailAttribute({ ...signedIn, authEmail: "not-an-email" })).toBeNull()
  })
})
