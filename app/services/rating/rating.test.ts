import { describe, expect, it } from "vitest"

import type { RatingConfig } from "./config"
import { shouldPrompt } from "./decide"
import { computeInitialState } from "./migrate"
import { applyApprove, applyDeny, reduceRecordEvent } from "./reducers"
import type { RatingState } from "./types"

// Deterministic config independent of EXPO_PUBLIC_* env in the test runner.
const cfg: RatingConfig = {
  MIN_EVENTS: 5,
  MIN_DAYS: 3,
  APPROVE_MIN_GAP_DAYS: 90,
  DENY_BACKOFF_DAYS: [45, 120, 365],
}

const NOW = new Date("2026-06-29T12:00:00.000Z")

function daysAgo(n: number): string {
  const d = new Date(NOW.getTime())
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function baseState(overrides: Partial<RatingState> = {}): RatingState {
  return {
    events: 0,
    installedAt: daysAgo(30),
    lastPromptAt: null,
    denyCount: 0,
    approvedAtVersion: null,
    disabled: false,
    ...overrides,
  }
}

describe("shouldPrompt — warm-up gate", () => {
  it("blocks below MIN_EVENTS", () => {
    expect(shouldPrompt(baseState({ events: 4 }), NOW, "4.6.0", cfg)).toBe(false)
  })

  it("blocks when install is younger than MIN_DAYS even with enough events", () => {
    expect(
      shouldPrompt(baseState({ events: 10, installedAt: daysAgo(1) }), NOW, "4.6.0", cfg),
    ).toBe(false)
  })

  it("prompts once both warm-up gates pass and there is no prior prompt", () => {
    expect(shouldPrompt(baseState({ events: 5 }), NOW, "4.6.0", cfg)).toBe(true)
  })

  it("never prompts when disabled", () => {
    expect(shouldPrompt(baseState({ events: 999, disabled: true }), NOW, "4.6.0", cfg)).toBe(false)
  })
})

describe("shouldPrompt — approver path (version-gated)", () => {
  const approved = (over: Partial<RatingState> = {}) =>
    baseState({ events: 10, approvedAtVersion: "4.6.0", lastPromptAt: daysAgo(200), ...over })

  it("does not re-ask on the same version", () => {
    expect(shouldPrompt(approved(), NOW, "4.6.0", cfg)).toBe(false)
  })

  it("does not re-ask on a new version before the 90-day floor", () => {
    expect(shouldPrompt(approved({ lastPromptAt: daysAgo(10) }), NOW, "4.7.0", cfg)).toBe(false)
  })

  it("re-asks on a new version once past the 90-day floor", () => {
    expect(shouldPrompt(approved({ lastPromptAt: daysAgo(100) }), NOW, "4.7.0", cfg)).toBe(true)
  })

  it("does not re-ask when the native version is unknown", () => {
    expect(shouldPrompt(approved({ lastPromptAt: daysAgo(100) }), NOW, null, cfg)).toBe(false)
  })
})

describe("shouldPrompt — denier path (backoff)", () => {
  const denied = (denyCount: number, since: number) =>
    baseState({ events: 10, denyCount, lastPromptAt: daysAgo(since) })

  it("blocks within the current backoff window", () => {
    expect(shouldPrompt(denied(1, 10), NOW, "4.6.0", cfg)).toBe(false) // wait 45
  })

  it("re-asks once past the current backoff step", () => {
    expect(shouldPrompt(denied(1, 50), NOW, "4.6.0", cfg)).toBe(true) // >= 45
    expect(shouldPrompt(denied(2, 130), NOW, "4.6.0", cfg)).toBe(true) // >= 120
    expect(shouldPrompt(denied(3, 400), NOW, "4.6.0", cfg)).toBe(true) // >= 365
  })

  it("stops forever once the backoff schedule is exhausted", () => {
    expect(shouldPrompt(denied(4, 1000), NOW, "4.6.0", cfg)).toBe(false) // no step left
  })
})

describe("reducers", () => {
  it("reduceRecordEvent increments unconditionally (no flag argument exists)", () => {
    // Structural proof that counting can't be gated: the function only takes state.
    expect(reduceRecordEvent(baseState({ events: 7 })).events).toBe(8)
    expect(reduceRecordEvent(baseState({ events: 0 })).events).toBe(1)
  })

  it("applyApprove stamps the version and prompt time", () => {
    const next = applyApprove(baseState(), "2026-06-29T12:00:00.000Z", "4.7.0")
    expect(next.approvedAtVersion).toBe("4.7.0")
    expect(next.lastPromptAt).toBe("2026-06-29T12:00:00.000Z")
  })

  it("applyDeny advances backoff and only disables after the schedule is exhausted", () => {
    const third = applyDeny(baseState({ denyCount: 2 }), NOW.toISOString(), cfg)
    expect(third.denyCount).toBe(3)
    expect(third.disabled).toBe(false) // last backoff step still ahead

    const fourth = applyDeny(baseState({ denyCount: 3 }), NOW.toISOString(), cfg)
    expect(fourth.denyCount).toBe(4)
    expect(fourth.disabled).toBe(true) // 4 > DENY_BACKOFF_DAYS.length
  })
})

describe("computeInitialState — migration & rollout intent", () => {
  it("keeps an existing v1 state untouched", () => {
    const existing = baseState({ events: 42 })
    const { state, removeLegacy } = computeInitialState(existing, null, NOW, cfg)
    expect(state).toBe(existing)
    expect(removeLegacy).toBe(false)
  })

  it("seeds a pre-existing (legacy) install as already-eligible and removes the old key", () => {
    const { state, removeLegacy } = computeInitialState(null, { totalMeetings: 0 }, NOW, cfg)
    expect(state.events).toBe(cfg.MIN_EVENTS)
    expect(removeLegacy).toBe(true)
    expect(state.disabled).toBe(false) // legacy.disabled intentionally dropped
    // The catch-up prompt fires on the next event once REVIEW_ENABLED flips on.
    expect(shouldPrompt(state, NOW, "4.6.0", cfg)).toBe(true)
  })

  it("starts a fresh post-ship install at the bottom of the warm-up", () => {
    const { state, removeLegacy } = computeInitialState(null, null, NOW, cfg)
    expect(state.events).toBe(0)
    expect(removeLegacy).toBe(false)
    expect(shouldPrompt(state, NOW, "4.6.0", cfg)).toBe(false)
  })
})
