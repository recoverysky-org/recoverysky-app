import { beforeEach, describe, expect, it } from "vitest"

import { claimOverlay, overlayOwner, releaseOverlay } from "./overlayGate"

describe("overlayGate", () => {
  beforeEach(() => {
    releaseOverlay(overlayOwner() ?? "")
  })
  it("gives the overlay to the first claimer only", () => {
    expect(claimOverlay("verifyEmail")).toBe(true)
    expect(claimOverlay("announcement")).toBe(false)
    expect(overlayOwner()).toBe("verifyEmail")
  })
  it("lets the owner claim again", () => {
    claimOverlay("verifyEmail")
    expect(claimOverlay("verifyEmail")).toBe(true)
  })
  it("frees it only for the owner", () => {
    claimOverlay("verifyEmail")
    releaseOverlay("announcement")
    expect(overlayOwner()).toBe("verifyEmail")
    releaseOverlay("verifyEmail")
    expect(overlayOwner()).toBeNull()
    expect(claimOverlay("announcement")).toBe(true)
  })
})
