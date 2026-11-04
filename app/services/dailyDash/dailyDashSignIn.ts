import { err, internal, ok, unauthorized } from "@daily-dash/client"
import type { Auth0Result, SignIn } from "@daily-dash/client"

import { isUsableAccessToken } from "@/services/auth/jwtUtils"

import { dailyDashLoginMethod, decideDailyDashSignIn } from "./dailyDashSignInLogic"
import type { HeldTokens } from "./dailyDashSignInLogic"

/**
 * Everything the adapter needs from the app, injected by app.tsx so this folder
 * never imports `@/models` (and stays testable). ADDED 2026-11-04.
 */
export interface DailyDashSignInDeps {
  held(): HeldTokens
  loginMethod(): "email" | "apple" | "google" | undefined
  audience: string
  renew(): Promise<{ accessToken: string; idToken?: string | null } | null>
  getUserToken(): Promise<string | null>
}

export function createDailyDashSignIn(deps: DailyDashSignInDeps): SignIn {
  const usable = (token: string) => isUsableAccessToken(token, { audience: deps.audience }).ok

  return {
    inAppEmailCode: false,

    sendEmailCode: async () => err(internal("RecoverySky signs in elsewhere")),
    signInWithEmailCode: async () => err(internal("RecoverySky signs in elsewhere")),

    // `connection` is ignored on purpose (spec D10): the app signed the person
    // in already, so there is no provider to pick; we hand over what we hold.
    signInWithProvider: async () => {
      let held = deps.held()
      let decision = decideDailyDashSignIn(held, usable, false)
      if (decision.kind === "renew") {
        // At most one renewal per request (the logic refuses a second).
        const renewed = await deps.renew()
        held = {
          accessToken: renewed?.accessToken ?? held.accessToken,
          idToken: renewed?.idToken ?? undefined,
        }
        decision = decideDailyDashSignIn(held, usable, true)
      }
      if (decision.kind === "ok") {
        const result: Auth0Result = {
          accessToken: decision.accessToken,
          idToken: decision.idToken,
          method: dailyDashLoginMethod(deps.loginMethod()),
          product: "recoverysky",
        }
        return ok(result)
      }
      const reason = decision.kind === "unauthorized" ? decision.reason : "no_id_token"
      return err(unauthorized("Sign in to RecoverySky first", { code: reason }))
    },

    completeRedirect: async () => ok(null),

    // A no-op by design (spec D8): the Auth0 session is the app's, so a Daily
    // Dash sign-out must never end it. Our own logout never calls this either.
    signOutProvider: async () => {},

    providerToken: async (options) => {
      const token = options?.fresh ? (await deps.renew())?.accessToken : await deps.getUserToken()
      if (!token) return err(unauthorized("Sign in again", { code: "provider_token_unavailable" }))
      return ok(token)
    },
  }
}
