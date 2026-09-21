import { describe, expect, it } from "vitest"

import {
  BEARER_EJECT_CODES,
  bearerRejectionCode,
  deviceJwtRejected,
  NO_DEVICE_CREDENTIAL_ERROR,
  noDeviceCredentialAdapter,
  readHeader,
  USER_LANE_MISSING_CREDENTIALS_BODY,
} from "./bearerRejectionLogic"

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

describe("deviceJwtRejected", () => {
  // The device middleware answers a bad X-Device-Token with a code-less 401
  // (api/src/middleware/deviceAuth.ts), while every user-lane rejection
  // carries `code: token_*`. That asymmetry is the only signal that says
  // which of the two credentials the server refused.
  const DEVICE = { "X-Device-Token": "eyJ.device.jwt" }

  it("returns the rejected token for a code-less 401 that carried a device JWT", () => {
    expect(deviceJwtRejected(401, DEVICE, body())).toBe("eyJ.device.jwt")
    expect(deviceJwtRejected(401, new FakeAxiosHeaders(DEVICE), body())).toBe("eyJ.device.jwt")
  })

  it("ignores a 401 whose body names a bearer code — the device token was accepted", () => {
    expect(deviceJwtRejected(401, { ...DEVICE, ...BEARER }, body("token_expired"))).toBeNull()
    expect(deviceJwtRejected(401, { ...DEVICE, ...BEARER }, body("token_signature"))).toBeNull()
  })

  it("ignores the user lane's missing-header 401 — the device token was verified, the Bearer was absent", () => {
    // RS-040: api/src/middleware/auth.ts answers a request with no
    // Authorization header at all with a 401 that carries NO code. The device
    // middleware runs first and has already accepted the JWT by then.
    expect(deviceJwtRejected(401, DEVICE, USER_LANE_MISSING_CREDENTIALS_BODY)).toBeNull()
    expect(
      deviceJwtRejected(401, new FakeAxiosHeaders(DEVICE), USER_LANE_MISSING_CREDENTIALS_BODY),
    ).toBeNull()
  })

  it("still drops for the device middleware's own code-less bodies", () => {
    expect(
      deviceJwtRejected(401, DEVICE, { error: "Unauthorized", message: "Device token expired" }),
    ).toBe("eyJ.device.jwt")
    expect(
      deviceJwtRejected(401, DEVICE, { error: "Unauthorized", message: "Invalid device token" }),
    ).toBe("eyJ.device.jwt")
  })

  it("ignores requests that carried no device token, including the local no-credential 401", () => {
    expect(deviceJwtRejected(401, BEARER, body())).toBeNull()
    expect(deviceJwtRejected(401, {}, { error: NO_DEVICE_CREDENTIAL_ERROR })).toBeNull()
  })

  it("ignores every other status", () => {
    expect(deviceJwtRejected(403, DEVICE, body())).toBeNull()
    expect(deviceJwtRejected(200, DEVICE, {})).toBeNull()
    expect(deviceJwtRejected(undefined, DEVICE, body())).toBeNull()
  })
})

describe("noDeviceCredentialAdapter", () => {
  // Installed as the per-request axios adapter when the gate has nothing to
  // stamp: the request resolves as a 401 locally and never reaches the wire.
  it("resolves a 401 carrying the marker body without any network", async () => {
    const config = { url: "/config", method: "get", headers: {} }
    const response = await noDeviceCredentialAdapter(config)
    expect(response.status).toBe(401)
    expect(response.data).toEqual({
      error: NO_DEVICE_CREDENTIAL_ERROR,
      message: expect.any(String),
    })
    expect(response.config).toBe(config)
  })
})
