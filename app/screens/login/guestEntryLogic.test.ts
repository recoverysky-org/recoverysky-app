import { describe, expect, it } from "vitest"

import { decideGuestEntry } from "./guestEntryLogic"

const base = { platform: "android", step: "choose", hasUserId: false }

describe("decideGuestEntry", () => {
  it("offers guest mode on Android's choose step when no identity is present", () => {
    expect(decideGuestEntry(base)).toBe(true)
  })

  it("never offers it off Android, because iOS requires an account", () => {
    expect(decideGuestEntry({ ...base, platform: "ios" })).toBe(false)
  })

  it("offers it on the choose step only, never under the email or code field", () => {
    expect(decideGuestEntry({ ...base, step: "email" })).toBe(false)
    expect(decideGuestEntry({ ...base, step: "code" })).toBe(false)
  })

  // The Login screen also shows while a userId is present: for a signed-in
  // owner whose token is renewing at cold start, and while a forced logout is
  // deferred for a persisted attendance timer. A tap there would put the
  // owner's own session in guest mode, where Join opens Zoom with no
  // attendance timer.
  it("hides it while a userId is present, so a signed-in owner never lands in guest mode", () => {
    expect(decideGuestEntry({ ...base, hasUserId: true })).toBe(false)
  })
})
