/**
 * Auth0 post-login Action: "Link passwordless identity".
 *
 * @auth0-action Link passwordless identity
 * @auth0-trigger post-login
 * @auth0-runtime node22
 * @auth0-secret MGMT_DOMAIN
 * @auth0-secret MGMT_CLIENT_ID
 * @auth0-secret MGMT_CLIENT_SECRET
 *
 * Spec 1 §3.5 (docs/superpowers/specs/2026-09-12-passwordless-login-design.md).
 * The app's "Continue with Email" signs in through the `email` passwordless
 * connection, which Auth0 treats as its own user store. Without this Action
 * an existing password / Google / Apple user who types their address gets a
 * brand-new, empty `email|…` user instead of their account. This Action links
 * the new email identity into the OLDEST existing account with the same
 * address and makes that account the primary for this login, so the token
 * carries the sub (and the hashed userId, attendance, reports, subscription)
 * the user already had. No app code is involved.
 *
 * Guard: only an `email` login by a user with exactly one identity. A linked
 * user arrives with two or more, so this is the idempotency check too. An
 * email user with no match stays at one identity and costs one Management API
 * lookup per login — accepted in the spec; a match that appears later (the
 * user signs up with Google on another phone) must still be found, so there
 * is deliberately no "already checked" flag in app_metadata.
 *
 * Refresh-token exchanges are skipped: post-login also runs on every refresh,
 * and linking mid-session would swap the sub under a running app (the
 * ownership gate would then see a different account). The next real login
 * retries instead.
 *
 * Never denies access. Any Management API failure logs and returns, and the
 * user gets the fresh email account for this login only; the guard retries
 * next login. A linking hiccup must not lock anyone out.
 *
 * The spec's random-password PATCH on a database primary is SKIPPED
 * (decided 2026-09-30): old builds on the shared prod client still sign in
 * with passwords, and randomising would lock them out. So the Management
 * client needs only `read:users` + `update:users`.
 *
 * Accepted risk (spec 1 Decisions): candidates are matched on email without
 * checking `email_verified`. The code login itself proves the inbox.
 *
 * Secrets: MGMT_DOMAIN is the tenant's CANONICAL domain
 * (`<tenant>.us.auth0.com`), not a custom domain — the Management API
 * audience is `https://<canonical>/api/v2/`. Client id/secret belong to a
 * DEDICATED M2M application granted only `read:users` + `update:users` — not
 * the API's `AUTH_MGMT_*` client, because Action secrets are readable by every
 * dashboard admin (CHANGED 2026-09-30: was the API's client). They are client
 * credentials, never a token: managementToken() mints a short-lived token per
 * worker and caches it, so nothing long-lived is stored.
 *
 * Logs never carry email addresses; Auth0's Action logs are visible to
 * every dashboard admin.
 */

/* global AbortSignal -- Node 22 global in the Actions runtime */

/** Providers whose accounts an email login may be linked into. */
const LINKABLE_PROVIDERS = new Set(["auth0", "google-oauth2", "apple"])

const TOKEN_CACHE_KEY = "mgmt_token"
const HTTP_TIMEOUT_MS = 5000

async function managementToken(event, api) {
  const cached = api.cache.get(TOKEN_CACHE_KEY)
  if (cached && cached.value) return cached.value

  const domain = event.secrets.MGMT_DOMAIN
  const res = await fetch(`https://${domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: event.secrets.MGMT_CLIENT_ID,
      client_secret: event.secrets.MGMT_CLIENT_SECRET,
      audience: `https://${domain}/api/v2/`,
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`token grant ${res.status}`)
  const body = await res.json()
  // Cache for the token's life minus a minute so a cached token never
  // expires mid-login. api.cache is per Action and survives between logins
  // on the same worker, which keeps us off the M2M token quota.
  const ttl = Math.max(0, (body.expires_in - 60) * 1000)
  if (ttl > 0) api.cache.set(TOKEN_CACHE_KEY, body.access_token, { ttl })
  return body.access_token
}

async function mgmt(event, token, method, path, body) {
  const res = await fetch(`https://${event.secrets.MGMT_DOMAIN}/api/v2${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} ${res.status}`)
  return res.status === 204 ? null : res.json()
}

exports.onExecutePostLogin = async (event, api) => {
  if (!event.connection || event.connection.strategy !== "email") return
  if ((event.user.identities || []).length !== 1) return
  if (event.transaction && event.transaction.protocol === "oauth2-refresh-token") return
  const email = event.user.email
  if (!email) return

  try {
    const token = await managementToken(event, api)
    const users = await mgmt(
      event,
      token,
      "GET",
      `/users-by-email?email=${encodeURIComponent(email.toLowerCase())}`,
    )

    // Oldest same-email account whose own (primary) identity is a database,
    // Google or Apple login. `identities[0]` is the root identity of a user.
    const primary = (users || [])
      .filter((u) => u.user_id !== event.user.user_id)
      .filter(
        (u) => u.identities && u.identities[0] && LINKABLE_PROVIDERS.has(u.identities[0].provider),
      )
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]
    // No candidate: a genuinely new user. Spec 2's wrong-account screen
    // handles a device that already belongs to someone else.
    if (!primary) return

    // event.user.user_id is "email|<id>"; the link takes the bare id.
    const secondaryId = event.user.user_id.slice(event.user.user_id.indexOf("|") + 1)
    await mgmt(event, token, "POST", `/users/${encodeURIComponent(primary.user_id)}/identities`, {
      provider: "email",
      user_id: secondaryId,
    })

    // Issue THIS login's tokens for the primary, so the app never sees the
    // throwaway email sub. The identities claim Action reads the event as it
    // was before the link, so the "Linked" row shows from the next refresh.
    api.authentication.setPrimaryUser(primary.user_id)
    console.log(`linked email identity into ${primary.identities[0].provider} primary`)
  } catch (err) {
    console.log(`link skipped: ${err && err.message}`)
  }
}
