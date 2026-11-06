/**
 * The driver's wiring over fake deps (the decisions themselves are pinned in
 * dailyDashDriverLogic.test.ts). The driver has no runtime `@/` or
 * react-native import, which is what lets vitest load it.
 */
import type { ClientConnectivity, Logger, Session, SessionState } from "@daily-dash/client"
import { describe, expect, it, vi } from "vitest"

import { createDailyDashDriver } from "./dailyDashDriver"

type Result = { ok: true; value: undefined } | { ok: false; error: { code: string } }

/** A promise you settle by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(initial: SessionState["status"] = "signedOut") {
  let state = { status: initial } as SessionState
  const listeners = new Set<(s: SessionState) => void>()
  const signIns: ReturnType<typeof deferred<Result>>[] = []
  const releases: ReturnType<typeof deferred<Result>>[] = []

  const session = {
    getState: () => state,
    subscribe: vi.fn((l: (s: SessionState) => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }),
    start: vi.fn(() => Promise.resolve()),
    signInWithProvider: vi.fn(() => {
      const d = deferred<Result>()
      signIns.push(d)
      return d.promise
    }),
    releaseDevice: vi.fn(() => {
      const d = deferred<Result>()
      releases.push(d)
      return d.promise
    }),
  }
  const emit = (status: SessionState["status"]) => {
    state = { status } as SessionState
    for (const l of [...listeners]) l(state)
  }

  let reconnect: (() => void) | null = null
  const connectivity: ClientConnectivity = {
    reach: () => {},
    onReconnect: (fn) => {
      reconnect = fn
      return () => {
        reconnect = null
      }
    },
  }
  const appState = {
    currentState: "active" as const,
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  }
  const log = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  ;(log as unknown as { child: () => unknown }).child = () => log

  const driver = createDailyDashDriver({
    session: session as unknown as Session,
    connectivity,
    appState: appState as never,
    log: log as unknown as Logger,
  })
  return { driver, session, emit, signIns, releases, appState, reconnect: () => reconnect?.() }
}

const OK: Result = { ok: true, value: undefined }

describe("createDailyDashDriver", () => {
  it("opening the gate starts the session once and signs a signed-out session in once", async () => {
    const t = setup("signedOut")
    t.driver.setGate(true)
    t.driver.setGate(true)
    expect(t.session.start).toHaveBeenCalledTimes(1)
    expect(t.session.signInWithProvider).toHaveBeenCalledTimes(1)
    expect(t.session.signInWithProvider).toHaveBeenCalledWith(null, "recoverysky")
    expect(t.driver.getAttempt()).toBe("running")
    t.signIns[0].resolve(OK)
    await flush()
    expect(t.driver.getAttempt()).toBe("idle")
  })

  it("a wrongAccount emitted mid-sign-in waits for the sign-in, then releases once", async () => {
    const t = setup("signedOut")
    t.driver.setGate(true)
    t.emit("wrongAccount")
    await flush()
    expect(t.session.releaseDevice).not.toHaveBeenCalled()
    t.signIns[0].resolve({ ok: false, error: { code: "wrong_account" } })
    await flush()
    expect(t.session.releaseDevice).toHaveBeenCalledTimes(1)
    t.releases[0].resolve(OK)
    await flush()
    expect(t.session.releaseDevice).toHaveBeenCalledTimes(1)
  })

  it("after a failed sign-in a state change does not retry, but retry() does", async () => {
    const t = setup("signedOut")
    t.driver.setGate(true)
    t.signIns[0].resolve({ ok: false, error: { code: "x" } })
    await flush()
    expect(t.driver.getAttempt()).toBe("failed")
    t.emit("signedOut")
    await flush()
    expect(t.session.signInWithProvider).toHaveBeenCalledTimes(1)
    t.driver.retry()
    expect(t.session.signInWithProvider).toHaveBeenCalledTimes(2)
  })

  it("notifies listeners on every attempt change", async () => {
    const t = setup("signedOut")
    const seen: string[] = []
    t.driver.subscribe(() => seen.push(t.driver.getAttempt()))
    t.driver.setGate(true)
    t.signIns[0].resolve({ ok: false, error: { code: "x" } })
    await flush()
    expect(seen).toEqual(["running", "failed"])
  })

  it("closing the gate starts nothing", async () => {
    const t = setup("signedOut")
    t.driver.setGate(true)
    t.signIns[0].resolve(OK)
    await flush()
    t.driver.setGate(false)
    t.emit("signedOut")
    t.reconnect()
    await flush()
    expect(t.session.signInWithProvider).toHaveBeenCalledTimes(1)
  })

  it("dispose() unsubscribes: a later state emission calls nothing", async () => {
    const t = setup("restoring")
    t.driver.setGate(true)
    t.driver.dispose()
    t.emit("signedOut")
    t.reconnect()
    await flush()
    expect(t.session.signInWithProvider).not.toHaveBeenCalled()
    expect(t.session.releaseDevice).not.toHaveBeenCalled()
  })
})
