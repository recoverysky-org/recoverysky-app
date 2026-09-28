/**
 * Pure classifier for the `GET /news` success path (`Api.getNews`).
 *
 * PURE MODULE — no `@/` runtime imports, no React, no native modules. Vitest
 * cannot resolve the `@/` alias (see CLAUDE.md "Test Runner Split"), so the
 * decision lives here and the I/O stays in services/api/index.ts — same split
 * as contentRetryLogic.ts.
 *
 * ADDED 2026-09-26. The API answers `204 No Content` when nothing is published
 * (api/src/routes/news.ts), which is its idle state nearly all of the time.
 * `getNews` used to fold that into `{ kind: "bad-data" }`, so HomeScreen logged
 * "News unavailable — hiding the card" with kind=bad-data on 144 of 145 Home
 * loads in a 6h window on 4.10.1-12 (~450–500/day since 4.10.1-8), and a
 * genuinely malformed payload was indistinguishable from "nothing to show".
 * Now "nothing" and "wrong shape" are separate outcomes.
 */

export type NewsPayloadOutcome =
  /** The server sent an item with something to show. */
  | { kind: "ok"; title: string; body: string }
  /** Nothing published right now (204, or a payload with nothing to show). */
  | { kind: "no-content" }
  /** A payload that has content but not the shape we expect — a real fault. */
  | { kind: "bad-data" }

/**
 * Whether a 2xx payload carries nothing at all. Axios hands a 204 back as an
 * empty string (`""`), older transports as `null`/`undefined`, and an empty
 * JSON object is nothing to show either — all of them are "no news".
 */
function isEmptyPayload(data: unknown): boolean {
  if (data === null || data === undefined || data === "") return true
  if (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0)
    return true
  return false
}

/**
 * Classify the payload of a *successful* (2xx) `/news` response.
 *
 * Non-2xx responses never reach this — `getGeneralApiProblem` classifies them
 * in the caller. A 204 is "no news" regardless of what the transport put in
 * `data`; a 200 is "no news" when it has nothing to show, "ok" when it has a
 * non-empty title and body, and "bad-data" otherwise.
 */
export function classifyNewsPayload(status: number | undefined, data: unknown): NewsPayloadOutcome {
  if (status === 204 || isEmptyPayload(data)) return { kind: "no-content" }

  if (typeof data !== "object" || data === null) return { kind: "bad-data" }
  const { title, body } = data as { title?: unknown; body?: unknown }
  if (typeof title !== "string" || typeof body !== "string") return { kind: "bad-data" }

  // An item with a blank title or body is nothing to show. HomeScreen already
  // requires both to be non-empty before it renders the card, so report it as
  // "no-content" here rather than as a success the caller then discards.
  if (title === "" || body === "") return { kind: "no-content" }

  return { kind: "ok", title, body }
}
