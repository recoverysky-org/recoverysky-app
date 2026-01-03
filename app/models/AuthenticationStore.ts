import { Instance, SnapshotOut, types } from "mobx-state-tree"

import { logger } from "@/utils/logger"

import { withSetPropAction } from "./helpers/withSetPropAction"

const log = logger.child({ module: "AuthStore" })

export const AuthenticationStoreModel = types
  .model("AuthenticationStore")
  .props({
    /** OAuth access token */
    accessToken: types.maybe(types.string),
    /** OAuth refresh token for obtaining new access tokens */
    refreshToken: types.maybe(types.string),
    /** OAuth ID token containing user identity claims */
    idToken: types.maybe(types.string),
    /** Timestamp (ms) when access token expires */
    expiresAt: types.maybe(types.number),
    /** User's email address */
    authEmail: "",
    /** User ID from OAuth provider (sub claim) or deviceId for anonymous users */
    userId: types.maybe(types.string),
    /** Unique device identifier, captured on app start */
    deviceId: types.maybe(types.string),
    /** Whether user is using anonymous login (no OAuth) */
    isAnonymous: types.optional(types.boolean, false),
  })
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
      log.debug("setDeviceId()", { deviceId: id.slice(0, 8) + "..." })
      store.deviceId = id
    },
    /**
     * Login as anonymous user
     * Uses deviceId as userId for tracking
     */
    loginAnonymously() {
      log.info("loginAnonymously()", { deviceId: store.deviceId?.slice(0, 8) + "..." })
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
      // Note: deviceId is NOT cleared - it persists across sessions
    },
  }))

export interface AuthenticationStore extends Instance<typeof AuthenticationStoreModel> {}
export interface AuthenticationStoreSnapshot extends SnapshotOut<typeof AuthenticationStoreModel> {}
