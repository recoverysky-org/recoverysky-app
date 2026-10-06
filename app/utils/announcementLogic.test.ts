import { describe, expect, it } from "vitest"

import type { Announcement } from "@/config/announcements"

import { compareVersions, selectPendingAnnouncement, shouldShowCta } from "./announcementLogic"

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
  platform: "android",
  nativeVersion: "4.10.1" as string | null,
  shownThisSession: [] as string[],
}

const NAG: Announcement = {
  id: "nag",
  titleTx: "x" as never,
  bodyTx: "y" as never,
  platform: "android",
  repeatUntilNativeVersion: "4.11.0",
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

describe("platform-targeted and repeating announcements", () => {
  const nag = { ...base, announcements: [NAG] as const }

  it("shows a repeating notice even after it was recorded as seen", () => {
    expect(selectPendingAnnouncement({ ...nag, seenIds: ["nag"] })?.id).toBe("nag")
  })

  it("shows it only once per session", () => {
    expect(selectPendingAnnouncement({ ...nag, shownThisSession: ["nag"] })).toBeNull()
  })

  it("never shows an android notice on ios", () => {
    expect(selectPendingAnnouncement({ ...nag, platform: "ios" })).toBeNull()
  })

  it("stops once the installed build reaches the target version", () => {
    expect(selectPendingAnnouncement({ ...nag, nativeVersion: "4.11.0" })).toBeNull()
    expect(selectPendingAnnouncement({ ...nag, nativeVersion: "4.12.3" })).toBeNull()
  })

  it("shows on every build below the target", () => {
    expect(selectPendingAnnouncement({ ...nag, nativeVersion: "4.9.9" })?.id).toBe("nag")
  })

  it("stays hidden when the native version is unknown", () => {
    expect(selectPendingAnnouncement({ ...nag, nativeVersion: null })).toBeNull()
  })

  it("skips an ineligible entry and falls through to the next unseen one", () => {
    const s = { ...base, platform: "ios", announcements: [NAG, A] as const }
    expect(selectPendingAnnouncement(s)?.id).toBe("a")
  })
})

describe("compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("4.10.1", "4.9.0")).toBe(1)
    expect(compareVersions("4.10.1", "4.11.0")).toBe(-1)
  })

  it("treats missing parts as zero", () => {
    expect(compareVersions("4.11", "4.11.0")).toBe(0)
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
