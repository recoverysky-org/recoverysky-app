import { describe, expect, it } from "vitest"

import {
  decideBanner,
  decideMaintenanceCause,
  decideOracleVerdict,
  decideOutageVariant,
  isTransportProblem,
  shouldFlipMaintenanceOnPollFailure,
  shouldSkipConfigPoll,
  isLiveRefreshBlocked,
  isServiceRecoveryEdge,
} from "./connectivityLogic"

describe("decideBanner", () => {
  it("shows nothing when online and healthy", () => {
    expect(
      decideBanner({ isOffline: false, maintenanceMode: false, deviceAuthDegraded: false }),
    ).toBe("none")
  })

  it("shows maintenance when online and maintenance is flagged", () => {
    expect(
      decideBanner({ isOffline: false, maintenanceMode: true, deviceAuthDegraded: false }),
    ).toBe("maintenance")
  })

  it("shows offline when the device is offline", () => {
    expect(
      decideBanner({ isOffline: true, maintenanceMode: false, deviceAuthDegraded: false }),
    ).toBe("offline")
  })

  it("offline wins over maintenance — it is the more accurate diagnosis", () => {
    // Load-bearing precedence: an offline device cannot verify a maintenance
    // claim, and "you're offline" is true regardless of our service state.
    expect(
      decideBanner({ isOffline: true, maintenanceMode: true, deviceAuthDegraded: false }),
    ).toBe("offline")
  })

  it("shows connecting when device auth is degraded and the device is online", () => {
    expect(
      decideBanner({ isOffline: false, maintenanceMode: false, deviceAuthDegraded: true }),
    ).toBe("connecting")
  })

  it("offline wins over connecting", () => {
    expect(
      decideBanner({ isOffline: true, maintenanceMode: false, deviceAuthDegraded: true }),
    ).toBe("offline")
  })

  it("connecting wins over maintenance", () => {
    expect(
      decideBanner({ isOffline: false, maintenanceMode: true, deviceAuthDegraded: true }),
    ).toBe("connecting")
  })

  // ADDED 2026-09-28: connected-but-not-getting-through devices were shown
  // amber "Maintenance in progress" while the API was healthy.
  const netMaint = { isOffline: false, maintenanceMode: true, deviceAuthDegraded: false }

  it("shows network issues when maintenance came from transport failures", () => {
    expect(decideBanner({ ...netMaint, maintenanceCause: "network" })).toBe("network")
  })

  it("names the connection when the reachability probe agrees", () => {
    expect(
      decideBanner({ ...netMaint, maintenanceCause: "network", isInternetReachable: false }),
    ).toBe("no-internet")
  })

  it("keeps the soft network copy while the probe is unknown or says reachable", () => {
    for (const isInternetReachable of [null, true, undefined]) {
      expect(decideBanner({ ...netMaint, maintenanceCause: "network", isInternetReachable })).toBe(
        "network",
      )
    }
  })

  it("never shows a network variant from the probe alone", () => {
    // The probe host is blocked on some national networks — it may pick the
    // copy, never decide that there's a problem.
    expect(
      decideBanner({
        isOffline: false,
        maintenanceMode: false,
        deviceAuthDegraded: false,
        isInternetReachable: false,
      }),
    ).toBe("none")
  })

  it("keeps amber maintenance for server-caused (or unlabelled) maintenance", () => {
    expect(decideBanner({ ...netMaint, maintenanceCause: "server" })).toBe("maintenance")
    expect(decideBanner({ ...netMaint, maintenanceCause: null })).toBe("maintenance")
  })

  it("offline still wins over network issues", () => {
    expect(decideBanner({ ...netMaint, isOffline: true, maintenanceCause: "network" })).toBe(
      "offline",
    )
  })

  it("network issues win over connecting — the dead link is the root cause", () => {
    expect(
      decideBanner({ ...netMaint, deviceAuthDegraded: true, maintenanceCause: "network" }),
    ).toBe("network")
  })
})

describe("decideBanner with the internet oracle", () => {
  const netMaint = {
    isOffline: false,
    maintenanceMode: true,
    deviceAuthDegraded: false,
    maintenanceCause: "network" as const,
  }

  it("oracle down means no-internet, even when NetInfo's probe says reachable", () => {
    expect(decideBanner({ ...netMaint, internetOracle: false, isInternetReachable: true })).toBe(
      "no-internet",
    )
  })

  it("oracle up means the soft network copy, even when NetInfo's probe says unreachable", () => {
    expect(decideBanner({ ...netMaint, internetOracle: true, isInternetReachable: false })).toBe(
      "network",
    )
  })

  it("falls back to NetInfo's probe when the oracle has not run", () => {
    expect(decideBanner({ ...netMaint, internetOracle: null, isInternetReachable: false })).toBe(
      "no-internet",
    )
  })

  it("never shows a banner from the oracle alone", () => {
    expect(
      decideBanner({
        isOffline: false,
        maintenanceMode: false,
        deviceAuthDegraded: false,
        internetOracle: false,
      }),
    ).toBe("none")
  })

  it("never escalates a server-caused maintenance to a network variant", () => {
    expect(decideBanner({ ...netMaint, maintenanceCause: "server", internetOracle: false })).toBe(
      "maintenance",
    )
  })
})

