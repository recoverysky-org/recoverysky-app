import { describe, expect, it } from "vitest"

import { decideStartupConfigPath } from "./configCacheLogic"

describe("decideStartupConfigPath", () => {
  it("returns cold for a null row (first launch / cache miss)", () => {
    expect(decideStartupConfigPath(null)).toEqual({ mode: "cold" })
  })

  it("returns cold for an empty payload", () => {
    expect(decideStartupConfigPath({ payload: "", fetchedAt: 123 })).toEqual({ mode: "cold" })
  })

  it("returns cold for invalid JSON", () => {
    expect(decideStartupConfigPath({ payload: "{not json", fetchedAt: 123 })).toEqual({
      mode: "cold",
    })
  })

  it("returns cold for JSON that is not an object (array)", () => {
    expect(decideStartupConfigPath({ payload: "[1,2]", fetchedAt: 123 })).toEqual({ mode: "cold" })
  })

  it("returns cold for JSON that is not an object (scalar)", () => {
    expect(decideStartupConfigPath({ payload: "42", fetchedAt: 123 })).toEqual({ mode: "cold" })
  })

  it("returns cold for JSON null", () => {
    expect(decideStartupConfigPath({ payload: "null", fetchedAt: 123 })).toEqual({ mode: "cold" })
  })

  it("returns warm with the parsed config for a valid payload", () => {
    const payload = JSON.stringify({ AGENT_URL: "https://agent.example", MAINTENANCE_MODE: true })
    const decision = decideStartupConfigPath({ payload, fetchedAt: 123 })
    expect(decision.mode).toBe("warm")
    if (decision.mode === "warm") {
      expect(decision.config.AGENT_URL).toBe("https://agent.example")
      // Maintenance fields ride along untouched — ConfigStore.applyServerConfig
      // ({ fromCache: true }) is what ignores them, not the parser.
      expect(decision.config.MAINTENANCE_MODE).toBe(true)
    }
  })
})
