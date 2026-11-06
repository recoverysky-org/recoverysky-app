import { describe, expect, it } from "vitest"

import { decideMyDayGateView } from "./myDayGateLogic"

const signedIn = {
  status: "signedIn",
  accountId: "a",
  accountHash: "h",
  product: "recoverysky",
} as const
describe("decideMyDayGateView (spec §4.5 'the tab's own gate')", () => {
  it("ready only when signed in and the database is open", () => {
    expect(
      decideMyDayGateView({ session: signedIn, db: { phase: "ready" }, attempt: "idle" }),
    ).toEqual({ kind: "ready" })
    expect(
      decideMyDayGateView({ session: signedIn, db: { phase: "opening" }, attempt: "idle" }),
    ).toEqual({ kind: "loading" })
    expect(
      decideMyDayGateView({ session: signedIn, db: { phase: "idle" }, attempt: "idle" }),
    ).toEqual({ kind: "loading" })
  })
  it("a failed database offers the reset, with the client's message", () => {
    expect(
      decideMyDayGateView({
        session: signedIn,
        db: { phase: "failed", code: "db_open", message: "wrong key", unsupportedBrowser: false },
        attempt: "idle",
      }),
    ).toEqual({ kind: "dbFailed", message: "wrong key" })
  })
  it("signed out: loading while an attempt may run, connect-failed after one failed", () => {
    const signedOut = { status: "signedOut", owner: null, notice: null } as const
    expect(
      decideMyDayGateView({ session: signedOut, db: { phase: "idle" }, attempt: "idle" }),
    ).toEqual({ kind: "loading" })
    expect(
      decideMyDayGateView({ session: signedOut, db: { phase: "idle" }, attempt: "running" }),
    ).toEqual({ kind: "loading" })
    expect(
      decideMyDayGateView({ session: signedOut, db: { phase: "idle" }, attempt: "failed" }),
    ).toEqual({ kind: "connectFailed" })
  })
  it("restoring and wrong account are loading (the driver resolves them)", () => {
    expect(
      decideMyDayGateView({
        session: { status: "restoring" },
        db: { phase: "idle" },
        attempt: "idle",
      }),
    ).toEqual({ kind: "loading" })
    expect(
      decideMyDayGateView({
        session: {
          status: "wrongAccount",
          owner: { proof: "code", maskedEmail: null },
          other: null,
        },
        db: { phase: "idle" },
        attempt: "idle",
      }),
    ).toEqual({ kind: "loading" })
  })
  it("deleted: restorable while the window is open", () => {
    const deleted = { status: "accountDeleted", accountId: "a", accountHash: "h" } as const
    expect(
      decideMyDayGateView({
        session: { ...deleted, recoverableUntil: "2026-12-01T00:00:00Z" },
        db: { phase: "idle" },
        attempt: "idle",
      }),
    ).toEqual({ kind: "deleted", recoverable: true })
    expect(
      decideMyDayGateView({
        session: { ...deleted, recoverableUntil: null },
        db: { phase: "idle" },
        attempt: "idle",
      }),
    ).toEqual({ kind: "deleted", recoverable: false })
  })
})
