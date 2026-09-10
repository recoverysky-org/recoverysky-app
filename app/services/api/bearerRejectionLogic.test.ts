import { describe, expect, it } from "vitest"

import { BEARER_EJECT_CODES, bearerRejectionCode, readHeader } from "./bearerRejectionLogic"

/** Mimics axios 1.x AxiosHeaders: case-insensitive get(), no own enumerable keys to rely on. */
class FakeAxiosHeaders {
  private map = new Map<string, string>()
  constructor(init: Record<string, string>) {
    for (const [k, v] of Object.entries(init)) this.map.set(k.toLowerCase(), v)
  }
  get(name: string) {
    return this.map.get(name.toLowerCase())
  }
}

const BEARER = { Authorization: "Bearer Xk9pQ2vL8mN4rT6wY1zA3bC5dE7fG0hJ" }
const body = (code?: string) => ({
  error: "Unauthorized",
  message: "Invalid token",
  ...(code ? { code } : {}),
})

describe("readHeader", () => {
  it("reads through an AxiosHeaders-style get()", () => {
    expect(readHeader(new FakeAxiosHeaders(BEARER), "authorization")).toBe(BEARER.Authorization)
  })
  it("reads a plain object case-insensitively", () => {
    expect(readHeader({ authorization: "Bearer x" }, "Authorization")).toBe("Bearer x")
    expect(readHeader({ Authorization: "Bearer y" }, "authorization")).toBe("Bearer y")
  })
  it("returns undefined for missing, null, or non-object headers", () => {
    expect(readHeader({}, "Authorization")).toBeUndefined()
    expect(readHeader(null, "Authorization")).toBeUndefined()
    expect(readHeader("nope", "Authorization")).toBeUndefined()
  })
})

describe("bearerRejectionCode", () => {
  it.each(BEARER_EJECT_CODES)("returns %s for a 401 with a bearer and that code", (code) => {
    expect(bearerRejectionCode(401, new FakeAxiosHeaders(BEARER), body(code))).toBe(code)
  })

  it("works with plain-object request headers too", () => {
    expect(bearerRejectionCode(401, BEARER, body("token_malformed"))).toBe("token_malformed")
  })

  it("ignores token_expired (the gate refreshes)", () => {
    expect(bearerRejectionCode(401, BEARER, body("token_expired"))).toBeNull()
  })

  it("ignores token_invalid", () => {
    expect(bearerRejectionCode(401, BEARER, body("token_invalid"))).toBeNull()
  })

  it("ignores a 401 with no code (Invalid API key, missing header, older API)", () => {
    expect(bearerRejectionCode(401, BEARER, body())).toBeNull()
    expect(
      bearerRejectionCode(401, BEARER, { error: "Unauthorized", message: "Invalid API key" }),
    ).toBeNull()
  })

  it("ignores a 401 that carried no bearer", () => {
    expect(bearerRejectionCode(401, { "X-API-Key": "k" }, body("token_malformed"))).toBeNull()
    expect(bearerRejectionCode(401, undefined, body("token_malformed"))).toBeNull()
  })

  it("ignores a 503 auth_unavailable and every non-401 status", () => {
    expect(
      bearerRejectionCode(503, BEARER, { error: "ServiceUnavailable", code: "auth_unavailable" }),
    ).toBeNull()
    expect(bearerRejectionCode(403, BEARER, body("token_malformed"))).toBeNull()
    expect(bearerRejectionCode(undefined, BEARER, body("token_malformed"))).toBeNull()
  })

  it("ignores non-object or string bodies", () => {
    expect(bearerRejectionCode(401, BEARER, "Unauthorized")).toBeNull()
    expect(bearerRejectionCode(401, BEARER, null)).toBeNull()
    expect(bearerRejectionCode(401, BEARER, { code: 42 })).toBeNull()
  })
})
