import { Instance, SnapshotOut, types } from "mobx-state-tree"

import { logger } from "@/utils/logger"

import { withSetPropAction } from "./helpers/withSetPropAction"

const log = logger.child({ module: "AuthStore" })

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
      // Note: deviceId is NOT cleared - it persists across sessions
    },
  }))

export interface AuthenticationStore extends Instance<typeof AuthenticationStoreModel> {}
export interface AuthenticationStoreSnapshot extends SnapshotOut<typeof AuthenticationStoreModel> {}
