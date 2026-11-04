import { describe, expect, it } from "vitest"

import { dailyDashLoginMethod, decideDailyDashSignIn } from "./dailyDashSignInLogic"

const usable = () => true
describe("decideDailyDashSignIn (spec §4.3)", () => {
  it("both tokens, usable: ok", () => {
    expect(decideDailyDashSignIn({ accessToken: "a", idToken: "i" }, usable, false)).toEqual({
      kind: "ok",
      accessToken: "a",
      idToken: "i",
    })
  })
  it("no access token: unauthorized, never a renewal", () => {
    expect(decideDailyDashSignIn({ accessToken: undefined, idToken: "i" }, usable, false)).toEqual({
      kind: "unauthorized",
      reason: "no_access_token",
    })
  })
  it("an unusable access token: unauthorized", () => {
    expect(
      decideDailyDashSignIn({ accessToken: "opaque", idToken: "i" }, () => false, false),
    ).toEqual({ kind: "unauthorized", reason: "unusable_access_token" })
  })
  it("renew once, then unauthorized", () => {
    expect(decideDailyDashSignIn({ accessToken: "a", idToken: undefined }, usable, false)).toEqual({
      kind: "renew",
    })
    expect(decideDailyDashSignIn({ accessToken: "a", idToken: undefined }, usable, true)).toEqual({
      kind: "unauthorized",
      reason: "no_id_token",
    })
  })
})
describe("dailyDashLoginMethod", () => {
  it("maps the app's method, hosted when none is recorded", () => {
    expect(dailyDashLoginMethod("email")).toBe("email")
    expect(dailyDashLoginMethod("apple")).toBe("apple")
    expect(dailyDashLoginMethod(undefined)).toBe("hosted")
  })
})
