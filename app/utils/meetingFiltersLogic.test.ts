import { describe, expect, it } from "vitest"

import {
  buildLanguageOptions,
  getLanguageDisplayName,
  matchesLanguage,
  parsePersistedLanguage,
  resolveFellowship,
} from "./meetingFiltersLogic"

const ACTIVE = ["AA", "NA", "CMA"] as const

describe("resolveFellowship", () => {
  it("prefers the persisted bar value when it is still offered", () => {
    expect(resolveFellowship({ persisted: "NA", saved: "AA", active: ACTIVE })).toBe("NA")
  })

  it("follows the saved Settings value when nothing is persisted", () => {
    // Hydration race: this is re-evaluated each render, so a later hydrated
    // `saved` wins without anything being written.
    expect(resolveFellowship({ persisted: null, saved: "CMA", active: ACTIVE })).toBe("CMA")
  })

  it("ignores a persisted value this build no longer offers", () => {
    expect(resolveFellowship({ persisted: "RD", saved: "NA", active: ACTIVE })).toBe("NA")
  })

  it("falls back to the first active fellowship when neither is usable", () => {
    expect(resolveFellowship({ persisted: "RD", saved: "", active: ACTIVE })).toBe("AA")
    expect(resolveFellowship({ persisted: null, saved: undefined, active: ACTIVE })).toBe("AA")
  })
})

describe("parsePersistedLanguage", () => {
  it("returns null for missing or empty values (= all languages)", () => {
    expect(parsePersistedLanguage(null)).toBeNull()
    expect(parsePersistedLanguage("")).toBeNull()
  })

  it("normalizes to uppercase", () => {
    expect(parsePersistedLanguage("es")).toBe("ES")
  })

  it("rejects junk rather than filtering on it", () => {
    expect(parsePersistedLanguage("español")).toBeNull()
    expect(parsePersistedLanguage("E1")).toBeNull()
  })
})

describe("buildLanguageOptions", () => {
  it("returns sorted unique uppercase codes", () => {
    const meetings = [{ language: "es" }, { language: "EN" }, { language: "es" }, { language: null }, {}]
    expect(buildLanguageOptions(meetings, null)).toEqual(["EN", "ES"])
  })

  it("always keeps the current selection, even when absent from the list", () => {
    expect(buildLanguageOptions([{ language: "EN" }], "FR")).toEqual(["EN", "FR"])
  })

  it("returns only the selection for an empty list", () => {
    expect(buildLanguageOptions([], "ES")).toEqual(["ES"])
    expect(buildLanguageOptions([], null)).toEqual([])
  })
})

describe("matchesLanguage", () => {
  it("matches everything when no language is selected", () => {
    expect(matchesLanguage({ language: "RU" }, null)).toBe(true)
    expect(matchesLanguage({}, null)).toBe(true)
  })

  it("compares case-insensitively", () => {
    expect(matchesLanguage({ language: "es" }, "ES")).toBe(true)
  })

  it("rejects a meeting with a different or missing language", () => {
    expect(matchesLanguage({ language: "EN" }, "ES")).toBe(false)
    expect(matchesLanguage({}, "ES")).toBe(false)
  })
})

describe("getLanguageDisplayName", () => {
  it("returns the native name for a known code", () => {
    expect(getLanguageDisplayName("ES")).toBe("Español")
  })

  it("falls through to the raw code for an unknown one", () => {
    expect(getLanguageDisplayName("XX")).toBe("XX")
  })
})
