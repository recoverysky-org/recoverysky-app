import { describe, expect, it } from "vitest"

import { pushRegistrationUserId } from "./pushRegistrationLogic"

describe("pushRegistrationUserId", () => {
  // POST /push-tokens/ is `authenticateSignedIn` on the server: an anonymous
  // or signed-out caller gets a 403, and the app used to send one on every
  // signed-out cold start because `userIdentifier` falls back to the device
  // id. 403 feeds the edge's probing and 403-bf scenarios.
  it("returns the Auth0 user id for a signed-in user", () => {
    expect(
      pushRegistrationUserId({ userId: "google-oauth2|123", isAnonymous: false, hasSession: true }),
    ).toBe("google-oauth2|123")
  })

  it("returns null for an anonymous session even though userId holds the device id", () => {
    expect(
      pushRegistrationUserId({ userId: "3c8d8f26d5fb07b3", isAnonymous: true, hasSession: false }),
    ).toBeNull()
  })

  it("returns null when the store names a user but holds no tokens (RS-040 zombie sign-in)", () => {
    // MMKV restores userId instantly; the tokens live in SecureStore and can be
    // gone (keychain loss) while the id survives. A request sent then has no
    // Bearer, and the user lane's code-less 401 costs the device JWT.
    expect(
      pushRegistrationUserId({
        userId: "google-oauth2|123",
        isAnonymous: false,
        hasSession: false,
      }),
    ).toBeNull()
  })

  it("returns null when signed out", () => {
    expect(
      pushRegistrationUserId({ userId: undefined, isAnonymous: false, hasSession: false }),
    ).toBeNull()
    expect(pushRegistrationUserId({ userId: "", isAnonymous: false, hasSession: false })).toBeNull()
  })
})
