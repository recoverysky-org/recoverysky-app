import { describe, expect, it } from "vitest"

import { canLogAttendance } from "./attendanceGateLogic"

describe("canLogAttendance", () => {
  it("is true for a signed-in user who turned attendance on", () => {
    expect(canLogAttendance({ attendanceEnabled: true, isGuest: false })).toBe(true)
  })

  it("is false for a signed-in user who left attendance off", () => {
    expect(canLogAttendance({ attendanceEnabled: false, isGuest: false })).toBe(false)
  })

  it("a guest never logs attendance, even when the device owner turned attendance on", () => {
    // `attendanceEnabled` is an MMKV prop, so the owner's `true` is still what
    // the profile store holds while a guest is browsing.
    expect(canLogAttendance({ attendanceEnabled: true, isGuest: true })).toBe(false)
  })

  it("is false for a guest when attendance is off too", () => {
    expect(canLogAttendance({ attendanceEnabled: false, isGuest: true })).toBe(false)
  })
})
