/**
 * Which identity, if any, the push token should be registered under.
 *
 * ADDED 2026-09-14. `POST /push-tokens/` is `authenticateSignedIn` on the
 * server, so only an Auth0 user can own a token. The app used to register
 * whenever `authStore.userIdentifier` was truthy — but that getter falls back
 * to the device id when signed out, and `loginAnonymously()` puts the device
 * id in `userId` too, so every signed-out or anonymous cold start (and every
 * sign-out, via the identity reaction) sent one request that was guaranteed
 * a 403. The edge counts 403s in both its probing and brute-force scenarios.
 *
 * CHANGED 2026-09-21 (RS-040): a signed-in id alone is not enough — see
 * `hasSession` below.
 *
 * Pure, no `@/` imports, so vitest can reach it (CLAUDE.md, "Test Runner
 * Split"). The I/O half is the reaction in app.tsx.
 */
export function pushRegistrationUserId(i: {
  userId: string | undefined
  isAnonymous: boolean
  /**
   * Whether the store holds an access or refresh token — the same predicate
   * as the user refresher's never-signed-in guard. ADDED 2026-09-21 (RS-040):
   * `userId` is MMKV and restores instantly; the tokens are SecureStore and
   * can be gone while the id survives (keychain loss). Registering then sends
   * `POST /push-tokens/` with no Bearer, and the user lane's code-less 401
   * used to cost the device JWT. Waiting for a session means the reaction in
   * app.tsx fires when tokens arrive, not when the id does.
   */
  hasSession: boolean
}): string | null {
  if (i.isAnonymous || !i.userId || !i.hasSession) return null
  return i.userId
}
