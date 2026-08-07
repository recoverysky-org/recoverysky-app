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
 * Drop the SDK's own stored credentials.
 *
 * Required on forced logout IN ADDITION to clearAuthCredentials(): that only
 * clears our SecureStore copy, and leaving the SDK's keychain entry intact lets
 * the next useAuth0Wrapper sync re-hydrate the dead session.
 */
export async function clearStoredCredentials(): Promise<void> {
  await getAuth0Client().credentialsManager.clearCredentials()
}
