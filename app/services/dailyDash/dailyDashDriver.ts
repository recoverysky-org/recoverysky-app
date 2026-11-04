/**
 * The Daily Dash sign-in driver. ADDED 2026-11-04 (My Day tab, spec D8, D10,
 * §4.4).
 *
 * RecoverySky signs the person in; Daily Dash never shows its own sign-in
 * screen here. The driver watches three sources (the session's state, the
 * network's reconnect edge, the app coming to the foreground) plus the My Day
 * gate that `DailyDashProvider` feeds it, and when the session is signed out
 * while the gate holds it hands the app's Auth0 tokens over through
 * `session.signInWithProvider(null, "recoverysky")` (the SignIn adapter in
 * dailyDashSignIn.ts ignores the connection and returns what the app holds).
 *
 * What it never does: sign the session out. Its action set is
 * `signIn | releaseDevice | none` (dailyDashDriverLogic.ts). The gate
 * releasing, a lapsed subscription or the app's logout leave the Daily Dash
 * session and its local data alone (spec D8); the one sign-out is Settings'.
 *
 * Decisions are pure (`decideDailyDashAction`, vitest-covered); this file is
 * only the wiring and the in-flight bookkeeping.
 */
import type { AppState, AppStateStatus } from "react-native"
import type { ClientConnectivity, Logger, Session } from "@daily-dash/client"

import { decideDailyDashAction } from "./dailyDashDriverLogic"
import type { Attempt, Trigger } from "./dailyDashDriverLogic"

export interface DailyDashDriver {
  /** Hears every change of `getAttempt()`; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** The sign-in attempt's state, for the tab's "connecting / try again" UI. */
  getAttempt(): Attempt
  /** The My Day gate (`decideMyDayTabVisible`), from DailyDashProvider. */
  setGate(holds: boolean): void
  /** The tab's "Try again": the one manual edge out of a failed attempt. */
  retry(): void
  /** Unsubscribes from the session, connectivity and AppState. */
  dispose(): void
}

export interface DailyDashDriverDeps {
  session: Session
  connectivity: ClientConnectivity
  appState: Pick<typeof AppState, "addEventListener" | "currentState">
  log: Logger
}

export function createDailyDashDriver(deps: DailyDashDriverDeps): DailyDashDriver {
  const { session, connectivity, appState, log } = deps

  let gateHolds = false
  let attempt: Attempt = "idle"
  let disposed = false
  // One session operation at a time, sign-in or release. `attempt` alone
  // cannot say so: the pure rule answers `releaseDevice` for `wrongAccount`
  // whatever the attempt, and a sign-in that ends on the wrong-account screen
  // emits that state while its own promise is still pending. Calling
  // releaseDevice() then would race the sign-in it is meant to follow.
  let busy = false
  // A trigger that arrived while busy, replayed once the operation settles,
  // so the wrong-account state above is acted on and an edge (a reconnect
  // during a doomed attempt) is not lost. An edge outranks a plain "state".
  let pending: Trigger | null = null
  let lastAppState: AppStateStatus | null = appState.currentState ?? null

  const listeners = new Set<() => void>()

  const setAttempt = (next: Attempt) => {
    if (attempt === next) return
    attempt = next
    for (const listener of [...listeners]) listener()
  }

  const runSignIn = async () => {
    busy = true
    setAttempt("running")
    try {
      const result = await session.signInWithProvider(null, "recoverysky")
      if (result.ok) {
        setAttempt("idle")
      } else {
        // `code` only: the error's message, details and cause can carry
        // request context, and nothing token-shaped may reach a log line.
        log.warn({ code: result.error.code }, "Daily Dash sign-in failed")
        setAttempt("failed")
      }
    } catch {
      // The client's contract is that sign-in returns a Result; a throw would
      // otherwise leave `attempt` on "running" for good and the tab spinning.
      log.warn({ code: "threw" }, "Daily Dash sign-in failed")
      setAttempt("failed")
    } finally {
      busy = false
    }
  }

  const runRelease = async () => {
    busy = true
    try {
      const result = await session.releaseDevice()
      if (!result.ok) log.warn({ code: result.error.code }, "Daily Dash device release failed")
    } catch {
      log.warn({ code: "threw" }, "Daily Dash device release failed")
    } finally {
      busy = false
    }
  }

  const evaluate = (trigger: Trigger): void => {
    if (disposed) return
    if (busy) {
      if (pending === null || trigger !== "state") pending = trigger
      return
    }
    const action = decideDailyDashAction({
      gateHolds,
      status: session.getState().status,
      attempt,
      trigger,
    })
    if (action === "none") return
    const run = action === "signIn" ? runSignIn : runRelease
    void run().then(() => {
      // Replay only what arrived meanwhile. No unconditional re-evaluation:
      // a sign-in that resolved ok while the state somehow stayed signedOut,
      // or a release the API refused, would otherwise retry in a tight loop.
      const replay = pending
      pending = null
      if (replay) evaluate(replay)
    })
  }

  const unsubscribeSession = session.subscribe(() => evaluate("state"))
  // A failed attempt waits for an edge (this, a foreground or the tab's Try
  // again) instead of a timer: the usual cause is an API that is down or a
  // network that is not getting through, and polling it on a schedule would
  // spend battery against a server that cannot answer. CrowdSec has banned
  // devices for less (see CLAUDE.md, sync's body backfill).
  const unsubscribeReconnect = connectivity.onReconnect(() => evaluate("reconnect"))
  const appStateSubscription = appState.addEventListener("change", (next) => {
    const previous = lastAppState
    lastAppState = next
    // Any non-active state to active: iOS goes inactive → active, Android
    // background → active.
    if (next === "active" && previous !== "active") evaluate("foreground")
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getAttempt: () => attempt,
    setGate(holds) {
      if (holds === gateHolds) return
      gateHolds = holds
      // Closing the gate decides `none` for every status; it is evaluated
      // anyway so the rule, not this file, owns that answer. A running
      // attempt is not cancelled: the client offers no cancel, and its
      // result is harmless (signed in, with the tab hidden).
      evaluate("gate")
    },
    retry: () => evaluate("retry"),
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeSession()
      unsubscribeReconnect()
      appStateSubscription.remove()
      listeners.clear()
    },
  }
}
