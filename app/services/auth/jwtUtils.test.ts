import { describe, expect, it } from "vitest"

import { decodeJwtPayload, isUsableAccessToken } from "./jwtUtils"

const AUDIENCE = "https://api.recoverysky.app"
const CONFIG = { audience: AUDIENCE }

/** Build an unsigned three-segment JWT. The signature segment is never inspected. */
function mint(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", typ: "JWT" },
) {
  const seg = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url")
  return `${seg(header)}.${seg(payload)}.sig`
}

const GOOD = {
  iss: "https://auth.recoverysky.app/",
  aud: AUDIENCE,
  exp: 1_800_000_000,
  sub: "auth0|x",
}

describe("isUsableAccessToken", () => {
  it("rejects an opaque token as not-jwt", () => {
    expect(isUsableAccessToken("Xk9pQ2vL8mN4rT6wY1zA3bC5dE7fG0hJ", CONFIG)).toEqual({
      ok: false,
      reason: "not-jwt",
    })
  })

  it("rejects two segments as not-jwt", () => {
    expect(isUsableAccessToken("abc.def", CONFIG)).toEqual({ ok: false, reason: "not-jwt" })
  })

  it("rejects three segments with a non-JSON payload as not-jwt", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")
    expect(isUsableAccessToken(`${header}.bm90LWpzb24.sig`, CONFIG)).toEqual({
      ok: false,
      reason: "not-jwt",
    })
  })

  it("accepts aud as a matching string", () => {
    expect(isUsableAccessToken(mint(GOOD), CONFIG)).toEqual({ ok: true })
  })

  it("accepts aud as an array containing the audience", () => {
    expect(
      isUsableAccessToken(
        mint({ ...GOOD, aud: [AUDIENCE, "https://auth.recoverysky.app/userinfo"] }),
        CONFIG,
      ),
    ).toEqual({ ok: true })
  })

  it("rejects a mismatched aud", () => {
    expect(
      isUsableAccessToken(mint({ ...GOOD, aud: "https://auth.recoverysky.app/userinfo" }), CONFIG),
    ).toEqual({ ok: false, reason: "wrong-audience" })
  })

  it("rejects a missing aud", () => {
    const { aud: _aud, ...noAud } = GOOD
    expect(isUsableAccessToken(mint(noAud), CONFIG)).toEqual({
      ok: false,
      reason: "wrong-audience",
    })
  })

  it("rejects a missing exp", () => {
    const { exp: _exp, ...noExp } = GOOD
    expect(isUsableAccessToken(mint(noExp), CONFIG)).toEqual({ ok: false, reason: "no-expiry" })
  })

  it("rejects a non-numeric exp", () => {
    expect(isUsableAccessToken(mint({ ...GOOD, exp: "soon" }), CONFIG)).toEqual({
      ok: false,
      reason: "no-expiry",
    })
  })

  it("skips the audience rule when no audience is configured", () => {
    expect(isUsableAccessToken(mint({ ...GOOD, aud: "something-else" }), { audience: "" })).toEqual(
      { ok: true },
    )
  })

  it("still rejects an opaque token when no audience is configured", () => {
    expect(isUsableAccessToken("opaque", { audience: "" })).toEqual({
      ok: false,
      reason: "not-jwt",
    })
  })

  // Regression guard for the dropped issuer rule (spec Section 1): the API's
  // issuer is env-configured and the client must not second-guess it.
  it("passes a token with an unexpected iss but the right aud", () => {
    expect(
      isUsableAccessToken(mint({ ...GOOD, iss: "https://meetingmaker.auth0.com/" }), CONFIG),
    ).toEqual({ ok: true })
  })

  it("agrees with decodeJwtPayload on what a payload is", () => {
    expect(decodeJwtPayload(mint(GOOD))).toMatchObject({ sub: "auth0|x" })
  })
})
