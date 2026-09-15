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
 * Pure, no `@/` imports, so vitest can reach it (CLAUDE.md, "Test Runner
 * Split"). The I/O half is the reaction in app.tsx.
 */
export function pushRegistrationUserId(i: {
  userId: string | undefined
  isAnonymous: boolean
}): string | null {
  if (i.isAnonymous || !i.userId) return null
  return i.userId
}
