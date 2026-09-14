import { describe, expect, it, vi } from "vitest"

import type { StoredAuthCredentials } from "./secureStorage"
import {
  buildUserTokenRefresher,
  type FreshCredentials,
  type UserRefresherStore,
} from "./userTokenRefresher"

const AUDIENCE = "https://api.recoverysky.app"

function mint(payload: Record<string, unknown>) {
  const seg = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url")
  return `${seg({ alg: "RS256", typ: "JWT" })}.${seg(payload)}.sig`
}

const GOOD_JWT = mint({ aud: AUDIENCE, exp: 1_800_000_000, sub: "auth0|x" })
const OPAQUE = "Xk9pQ2vL8mN4rT6wY1zA3bC5dE7fG0hJ"

/** A store that already holds a signed-in session whose token needs refreshing. */
function makeStore(): UserRefresherStore & {
  setTokens: ReturnType<typeof vi.fn<UserRefresherStore["setTokens"]>>
} {
  return {
    accessToken: "stale.stale.stale",
    refreshToken: "rt-1",
    idToken: undefined,
    expiresAt: undefined, // undefined → shouldRefresh() says refresh now
    isAnonymous: false,
    // Explicit type param: `ReturnType<typeof vi.fn>` alone resolves the
    // generic's constraint (Procedure | Constructable) rather than its
    // default, which vitest 4's Mock<T> then refuses to assign to the
    // concrete setTokens signature. See tsc output before this line existed.
    setTokens: vi.fn<UserRefresherStore["setTokens"]>(),
  }
}

function harness(fresh: FreshCredentials | (() => Promise<FreshCredentials>), audience = AUDIENCE) {
  const authStore = makeStore()
  const onPermanentFailure = vi.fn()
  const getFreshCredentials = vi.fn(typeof fresh === "function" ? fresh : async () => fresh)
  const persistCredentials = vi.fn(async (_c: StoredAuthCredentials) => {})
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const refresher = buildUserTokenRefresher({
    authStore,
    onPermanentFailure,
    getFreshCredentials,
    persistCredentials,
    log,
    audience,
  })
  return { authStore, onPermanentFailure, getFreshCredentials, persistCredentials, log, refresher }
}

describe("buildUserTokenRefresher — usable token", () => {
  it("stores, persists and returns a JWT for the configured audience", async () => {
    const h = harness({
      accessToken: GOOD_JWT,
      refreshToken: null,
      idToken: null,
      expiresAt: 1_800_000_000,
    })
    await expect(h.refresher.getToken()).resolves.toBe(GOOD_JWT)
    expect(h.authStore.setTokens).toHaveBeenCalledWith(
      GOOD_JWT,
      "rt-1",
      undefined,
      1_800_000_000_000,
    )
    expect(h.persistCredentials).toHaveBeenCalledWith({
      accessToken: GOOD_JWT,
      refreshToken: "rt-1",
      idToken: undefined,
      expiresAt: 1_800_000_000_000,
    })
    expect(h.onPermanentFailure).not.toHaveBeenCalled()
  })

  it("keeps the ID token in the store but leaves it out of the persisted record", async () => {
    // The ID token is the largest of the three tokens (~1.3 KB of profile
    // claims + signature). Persisting it alongside the access and refresh
    // tokens pushed the SecureStore record past the 2048-byte limit; nothing
    // reads the persisted copy, so it must not be written.
    const h = harness({
      accessToken: GOOD_JWT,
      refreshToken: null,
      idToken: "id.id.id",
      expiresAt: 1_800_000_000,
    })
    await h.refresher.getToken()
    expect(h.authStore.setTokens).toHaveBeenCalledWith(
      GOOD_JWT,
      "rt-1",
      "id.id.id",
      1_800_000_000_000,
    )
    expect(h.persistCredentials).toHaveBeenCalledTimes(1)
    const persisted = h.persistCredentials.mock.calls[0][0]
    expect(persisted).not.toHaveProperty("idToken")
    expect(persisted).toEqual({
      accessToken: GOOD_JWT,
      refreshToken: "rt-1",
      expiresAt: 1_800_000_000_000,
    })
  })
})

