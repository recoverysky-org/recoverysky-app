import { describe, expect, it } from "vitest"

import { toPostalLookupResult } from "./postalLookupLogic"

const ok = (data: unknown) => toPostalLookupResult({ ok: true, problemKind: null, data })
const bad = { kind: "failed", problem: "bad-data" }

describe("toPostalLookupResult", () => {
  it("accepts a found body", () => {
    expect(ok({ found: true, lat: 45.4, lon: -75.7, country: "CA" })).toEqual({
      kind: "ok",
      answer: { found: true, lat: 45.4, lon: -75.7, country: "CA" },
    })
  })

  it("accepts a not-found body", () => {
    expect(ok({ found: false })).toEqual({ kind: "ok", answer: { found: false } })
  })

  it("rejects malformed found bodies as bad-data", () => {
    expect(ok({ found: true, lat: "45", lon: -75, country: "US" })).toEqual(bad)
    expect(ok({ found: true, lat: 91, lon: -75, country: "US" })).toEqual(bad)
    expect(ok({ found: true, lat: 45, lon: -181, country: "US" })).toEqual(bad)
    expect(ok({ found: true, lat: 45, lon: -75, country: "MX" })).toEqual(bad)
    expect(ok({ found: true, lat: NaN, lon: -75, country: "US" })).toEqual(bad)
    expect(ok(null)).toEqual(bad)
    expect(ok({})).toEqual(bad)
  })

  it("maps not-found problem to unavailable", () => {
    expect(toPostalLookupResult({ ok: false, problemKind: "not-found", data: null })).toEqual({
      kind: "unavailable",
    })
  })

  it("passes other problems through as failed", () => {
    expect(toPostalLookupResult({ ok: false, problemKind: "timeout", data: null })).toEqual({
      kind: "failed",
      problem: "timeout",
    })
    expect(toPostalLookupResult({ ok: false, problemKind: "rejected", data: null })).toEqual({
      kind: "failed",
      problem: "rejected",
    })
  })
})
