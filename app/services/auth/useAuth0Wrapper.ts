/**
 * useAuth0Wrapper Hook
 *
 * Custom hook that wraps Auth0's useAuth0 hook to:
 * - Sync auth state to MST AuthenticationStore for API layer compatibility
 * - Handle anonymous login (Auth0 doesn't support this natively)
 * - Extract SQLite encryption key from JWT claims if present
 * - Passwordless email code login (sendCode/verifyCode), direct-to-provider
 *   social login, and the device-ownership gate (spec 2 §2.1)
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth0, WebAuthError, WebAuthErrorCodes } from "react-native-auth0"

import { rewriteOwnerUid } from "@/db/rewriteOwnerUid"
import { translate } from "@/i18n"
import { useAuthenticationStore, useConfigStore, type LoginMethod } from "@/models"
import { setSqliteEncryptionKey, getCurrentSqliteKey } from "@/services/encryption/sqliteKey"
import { hashUserId, logger } from "@/utils/logger"

import { linkedSubsFromIdToken } from "./accountMethodsLogic"
import { AUTH0_CONFIG, type Auth0UserInfo } from "./auth0"
import { classifyAuthError, isUserAbandonedAuth } from "./authErrorLogic"
import {
  decodeJwtPayload,
  extractSqliteKeyFromClaims,
  isUsableAccessToken,
  type IdTokenClaims,
} from "./jwtUtils"
import { linkForeignIdentity } from "./linkForeignIdentity"
import { decideForeignLink, decideOwnership, ownerEmailAfterLogin } from "./ownerLogic"
import { saveAuthCredentials, clearAuthCredentials } from "./secureStorage"
import { reportUnusableToken } from "./unusableTokenHandler"

const log = logger.child({ module: "useAuth0Wrapper" })

/**
 * How the login that is currently in flight was started. Written by sendCode /
 * verifyCode / loginWithProvider before the SDK call, read by the sync effect
 * once the SDK sets `user`. NOT the store's persisted loginMethod: that is
 * written only for an ACCEPTED session, so a foreign session never leaves it
 * behind (spec 2 §2.1). Empty on a cold-start restore, which every consumer
 * treats as "browser possible".
 *
 * ADDED 2026-09-17. CHANGED 2026-09-18: module-scoped, not a per-instance
 * useRef. This hook has FIVE mount sites — AppStack (AppNavigator.tsx, bare),
 * LoginScreen, WrongAccountScreen, SettingsScreen and DevScreen — and each one
 * registers the [user] sync effect, so several run syncUserToStore on the same
 * login. At least two are live during any login: AppStack plus whichever of
 * LoginScreen / WrongAccountScreen is on screen. With a per-instance ref the
 * AppStack copy was always undefined, and because setForeignSession replaces
 * the whole object, whichever instance flushed last (usually AppStack, since
 * child effects flush first) wrote loginMethod: undefined over the real
 * value. An email-code foreign session then looked browser-possible and
 * abandonForeignSession opened a browser — plus the iOS system dialog — to
 * clear a cookie that never existed. One JS process and one SDK-talking module
 * make module scope the correct home for this. Deliberately NOT cleared inside
 * syncUserToStore (every mounted instance must read the same value); logout()
 * and abandonForeignSession() clear it instead.
 */
let pendingLoginMethod: LoginMethod | undefined

/**
 * The address typed for the code sign-in in flight — normalised, the same
 * string sendCode/verifyCode hand to the SDK. ADDED 2026-09-30: the ID token's
 * email is the linked account's PRIMARY address, which need not be the one the
 * user typed, and the Login screen offered that one back ("Send code to
 * m***@gmail.com" after signing in as jenova-marie@proton.me). See
 * ownerEmailAfterLogin. Module-scoped and cleared for the same reasons, and at
 * the same sites, as pendingLoginMethod above.
 */
let pendingLoginEmail: string | undefined

