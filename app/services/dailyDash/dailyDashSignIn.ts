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
        // ADDED 2026-11-04: the client's SignIn contract says "No method throws"
        // (session/types.d.ts:46), and Auth0 credential calls do reject. A
        // rejection is treated as a null renewal, so the second decision yields
        // unauthorized/no_id_token. The caught error is dropped, never logged
        // or put in details/cause (it can carry request context).
        const renewed = await deps.renew().catch(() => null)
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
      // ADDED 2026-11-04: "No method throws" (session/types.d.ts:46). A rejected
      // renew/getUserToken maps to the same refusal as a missing token; the
      // caught error is discarded so nothing of it reaches details or a log.
      const token = await (
        options?.fresh ? deps.renew().then((r) => r?.accessToken) : deps.getUserToken()
      ).catch(() => null)
      if (!token) return err(unauthorized("Sign in again", { code: "provider_token_unavailable" }))
      return ok(token)
    },
  }
}