describe("decideOracleVerdict", () => {
  it("is reachable when any probe answered", () => {
    expect(decideOracleVerdict(["answered", "timeout"])).toBe(true)
    expect(decideOracleVerdict(["failed", "answered"])).toBe(true)
  })

  it("is unreachable only when every probe failed", () => {
    expect(decideOracleVerdict(["timeout", "failed"])).toBe(false)
    expect(decideOracleVerdict(["timeout", "timeout"])).toBe(false)
  })

  it("gives no verdict without probes", () => {
    expect(decideOracleVerdict([])).toBe(null)
  })
})

describe("isTransportProblem", () => {
  it("is true only for no-answer kinds", () => {
    expect(isTransportProblem("cannot-connect")).toBe(true)
    expect(isTransportProblem("timeout")).toBe(true)
    for (const kind of ["server", "unknown", "unauthorized", "bad-data", "", null, undefined]) {
      expect(isTransportProblem(kind)).toBe(false)
    }
  })
})

describe("decideMaintenanceCause", () => {
  it("is network when every attempt failed at the transport level", () => {
    expect(decideMaintenanceCause(["timeout", "cannot-connect", "timeout"])).toBe("network")
  })

  it("is server when any attempt got a real answer", () => {
    expect(decideMaintenanceCause(["timeout", "server", "timeout"])).toBe("server")
    expect(decideMaintenanceCause(["unauthorized"])).toBe("server")
  })

  it("is server for an unclassified failure or no attempts at all", () => {
    expect(decideMaintenanceCause(["unknown"])).toBe("server")
    expect(decideMaintenanceCause([])).toBe("server")
  })
})

describe("decideOutageVariant", () => {
  it("blames the device when it is offline", () => {
    expect(decideOutageVariant({ isOffline: true })).toBe("offline")
  })

  it("blames the service when the device is online", () => {
    expect(decideOutageVariant({ isOffline: false })).toBe("maintenance")
  })

  it("blames the connection when the outage came from transport failures", () => {
    expect(decideOutageVariant({ isOffline: false, maintenanceCause: "network" })).toBe("network")
  })

  it("offline still wins over a network cause", () => {
    expect(decideOutageVariant({ isOffline: true, maintenanceCause: "network" })).toBe("offline")
  })
})

describe("shouldFlipMaintenanceOnPollFailure", () => {
  it("flips maintenance for an online device whose poll exhausted retries", () => {
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: false, isLoaded: true })).toBe(true)
  })

  it("never flips maintenance while the device is offline", () => {
    // THE fix for the false-banner complaint: a subway rider's failed polls
    // are the device's problem, not evidence of maintenance.
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: true, isLoaded: true })).toBe(false)
  })

  it("never flips on the cold-start path (isLoaded false) — that is app.tsx's outage gate", () => {
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: false, isLoaded: false })).toBe(false)
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: true, isLoaded: false })).toBe(false)
  })
})

describe("shouldSkipConfigPoll", () => {
  it("skips polling while offline — a poll that cannot succeed must not count as a failure", () => {
    expect(shouldSkipConfigPoll({ isOffline: true })).toBe(true)
  })

  it("polls normally while online", () => {
    expect(shouldSkipConfigPoll({ isOffline: false })).toBe(false)
  })
})

describe("isLiveRefreshBlocked", () => {
  it("is not blocked when the service is healthy", () => {
    expect(isLiveRefreshBlocked({ maintenanceMode: false, outageMode: false })).toBe(false)
  })

  it("is blocked by runtime maintenance", () => {
    expect(isLiveRefreshBlocked({ maintenanceMode: true, outageMode: false })).toBe(true)
  })

  it("is blocked by cold-start outage — the flag maintenance never sets on that path", () => {
    // A cold start whose /status/ready precheck fails sets outageMode ONLY;
    // maintenanceMode stays false for the whole outage. Watching maintenance
    // alone is how Live stayed empty after the outage cleared.
    expect(isLiveRefreshBlocked({ maintenanceMode: false, outageMode: true })).toBe(true)
  })
})

describe("isServiceRecoveryEdge", () => {
  it("fires on the blocked → unblocked transition", () => {
    expect(isServiceRecoveryEdge(true, false)).toBe(true)
  })

  it("does not fire when blocking begins", () => {
    expect(isServiceRecoveryEdge(false, true)).toBe(false)
  })

  it("does not fire while steady in either state", () => {
    expect(isServiceRecoveryEdge(false, false)).toBe(false)
    expect(isServiceRecoveryEdge(true, true)).toBe(false)
  })

  it("treats an unknown previous state as no edge — the initial refresh already ran", () => {
    expect(isServiceRecoveryEdge(undefined, false)).toBe(false)
  })
})
