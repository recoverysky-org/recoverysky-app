/**
 * Auth0 post-login Action: "Identities claim".
 *
 * @auth0-action Identities claim
 * @auth0-trigger post-login
 * @auth0-runtime node22
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
 *
 * `current: true` marks the identity whose connection this login used. The
 * app needs it because the token's `email` is the primary's on every linked
 * login, so it cannot tell which of two same-provider identities is active.
 * Two identities on the SAME connection (two Googles) both get tagged; the app
 * then shows the method without guessing an address.
 *
 * `sub` (ADDED 2026-09-30, spec 2 §7) is `provider|user_id` — the sub that
 * identity had as a standalone user. A device whose owner's identity was
 * linked in from ANOTHER device still records that old sub; the app's
 * ownership gate finds it here and moves the owner to this account
 * (`relinked`) instead of looping on the wrong-account screen.
 *
 * Unlinked accounts (one identity) get no claim at all: the app treats a
 * missing claim as "no links", and this keeps the emails of linked accounts
 * out of every token that doesn't need them — including the foreign-session
 * tokens the app hands to POST /auth0/link.
 */
exports.onExecutePostLogin = async (event, api) => {
  const identities = event.user.identities || []
  if (identities.length < 2) return

  const loginConnection = event.connection && event.connection.name
  const claim = identities.map((identity) => {
    const isPrimary = `${identity.provider}|${identity.user_id}` === event.user.user_id
    const email = isPrimary ? event.user.email : identity.profileData && identity.profileData.email
    const entry = { provider: identity.provider, sub: `${identity.provider}|${identity.user_id}` }
    if (email) entry.email = email
    if (identity.connection === loginConnection) entry.current = true
    return entry
  })
  api.idToken.setCustomClaim("https://recoverysky.app/identities", claim)
}