/**
 * Pick what the login screen shows for a failed auth call. Classified cases
 * get an i18n string; everything else keeps the SDK's message so the raw
 * diagnostic still reaches us via the "Auth error displayed to user" log line.
 * ADDED 2026-09-12 — see authErrorLogic.ts for the incident history.
 * CHANGED 2026-09-17: exported and extended with the passwordless outcomes
 * (spec 1 §2.5) so LoginScreen can map a thrown error the same way.
 */
export function authErrorMessage(err: unknown, fallback: string): string {
  switch (classifyAuthError(err)) {
    case "browserTerminated":
      return translate("loginScreen:errorBrowserTerminated")
    case "networkError":
    // The OTP grant is missing on the Auth0 application (runbook §3.2). The
    // user can do nothing about it; the error-level log below is for us.
    case "passwordlessNotEnabled":
      return translate("loginScreen:errorNetwork")
    case "wrongCode":
      return translate("loginScreen:errorWrongCode")
    case "codeExpired":
      return translate("loginScreen:errorCodeExpired")
    case "tooManyAttempts":
      return translate("loginScreen:errorTooManyAttempts")
    case "sendRateLimited":
      return translate("loginScreen:errorSendRateLimited")
    default:
      return (err instanceof Error && err.message) || fallback
  }
}

export type ProviderConnection = "apple" | "google-oauth2"

export interface ProviderLoginOptions {
  /** Prefills the provider's account chooser — the owner's stored email (spec 2 §2.3). */
  loginHint?: string
  /**
   * Clear Auth0's browser cookie before opening the provider. Required when a
   * foreign session arrived through the browser: otherwise the cookie hands
   * that same account straight back (spec 2 §2.3 "the cookie trap").
   */
  clearBrowserSessionFirst?: boolean
}

/**
 * Universal Login's password form for legacy `auth0|` accounts.
 *
 * ADDED 2026-09-30 as a DEV-only button for testing the "Link passwordless
 * identity" Action.
 * CHANGED 2026-10-01 (legacy email verification spec §7): now offered to
 * everyone as a small link on Login and on the wrong-account screen. A
 * password account whose email is a typo or a dead mailbox can never receive
 * a code, so the password is the only proof its owner has left. Once in, an
 * unverified account is taken to VerifyEmailGate to fix the address.
 */
export const PASSWORD_CONNECTION = "Username-Password-Authentication"

/** What loginWithProvider accepts: the real providers plus the legacy password form. */
export type BrowserConnection = ProviderConnection | typeof PASSWORD_CONNECTION

// The password form records NO loginMethod — there is no "password" member,
// and adding one to a persisted MST enum for the legacy password form isn't
// worth it. (CHANGED 2026-10-01: was "for a dev button"; the form is now
// offered in every build.)
// Undefined is correct where it matters: logout takes the clearSession()
// branch (anything but "email"), which this browser session needs, and
// Settings → Account derives the row from the `auth0|` sub ("Email").
const METHOD_FOR_CONNECTION: Record<BrowserConnection, LoginMethod | undefined> = {
  "apple": "apple",
  "google-oauth2": "google",
  [PASSWORD_CONNECTION]: undefined,
}

export interface UseAuth0WrapperOptions {
  /** Callback when SQLite encryption key from JWT differs from current key */
  onSqliteKeyChange?: (newKey: string) => Promise<void>
}

export interface UseAuth0WrapperResult {
  /** Email a six-digit code. Rejects with the raw SDK error (classify with classifyAuthError). */
  sendCode: (email: string) => Promise<void>
  /** Exchange the code for a session. Rejects with the raw SDK error. */
  verifyCode: (email: string, code: string) => Promise<void>
  /**
   * Browser login straight to Apple/Google — Universal Login never shows.
   * (PASSWORD_CONNECTION shows the legacy password form.)
   */
  loginWithProvider: (
    connection: BrowserConnection,
    options?: ProviderLoginOptions,
  ) => Promise<void>
  /** Cancel on WrongAccountScreen: drop the foreign session and return to Login. */
  abandonForeignSession: () => Promise<void>
  /** Login as anonymous user (no OAuth) */
  loginAnonymously: () => void
  /** Logout and clear all tokens */
  logout: () => Promise<void>
  /** Whether an auth operation is in progress */
  isLoading: boolean
  /** Error message if auth failed */
  error: string | null
  /** Clear the error state */
  clearError: () => void
  /** Auth0 user info (null if not authenticated) */
  user: Auth0UserInfo | null
  /** Whether user is authenticated via Auth0 */
  isAuthenticated: boolean
}

