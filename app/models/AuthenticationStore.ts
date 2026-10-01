import { Instance, SnapshotOut, types } from "mobx-state-tree"

import { hashUserId, logger } from "@/utils/logger"

import { withSetPropAction } from "./helpers/withSetPropAction"

const log = logger.child({ module: "AuthStore" })

/** How the CURRENT session was established — drives the logout branch (spec 1 §2.4). */
export type LoginMethod = "email" | "apple" | "google"

/**
 * A session whose sub is not the device owner's. Held in memory only while
 * WrongAccountScreen is up; never persisted (spec 2 §2.1).
 */
export interface ForeignSession {
  sub: string
  email?: string
  idToken?: string
  /** undefined on a cold-start restore — consumers treat that as "browser possible". */
  loginMethod?: LoginMethod
}

export const AuthenticationStoreModel = types
  .model("AuthenticationStore")
  .props({
    /** User's email address */
    authEmail: "",
    /** User ID from OAuth provider (sub claim) or deviceId for anonymous users */
    userId: types.maybe(types.string),
    /** Unique device identifier, captured on app start */
    deviceId: types.maybe(types.string),
    /** Whether user is using anonymous login (no OAuth) */
    isAnonymous: types.optional(types.boolean, false),
    /**
     * ADDED 2026-09-17 (spec 1 §2.4). Written only when a session is ACCEPTED
     * by the ownership gate — a foreign session must not leave this behind.
     */
    loginMethod: types.maybe(
      types.enumeration<LoginMethod>("LoginMethod", ["email", "apple", "google"]),
    ),
    /**
     * ADDED 2026-09-17 (spec 2 §1). The one account that owns this device's
     * local data. Survives logout on purpose; cleared only by
     * resetLocalDatabase(). Proof method is derived from the prefix by
     * ownerProofMethod() — do not add a stored method field.
     */
    ownerSub: types.maybe(types.string),
    /** Owner's email at stamping time. Shown masked, only for the code path; login_hint otherwise. Never logged. */
    ownerEmail: types.maybe(types.string),
    /**
     * ADDED 2026-09-30 (spec 2 §7). Subs this device's owner had before their
     * identity was linked into the account `ownerSub` now names (a
     * `relinked` decision). Local rows and the sync outbox may still carry
     * them; rewriteOwnerUid() and the sync service's queue handover read this
     * list to move them to `ownerSub` instead of treating them as a stranger's.
     * Only ever appended from the signed ID token's identities claim, and
     * cleared with the owner record. Never logged raw.
     */
    previousOwnerSubs: types.optional(types.array(types.string), []),
  })
  .volatile(() => ({
    /** OAuth refresh token — persisted to SecureStore, never MMKV */
    refreshToken: undefined as string | undefined,
    /** OAuth access token — kept in memory only, never persisted */
    accessToken: undefined as string | undefined,
    /** OAuth ID token — kept in memory only */
    idToken: undefined as string | undefined,
    /** Timestamp (ms) when access token expires — kept in memory only */
    expiresAt: undefined as number | undefined,
    /** Whether auth initialization is complete (Auth0 session resolved) */
    authReady: false,
    /**
     * Set when a refresh failed permanently but an attendance timer is still
     * running. A forced logout swaps the tree at the AppNavigator level, ABOVE
     * MainNavigator's isTimerSessionActive() tab lock, so that lock does not
     * catch it — the timer modal would unmount and TimerSessionResumer only
     * fires once per mount, losing the meeting. We hold the eject until the
     * timer resolves instead. Not persisted: a cold start re-derives auth
     * state from scratch.
     */
    pendingLogout: false,
    /** See ForeignSession. Volatile: a cold start re-derives it from the SDK's restored session. */
    foreignSession: undefined as ForeignSession | undefined,
    /**
     * Raised by app.tsx's performForcedLogout() AFTER logout() so LoginScreen
     * can say why the user is looking at it. ADDED 2026-09-19 (RS-036): a
     * refresh that fails permanently (dead refresh token, DPoP key gone from
     * the Keychain, an unusable renewed token) ejected the user to Login with
     * no message at all — indistinguishable from never having signed in, and
     * the only trace was one ERROR line. LoginScreen reads this on mount and
     * clears it. Volatile: a cold start has nothing to explain.
     */
    forcedLogoutNotice: false,
  }))
  .views((store) => ({
    /**
     * Whether the user is authenticated.
     * Returns true for:
     * - Anonymous users (isAnonymous=true with deviceId)
     * - OAuth users (valid, non-expired access token)
     */
    get isAuthenticated() {
      // Anonymous users are authenticated
      if (store.isAnonymous && store.deviceId) return true
      // OAuth users need valid token
      if (!store.accessToken) return false
      if (store.expiresAt && store.expiresAt < Date.now()) return false
      return true
    },
    /**
     * Whether the access token has expired
     */
    get isTokenExpired() {
      if (!store.expiresAt) return true
      return store.expiresAt < Date.now()
    },
    /**
     * Whether we have a refresh token to obtain new access tokens
     */
    get canRefresh() {
      return !!store.refreshToken
    },
    /** The effective user identifier: Auth0 userId for registered users, deviceId for anonymous */
    get userIdentifier(): string | undefined {
      return store.userId ?? store.deviceId
    },
    /**
     * Email validation error (if any)
     */
    get validationError() {
      if (store.authEmail.length === 0) return "Email can't be blank"
      if (store.authEmail.length < 6) return "Email must be at least 6 characters"
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(store.authEmail))
        return "Must be a valid email address"
      return ""
    },
  }))
  .actions(withSetPropAction)
  .actions((store) => ({
    /**
     * Set all OAuth tokens at once
     */
    setTokens(accessToken: string, refreshToken?: string, idToken?: string, expiresAt?: number) {
      const expiresInSec = expiresAt ? Math.round((expiresAt - Date.now()) / 1000) : undefined
      log.info("setTokens()", {
        hasRefresh: !!refreshToken,
        hasIdToken: !!idToken,
        expiresInSec,
      })
      store.accessToken = accessToken
      store.refreshToken = refreshToken
      store.idToken = idToken
      store.expiresAt = expiresAt
    },
    /**
     * Clear all OAuth tokens
     */
    clearTokens() {
      log.info("clearTokens()")
      store.accessToken = undefined
      store.refreshToken = undefined
      store.idToken = undefined
      store.expiresAt = undefined
    },
    /**
     * Set user email
     */
    setAuthEmail(value: string) {
      log.debug("setAuthEmail()", { hasEmail: !!value })
      store.authEmail = value.replace(/ /g, "")
    },
    /**
     * Set user ID
     */
    setUserId(value?: string) {
      log.info("setUserId()", { hasUserId: !!value })
      store.userId = value
    },
    /**
     * Set device ID (captured on app start)
     */
    setDeviceId(id: string) {
      log.debug("setDeviceId()")
      store.deviceId = id
    },
    /**
     * Mark auth initialization as complete
     */
    setAuthReady() {
      store.authReady = true
    },
    /**
     * Defer a forced logout until a running attendance timer finishes.
     * See the pendingLogout volatile field for why this exists.
     */
    setPendingLogout(value: boolean) {
      log.info("setPendingLogout()", { value })
      store.pendingLogout = value
    },
    setLoginMethod(method?: LoginMethod) {
      log.debug("setLoginMethod()", { method })
      store.loginMethod = method
    },
    /** Stamp the device owner. Called only on an `adopt` decision (spec 2 §1.3). */
    setOwner(sub: string, email?: string) {
      log.info("setOwner()", { ownerId: hashUserId(sub) })
      store.ownerSub = sub
      store.ownerEmail = email
      // A new owner inherits nothing from the previous one's relinks.
      store.previousOwnerSubs.clear()
    },
    /**
     * ADDED 2026-09-30 (spec 2 §7): the owner's identity is now inside the
     * account `sub` names. Move the owner record there and remember the old
     * sub so its rows follow. Called only on a `relinked` decision.
     */
    relinkOwner(sub: string) {
      const previous = store.ownerSub
      log.info("relinkOwner()", { ownerId: hashUserId(sub), previousId: hashUserId(previous) })
      if (previous && previous !== sub && !store.previousOwnerSubs.includes(previous)) {
        store.previousOwnerSubs.push(previous)
      }
      store.ownerSub = sub
    },
    /**
     * Update only the address offered as "Send code to …" (ADDED 2026-09-30,
     * see ownerEmailAfterLogin). The owner's sub never changes here.
     */
    setOwnerEmail(email?: string) {
      log.debug("setOwnerEmail()", { hasEmail: !!email })
      store.ownerEmail = email
    },
    /** Only resetLocalDatabase() calls this — the record and the data are one unit. */
    clearOwner() {
      log.warn("clearOwner()")
      store.ownerSub = undefined
      store.ownerEmail = undefined
      store.previousOwnerSubs.clear()
    },
    setForeignSession(session: ForeignSession) {
      log.warn("setForeignSession()", {
        sessionId: hashUserId(session.sub),
        loginMethod: session.loginMethod,
      })
      store.foreignSession = session
    },
    clearForeignSession() {
      store.foreignSession = undefined
    },
    /** See the forcedLogoutNotice volatile field. */
    setForcedLogoutNotice(value: boolean) {
      store.forcedLogoutNotice = value
    },
    /**
     * Login as anonymous user
     * Uses deviceId as userId for tracking
     */
    loginAnonymously() {
      log.info("loginAnonymously()")
      store.isAnonymous = true
      store.userId = store.deviceId
    },
    /**
     * Logout - clear all auth state
     */
    logout() {
      log.info("logout()", { wasAnonymous: store.isAnonymous, hadUserId: !!store.userId })
      store.accessToken = undefined
      store.refreshToken = undefined
      store.idToken = undefined
      store.expiresAt = undefined
      store.authEmail = ""
      store.userId = undefined
      store.isAnonymous = false
      store.pendingLogout = false
      // ADDED 2026-09-17: the session's method goes with the session; the
      // owner record does NOT — it protects the data that stays on disk.
      store.loginMethod = undefined
      store.foreignSession = undefined
      // Note: deviceId is NOT cleared - it persists across sessions
    },
  }))

export interface AuthenticationStore extends Instance<typeof AuthenticationStoreModel> {}
export interface AuthenticationStoreSnapshot extends SnapshotOut<typeof AuthenticationStoreModel> {}
