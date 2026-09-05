import { describe, expect, it } from "vitest"

import { hashUserId } from "./hashUserId"

describe("hashUserId", () => {
  it("returns undefined for empty input", () => {
    expect(hashUserId(undefined)).toBeUndefined()
    expect(hashUserId("")).toBeUndefined()
  })

  it("is deterministic for the same id", () => {
    expect(hashUserId("auth0|abc123")).toBe(hashUserId("auth0|abc123"))
  })

  it("differs for different ids", () => {
    expect(hashUserId("auth0|abc123")).not.toBe(hashUserId("auth0|abc124"))
  })

  it("never leaks the raw id or its identity-provider prefix", () => {
    const out = hashUserId("google-oauth2|109823456789012345678")!
    expect(out).not.toContain("google")
    expect(out).not.toContain("109823456789012345678")
    expect(out).not.toContain("|")
  })

  it("is a fixed-length lowercase hex string", () => {
    expect(hashUserId("apple|000123.abc")).toMatch(/^[0-9a-f]{16}$/)
  })
})
