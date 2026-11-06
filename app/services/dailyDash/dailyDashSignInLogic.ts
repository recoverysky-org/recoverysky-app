// Pure decisions for the Daily Dash SignIn adapter (spec §4.3). No runtime `@/`
// imports so vitest can load it; the I/O half is dailyDashSignIn.ts.
// ADDED 2026-11-04: RecoverySky already holds the person's Auth0 tokens, so the
// adapter hands them to the Daily Dash client instead of opening a browser.

export interface HeldTokens {
  accessToken: string | undefined
  idToken: string | undefined
}

export type SignInDecision =
  | { kind: "ok"; accessToken: string; idToken: string }
  | { kind: "renew" }
  | {
      kind: "unauthorized"
      reason: "no_access_token" | "unusable_access_token" | "no_id_token"
    }

/**
 * Decide what a sign-in request does with the tokens the app holds.
 * - No access token means the app itself is signed out: never renew, since a
 *   renewal would try to sign someone in behind the app's back.
 * - An unusable (opaque / wrong-audience) access token is refused as-is.
 * - A missing ID token (volatile; a cold start can lack it) earns exactly ONE
 *   renewal (`renewed` is true on the second ask), then a refusal.
 */
export function decideDailyDashSignIn(
  held: HeldTokens,
  usable: (accessToken: string) => boolean,
  renewed: boolean,
): SignInDecision {
  if (!held.accessToken) return { kind: "unauthorized", reason: "no_access_token" }
  if (!usable(held.accessToken)) return { kind: "unauthorized", reason: "unusable_access_token" }
  if (!held.idToken) {
    return renewed ? { kind: "unauthorized", reason: "no_id_token" } : { kind: "renew" }
  }
  return { kind: "ok", accessToken: held.accessToken, idToken: held.idToken }
}

/** The app's login method as the client names it; none recorded means "hosted". */
export function dailyDashLoginMethod(
  m: "email" | "apple" | "google" | undefined,
): "email" | "apple" | "google" | "hosted" {
  return m ?? "hosted"
}
