import { describe, expect, it } from "vitest"

import type { Announcement } from "@/config/announcements"

import { selectPendingAnnouncement, shouldShowCta } from "./announcementLogic"

const A: Announcement = { id: "a", titleTx: "x" as never, bodyTx: "y" as never }
const B: Announcement = { id: "b", titleTx: "x" as never, bodyTx: "y" as never }
const withCta = (requiresAttendance: boolean): Announcement => ({
  id: "c",
  titleTx: "x" as never,
  bodyTx: "y" as never,
  cta: { labelTx: "l" as never, requiresAttendance, target: "cloudBackupSettings" },
})

const base = {
  announcements: [A, B] as const,
  seenIds: [] as string[],
  isAuthenticated: true,
  onboardingCompleted: true,
  outageMode: false,
  timerSessionActive: false,
}

describe("selectPendingAnnouncement", () => {
  it("returns the first unseen announcement when all gates pass", () => {
    expect(selectPendingAnnouncement(base)?.id).toBe("a")
  })

  it("skips seen ids and returns the next unseen in array order", () => {
    expect(selectPendingAnnouncement({ ...base, seenIds: ["a"] })?.id).toBe("b")
  })

  it("returns null when all are seen", () => {
    expect(selectPendingAnnouncement({ ...base, seenIds: ["a", "b"] })).toBeNull()
  })

  it("returns null when unauthenticated", () => {
    expect(selectPendingAnnouncement({ ...base, isAuthenticated: false })).toBeNull()
  })

  it("returns null when onboarding incomplete", () => {
    expect(selectPendingAnnouncement({ ...base, onboardingCompleted: false })).toBeNull()
  })

  it("returns null during outage", () => {
    expect(selectPendingAnnouncement({ ...base, outageMode: true })).toBeNull()
  })

  it("returns null while a timer session is active", () => {
    expect(selectPendingAnnouncement({ ...base, timerSessionActive: true })).toBeNull()
  })
})

describe("shouldShowCta", () => {
  it("is false when the announcement has no cta", () => {
    expect(shouldShowCta(A, true)).toBe(false)
  })

  it("is false when cta requires attendance and the user lacks it", () => {
    expect(shouldShowCta(withCta(true), false)).toBe(false)
  })

  it("is true when cta requires attendance and the user has it", () => {
    expect(shouldShowCta(withCta(true), true)).toBe(true)
  })

  it("is true when cta does not require attendance, regardless of entitlement", () => {
    expect(shouldShowCta(withCta(false), false)).toBe(true)
  })
})
