/**
 * Pure decision for the Daily Dash sign-in driver (dailyDashDriver.ts).
 * ADDED 2026-11-04 (My Day tab, spec D8, D10, §4.4).
 *
 * Kept free of runtime `@/` and React Native imports so vitest can import it
 * (CLAUDE.md "Test Runner Split"); `SessionState` is a type-only import.
 *
 * The rules, in order:
 * - A gate that does not hold starts NOTHING, whatever the session's status.
 *   The gate is the My Day tab's (`decideMyDayTabVisible`), so a free,
 *   guest or signed-out person never gets a Daily Dash account minted.
 * - The action set has no sign-out on purpose (spec D8). The gate releasing
 *   (a lapsed subscription, the app's logout) leaves the Daily Dash session as
 *   it is; the one Daily Dash sign-out lives in Settings.
 * - `wrongAccount` hands the device to the account that just signed in: the
 *   app's own ownership gate (useAuth0Wrapper) already decided who owns this
 *   device, so Daily Dash's owner record yields to it.
 * - `signedOut` signs in, but never over a running attempt, and after a failed
 *   one only on an edge (reconnect, foreground, an explicit retry, the gate
 *   re-opening), never on a plain state change. See the driver for why.
 */
import type { SessionState } from "@daily-dash/client"

export type Attempt = "idle" | "running" | "failed"
export type Trigger = "state" | "gate" | "reconnect" | "foreground" | "retry"

export interface DriverInputs {
  gateHolds: boolean
  status: SessionState["status"]
  attempt: Attempt
  trigger: Trigger
}

/** Deliberately no "signOut" member: see the header. */
export type DriverAction = "signIn" | "releaseDevice" | "none"

/** Triggers that may start a new attempt after a failed one. */
const RETRY_EDGES: ReadonlySet<Trigger> = new Set<Trigger>([
  "reconnect",
  "foreground",
  "retry",
  "gate",
])

export function decideDailyDashAction(i: DriverInputs): DriverAction {
  if (!i.gateHolds) return "none"
  if (i.status === "wrongAccount") return "releaseDevice"
  if (i.status === "signedOut" && i.attempt !== "running") {
    if (i.attempt !== "failed" || RETRY_EDGES.has(i.trigger)) return "signIn"
  }
  return "none"
}
