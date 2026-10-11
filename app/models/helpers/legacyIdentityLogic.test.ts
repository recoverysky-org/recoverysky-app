import { describe, expect, it } from "vitest"

import { isLegacyDeviceIdUserId } from "./legacyIdentityLogic"

describe("isLegacyDeviceIdUserId", () => {
  it("flags a userId equal to the device id (old device-id login)", () => {
    expect(
      isLegacyDeviceIdUserId({ userId: "3c8d8f26d5fb07b3", deviceId: "3c8d8f26d5fb07b3" }),
    ).toBe(true)
  })
  it("leaves a real Auth0 sub alone", () => {
    expect(isLegacyDeviceIdUserId({ userId: "email|abc", deviceId: "3c8d8f26d5fb07b3" })).toBe(
      false,
    )
  })
  it("is false when either side is missing", () => {
    expect(isLegacyDeviceIdUserId({ userId: undefined, deviceId: "d" })).toBe(false)
    expect(isLegacyDeviceIdUserId({ userId: "d", deviceId: undefined })).toBe(false)
    expect(isLegacyDeviceIdUserId({ userId: "", deviceId: "" })).toBe(false)
  })
})
