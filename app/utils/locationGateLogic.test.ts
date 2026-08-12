import { describe, expect, it } from "vitest"

import { decideLocationGate, shouldRevokeLocationFlag, toOsStatus } from "./locationGateLogic"

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

describe("shouldRevokeLocationFlag", () => {
  it("revokes when we claim a grant the OS does not give us", () => {
    // The whole point: an "Allow Once" grant that lapsed while our toggle
    // stayed on.
    expect(shouldRevokeLocationFlag({ osGranted: false, locationEnabled: true })).toBe(true)
  })

  it("leaves an agreeing pair alone", () => {
    expect(shouldRevokeLocationFlag({ osGranted: true, locationEnabled: true })).toBe(false)
  })

  it("does nothing when both already say no", () => {
    expect(shouldRevokeLocationFlag({ osGranted: false, locationEnabled: false })).toBe(false)
  })

  it("never enables the toggle off the back of an OS grant", () => {
    // Load-bearing. This is the `confirm-in-app` state — the OS has said yes
    // and only the user's own in-app consent is outstanding. A predicate that
    // acted here would silently delete the second consent layer and answer
    // that question on the user's behalf.
    expect(shouldRevokeLocationFlag({ osGranted: true, locationEnabled: false })).toBe(false)
  })
})

describe("decideLocationGate", () => {
  it("proceeds when the toggle is on and the OS agrees", () => {
    expect(decideLocationGate({ locationEnabled: true, osStatus: "granted" })).toBe("proceed")
  })

  it("prompts the OS when the toggle is on but permission was never asked", () => {
    expect(decideLocationGate({ locationEnabled: true, osStatus: "undetermined" })).toBe(
      "prompt-os",
    )
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