describe("buildUserTokenRefresher — unusable token from the SDK", () => {
  it("does not store or persist it, ejects once, and resolves null", async () => {
    const h = harness({
      accessToken: OPAQUE,
      refreshToken: null,
      idToken: null,
      expiresAt: 1_800_000_000,
    })
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.authStore.setTokens).not.toHaveBeenCalled()
    expect(h.persistCredentials).not.toHaveBeenCalled()
    expect(h.onPermanentFailure).toHaveBeenCalledTimes(1)
  })

  it("logs the reason and shape but never the token", async () => {
    const h = harness({
      accessToken: OPAQUE,
      refreshToken: null,
      idToken: null,
      expiresAt: 1_800_000_000,
    })
    await h.refresher.getToken()
    const calls = [...h.log.error.mock.calls, ...h.log.warn.mock.calls, ...h.log.info.mock.calls]
    const serialized = JSON.stringify(calls)
    expect(serialized).toContain('"reason":"not-jwt"')
    expect(serialized).toContain('"source":"refresh"')
    expect(serialized).toContain(`"tokenLength":${OPAQUE.length}`)
    expect(serialized).not.toContain(OPAQUE)
  })

  it("short-circuits every later getToken without calling the SDK again", async () => {
    const h = harness({
      accessToken: OPAQUE,
      refreshToken: null,
      idToken: null,
      expiresAt: 1_800_000_000,
    })
    await h.refresher.getToken()
    await expect(h.refresher.getToken()).resolves.toBeNull()
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.getFreshCredentials).toHaveBeenCalledTimes(1)
    expect(h.onPermanentFailure).toHaveBeenCalledTimes(1)
  })

  it("reset() re-enables refreshing", async () => {
    let attempt = 0
    const h = harness(async () => {
      attempt += 1
      return {
        accessToken: attempt === 1 ? OPAQUE : GOOD_JWT,
        refreshToken: null,
        idToken: null,
        expiresAt: 1_800_000_000,
      }
    })
    await expect(h.refresher.getToken()).resolves.toBeNull()
    h.refresher.reset()
    await expect(h.refresher.getToken()).resolves.toBe(GOOD_JWT)
    expect(h.getFreshCredentials).toHaveBeenCalledTimes(2)
  })

  it("rejects a JWT for the wrong audience", async () => {
    const wrong = mint({ aud: "https://auth.recoverysky.app/userinfo", exp: 1_800_000_000 })
    const h = harness({
      accessToken: wrong,
      refreshToken: null,
      idToken: null,
      expiresAt: 1_800_000_000,
    })
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.onPermanentFailure).toHaveBeenCalledTimes(1)
  })

  it("accepts any JWT when no audience is configured (dev builds)", async () => {
    const other = mint({ aud: "anything", exp: 1_800_000_000 })
    const h = harness(
      { accessToken: other, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 },
      "",
    )
    await expect(h.refresher.getToken()).resolves.toBe(other)
  })
})

describe("buildUserTokenRefresher — refresh landing after an eject", () => {
  it("discards a usable token that arrives after the store was cleared", async () => {
    // Simulate performForcedLogout() running while the SDK call is in flight:
    // the store is emptied between the request and the response.
    const h = harness(async () => {
      h.authStore.accessToken = undefined
      h.authStore.refreshToken = undefined
      return { accessToken: GOOD_JWT, refreshToken: null, idToken: null, expiresAt: 1_800_000_000 }
    })
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.authStore.setTokens).not.toHaveBeenCalled()
    expect(h.persistCredentials).not.toHaveBeenCalled()
    expect(h.onPermanentFailure).not.toHaveBeenCalled()
    expect(JSON.stringify(h.log.warn.mock.calls)).toContain("after the session was cleared")
  })
})

describe("buildUserTokenRefresher — markRejected()", () => {
  it("ejects once and is a no-op on repeat", () => {
    const h = harness({
      accessToken: GOOD_JWT,
      refreshToken: null,
      idToken: null,
      expiresAt: 1_800_000_000,
    })
    h.refresher.markRejected()
    h.refresher.markRejected()
    expect(h.onPermanentFailure).toHaveBeenCalledTimes(1)
  })

  it("stops bearers going out until reset()", async () => {
    const h = harness({
      accessToken: GOOD_JWT,
      refreshToken: null,
      idToken: null,
      expiresAt: 1_800_000_000,
    })
    h.refresher.markRejected()
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.getFreshCredentials).not.toHaveBeenCalled()
    h.refresher.reset()
    await expect(h.refresher.getToken()).resolves.toBe(GOOD_JWT)
  })
})

describe("buildUserTokenRefresher — guards that predate this change", () => {
  it("returns null without refreshing for an anonymous user", async () => {
    const h = harness({
      accessToken: GOOD_JWT,
      refreshToken: null,
      idToken: null,
      expiresAt: 1_800_000_000,
    })
    h.authStore.isAnonymous = true
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.getFreshCredentials).not.toHaveBeenCalled()
  })

  it("returns null without refreshing when there is no session at all", async () => {
    const h = harness({
      accessToken: GOOD_JWT,
      refreshToken: null,
      idToken: null,
      expiresAt: 1_800_000_000,
    })
    h.authStore.accessToken = undefined
    h.authStore.refreshToken = undefined
    await expect(h.refresher.getToken()).resolves.toBeNull()
    expect(h.getFreshCredentials).not.toHaveBeenCalled()
    expect(h.onPermanentFailure).not.toHaveBeenCalled()
  })
})
