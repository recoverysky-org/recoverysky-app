/**
 * Query-string PII scrubbing for anything we hand to a third-party sink
 * (today: Sentry breadcrumbs and event request data — see
 * `app/services/crashReporting/sentry.ts`).
 *
 * WHY THIS IS A SEPARATE, PURE MODULE: it has zero `@/` runtime imports, so
 * vitest can actually load it (CLAUDE.md, "Test Runner Split"). `sentry.ts`
 * imports `@/utils/logger` and is therefore untestable by either runner. This
 * logic guards the app's most sensitive data — the user's coordinates — and
 * it has already shipped broken once (see the `scrubUrl` note below), so it
 * needs real coverage. Keep this file free of `@/` imports.
 *
 * EVERYTHING HERE MUST BE RUNTIME-AGNOSTIC. These functions run under Hermes
 * with React Native's `URL` / `URLSearchParams` polyfills, which are NOT
 * spec-compliant, but the tests run under Node, which is. Any function whose
 * correctness depends on which implementation it got is a function that passes
 * its tests and fails on device.
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
 * required for correctness: React Native's `URLSearchParams` polyfill parses a
 * valueless token like `section-two` into a key whose value is `undefined` and
 * serializes it back as the literal `"section-two=undefined"`. (Node turns the
 * same input into `"section-two="`.) Round-tripping every value would silently
 * corrupt any non-key=value input — which is the common case for fragments.
 * Touch nothing you did not need to touch.
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
 * parse, mutate `parsed.searchParams`, return `parsed.toString()` — and that
 * version was a no-op on device that actively made things worse. React
 * Native's `URL` polyfill implements `toString()` as:
 *
 *     return this._url + separator + this._searchParamsInstance.toString()
 *
 * i.e. it appends the mutated params to the ORIGINAL, unmodified URL string
 * instead of replacing them. So scrubbing
 * `…/schedules/nearby?lat=37.7749&lon=-122.4194` produced
 * `…/schedules/nearby?lat=37.7749&lon=-122.4194&lat=[Filtered]&lon=[Filtered]`
 * — the real coordinates still present, now with a decoy alongside them.
 * Verified empirically against `react-native/Libraries/Blob/URL` on 2026-08-03.
 * The bug only ever fired on URLs that actually contained a sensitive key,
 * because the non-matching path returned the input untouched: the scrubber
 * worked on exactly the URLs that did not need it and failed on exactly the
 * ones that did.
 *
 * Plain string splitting has no such runtime dependency, and it also handles
 * custom schemes (`recoverysky-app://callback?code=…`) that the polyfill's
 * http/https-shaped regexes mangle.
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
