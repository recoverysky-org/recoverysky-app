/**
 * Auth0 post-login Action: "Identities claim".
 *
 * Adds `https://recoverysky.app/identities` to the ID token — one
 * `{ provider, email }` per identity on the account, the primary included —
 * so Settings → Account can show the sign-in methods linked into this
 * account. The app reads it in app/services/auth/accountMethodsLogic.ts;
 * the namespace string must match IDENTITIES_CLAIM there.
 *
 * Why a claim: after a link Auth0 issues the PRIMARY's sub and profile for
 * every identity, so nothing else in the token says which other identities
 * exist, and the app has no Management API access of its own.
 *
 * ID token only, never the access token: the email addresses are for the
 * signed-in user's own device, not for every API the access token reaches.
 *
 * Email source: the primary identity has no `profileData` (its profile IS
 * the root user), so its email is `event.user.email`; secondaries carry
 * theirs in `profileData.email`. Providers that give none produce an entry
 * without `email`, which the app renders as a bare method row.
 */
exports.onExecutePostLogin = async (event, api) => {
  const identities = (event.user.identities || []).map((identity) => {
    const isPrimary = `${identity.provider}|${identity.user_id}` === event.user.user_id
    const email = isPrimary ? event.user.email : identity.profileData && identity.profileData.email
    return email ? { provider: identity.provider, email } : { provider: identity.provider }
  })
  api.idToken.setCustomClaim("https://recoverysky.app/identities", identities)
}
