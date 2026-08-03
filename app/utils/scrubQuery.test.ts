import { describe, expect, it } from "vitest"

import { scrubQueryString, scrubUrl } from "./scrubQuery"

/**
 * These tests run under Node, whose `URL` / `URLSearchParams` are
 * spec-compliant. The app runs under Hermes with React Native's polyfills,
 * which are not. That gap is exactly how the original `scrubUrl` shipped
 * broken — it passed on paper because `new URL().toString()` behaves in Node,
 * while RN's polyfill appends the mutated params to the untouched original.
 *
 * So the rule for this file: assert on the OUTPUT STRING, never on "it didn't
 * throw", and always include a negative assertion that the secret is gone. A
 * test that only checks `[Filtered]` is present would have passed against the
 * broken implementation, because it appended `[Filtered]` while keeping the
 * real value.
 */

const COORDS_URL =
  "https://api.recoverysky.org/schedules/nearby?lat=37.7749&lon=-122.4194&radius=25"

describe("scrubUrl", () => {
  it("removes coordinates rather than merely adding a filtered copy", () => {
    const result = scrubUrl(COORDS_URL)
    // The assertion that the old implementation failed:
    expect(result).not.toContain("37.7749")
    expect(result).not.toContain("-122.4194")
    // Percent-encoded: URLSearchParams.toString() escapes the brackets. Sentry
    // shows `%5BFiltered%5D` rather than `[Filtered]` — less pretty, still
    // unambiguous, and not worth hand-rolling a serializer to avoid.
    expect(result).toContain("%5BFiltered%5D")
  })

  it("preserves scheme, path, and non-sensitive params", () => {
    expect(scrubUrl(COORDS_URL)).toBe(
      "https://api.recoverysky.org/schedules/nearby?lat=%5BFiltered%5D&lon=%5BFiltered%5D&radius=25",
    )
  })

  it("scrubs a Zoom passcode", () => {
    const result = scrubUrl("https://zoom.us/j/123456789?pwd=SuperSecret&un=am9l")
    expect(result).not.toContain("SuperSecret")
    expect(result).toContain("un=am9l")
  })

  it("handles custom schemes, which the RN URL polyfill mangles", () => {
    const result = scrubUrl("recoverysky-app://callback?code=abc123&state=xyz")
    expect(result).not.toContain("abc123")
    expect(result).toContain("recoverysky-app://callback?")
    expect(result).toContain("state=xyz")
  })

  it("returns the input untouched when no sensitive key is present", () => {
    const clean = "https://api.recoverysky.org/schedules/daily?iso_dow=3&limit=50"
    expect(scrubUrl(clean)).toBe(clean)
  })

  it("leaves a URL with no query string alone, including its trailing form", () => {
    // Regression guard: the old `new URL()` implementation appended a trailing
    // slash to bare paths. It happened to be masked by the early return, but
    // string-splitting makes it structurally impossible.
    expect(scrubUrl("https://api.recoverysky.org/status")).toBe(
      "https://api.recoverysky.org/status",
    )
  })

  it("keeps the fragment and does not treat a '?' inside it as a query", () => {
    const result = scrubUrl("https://example.com/p?lat=1.5#section?lat=notaquery")
    expect(result).toContain("#section?lat=notaquery")
    expect(result).not.toContain("?lat=1.5")
  })

  it("is null-safe", () => {
    expect(scrubUrl(undefined)).toBeUndefined()
    expect(scrubUrl("")).toBe("")
  })
})

describe("scrubQueryString", () => {
  it("scrubs a bare query string with no leading '?'", () => {
    const result = scrubQueryString("lat=37.7749&lon=-122.4194&radius=25")
    expect(result).not.toContain("37.7749")
    expect(result).not.toContain("-122.4194")
    expect(result).toContain("radius=25")
  })

  it("matches keys case-insensitively", () => {
    expect(scrubQueryString("LAT=37.7749")).not.toContain("37.7749")
  })

  it("returns non-key=value input byte-identical when nothing matched", () => {
    // The load-bearing case: RN's URLSearchParams round-trips `section-two`
    // into the literal `section-two=undefined`. Returning the original is what
    // keeps `http.fragment` from being corrupted on device.
    expect(scrubQueryString("section-two")).toBe("section-two")
  })

  it("returns unmatched query strings byte-identical", () => {
    expect(scrubQueryString("iso_dow=3&limit=50")).toBe("iso_dow=3&limit=50")
  })

  it("is null-safe", () => {
    expect(scrubQueryString(undefined)).toBeUndefined()
    expect(scrubQueryString("")).toBe("")
  })
})
