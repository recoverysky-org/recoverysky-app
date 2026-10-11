import { describe, expect, it } from "vitest"

import { zoomPrefillName } from "./zoomNameLogic"

describe("zoomPrefillName", () => {
  it("is the profile display name for a signed-in user", () => {
    expect(zoomPrefillName({ isGuest: false, displayName: "Jen" })).toBe("Jen")
  })
  it("is undefined for a guest, whatever the profile holds", () => {
    expect(zoomPrefillName({ isGuest: true, displayName: "Jen" })).toBeUndefined()
    expect(zoomPrefillName({ isGuest: true, displayName: undefined })).toBeUndefined()
  })
  // The profile is not empty for a guest, so the rule cannot lean on "the
  // hydrator skipped them". ProfileStore.displayName appends the owner's saved
  // clean-time / pronoun toggles (MMKV props, so they persist into guest mode)
  // even when shortName is empty, giving " (12d)"; an owner profile already in
  // memory (sign out, then "Just join meetings") still gives "Jen (12d)".
  it("is undefined for a guest whose profile display name is not empty", () => {
    expect(zoomPrefillName({ isGuest: true, displayName: " (12d)" })).toBeUndefined()
    expect(zoomPrefillName({ isGuest: true, displayName: "Jen (12d)" })).toBeUndefined()
  })
})
