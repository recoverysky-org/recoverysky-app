/**
 * Non-React access to the Auth0 credentials manager.
 *
 * react-native-auth0 v5 exports a standalone `Auth0` class whose
 * credentialsManager is backed by the SAME Keychain/Keystore entry the
 * `useAuth0` hook uses — so a refresh performed here is immediately visible to
 * the hook, and vice versa. That is what lets the API layer refresh tokens
 * without lifting anything out of React.
 *
 * getCredentials() auto-renews with the stored refresh token when the access
 * token is expired or has less than `minTtl` seconds left. We request
 * `offline_access` (see auth0.ts) so the refresh token exists; before
 * 2026-08-06 it was persisted and never once used.
 */

import Auth0 from "react-native-auth0"

import { AUTH0_CONFIG } from "./auth0"

let client: Auth0 | null = null

/** Lazily construct the client — module load must not touch native modules. */
function getAuth0Client(): Auth0 {
  if (!client) {
    client = new Auth0({
      domain: AUTH0_CONFIG.domain,
      clientId: AUTH0_CONFIG.clientId,
    })
  }
  return client
}

/**
 * Stored credentials, refreshed if they expire within `minTtlSec` seconds.
 * Throws CredentialsManagerError — classify it with classifyRefreshError().
 */
export async function getFreshCredentials(minTtlSec: number) {
  return getAuth0Client().credentialsManager.getCredentials(undefined, minTtlSec)
}

/**
 * Renew the stored credentials NOW, whatever their remaining lifetime
 * (ADDED 2026-10-01, legacy email verification). Used after the API changed
 * or verified the account's email: the cached ID token still carries the old
 * address and `email_verified: false`, and a cold start would restore it.
 *
 * Same scope and parameters as getFreshCredentials (none: the refresh token
 * is bound to the login's audience, so the renewed access token keeps it).
 * Deliberately on this standalone client, not the hook's getCredentials: the
 * hook dispatches ERROR into the provider on failure, which every mounted
 * useAuth0Wrapper logs at error level and a later Login screen would show.
 * Both clients share the one native credentials manager, which serialises
 * renewals, so this cannot race the user-token refresher on the refresh token.
 * Throws CredentialsManagerError.
 */
export async function renewStoredCredentials() {
  return getAuth0Client().credentialsManager.getCredentials(undefined, undefined, undefined, true)
}

/**
 * Drop the SDK's own stored credentials.
 *
 * Required on forced logout IN ADDITION to clearAuthCredentials(): that only
 * clears our SecureStore copy, and leaving the SDK's keychain entry intact lets
 * the next useAuth0Wrapper sync re-hydrate the dead session.
 */
export async function clearStoredCredentials(): Promise<void> {
  await getAuth0Client().credentialsManager.clearCredentials()
}
