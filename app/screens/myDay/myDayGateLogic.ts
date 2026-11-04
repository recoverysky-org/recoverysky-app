/**
 * Pure decision for the My Day tab's own gate (`MyDayGate.tsx`). ADDED 2026-11-04 (My Day tab,
 * spec §4.5 "the tab's own gate").
 *
 * The Daily Dash client renders its children always and only *reports* its session and database
 * state; a blocking screen is the host's to draw. This module says which one to draw, from the
 * session's status, the database's phase and the sign-in driver's last attempt.
 *
 * The gate only shows; it never acts on the session. Signing in and releasing a wrong account are
 * the driver's (`services/dailyDash/dailyDashDriver.ts`), which is why `restoring`, `wrongAccount`
 * and a `signedOut` with no failed attempt all read as plain loading: the driver is already on it.
 *
 * Kept free of runtime `@/` and React Native imports so vitest can import it (CLAUDE.md "Test
 * Runner Split"); every import below is type-only and erased.
 */
import type { DbState, SessionState } from "@daily-dash/client"

import type { Attempt } from "../../services/dailyDash/dailyDashDriverLogic"

export type MyDayGateView =
  | { kind: "ready" }
  | { kind: "loading" }
  | { kind: "connectFailed" }
  | { kind: "dbFailed"; message: string }
  | { kind: "deleted"; recoverable: boolean }

export interface MyDayGateInputs {
  session: SessionState
  db: DbState
  attempt: Attempt
}

export function decideMyDayGateView({ session, db, attempt }: MyDayGateInputs): MyDayGateView {
  switch (session.status) {
    case "signedIn":
      // Signed in is not enough: the package's hooks need the repositories, which exist only once
      // the database reports `ready`. A failed open carries the client's own message, shown above
      // the reset offer.
      if (db.phase === "ready") return { kind: "ready" }
      if (db.phase === "failed") return { kind: "dbFailed", message: db.message }
      return { kind: "loading" }
    case "signedOut":
      // The driver signs a signed-out session in on its own; "couldn't connect" (with its retry)
      // shows only once an attempt has actually failed, never while one may still be starting.
      return attempt === "failed" ? { kind: "connectFailed" } : { kind: "loading" }
    case "accountDeleted":
      // `recoverableUntil` goes null once the recovery window has closed (`account_purged`), and
      // then there is nothing left for Restore to do.
      return { kind: "deleted", recoverable: session.recoverableUntil !== null }
    case "restoring":
    case "wrongAccount":
      // The driver hands a wrong-account device to the account the app signed in with; until it
      // does, as while the session restores, there is nothing for the person to choose.
      return { kind: "loading" }
  }
}
