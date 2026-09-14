import { describe, expect, it } from "vitest"

import {
  decideResume,
  FAST_INTERVAL_MS,
  getNextDelay,
  isTerminalProblem,
  MAX_POLL_AGE_MS,
  MEDIUM_INTERVAL_MS,
  SLOW_INTERVAL_MS,
} from "./reportPollingLogic"

const DAY_MS = 24 * 60 * 60_000
const NOW = 1_800_000_000_000

describe("decideResume", () => {
  it("resumes a fresh report owned by the signed-in identity", () => {
    expect(decideResume({ uid: "auth0|me", generated: NOW - 60_000 }, "auth0|me", NOW)).toBe(
      "resume",
    )
  })

  it("skips a report owned by a different identity", () => {
    // The 2026-09 incident: one device signed in with the Google identity
    // polled six reports created under the email identity. The server answers
    // an ownership mismatch with 404, so every poll was a guaranteed failure.
    expect(
      decideResume({ uid: "auth0|email-user", generated: NOW - 60_000 }, "google|me", NOW),
    ).toBe("skip-foreign")
  })

  it("resumes a report with no recorded owner", () => {
    // uid is "" on rows created before the column was stamped; the server's
    // status route is id-addressed for those, so polling can still succeed.
    expect(decideResume({ uid: "", generated: NOW - 60_000 }, "auth0|me", NOW)).toBe("resume")
  })

  it("skips a foreign report when nobody is signed in", () => {
    expect(decideResume({ uid: "auth0|someone", generated: NOW - 60_000 }, undefined, NOW)).toBe(
      "skip-foreign",
    )
  })

  it("skips a report older than the poll age cap", () => {
    // Delivery confirmations arrive within minutes. A week-old unconfirmed
    // report will never confirm, and without a cap it polls forever.
    expect(
      decideResume({ uid: "auth0|me", generated: NOW - MAX_POLL_AGE_MS - 1 }, "auth0|me", NOW),
    ).toBe("skip-stale")
  })

  it("still resumes a report exactly at the age cap", () => {
    expect(
      decideResume({ uid: "auth0|me", generated: NOW - MAX_POLL_AGE_MS }, "auth0|me", NOW),
    ).toBe("resume")
  })

  it("caps at seven days", () => {
    expect(MAX_POLL_AGE_MS).toBe(7 * DAY_MS)
  })
})

describe("getNextDelay", () => {
  it("polls fast during the first five minutes", () => {
    expect(getNextDelay(NOW - 60_000, NOW, "pending")).toBe(FAST_INTERVAL_MS)
  })

  it("polls every minute between five and sixty minutes", () => {
    expect(getNextDelay(NOW - 10 * 60_000, NOW, "pending")).toBe(MEDIUM_INTERVAL_MS)
  })

  it("polls slowly after an hour", () => {
    expect(getNextDelay(NOW - 2 * 60 * 60_000, NOW, "pending")).toBe(SLOW_INTERVAL_MS)
  })

  it("measures age from when the report was generated, not from when polling resumed", () => {
    // A cold-start resume used to restart the fast phase for every backlog
    // report at once: six reports × 6 calls/min blew the server's 60/min
    // bucket. Anchoring on `generated` keeps a three-day-old report slow.
    const generated = NOW - 3 * DAY_MS
    expect(getNextDelay(generated, NOW, "pending")).toBe(SLOW_INTERVAL_MS)
  })

  it("backs off to the slow interval after any API problem, even in the fast phase", () => {
    // A 429 retried every 10 s is what turned a rate-limit into a loop.
    expect(getNextDelay(NOW - 60_000, NOW, "problem")).toBe(SLOW_INTERVAL_MS)
  })
})

describe("isTerminalProblem", () => {
  it("treats not-found as terminal", () => {
    // The server says "no such report, or not yours". Neither changes by
    // asking again.
    expect(isTerminalProblem("not-found")).toBe(true)
  })

  it.each(["rejected", "server", "cannot-connect", "timeout", "unauthorized", "unknown"])(
    "keeps polling after %s",
    (kind) => {
      expect(isTerminalProblem(kind)).toBe(false)
    },
  )
})
