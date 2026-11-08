import { describe, expect, it } from "vitest"

import {
  decideStartingSearchMode,
  decideZipLookup,
  deriveSearchFlags,
  normalizePostalInput,
  parseSearchMode,
  parseStoredZip,
  serializeStoredZip,
  shouldAutoLookup,
  shouldExplainImHere,
  shouldRunVisitGate,
  type ZipAnswer,
} from "./inPersonSearchLogic"

describe("normalizePostalInput", () => {
  it("accepts a five-digit US ZIP", () => {
    expect(normalizePostalInput("80203")).toEqual({ country: "US", code: "80203" })
  })
  it("drops the ZIP+4 suffix, hyphenated or not", () => {
    expect(normalizePostalInput("80203-1234")).toEqual({ country: "US", code: "80203" })
    expect(normalizePostalInput("802031234")).toEqual({ country: "US", code: "80203" })
  })
  it("canonicalises a Canadian postal code", () => {
    const k = { country: "CA", code: "K1A0B1" }
    expect(normalizePostalInput(" k1a 0b1 ")).toEqual(k)
    expect(normalizePostalInput("K1A-0B1")).toEqual(k)
    expect(normalizePostalInput("k1a0b1")).toEqual(k)
  })
  it("accepts a bare FSA", () => {
    expect(normalizePostalInput("k1a")).toEqual({ country: "CA", code: "K1A" })
  })
  it.each(["", "1234", "123456", "ABCDE", "K1A 0B", "D1A 0B1", "W1A", "K1O 0B1"])(
    "rejects %j",
    (raw) => {
      expect(normalizePostalInput(raw)).toBeNull()
    },
  )
})

describe("parseSearchMode", () => {
  it("passes the two modes", () => {
    expect(parseSearchMode("gps")).toBe("gps")
    expect(parseSearchMode("zip")).toBe("zip")
  })
  it.each(["GPS", "", null, undefined])("returns null for %j", (raw) => {
    expect(parseSearchMode(raw)).toBeNull()
  })
})

describe("decideStartingSearchMode", () => {
  it("honours a stored pick", () => {
    expect(decideStartingSearchMode({ stored: "zip", locationEnabled: true })).toBe("zip")
    expect(decideStartingSearchMode({ stored: "gps", locationEnabled: false })).toBe("gps")
  })
  it("falls back on locationEnabled when nothing valid is stored", () => {
    expect(decideStartingSearchMode({ stored: null, locationEnabled: true })).toBe("gps")
    expect(decideStartingSearchMode({ stored: null, locationEnabled: false })).toBe("zip")
    expect(decideStartingSearchMode({ stored: "junk", locationEnabled: true })).toBe("gps")
  })
})

describe("stored ZIP", () => {
  const z = { code: "80203", country: "US" as const, lat: 39.73, lon: -104.98 }
  it("round-trips", () => {
    expect(parseStoredZip(serializeStoredZip(z))).toEqual(z)
  })
  it("rejects bad input", () => {
    expect(parseStoredZip(null)).toBeNull()
    expect(parseStoredZip(undefined)).toBeNull()
    expect(parseStoredZip("{")).toBeNull()
    expect(parseStoredZip(JSON.stringify({ code: "80203", country: "US", lat: 1 }))).toBeNull()
    expect(parseStoredZip(JSON.stringify({ ...z, lat: "x" }))).toBeNull()
    expect(parseStoredZip(JSON.stringify({ ...z, lat: 91 }))).toBeNull()
    expect(parseStoredZip(JSON.stringify({ ...z, lon: -181 }))).toBeNull()
    expect(parseStoredZip(JSON.stringify({ ...z, country: "MX" }))).toBeNull()
    expect(parseStoredZip("null")).toBeNull()
  })
})

