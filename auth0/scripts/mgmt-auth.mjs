/**
 * Management API credentials for the auth0/scripts, shared so every script
 * enforces the same tenant guard.
 *
 * Two sources, tried in this order:
 * 1. A ready-made token in AUTH0_MGMT_API_TOKEN_PROD (meetingmaker) or
 *    AUTH0_MGMT_API_TOKEN_DEV (bad-bitch-tenant), minted in the dashboard's API
 *    Explorer. ADDED 2026-09-30: prod had no client-credentials env file, and
 *    these tokens already sit in Jenova's shell. The tenant is read from the
 *    token's own `aud`, so a dev token can never act on prod or vice versa.
 *    They expire (dev 24 h, prod ~30 d); an expired one stops here with the
 *    refresh steps instead of failing later with a 401.
 * 2. The client-credentials client in AUTH_MGMT_* from ENV_FILE (default
 *    ../api/.env, the dev tenant). Setting ENV_FILE explicitly picks this
 *    source even when a token variable is set.
 *
 * Either way the domain must name the tenant given on the command line, and
 * the token must carry `requiredScopes`. Never prints a token or secret.
 */
import { Buffer } from "node:buffer"
import { existsSync, readFileSync } from "node:fs"

const TOKEN_VARS = {
  "meetingmaker": "AUTH0_MGMT_API_TOKEN_PROD",
  "bad-bitch-tenant": "AUTH0_MGMT_API_TOKEN_DEV",
}

const claimsOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())

/** @returns {Promise<{ domain: string, token: string, source: string }>} */
export async function getMgmtCredentials({ tenant, defaultEnvFile, requiredScopes, die }) {
  const tokenVar = TOKEN_VARS[tenant]
  const preset = tokenVar && !process.env.ENV_FILE ? process.env[tokenVar] : undefined

  let domain
  let token
  let source
  if (preset) {
    let claims
    try {
      claims = claimsOf(preset)
    } catch {
      die(`${tokenVar} is not a JWT`)
    }
    domain = String(claims.aud ?? "").match(/^https:\/\/([^/]+)\/api\/v2\/?$/)?.[1]
    if (!domain) die(`${tokenVar} is not a Management API token (aud ${claims.aud})`)
    if (!claims.exp || claims.exp * 1000 < Date.now() + 60_000)
      die(
        `${tokenVar} has expired — mint a new one in Dashboard → Applications → APIs → ` +
          `Auth0 Management API → API Explorer and re-export it`,
      )
    token = preset
    source = tokenVar
  } else {
    const envFile = process.env.ENV_FILE ?? defaultEnvFile
    if (!existsSync(envFile)) die(`env file not found: ${envFile} (set ENV_FILE=… or ${tokenVar})`)
    const env = {}
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^(AUTH_MGMT_[A-Z_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
    }
    domain = env.AUTH_MGMT_DOMAIN
    if (!domain || !env.AUTH_MGMT_CLIENT_ID || !env.AUTH_MGMT_CLIENT_SECRET)
      die(`AUTH_MGMT_DOMAIN/_CLIENT_ID/_CLIENT_SECRET missing in ${envFile}`)
    if (!domain.startsWith(`${tenant}.`))
      die(`AUTH_MGMT_DOMAIN is ${domain}, not the ${tenant} tenant`)
    const res = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: env.AUTH_MGMT_CLIENT_ID,
        client_secret: env.AUTH_MGMT_CLIENT_SECRET,
        audience: `https://${domain}/api/v2/`,
      }),
    })
    if (!res.ok) die(`token request failed: ${res.status}`)
    token = (await res.json()).access_token
    source = envFile
  }

  // Hard guard: the credentials must belong to the tenant named on the command line.
  if (!domain.startsWith(`${tenant}.`))
    die(`credentials are for ${domain}, not the ${tenant} tenant`)
  const scopes = claimsOf(token).scope?.split(" ") ?? []
  const missing = requiredScopes.filter((s) => !scopes.includes(s))
  if (missing.length) die(`token lacks ${missing.join(", ")} (from ${source})`)
  return { domain, token, source }
}
