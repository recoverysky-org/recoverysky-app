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

  it("shows for premium users when the URL is set", () => {
    expect(decideAgentTabVisible({ agentUrlEnv: url, isDev: false, isPremium: true })).toBe(true)
  })

  it("shows in dev builds without premium when the URL is set", () => {
    expect(decideAgentTabVisible({ agentUrlEnv: url, isDev: true, isPremium: false })).toBe(true)
  })

  it("hides for non-premium users in production builds", () => {
    expect(decideAgentTabVisible({ agentUrlEnv: url, isDev: false, isPremium: false })).toBe(false)
  })

  it("hides everywhere when the URL is missing or invalid, even in dev for premium", () => {
    for (const agentUrlEnv of [undefined, "", "not a url"]) {
      expect(decideAgentTabVisible({ agentUrlEnv, isDev: true, isPremium: true })).toBe(false)
    }
  })
})
