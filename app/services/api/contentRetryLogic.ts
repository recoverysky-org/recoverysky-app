/**
 * Pure retry policy for CMS content fetches (`Api.getContent`).
 *
 * PURE MODULE — no `@/` runtime imports, no React, no native modules. Vitest
 * cannot resolve the `@/` alias (see CLAUDE.md "Test Runner Split"), so anything
 * we want covered has to stay import-free. The I/O that composes these helpers
 * lives in services/api/index.ts — same split as tokenFreshnessLogic.ts vs
 * tokenFreshness.ts. The `GeneralApiProblem` import is type-only (erased at
 * compile time) and its module is itself `@/`-free, so it costs Vitest nothing.
 *
 * ADDED 2026-08-09. Directus intermittently returns a 500 for one document in
 * `RecoverySky_Content` while a sibling document requested in the same tick
 * returns 200 — observed live on the login screen, where `disclaimer` loaded
 * and `EULA` did not. The upstream cause is server-side and not reproducible on
 * demand (112/112 clean under a cache-busting soak), so the client's job is to
 * ride the blip out rather than to surface it.
 */

import type { GeneralApiProblem } from "./apiProblem"

/** The problem kinds `getGeneralApiProblem` can classify a content fetch as. */
export type ContentProblemKind = GeneralApiProblem["kind"]

/**
 * Hold-off before each successive retry, walked left to right.
 *
 * Three attempts after the original, ~6 s of waiting worst case. The ladder is
 * deliberately short: these retries run while the user watches a spinner inside
 * the agreement modal with no way to dismiss it, so a longer ladder would read
 * as a hang. It is not jittered — the fleet does not fetch these documents on a
 * shared schedule (each retry ladder starts when a human taps Sign In), so
 * there is no thundering herd to spread out.
 */
export const CONTENT_RETRY_DELAYS_MS: readonly number[] = [500, 1500, 4000]

/**
 * Problem kinds a second attempt could plausibly resolve.
 *
 * `server` is the one this policy was written for. `bad-data` is included
 * because the API proxy already treats an empty document as a transient
 * upstream blip rather than the truth — it refuses to cache or serve one (see
 * `hasData` in api/src/routes/content.ts) — and retrying is the client half of
 * that same stance.
 *
 * Everything else is excluded on purpose: `not-found`, `forbidden`,
 * `unauthorized` and `rejected` all describe a state that a second identical
 * request cannot change, so retrying them only delays the error the user needs
 * to see. Note this is the OPPOSITE default from `classifyRefreshError` in
 * tokenFreshnessLogic.ts, and for a good reason — there, guessing wrong logs a
 * real user out; here, guessing wrong just stalls a modal.
 */
const RETRYABLE_CONTENT_PROBLEMS: readonly ContentProblemKind[] = [
  "server",
  "timeout",
  "cannot-connect",
  "unknown",
  "bad-data",
]

/** Whether a failed content fetch is worth attempting again. */
export function isRetryableContentProblem(kind: ContentProblemKind): boolean {
  return RETRYABLE_CONTENT_PROBLEMS.includes(kind)
}

/**
 * Hold-off before the retry that follows `attempt` failed tries, or `null` when
 * the ladder is spent and the caller should give up.
 *
 * `null` rather than a sentinel number so "stop" cannot be misread as "retry
 * immediately" — a 0 would spin the caller forever.
 */
export function contentRetryDelayMs(attempt: number): number | null {
  if (attempt < 0 || attempt >= CONTENT_RETRY_DELAYS_MS.length) return null
  return CONTENT_RETRY_DELAYS_MS[attempt]
}

/** Anything `getContent` can hand back: a loaded document or a classified problem. */
type Attempted<T> = T | GeneralApiProblem

/** Reported before each hold-off, so the caller owns logging and we stay pure. */
export interface ContentRetryNotice {
  problem: ContentProblemKind
  /** Zero-based index of the attempt that just failed. */
  attempt: number
  /** Hold-off before the next attempt. */
  waitMs: number
}

/**
 * Run `attempt` until it yields a document, hits a problem retrying cannot fix,
 * or exhausts the ladder — whichever comes first. Returns the last result
 * either way, so the caller always has something to classify.
 *
 * `attempt` and `sleep` are injected rather than imported so this stays a pure
 * module Vitest can exercise (see the header). The real caller passes apisauce
 * and `@/utils/delay`; the tests pass a counter and a no-op.
 */
export async function fetchWithContentRetry<T extends { kind: "ok" }>(
  attempt: () => Promise<Attempted<T>>,
  sleep: (ms: number) => Promise<unknown>,
  onRetry?: (notice: ContentRetryNotice) => void,
): Promise<Attempted<T>> {
  for (let tries = 0; ; tries++) {
    const result = await attempt()
    if (result.kind === "ok" || !isRetryableContentProblem(result.kind)) return result

    const waitMs = contentRetryDelayMs(tries)
    // Ladder spent — hand back the failure rather than looping forever.
    if (waitMs === null) return result

    onRetry?.({ problem: result.kind, attempt: tries, waitMs })
    await sleep(waitMs)
  }
}
