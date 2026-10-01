#!/usr/bin/env node
/**
 * One-time setup for the "Link passwordless identity" Action on a tenant:
 *
 *   node auth0/scripts/provision-link-client.mjs <tenant>                 # dry run: report only
 *   node auth0/scripts/provision-link-client.mjs <tenant> --apply         # make the changes
 *   node auth0/scripts/provision-link-client.mjs meetingmaker --apply --prod
 *
 * 1. Creates the dedicated M2M application CLIENT_NAME (client credentials only).
 * 2. Grants it the Auth0 Management API with ONLY read:users + update:users.
 * 3. Writes MGMT_DOMAIN / MGMT_CLIENT_ID / MGMT_CLIENT_SECRET into the Action's
 *    secrets — creating the Action from the tenant folder's file if it doesn't
 *    exist yet (undeployed and unbound: deploy-actions.sh does that next).
 *
 * Why a script: the client secret goes from the create-client response straight
 * into the Action's secrets in memory, so it never lands on a screen, a
 * clipboard, or a file. Why a dedicated client: Action secrets are readable by
 * every dashboard admin, so a leak exposes two scopes, not the API's client.
 *
 * Idempotent: an existing client / grant is left alone. If the client exists but
 * the Action still lacks a secret, the script stops — it can't read an existing
 * client's secret without read:client_keys, and it won't silently rotate one.
 *
 * Credentials: AUTH_MGMT_* from ../api/.env (override with ENV_FILE=…), the same
 * client deploy-actions.sh uses. It additionally needs read:clients,
 * create:clients, read:client_grants, create:client_grants. Never prints a
 * secret or token.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { getMgmtCredentials } from "./mgmt-auth.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.ENV_FILE ?? resolve(HERE, "../../../api/.env")
const PROD_TENANTS = new Set(["meetingmaker"])
const CLIENT_NAME = "Action: Link passwordless identity"
const ACTION_FILE = "link-passwordless-identity.js"
const GRANT_SCOPES = ["read:users", "update:users"]
const REQUIRED_SCOPES = [
  "read:clients",
  "create:clients",
  "read:client_grants",
  "create:client_grants",
  "read:actions",
  "create:actions",
  "update:actions",
]

const args = process.argv.slice(2)
const tenant = args.find((a) => !a.startsWith("--"))
const apply = args.includes("--apply")

function die(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

if (!tenant) die("usage: provision-link-client.mjs <tenant> [--apply] [--prod]")
if (apply && PROD_TENANTS.has(tenant) && !args.includes("--prod"))
  die(`${tenant} is PROD — add --prod to apply`)
const actionPath = resolve(HERE, "../actions", tenant, ACTION_FILE)
if (!existsSync(actionPath)) die(`no ${actionPath} — copy the Action into the tenant folder first`)
const code = readFileSync(actionPath, "utf8")
const tag = (t) => code.match(new RegExp(`@${t}[ \\t]+(.+)`))?.[1].trim()
const actionName = tag("auth0-action")
const trigger = tag("auth0-trigger")
const runtime = tag("auth0-runtime") ?? "node22"

// ── credentials ─────────────────────────────────────────────────────────────
// CHANGED 2026-09-30: shared with the other scripts in mgmt-auth.mjs, which
// also accepts a ready-made AUTH0_MGMT_API_TOKEN_PROD/_DEV token.
const { domain, token, source } = await getMgmtCredentials({
  tenant,
  defaultEnvFile: ENV_FILE,
  requiredScopes: REQUIRED_SCOPES,
  die,
})
console.log(
  `Tenant: ${domain}${PROD_TENANTS.has(tenant) ? " (PROD)" : ""} — ${apply ? "APPLY" : "dry run"} (via ${source})`,
)

async function mgmt(method, path, body) {
  const res = await fetch(`https://${domain}/api/v2${path}`, {
    method,
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  // Error bodies from these endpoints never echo a client secret.
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${text}`)
  return text ? JSON.parse(text) : undefined
}

// Callers pass include_totals=true where the endpoint needs it (/clients):
// /actions/actions always returns `total` and 400s on that parameter.
async function all(path, key) {
  const out = []
  for (let page = 0; ; page++) {
    const sep = path.includes("?") ? "&" : "?"
    const res = await mgmt("GET", `${path}${sep}per_page=100&page=${page}`)
    out.push(...res[key])
    if (out.length >= res.total || res[key].length === 0) return out
  }
}

// ── current state ───────────────────────────────────────────────────────────
const mgmtAudience = `https://${domain}/api/v2/`
const clients = await all(
  "/clients?fields=client_id,name&include_fields=true&include_totals=true",
  "clients",
)
let client = clients.find((c) => c.name === CLIENT_NAME)
const actions = await all("/actions/actions", "actions")
const action = actions.find((a) => a.name === actionName)
const actionSecrets = (action?.secrets ?? []).map((s) => s.name)
const secretsComplete = ["MGMT_DOMAIN", "MGMT_CLIENT_ID", "MGMT_CLIENT_SECRET"].every((s) =>
  actionSecrets.includes(s),
)
// A client created by this run must reach the Action: its secret exists only in
// the create response. So when the client is new, the Action's secrets are
// (re)written even if all three names are already there — they belong to some
// other client (typically one entered by hand), and keeping them would orphan
// the new app and leave the Action on the old credentials.
const writeSecrets = !client || !secretsComplete

console.log(`${client ? "=" : "+"} M2M app "${CLIENT_NAME}"${client ? " exists" : ": create"}`)
let grant
if (client) {
  ;[grant] = await mgmt(
    "GET",
    `/client-grants?client_id=${client.client_id}&audience=${encodeURIComponent(mgmtAudience)}`,
  )
}
if (grant) {
  const extra = grant.scope.filter((s) => !GRANT_SCOPES.includes(s))
  const lacking = GRANT_SCOPES.filter((s) => !grant.scope.includes(s))
  console.log(`= Management API grant: ${grant.scope.join(" ")}`)
  if (lacking.length) console.log(`  ⚠ lacks ${lacking.join(", ")} — fix in the dashboard`)
  if (extra.length) console.log(`  ⚠ has extra scopes ${extra.join(", ")} — trim in the dashboard`)
} else {
  console.log(`+ Management API grant: ${GRANT_SCOPES.join(" ")}`)
}
console.log(
  action
    ? !writeSecrets
      ? `= Action "${actionName}" has its secrets`
      : secretsComplete
        ? `~ Action "${actionName}": REPLACE its secrets so they point at the new app`
        : `+ Action "${actionName}": set secrets`
    : `+ Action "${actionName}": create (${trigger}, ${runtime}) with secrets`,
)

if (client && !secretsComplete)
  die(
    `"${CLIENT_NAME}" already exists but the Action lacks its secrets. Copy its Client ID/Secret ` +
      `into the Action's secrets by hand, or delete the app and re-run to have it recreated.`,
  )
if (!apply) {
  console.log("Dry run. Re-run with --apply to make these changes.")
  process.exit(0)
}

// ── apply ───────────────────────────────────────────────────────────────────
let clientSecret
if (!client) {
  const created = await mgmt("POST", "/clients", {
    name: CLIENT_NAME,
    description: `Used only by the "${actionName}" post-login Action (auth0/actions/). Rotate freely.`,
    app_type: "non_interactive",
    grant_types: ["client_credentials"],
    token_endpoint_auth_method: "client_secret_post",
  })
  client = { client_id: created.client_id, name: created.name }
  clientSecret = created.client_secret
  console.log(`✔ created M2M app (client id ${client.client_id})`)
}
if (!grant) {
  await mgmt("POST", "/client-grants", {
    client_id: client.client_id,
    audience: mgmtAudience,
    scope: GRANT_SCOPES,
  })
  console.log(`✔ granted Management API: ${GRANT_SCOPES.join(" ")}`)
}
if (writeSecrets) {
  const secrets = [
    { name: "MGMT_DOMAIN", value: domain },
    { name: "MGMT_CLIENT_ID", value: client.client_id },
    { name: "MGMT_CLIENT_SECRET", value: clientSecret },
  ]
  if (action) {
    await mgmt("PATCH", `/actions/actions/${action.id}`, { secrets })
    console.log(`✔ set the Action's secrets`)
  } else {
    const { triggers } = await mgmt("GET", "/actions/triggers")
    const t =
      triggers.find((x) => x.id === trigger && x.status === "CURRENT") ??
      triggers.find((x) => x.id === trigger)
    if (!t) die(`unknown trigger "${trigger}" on this tenant`)
    await mgmt("POST", "/actions/actions", {
      name: actionName,
      supported_triggers: [{ id: trigger, version: t.version }],
      code,
      runtime,
      secrets,
    })
    console.log(`✔ created the Action with its secrets (not yet deployed or bound)`)
  }
}
console.log(
  `Next: auth0/scripts/deploy-actions.sh ${tenant} --apply, then drag it above Identities claim.`,
)
