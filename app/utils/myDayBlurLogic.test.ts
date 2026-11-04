import { describe, expect, it } from "vitest"
import { decideAndroidBlurMethod } from "./myDayBlurLogic"

describe("decideAndroidBlurMethod (spec D5, §4.6)", () => {
  it("is the native blur on Android 12 and later", () => {
    expect(decideAndroidBlurMethod({ os: "android", version: 31 })).toBe("dimezisBlurView")
    expect(decideAndroidBlurMethod({ os: "android", version: 34 })).toBe("dimezisBlurView")
  })
  it("is the overlay below Android 12", () => {
    expect(decideAndroidBlurMethod({ os: "android", version: 30 })).toBe("none")
    expect(decideAndroidBlurMethod({ os: "android", version: 28 })).toBe("none")
  })
  it("is omitted on iOS and web", () => {
    expect(decideAndroidBlurMethod({ os: "ios", version: "17.2" })).toBeUndefined()
    expect(decideAndroidBlurMethod({ os: "web", version: "" })).toBeUndefined()
  })
})
