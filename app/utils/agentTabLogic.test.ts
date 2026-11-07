import { describe, expect, it } from "vitest"

import { decideAgentTabVisible, isValidAgentUrl } from "./agentTabLogic"

describe("isValidAgentUrl", () => {
  it.each([
    "https://agent.recoverysky.app",
    "https://agent.recoverysky.app/",
    "http://localhost:3333",
    "http://192.168.1.20:3333",
    "https://example.com/agent/v2",
    "  https://agent.recoverysky.app  ",
  ])("accepts %s", (url) => {
    expect(isValidAgentUrl(url)).toBe(true)
  })

  it.each([
    undefined,
    null,
    "",
    "   ",
    "agent.recoverysky.app",
    "ftp://agent.recoverysky.app",
    "https://",
    "https://-bad.example.com",
    "https://agent.recoverysky.app?x=1",
    "https://agent.recoverysky.app#frag",
    "https://agent recoverysky.app",
    "https://agent.recoverysky.app:port",
  ])("rejects %s", (url) => {
    expect(isValidAgentUrl(url)).toBe(false)
  })
})

describe("decideAgentTabVisible", () => {
  const url = "https://agent.recoverysky.app"

  it("shows with the skyagent entitlement when the URL is set", () => {
    expect(decideAgentTabVisible({ agentUrlEnv: url, hasSkyAgent: true })).toBe(true)
  })

  // CHANGED 2026-11-07: no `__DEV__` escape; dev builds need the entitlement too.
  it("hides without the skyagent entitlement when the URL is set", () => {
    expect(decideAgentTabVisible({ agentUrlEnv: url, hasSkyAgent: false })).toBe(false)
  })

  it("hides when the URL is missing or invalid, even with the entitlement", () => {
    for (const agentUrlEnv of [undefined, "", "not a url"]) {
      expect(decideAgentTabVisible({ agentUrlEnv, hasSkyAgent: true })).toBe(false)
    }
  })
})
