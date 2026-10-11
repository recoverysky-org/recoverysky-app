import { describe, expect, it } from "vitest"

import {
  decideRcIdentityTransition,
  rcIdentityFor,
  shouldSyncForIdentity,
  syncFlagKey,
} from "./rcIdentityLogic"

describe("rcIdentityFor", () => {
  // The device id is never a RevenueCat identity (spec 2026-09-17). Before this,
  // configure() ran with the device id and 9,881 phantom customers — and 286
  // purchases — accumulated on them.
  // CHANGED 2026-10-11: the case that fed a device id in through the old
  // device-id login's flag is gone with that login. `userId` is only ever an
  // Auth0 sub now, and a leftover device-id value is cleared on hydration.
  it("is the Auth0 user id for a signed-in user", () => {
    expect(rcIdentityFor({ userId: "google-oauth2|123" })).toBe("google-oauth2|123")
  })

  it("is null when nobody is signed in", () => {
    expect(rcIdentityFor({ userId: undefined })).toBeNull()
    expect(rcIdentityFor({ userId: "" })).toBeNull()
  })
})

describe("decideRcIdentityTransition", () => {
  it("logs in on the null → sub edge and when the sub changes", () => {
    expect(decideRcIdentityTransition(null, "auth0|a")).toBe("login")
    expect(decideRcIdentityTransition("auth0|a", "auth0|b")).toBe("login")
  })

  it("logs out on the sub → null edge", () => {
    expect(decideRcIdentityTransition("auth0|a", null)).toBe("logout")
  })

  it("does nothing when the identity is unchanged, including null → null", () => {
    expect(decideRcIdentityTransition("auth0|a", "auth0|a")).toBe("none")
    expect(decideRcIdentityTransition(null, null)).toBe("none")
  })
})

describe("per-identity receipt sync", () => {
  it("keys the flag on the app user id", () => {
    expect(syncFlagKey("auth0|a")).toBe("rc_purchases_synced.auth0|a")
  })

  it("syncs the first time an identity is seen on this install, then never again", () => {
    // The old install-wide flag was written under the device id on first
    // launch, so the Auth0 customer never got a sync — which is how 81 active
    // subscriptions ended up stranded on device-id customers.
    expect(
      shouldSyncForIdentity("auth0|a", (k) => (k === "rc_purchases_synced" ? "1" : null)),
    ).toBe(true)
    expect(
      shouldSyncForIdentity("auth0|a", (k) => (k === syncFlagKey("auth0|a") ? "1" : null)),
    ).toBe(false)
  })
})
