import { describe, expect, it } from "vitest"

import { agentCredentialHeaders } from "./agentHeadersLogic"

describe("agentCredentialHeaders", () => {
  it("sends the device JWT and the bearer together", () => {
    expect(
      agentCredentialHeaders({
        deviceJwt: "dev.jwt.sig",
        authKey: "key",
        accessToken: "user.jwt.sig",
      }),
    ).toEqual({
      "X-Device-Token": "dev.jwt.sig",
      "Authorization": "Bearer user.jwt.sig",
    })
  })

  it("never sends the API key beside a device JWT", () => {
    const headers = agentCredentialHeaders({
      deviceJwt: "dev.jwt.sig",
      authKey: "key",
      accessToken: null,
    })
    expect(headers).not.toHaveProperty("X-API-Key")
  })

  it("falls back to the API key without a device JWT (simulators, dev builds)", () => {
    expect(
      agentCredentialHeaders({ deviceJwt: null, authKey: "key", accessToken: "user.jwt.sig" }),
    ).toEqual({
      "X-API-Key": "key",
      "Authorization": "Bearer user.jwt.sig",
    })
  })

  it("sends no device credential when it has neither", () => {
    expect(
      agentCredentialHeaders({ deviceJwt: null, authKey: "", accessToken: "user.jwt.sig" }),
    ).toEqual({
      Authorization: "Bearer user.jwt.sig",
    })
  })

  it("sends no bearer when signed out", () => {
    expect(
      agentCredentialHeaders({ deviceJwt: "dev.jwt.sig", authKey: "", accessToken: null }),
    ).toEqual({
      "X-Device-Token": "dev.jwt.sig",
    })
  })
})
