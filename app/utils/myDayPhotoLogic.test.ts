import { describe, expect, it } from "vitest"
import { pickPhotoIndex } from "./myDayPhotoLogic"

describe("pickPhotoIndex", () => {
  it("spans the whole set", () => {
    expect(pickPhotoIndex(13, () => 0)).toBe(0)
    expect(pickPhotoIndex(13, () => 0.999)).toBe(12)
  })
  it("never overflows, even on a random of 1", () => expect(pickPhotoIndex(13, () => 1)).toBe(12))
  it("is 0 for an empty set", () => expect(pickPhotoIndex(0, () => 0.5)).toBe(0))
})