describe("decideZipLookup", () => {
  const us = { country: "US" as const, code: "80203" }
  const found: ZipAnswer = { found: true, lat: 1, lon: 2, country: "US" }
  const miss: ZipAnswer = { found: false }
  const base = {
    normalized: us,
    memo: new Map<string, ZipAnswer>(),
    unavailable: false,
    inFlightCode: null,
  }

  it("invalid wins even when unavailable", () => {
    expect(decideZipLookup({ ...base, normalized: null, unavailable: true })).toEqual({
      action: "invalid",
    })
  })
  it("unavailable", () => {
    expect(decideZipLookup({ ...base, unavailable: true })).toEqual({ action: "unavailable" })
  })
  it("memo hit, found and not-found", () => {
    expect(decideZipLookup({ ...base, memo: new Map([["80203", found]]) })).toEqual({
      action: "memo",
      answer: found,
    })
    expect(decideZipLookup({ ...base, memo: new Map([["80203", miss]]) })).toEqual({
      action: "memo",
      answer: miss,
    })
  })
  it("in-flight for the same code only", () => {
    expect(decideZipLookup({ ...base, inFlightCode: "80203" })).toEqual({ action: "in-flight" })
    expect(decideZipLookup({ ...base, inFlightCode: "80204" })).toEqual({
      action: "fetch",
      code: "80203",
    })
  })
  it("fetches otherwise", () => {
    expect(decideZipLookup(base)).toEqual({ action: "fetch", code: "80203" })
  })
})

describe("deriveSearchFlags", () => {
  const f = (
    mode: "gps" | "zip" | null,
    locationEnabled: boolean,
    hasFix: boolean,
    hasZipCenter: boolean,
  ) => deriveSearchFlags({ mode, locationEnabled, hasFix, hasZipCenter })
  it("gps", () => {
    expect(f("gps", true, true, false)).toEqual({ gpsAllowed: true, hasCenter: true })
    expect(f("gps", false, true, false)).toEqual({ gpsAllowed: false, hasCenter: false })
    expect(f("gps", true, false, false)).toEqual({ gpsAllowed: true, hasCenter: false })
  })
  it("zip never allows gps", () => {
    expect(f("zip", false, false, true)).toEqual({ gpsAllowed: false, hasCenter: true })
    expect(f("zip", true, true, false)).toEqual({ gpsAllowed: false, hasCenter: false })
  })
  it("null mode", () => {
    expect(f(null, true, true, true)).toEqual({ gpsAllowed: false, hasCenter: false })
  })
})

describe("shouldRunVisitGate", () => {
  it("only gps with location off", () => {
    expect(shouldRunVisitGate({ mode: "gps", locationEnabled: false })).toBe(true)
    expect(shouldRunVisitGate({ mode: "gps", locationEnabled: true })).toBe(false)
    expect(shouldRunVisitGate({ mode: "zip", locationEnabled: false })).toBe(false)
    expect(shouldRunVisitGate({ mode: "zip", locationEnabled: true })).toBe(false)
    expect(shouldRunVisitGate({ mode: null, locationEnabled: false })).toBe(false)
  })
})

describe("shouldExplainImHere", () => {
  it("only zip without OS grant", () => {
    expect(shouldExplainImHere({ mode: "zip", osGranted: false })).toBe(true)
    expect(shouldExplainImHere({ mode: "zip", osGranted: true })).toBe(false)
    expect(shouldExplainImHere({ mode: "gps", osGranted: false })).toBe(false)
    expect(shouldExplainImHere({ mode: null, osGranted: false })).toBe(false)
  })
})

describe("shouldAutoLookup", () => {
  it("looks up a complete US ZIP as it is typed", () => {
    expect(shouldAutoLookup({ country: "US", code: "80203" })).toBe(true)
  })
  it("looks up a full six-character Canadian code", () => {
    expect(shouldAutoLookup({ country: "CA", code: "K1A0B1" })).toBe(true)
  })
  it("waits on a bare FSA, which is usually the first half of a full code", () => {
    expect(shouldAutoLookup({ country: "CA", code: "K1A" })).toBe(false)
  })
  it("never looks up a shape it does not accept", () => {
    expect(shouldAutoLookup(null)).toBe(false)
  })
  it("agrees with normalizePostalInput as the person types a Canadian code", () => {
    const steps = ["K", "K1", "K1A", "K1A ", "K1A 0", "K1A 0B", "K1A 0B1"]
    expect(steps.map((t) => shouldAutoLookup(normalizePostalInput(t)))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ])
  })
})
