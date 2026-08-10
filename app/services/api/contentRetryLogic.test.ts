import { describe, expect, it } from "vitest"

import type { GeneralApiProblem } from "./apiProblem"
import {
  CONTENT_RETRY_DELAYS_MS,
  contentRetryDelayMs,
  fetchWithContentRetry,
  isRetryableContentProblem,
} from "./contentRetryLogic"

type Doc = { kind: "ok"; content: string }

const DOC: Doc = { kind: "ok", content: "<p>EULA</p>" }

/**
 * Feeds `fetchWithContentRetry` a scripted sequence of outcomes and records
 * every hold-off it asked for, so a test can assert on both the result and the
 * number of attempts without any real waiting.
 */
function scripted(outcomes: (Doc | GeneralApiProblem)[]) {
  const slept: number[] = []
  let calls = 0
  const attempt = async () => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)]
    calls++
    return outcome
  }
  return {
    attempt,
    slept,
    sleep: async (ms: number) => {
      slept.push(ms)
    },
    get calls() {
      return calls
    },
  }
}

describe("isRetryableContentProblem", () => {
  it("retries a 5xx, the failure this policy exists for", () => {
    // Directus intermittently 500s a single document while a sibling document
    // fetched in the same tick returns 200 — see the 2026-08-09 EULA incident.
    expect(isRetryableContentProblem("server")).toBe(true)
  })

  it("retries the transport-level problems", () => {
    expect(isRetryableContentProblem("timeout")).toBe(true)
    expect(isRetryableContentProblem("cannot-connect")).toBe(true)
    expect(isRetryableContentProblem("unknown")).toBe(true)
  })

  it("retries an empty payload", () => {
    // The API proxy already refuses to cache or serve an empty document
    // because emptiness is far more likely to be a transient upstream blip
    // than the truth. Retrying it here is the client half of that stance.
    expect(isRetryableContentProblem("bad-data")).toBe(true)
  })

  it("does not retry problems a second attempt cannot fix", () => {
    expect(isRetryableContentProblem("not-found")).toBe(false)
    expect(isRetryableContentProblem("forbidden")).toBe(false)
    expect(isRetryableContentProblem("unauthorized")).toBe(false)
    expect(isRetryableContentProblem("rejected")).toBe(false)
  })
})

describe("contentRetryDelayMs", () => {
  it("walks the ladder left to right", () => {
    expect(contentRetryDelayMs(0)).toBe(CONTENT_RETRY_DELAYS_MS[0])
    expect(contentRetryDelayMs(1)).toBe(CONTENT_RETRY_DELAYS_MS[1])
    expect(contentRetryDelayMs(2)).toBe(CONTENT_RETRY_DELAYS_MS[2])
  })

  it("returns null once the ladder is exhausted", () => {
    // null is the stop signal, distinct from a 0 ms delay — a caller that
    // treated "no more delays" as "retry immediately" would spin forever.
    expect(contentRetryDelayMs(CONTENT_RETRY_DELAYS_MS.length)).toBeNull()
    expect(contentRetryDelayMs(CONTENT_RETRY_DELAYS_MS.length + 5)).toBeNull()
  })

  it("returns null for a negative attempt rather than indexing off the end", () => {
    expect(contentRetryDelayMs(-1)).toBeNull()
  })

  it("uses a ladder that stays under a few seconds in total", () => {
    // These fire while the user is staring at a spinner in the agreement
    // modal with no way to skip it, so the whole ladder has to stay short
    // enough to feel like loading rather than like a hang.
    const total = CONTENT_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)
    expect(total).toBeLessThanOrEqual(6000)
  })
})

describe("fetchWithContentRetry", () => {
  it("returns a first-try success without sleeping", async () => {
    const s = scripted([DOC])
    await expect(fetchWithContentRetry(s.attempt, s.sleep)).resolves.toEqual(DOC)
    expect(s.calls).toBe(1)
    expect(s.slept).toEqual([])
  })

  it("recovers from a transient 500 — the EULA incident", async () => {
    // Exactly the observed failure: one 500, then the same document loads.
    const s = scripted([{ kind: "server" }, DOC])
    await expect(fetchWithContentRetry(s.attempt, s.sleep)).resolves.toEqual(DOC)
    expect(s.calls).toBe(2)
    expect(s.slept).toEqual([CONTENT_RETRY_DELAYS_MS[0]])
  })

  it("walks the whole ladder before giving up, then stops", async () => {
    const s = scripted([{ kind: "server" }])
    await expect(fetchWithContentRetry(s.attempt, s.sleep)).resolves.toEqual({ kind: "server" })
    // One original attempt plus one per rung — and no more, or a permanently
    // sick upstream would spin the modal forever.
    expect(s.calls).toBe(CONTENT_RETRY_DELAYS_MS.length + 1)
    expect(s.slept).toEqual([...CONTENT_RETRY_DELAYS_MS])
  })

  it("gives up immediately on a problem a retry cannot fix", async () => {
    const s = scripted([{ kind: "not-found" }])
    await expect(fetchWithContentRetry(s.attempt, s.sleep)).resolves.toEqual({ kind: "not-found" })
    expect(s.calls).toBe(1)
    expect(s.slept).toEqual([])
  })

  it("reports each retry to the caller for logging", async () => {
    const s = scripted([{ kind: "server" }, { kind: "timeout", temporary: true }, DOC])
    const notices: unknown[] = []
    await fetchWithContentRetry(s.attempt, s.sleep, (n) => notices.push(n))
    expect(notices).toEqual([
      { problem: "server", attempt: 0, waitMs: CONTENT_RETRY_DELAYS_MS[0] },
      { problem: "timeout", attempt: 1, waitMs: CONTENT_RETRY_DELAYS_MS[1] },
    ])
  })
})
