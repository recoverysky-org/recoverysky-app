import { describe, expect, it } from "vitest"

import { resolveEmailAttribute } from "./emailAttributeLogic"

const signedIn = {
  appUserId: "auth0|abc123",
  deviceId: "device-1",
  isAnonymous: false,
  authEmail: "jenova@example.org",
}

describe("resolveEmailAttribute", () => {
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

  it("sends nothing for an anonymous (device-id) user", () => {
    expect(
      resolveEmailAttribute({ ...signedIn, appUserId: "device-1", isAnonymous: true }),
    ).toBeNull()
  })

  it("sends nothing when the app user id is just the device id, even if the flag is stale", () => {
    // logout() clears isAnonymous but userIdentifier falls back to deviceId.
    expect(resolveEmailAttribute({ ...signedIn, appUserId: "device-1" })).toBeNull()
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
