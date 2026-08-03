import { describe, expect, it } from "vitest"

import { scrubQueryString, scrubUrl } from "./scrubQuery"

/**
 * The rule for this file: assert on the OUTPUT STRING, never on "it didn't
 * throw", and always include a negative assertion that the secret is GONE —
 * not merely that a `[Filtered]` marker is present.
 *
 * Why absence and not presence: a scrubber can plausibly fail by *adding* the
 * redacted value while leaving the original in place (any implementation that
 * appends rather than replaces does this — React Native's own `URL.toString()`
 * is written that way, though it is not the implementation the app ends up
 * using; see the note on `scrubUrl`). A presence-only assertion passes against
 * that failure. An absence assertion cannot.
 *
 * These tests run under Node. `scrubUrl` is deliberately implemented without a
 * URL parser, so it behaves identically wherever it runs; `scrubQueryString`
 * does use `URLSearchParams`, and its "return the original when nothing
 * matched" contract is what keeps *its* result independent of which polyfill
 * is installed. Neither depends on Node-vs-Hermes differences.
 */

const COORDS_URL =
  "https://api.recoverysky.org/schedules/nearby?lat=37.7749&lon=-122.4194&radius=25"

describe("scrubUrl", () => {
  it("removes coordinates rather than merely adding a filtered copy", () => {
    const result = scrubUrl(COORDS_URL)
    // The absence assertions are the point — see the file header.
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

  // Custom schemes are handled by the spec-compliant URL Expo installs, and by
  // string splitting. They are NOT handled by React Native's own polyfill,
  // whose http/https-shaped regexes mangle them. Pinning the behavior here
  // means a future change to which parser wins can't quietly break it.
  it("handles custom schemes independently of the installed URL parser", () => {
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
    // Byte-identical, not merely equivalent. Some URL parsers normalize bare
    // paths by appending a trailing slash (React Native's does); string
    // splitting can't, because it returns the input by reference when there is
    // no query to scrub.
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
