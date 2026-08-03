/**
 * Query-string PII scrubbing for anything we hand to a third-party sink
 * (today: Sentry breadcrumbs and event request data — see
 * `app/services/crashReporting/sentry.ts`).
 *
 * WHY THIS IS A SEPARATE, PURE MODULE: it has zero `@/` runtime imports, so
 * vitest can actually load it (CLAUDE.md, "Test Runner Split"). `sentry.ts`
 * imports `@/utils/logger` and is therefore untestable by either runner. This
 * logic guards the app's most sensitive data — the user's coordinates — so it
 * needs real coverage. Keep this file free of `@/` imports.
 *
 * EVERYTHING HERE IS DELIBERATELY RUNTIME-AGNOSTIC — defence in depth, not a
 * bug fix. Which `URL` implementation is installed on the global depends on
 * layered polyfills: React Native's `setUpXHR` installs the partial one from
 * `Libraries/Blob/URL.js`, and then Expo SDK 54's winter runtime *replaces* it
 * with spec-compliant `whatwg-url-without-unicode`
 * (`expo/src/winter/runtime.native.ts` → `url.ts`, reached via
 * `expo/src/Expo.fx.tsx` → `./winter`). Expo's wins today, so parser-based
 * scrubbing does work here. But that is a property of the current dependency
 * stack, not of our code, and it is invisible at this call site. Writing these
 * functions so they don't care keeps a future Expo/RN change from quietly
 * turning a privacy guarantee into a no-op.
 */

/**
 * Sensitive query params we strip from any URL a third-party sink sees.
 * Kept narrow on purpose — over-eager scrubbing makes stack traces useless.
 * Add new keys here as the threat surface grows.
 */
export const SENSITIVE_QUERY_KEYS = new Set([
  "pwd", // Zoom join URL passcode (encrypted or plaintext)
  "password",
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "code", // OAuth authorization codes
  "api_key",
  "key",
  // The In-Person segment's /schedules/nearby call carries the user's precise
  // position in the query string. apisauce → axios → XHR means Sentry's XHR
  // breadcrumb integration records that full URL, so without these two keys
  // every nearby request would upload the user's coordinates with the next
  // error event. The hook (app/hooks/useNearbySchedules.ts) is careful never
  // to log or persist coordinates. Do not remove without removing the caller.
  "lat",
  "lon",
])

/**
 * Scrub sensitive keys out of a BARE query string — one with no leading `?`,
 * e.g. `lat=37.77&lon=-122.41&radius=25`.
 *
 * Returns the ORIGINAL string when no sensitive key matched, rather than the
 * round-tripped `params.toString()`. That is not a micro-optimization, it is
 * required for correctness: a valueless token like `section-two` does not
 * survive a round trip. The spec-compliant `whatwg-url-without-unicode` that
 * Expo installs turns it into `"section-two="`; React Native's own polyfill
 * turns it into `"section-two=undefined"`. Both differ from the input, so
 * round-tripping unconditionally would corrupt any non-`key=value` string —
 * the common case for `http.fragment`. Touch nothing you did not need to
 * touch, and the answer stops depending on which polyfill won.
 */
export function scrubQueryString(query: string | undefined): string | undefined {
  if (!query || typeof query !== "string") return query
  try {
    const params = new URLSearchParams(query)
    let mutated = false
    for (const key of Array.from(params.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        params.set(key, "[Filtered]")
        mutated = true
      }
    }
    return mutated ? params.toString() : query
  } catch {
    // Unparseable as a query string; leave alone.
    return query
  }
}

/**
 * Scrub sensitive query params out of a full URL, preserving scheme, path and
 * fragment.
 *
 * DO NOT REIMPLEMENT THIS WITH `new URL()`. It used to be written that way —
 * parse, mutate `parsed.searchParams`, return `parsed.toString()`. That
 * version DID work, but only because of a runtime detail no reader should
 * have to know, which is the whole reason this note exists.
 *
 * React Native's own `URL` polyfill (`react-native/Libraries/Blob/URL.js:184`)
 * implements `toString()` as:
 *
 *     return this._url + separator + this._searchParamsInstance.toString()
 *
 * i.e. it APPENDS the mutated params to the original, unmodified URL string
 * rather than replacing them. Under that implementation, scrubbing
 * `…/nearby?lat=37.7749&lon=-122.4194` would yield
 * `…/nearby?lat=37.7749&lon=-122.4194&lat=[Filtered]&lon=[Filtered]` — real
 * coordinates intact, with a redacted decoy appended.
 *
 * That is NOT what shipped, because Expo SDK 54's winter runtime replaces the
 * global before any app code runs: `expo/src/winter/runtime.native.ts:14`
 * installs `whatwg-url-without-unicode`'s spec-compliant `URL`, and
 * `installGlobal.ts` overwrites an existing global rather than deferring to
 * it. Verified 2026-08-03 by running the installed implementation directly:
 * the roundtrip replaces the query and leaks nothing.
 *
 * So the parser version was correct — but only as long as that override keeps
 * happening. Plain string splitting removes the dependency entirely: it cannot
 * be silently broken by an Expo or React Native change to which `URL` wins.
 * It also handles custom schemes (`recoverysky-app://callback?code=…`) that
 * RN's http/https-shaped regexes mangle. Defence in depth, not a bug fix.
 */
export function scrubUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== "string") return url

  // Fragment first: a `?` after a `#` is part of the fragment, not the query.
  const hashIndex = url.indexOf("#")
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex)
  const beforeFragment = hashIndex === -1 ? url : url.slice(0, hashIndex)

  const queryIndex = beforeFragment.indexOf("?")
  if (queryIndex === -1) return url

  const base = beforeFragment.slice(0, queryIndex)
  const query = beforeFragment.slice(queryIndex + 1)
  const scrubbed = scrubQueryString(query)

  // Reference equality is the "nothing matched" signal from scrubQueryString.
  if (scrubbed === query) return url

  return `${base}?${scrubbed}${fragment}`
}