/**
 * Hook for Auth0 authentication with MST store integration
 */
export function useAuth0Wrapper(options: UseAuth0WrapperOptions = {}): UseAuth0WrapperResult {
  const { onSqliteKeyChange } = options
  const authStore = useAuthenticationStore()
  const _configStore = useConfigStore()
  const [error, setError] = useState<string | null>(null)

  // Auth0 SDK hook
  const {
    authorize,
    clearSession,
    clearCredentials,
    sendEmailCode,
    authorizeWithEmail,
    user,
    isLoading: auth0Loading,
    error: auth0Error,
    getCredentials,
    cancelWebAuth,
  } = useAuth0()

  // Track our own loading state for anonymous login
  const [localLoading, setLocalLoading] = useState(false)
  const isLoading = auth0Loading || localLoading

  // Guard: prevent user sync from re-populating MST during logout
  const isLoggingOut = useRef(false)

  // Sync Auth0 error to local state (ignore user-cancelled errors)
  // CHANGED 2026-09-19 (RS-022): "cancelled" now includes declining the
  // consent screen (ACCESS_DENIED / "User did not authorize the request"),
  // which was reaching the ERROR line below twice per tap. See
  // isUserAbandonedAuth.
  useEffect(() => {
    if (auth0Error) {
      if (isUserAbandonedAuth(auth0Error)) {
        log.info("Auth0 operation cancelled or declined by user")
        return
      }
      log.error("Auth0 error", { error: auth0Error.message })
      // ADDED 2026-09-17: a missing OTP grant is a tenant misconfiguration, not
      // a user error — the user sees the generic network copy, we get this.
      if (classifyAuthError(auth0Error) === "passwordlessNotEnabled") {
        log.error("Passwordless OTP grant missing on the Auth0 application — see spec 1 §3.2")
      }
      // CHANGED 2026-09-12: route through authErrorMessage so BROWSER_TERMINATED
      // and network failures get the actionable copy instead of the raw SDK text.
      setError(authErrorMessage(auth0Error, "Authentication failed"))
    }
  }, [auth0Error])

  // Sync Auth0 user state to MST store
  // Note: We intentionally only depend on `user` - other deps are stable refs
  useEffect(() => {
    const syncUserToStore = async () => {
      if (isLoggingOut.current) return
      if (user) {
        // Hashed, not raw: these two lines were the only place the unhashed
        // Auth0 sub reached Loki. CHANGED 2026-09-04: every record now carries
        // the same hash via logger context (see hashUserId.ts), so logging it
        // here is belt-and-braces for the sign-in moment itself.
        log.info("Syncing Auth0 user to MST store", { userId: hashUserId(user.sub) })

        try {
          // Get credentials (tokens) from Auth0
          const credentials = await getCredentials()

          if (credentials) {
            // ADDED 2026-09-10: the SDK renews with the stored refresh token,
            // and a refresh token from an audience-less login (TestFlight
            // builds 3.12.1–4.1.6 shipped without EXPO_PUBLIC_AUTH0_AUDIENCE)
            // renews into an opaque token the API can never accept. Do not
            // store it; eject through the same path as a dead refresh token.
            // setAuthReady() still runs so the splash never waits on a session
            // that is being torn down — forced logout flips isAuthenticated
            // and routes to Login on its own.
            const check = isUsableAccessToken(credentials.accessToken, {
              audience: AUTH0_CONFIG.audience,
            })
            if (!check.ok) {
              const handled = reportUnusableToken(check.reason)
              log.error("Auth0 SDK returned unusable access token — signing out", {
                source: "sdk-sync",
                reason: check.reason,
                tokenLength: credentials.accessToken.length,
                tokenSegments: credentials.accessToken.split(".").length,
                handled,
              })
              authStore.setAuthReady()
              return
            }

            // ADDED 2026-09-17 (spec 2 §2.1): one device, one owner. A session
            // for any other account writes NOTHING below — no tokens, no
            // userId, no SecureStore copy — so isAuthenticated stays false and
            // every identity-driven reaction (sync outbox handover, RevenueCat,
            // push registration, logger/Sentry identity) never sees it. The SDK
            // has already saved these credentials in its own keychain entry;
            // a cold start restores them, hits this gate again, and shows the
            // same screen. That is intended.
            const decision = decideOwnership({
              ownerSub: authStore.ownerSub,
              sessionSub: user.sub,
              // CHANGED 2026-09-18: hardcoded false, not authStore.isAnonymous.
              // Auth0 never issues an anonymous session — reaching this line at
              // all means a real account signed in. The store flag describes
              // the PREVIOUS session (anonymous mode is our own local concept),
              // and decideOwnership returns "match" for an anonymous one, so
              // passing it here let any account through on a device whose flag
              // had not been reset yet.
              isAnonymous: false,
              // ADDED 2026-09-30 (spec 2 §7): lets the gate recognise an owner
              // whose identity was linked into this account from another device.
              linkedSubs: linkedSubsFromIdToken(credentials.idToken ?? undefined),
            })
            if (decision === "mismatch") {
              // CHANGED 2026-09-18: setForeignSession replaces the whole
              // object, and the second mounted instance of this hook runs the
              // same effect (see pendingLoginMethod above). Carry a method we
              // already recorded for THIS sub rather than regressing it to
              // undefined. A cold-start restore has neither and yields
              // undefined, which is correct — treat it as browser-possible.
              const carried =
                authStore.foreignSession?.sub === user.sub
                  ? authStore.foreignSession.loginMethod
                  : undefined
              authStore.setForeignSession({
                sub: user.sub,
                email: user.email,
                idToken: credentials.idToken ?? undefined,
                loginMethod: pendingLoginMethod ?? carried,
              })
              // The splash must never wait on a session we are refusing.
              authStore.setAuthReady()
              log.warn("Foreign session on an owned device", {
                ownerId: hashUserId(authStore.ownerSub),
                sessionId: hashUserId(user.sub),
                loginMethod: authStore.foreignSession?.loginMethod ?? "unknown",
              })
              return
            }
            // CHANGED 2026-09-30: the owner email is the address the user
            // typed for a code sign-in, not the token's (a linked account's
            // primary) — see ownerEmailAfterLogin. It is also refreshed on the
            // owner's later code sign-ins, so the Login screen offers the last
            // address actually used.
            const ownerEmail = ownerEmailAfterLogin({
              decision,
              loginMethod: pendingLoginMethod,
              typedEmail: pendingLoginEmail,
              tokenEmail: user.email,
              currentOwnerEmail: authStore.ownerEmail,
            })
            if (decision === "adopt") {
              authStore.setOwner(user.sub, ownerEmail)
              log.info("Device owner adopted", { ownerId: hashUserId(user.sub) })
            } else {
              if (decision === "relinked") {
                // ADDED 2026-09-30 (spec 2 §7). Order matters, and every step is
                // safe to repeat after a crash: move the local rows first (when
                // the database is open — OwnerRelinkMigrator covers the rest on
                // the next open), then the owner record, and only after that
                // setUserId() below, whose sync reaction reads the owner's
                // previous subs to hand the outbox over instead of clearing it.
                const previousSub = authStore.ownerSub
                if (previousSub) {
                  try {
                    rewriteOwnerUid([previousSub, ...authStore.previousOwnerSubs], user.sub)
                  } catch (err) {
                    log.error("Relinked owner: row rewrite failed; retried on next open", {
                      error: String(err),
                    })
                  }
                }
                authStore.relinkOwner(user.sub)
                log.info("Device owner relinked into a linked account", {
                  ownerId: hashUserId(user.sub),
                  previousId: hashUserId(previousSub),
                })
              }
              if (ownerEmail !== authStore.ownerEmail) authStore.setOwnerEmail(ownerEmail)
            }

            // Auth0 SDK returns expiresAt as UNIX timestamp (seconds)
            // Convert to milliseconds for JavaScript Date compatibility
            const expiresAt = credentials.expiresAt * 1000

            // ADDED 2026-10-01 (legacy email verification spec §3): keep the
            // ID token's `email_verified` claim for VerifyEmailGate. Written
            // BEFORE setTokens so the gate never sees an authenticated session
            // with last session's value. Only `=== true` counts as verified.
            authStore.setEmailVerified(
              credentials.idToken
                ? decodeJwtPayload<IdTokenClaims>(credentials.idToken)?.email_verified === true
                : undefined,
            )

            // Update MST store with tokens
            // Auth0 SDK may return null for optional fields; coerce to undefined for MST
            authStore.setTokens(
              credentials.accessToken,
              credentials.refreshToken ?? undefined,
              credentials.idToken ?? undefined,
              expiresAt,
            )

            // Clear anonymous flag for OAuth users
            authStore.setProp("isAnonymous", false)

            // Set user info
            authStore.setUserId(user.sub)

            // ADDED 2026-09-17: accepted session — record how it was started
            // (drives the logout branch). Falls back to the persisted value on
            // a cold-start restore, where nothing is in flight.
            // CHANGED 2026-09-18: pendingLoginMethod is NOT cleared here — the
            // other mounted instance's copy of this effect still has to read it.
            // logout() and abandonForeignSession() own the clearing.
            authStore.setLoginMethod(pendingLoginMethod ?? authStore.loginMethod)

            if (user.email) {
              authStore.setAuthEmail(user.email)
            }

            // Persist credentials to SecureStore for instant restore on next cold start.
            // CHANGED 2026-09-14: the ID token is deliberately left out — it is
            // only needed right here (handleSqliteKeyFromJwt below) and its
            // size pushed the record past SecureStore's 2048-byte limit.
            saveAuthCredentials({
              accessToken: credentials.accessToken,
              refreshToken: credentials.refreshToken ?? undefined,
              expiresAt,
            }).catch((err) =>
              log.error("Failed to persist auth credentials", { error: String(err) }),
            )

            // Auth initialization complete — credentials are now in MST
            authStore.setAuthReady()

            // Check for SQLite encryption key in JWT claims
            if (credentials.idToken) {
              await handleSqliteKeyFromJwt(credentials.idToken)
            }

            log.info("Auth state synced to MST store", { userId: hashUserId(user.sub) })

            // ADDED 2026-09-17 (spec 2 §2.5): the owner just signed back in
            // over a foreign session. Link that identity into the owner's
            // account so the same wrong tap next time resolves to the owner.
            // Fire-and-forget; the token lives only in memory and a failure
            // just means the next mismatch retries with a fresh one.
            // CHANGED 2026-09-18: the clear is now unconditional whenever a
            // foreign record exists. It used to be gated on the sub comparison
            // too, which left the record — and its ID token — held in memory
            // in the one case where the accepted session IS the recorded one.
            // Only the link call needs the comparison: linking an identity to
            // itself is meaningless.
            //
            // CHANGED 2026-09-30: linked only when the foreign address is the
            // owner account's own email (decideForeignLink). A different
            // address, once linked, can never sign in again — Auth0 finds
            // email-code users by the root account's email — so each later
            // code login made a fresh orphan user and the device looped back
            // to WrongAccountScreen. The screen's job is "sign into your
            // original account"; the user is told nothing, the skip is logged.
            const foreign = authStore.foreignSession
            if (foreign) {
              authStore.clearForeignSession()
              const decision = decideForeignLink({
                foreignSub: foreign.sub,
                foreignEmail: foreign.email,
                acceptedSub: user.sub,
                acceptedEmail: user.email,
              })
              if (decision === "same-session") {
                log.info("Accepted session matches the recorded foreign one — record dropped")
              } else if (decision === "skip-email-mismatch") {
                // Never the addresses or subs: hashes and the provider only.
                log.info("Foreign identity not linked — address differs from the account's", {
                  foreignId: hashUserId(foreign.sub),
                  foreignProvider: foreign.sub.split("|")[0],
                })
              } else if (foreign.idToken) {
                void linkForeignIdentity(foreign.idToken)
              } else {
                log.warn("Foreign session had no ID token — nothing to link")
              }
            }
          }
        } catch (err) {
          log.error("Failed to sync credentials to store", { error: String(err) })
        }
      }
    }

    syncUserToStore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // When Auth0 SDK finishes loading: if no user, auth is resolved (no session to restore)
  useEffect(() => {
    if (!auth0Loading && !user && !isLoggingOut.current && !authStore.authReady) {
      log.info("Auth0 resolved without user, auth ready")
      authStore.setAuthReady()
      clearAuthCredentials().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth0Loading, user])

  /**
   * Extract SQLite key from JWT claims and handle rekey if needed
   */
  const handleSqliteKeyFromJwt = async (idToken: string) => {
    try {
      const claims = decodeJwtPayload<IdTokenClaims>(idToken)
      if (claims) {
        const jwtSqliteKey = extractSqliteKeyFromClaims(claims)
        if (jwtSqliteKey) {
          const currentKey = await getCurrentSqliteKey()
          if (currentKey !== jwtSqliteKey) {
            log.info("SQLite key from JWT differs from current key, triggering rekey")
            if (onSqliteKeyChange) {
              await onSqliteKeyChange(jwtSqliteKey)
            } else {
              // Fallback: just save the key (requires app restart for rekey)
              await setSqliteEncryptionKey(jwtSqliteKey)
            }
          } else {
            log.debug("SQLite key from JWT matches current key")
          }
        }
      }
    } catch (err) {
      log.error("Failed to extract SQLite key from JWT", { error: String(err) })
    }
  }

  /**
   * Email a six-digit code. Any address is accepted — passwordless creates the
   * account on first use — so there is no "no account" outcome to surface.
   * ADDED 2026-09-17 (spec 1 §2.2), replacing the Universal Login login().
   */
  const sendCode = useCallback(
    async (email: string) => {
      log.info("Sending passwordless code")
      setError(null)
      setLocalLoading(true)
      try {
        await sendEmailCode({ email: email.trim().toLowerCase(), send: "code" })
        pendingLoginMethod = "email"
        pendingLoginEmail = email.trim().toLowerCase()
      } finally {
        setLocalLoading(false)
      }
    },
    [sendEmailCode],
  )

  /**
   * Exchange the code for a session. The SDK saves the credentials and sets
   * `user`; the sync effect above does the rest, exactly as for a browser login.
   */
  const verifyCode = useCallback(
    async (email: string, code: string) => {
      log.info("Verifying passwordless code")
      setError(null)
      setLocalLoading(true)
      pendingLoginMethod = "email"
      pendingLoginEmail = email.trim().toLowerCase()
      try {
        await authorizeWithEmail({
          email: email.trim().toLowerCase(),
          code: code.trim(),
          // LOAD-BEARING (spec 1 §2.2): without the audience Auth0 issues an
          // opaque token, isUsableAccessToken() rejects it, and the user is
          // signed out one tick after signing in. offline_access in the scope
          // string is what yields the refresh token.
          audience: AUTH0_CONFIG.audience,
          scope: AUTH0_CONFIG.scopes.join(" "),
        })
      } catch (err) {
        pendingLoginMethod = undefined
        pendingLoginEmail = undefined
        throw err
      } finally {
        setLocalLoading(false)
      }
    },
    [authorizeWithEmail],
  )

  /**
   * Browser login pointed straight at Apple or Google. Cancel, browser-
   * terminated and network handling are exactly the old login()'s.
   * ADDED 2026-09-17: `connection` is what skips Universal Login's own
   * account picker (spec 1 §2.3).
   */
  const loginWithProvider = useCallback(
    async (connection: BrowserConnection, options: ProviderLoginOptions = {}) => {
      log.info("Starting provider login", {
        connection,
        clearFirst: !!options.clearBrowserSessionFirst,
      })
      setError(null)
      pendingLoginMethod = METHOD_FOR_CONNECTION[connection]
      pendingLoginEmail = undefined

      try {
        // Cancel any stale/interrupted login transactions (iOS only)
        try {
          await cancelWebAuth()
        } catch {
          // Ignore - cancelWebAuth may fail if no transaction exists
        }

        if (options.clearBrowserSessionFirst) {
          try {
            await clearSession({}, { customScheme: AUTH0_CONFIG.customScheme })
          } catch (err) {
            // The iOS "Sign In" dialog was dismissed. Proceed anyway: worst
            // case the cookie is still there and the provider returns the
            // foreign account, which lands on the same screen again.
            if (!(err instanceof WebAuthError && err.type === WebAuthErrorCodes.USER_CANCELLED)) {
              throw err
            }
            log.info("Browser session clear cancelled by user — proceeding")
          }
        }

        await authorize(
          {
            scope: AUTH0_CONFIG.scopes.join(" "),
            audience: AUTH0_CONFIG.audience,
            connection,
            additionalParameters: options.loginHint ? { login_hint: options.loginHint } : undefined,
          },
          { customScheme: AUTH0_CONFIG.customScheme },
        )
        log.info("Provider login flow completed", { connection })
      } catch (err) {
        pendingLoginMethod = undefined
        pendingLoginEmail = undefined
        // CHANGED 2026-09-19 (RS-022): also covers a declined consent screen.
        if (isUserAbandonedAuth(err)) {
          log.info("Provider login cancelled or declined by user")
          return
        }
        const message = err instanceof Error ? err.message : "Login failed"
        // CHANGED 2026-09-12: the log keeps the raw SDK message; the user sees
        // the friendlier mapped copy when we have one (see authErrorMessage).
        log.error("Provider login failed", { connection, error: message })
        setError(authErrorMessage(err, message))
      }
    },
    [authorize, clearSession, cancelWebAuth],
  )

  /**
   * Cancel on WrongAccountScreen (spec 2 §2.4). Drops the SDK's stored
   * credentials for the foreign session and, when it arrived through the
   * browser (or we cannot tell), Auth0's cookie too — otherwise the next
   * provider tap silently returns the same wrong account.
   *
   * Deliberately does NOT touch the owner record or any local data: the
   * foreign session never owned anything on this device.
   */
  const abandonForeignSession = useCallback(async () => {
    const foreign = authStore.foreignSession
    log.info("Abandoning foreign session", { loginMethod: foreign?.loginMethod ?? "unknown" })
    // Same guard as logout: the SDK clearing `user` must not re-enter the
    // sync effect while we are tearing the session down.
    isLoggingOut.current = true
    let sdkCredentialsCleared = true
    try {
      if (foreign?.loginMethod !== "email") {
        try {
          await clearSession({}, { customScheme: AUTH0_CONFIG.customScheme })
        } catch (err) {
          if (!(err instanceof WebAuthError && err.type === WebAuthErrorCodes.USER_CANCELLED)) {
            log.warn("Browser session clear failed — clearing credentials only", {
              error: String(err),
            })
          }
        }
      }
      await clearCredentials().catch((err) => {
        sdkCredentialsCleared = false
        log.error("Failed to clear SDK credentials", { error: String(err) })
      })
    } finally {
      // We drop our foreign record even when the SDK refused to drop its own.
      // The alternative — keeping the record so the two stay in step — strands
      // the user on WrongAccountScreen with a Cancel button that does nothing.
      // ADDED 2026-09-18: say so in the log, because the mismatched state is
      // real until the next cold start re-runs the gate over the SDK's
      // surviving session and rebuilds the record.
      if (!sdkCredentialsCleared) {
        log.warn(
          "Foreign record dropped while the SDK session survived — self-heals on next cold start",
        )
      }
      authStore.clearForeignSession()
      // Nothing is in flight any more; a later cold-start restore must read
      // undefined here (see pendingLoginMethod).
      pendingLoginMethod = undefined
      pendingLoginEmail = undefined
      isLoggingOut.current = false
    }
  }, [authStore, clearSession, clearCredentials])

  /**
   * Login as anonymous user (no OAuth required)
   */
  const loginAnonymously = useCallback(() => {
    log.info("Anonymous login")
    setLocalLoading(true)
    setError(null)

    try {
      authStore.loginAnonymously()
      log.info("Anonymous login complete")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Anonymous login failed"
      log.error("Anonymous login failed", { error: message })
      setError(message)
    } finally {
      setLocalLoading(false)
    }
  }, [authStore])

  /**
   * Logout and clear all tokens.
   *
   * Uses clearSession to revoke the Auth0 web session (prevents auto-login
   * on next sign-in). iOS shows a system "Sign In" dialog for this — if the
   * user cancels it, the logout is aborted gracefully.
   */
  const logout = useCallback(async () => {
    log.info("Logging out")
    setError(null)
    isLoggingOut.current = true

    try {
      // Clear Auth0 web session (requires browser redirect)
      if (user && !authStore.isAnonymous) {
        // CHANGED 2026-09-17 (spec 1 §2.4): an email-code session never
        // created a browser session, so there is no Auth0 cookie to clear.
        // clearSession() would open a browser for nothing and, on iOS, show
        // the system dialog. Social sessions keep the browser logout.
        if (authStore.loginMethod === "email") {
          await clearCredentials()
          log.info("Email session credentials cleared")
        } else {
          await clearSession({}, { customScheme: AUTH0_CONFIG.customScheme })
          log.info("Auth0 session cleared")
        }
      }

      // Clear MST store and SecureStore
      authStore.logout()
      clearAuthCredentials().catch((err) =>
        log.error("Failed to clear auth credentials", { error: String(err) }),
      )
      log.info("Logout complete")
    } catch (err) {
      // User cancelled the iOS browser dialog — abort logout
      if (err instanceof WebAuthError && err.type === WebAuthErrorCodes.USER_CANCELLED) {
        log.info("Logout cancelled by user")
        return
      }

      const message = err instanceof Error ? err.message : "Logout failed"
      log.error("Logout failed", { error: message })
      // Still clear local state on unexpected errors
      authStore.logout()
      clearAuthCredentials().catch(() => {})
    } finally {
      // ADDED 2026-09-18: nothing is in flight after a logout attempt, so the
      // next session must not inherit this one's method (see
      // pendingLoginMethod). Safe on the user-cancelled path too: that path
      // leaves authStore.loginMethod intact, which is what the logout branch
      // actually reads.
      pendingLoginMethod = undefined
      pendingLoginEmail = undefined
      isLoggingOut.current = false
    }
  }, [user, authStore, clearSession, clearCredentials])

  /**
   * Clear the error state
   */
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    sendCode,
    verifyCode,
    loginWithProvider,
    abandonForeignSession,
    loginAnonymously,
    logout,
    isLoading,
    error,
    clearError,
    user: user as Auth0UserInfo | null,
    isAuthenticated: !!user,
  }
}

/**
 * Load stored auth state on app startup
 *
 * Auth0 SDK handles token persistence internally, so this is mainly for
 * syncing to MST store. Call this from app initialization.
 */
export async function loadStoredAuth0(
  authStore: ReturnType<typeof useAuthenticationStore>,
): Promise<boolean> {
  log.info("loadStoredAuth0() - Auth0 SDK handles token persistence internally")

  // Auth0 SDK automatically restores session on mount
  // This function is kept for API compatibility but doesn't need to do much
  // The useAuth0Wrapper hook will sync state when user becomes available

  // Check if we have a deviceId for anonymous users
  if (authStore.isAnonymous && authStore.deviceId) {
    log.info("Anonymous user session restored")
    return true
  }

  return false
}
