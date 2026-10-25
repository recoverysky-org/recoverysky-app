/**
 * Credential headers for the Sky agent (`configStore.agentUrl`).
 *
 * PURE MODULE — no `@/` runtime imports (see CLAUDE.md "Test Runner Split").
 * The tokens come from the same refreshers the RecoverySky API's auth gate
 * uses; `Api.agentHeaders()` in services/api/index.ts fetches them.
 *
 * ADDED 2026-10-24. The agent checks the same two credentials as the
 * RecoverySky API: the device JWT from /attest (X-Device-Token, verified with
 * the shared DEVICE_JWT_SECRET) and the Auth0 bearer. AgentScreen used to send
 * only the bearer, so production ran the agent with device auth bypassed. The
 * X-API-Key fallback mirrors the auth gate's: simulators and dev builds have
 * no device JWT, and the agent refuses the key in production.
 */

export interface AgentCredentials {
  deviceJwt: string | null
  /** EXPO_PUBLIC_AUTH_KEY; "" in production builds */
  authKey: string
  accessToken: string | null
}

export function agentCredentialHeaders(c: AgentCredentials): Record<string, string> {
  const headers: Record<string, string> = {}
  if (c.deviceJwt) {
    headers["X-Device-Token"] = c.deviceJwt
  } else if (c.authKey) {
    headers["X-API-Key"] = c.authKey
  }
  if (c.accessToken) {
    headers["Authorization"] = `Bearer ${c.accessToken}`
  }
  return headers
}
