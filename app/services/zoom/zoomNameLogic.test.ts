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
})
