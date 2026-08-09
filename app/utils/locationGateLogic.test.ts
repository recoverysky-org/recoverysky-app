import { describe, expect, it } from "vitest"

import { decideLocationGate, toOsStatus } from "./locationGateLogic"

describe("toOsStatus", () => {
  it("maps a granted permission to granted", () => {
    expect(toOsStatus({ granted: true, canAskAgain: false })).toBe("granted")
  })

  it("maps not-granted-but-askable to undetermined", () => {
    expect(toOsStatus({ granted: false, canAskAgain: true })).toBe("undetermined")
  })

  it("maps not-granted-and-not-askable to denied", () => {
    expect(toOsStatus({ granted: false, canAskAgain: false })).toBe("denied")
  })
})

describe("decideLocationGate", () => {
  it("proceeds when the toggle is on and the OS agrees", () => {
    expect(decideLocationGate({ locationEnabled: true, osStatus: "granted" })).toBe("proceed")
  })

  it("prompts the OS when the toggle is on but permission was never asked", () => {
    expect(decideLocationGate({ locationEnabled: true, osStatus: "undetermined" })).toBe("prompt-os")
  })

  it("sends the user to settings when the OS revoked an enabled toggle", () => {
    expect(decideLocationGate({ locationEnabled: true, osStatus: "denied" })).toBe("open-settings")
  })

  it("prompts the OS on a fresh install with the toggle off", () => {
    expect(decideLocationGate({ locationEnabled: false, osStatus: "undetermined" })).toBe(
      "prompt-os",
    )
  })

  it("confirms in-app when the OS already granted but the toggle is off", () => {
    // The one branch that must NOT deep-link: there is nothing to change in
    // device settings, so sending the user there is a dead end.
    expect(decideLocationGate({ locationEnabled: false, osStatus: "granted" })).toBe(
      "confirm-in-app",
    )
  })

  it("sends the user to settings when both the toggle and the OS say no", () => {
    expect(decideLocationGate({ locationEnabled: false, osStatus: "denied" })).toBe("open-settings")
  })
})
