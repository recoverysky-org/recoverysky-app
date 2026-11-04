// dailyDashDriverLogic.test.ts
import { describe, expect, it } from "vitest"

import { decideDailyDashAction } from "./dailyDashDriverLogic"

const STATUSES = ["restoring", "signedOut", "wrongAccount", "signedIn", "accountDeleted"] as const
describe("decideDailyDashAction (spec D10, §4.4)", () => {
  it("a gate that does not hold starts nothing, for every status (a free account never mints an account)", () => {
    for (const status of STATUSES)
      expect(
        decideDailyDashAction({ gateHolds: false, status, attempt: "idle", trigger: "state" }),
      ).toBe("none")
  })
  it("the gate releasing is never a sign-out: the action set has no such member", () => {
    for (const status of STATUSES)
      for (const trigger of ["gate", "state"] as const)
        expect(["signIn", "releaseDevice", "none"]).toContain(
          decideDailyDashAction({ gateHolds: false, status, attempt: "idle", trigger }),
        )
  })
  it("signs in when signed out and the gate holds", () => {
    expect(
      decideDailyDashAction({
        gateHolds: true,
        status: "signedOut",
        attempt: "idle",
        trigger: "state",
      }),
    ).toBe("signIn")
  })
  it("never overlaps a running attempt", () => {
    expect(
      decideDailyDashAction({
        gateHolds: true,
        status: "signedOut",
        attempt: "running",
        trigger: "retry",
      }),
    ).toBe("none")
  })
  it("after a failure, only a reconnect, a foreground, a retry or the gate tries again", () => {
    expect(
      decideDailyDashAction({
        gateHolds: true,
        status: "signedOut",
        attempt: "failed",
        trigger: "state",
      }),
    ).toBe("none")
    for (const trigger of ["reconnect", "foreground", "retry", "gate"] as const)
      expect(
        decideDailyDashAction({ gateHolds: true, status: "signedOut", attempt: "failed", trigger }),
      ).toBe("signIn")
  })
  it("a wrong account hands the device over (our gate is authoritative)", () => {
    expect(
      decideDailyDashAction({
        gateHolds: true,
        status: "wrongAccount",
        attempt: "idle",
        trigger: "state",
      }),
    ).toBe("releaseDevice")
  })
  it("signed in, restoring, deleted: nothing", () => {
    for (const status of ["signedIn", "restoring", "accountDeleted"] as const)
      expect(
        decideDailyDashAction({ gateHolds: true, status, attempt: "idle", trigger: "foreground" }),
      ).toBe("none")
  })
})
