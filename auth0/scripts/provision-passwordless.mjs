#!/usr/bin/env node
/**
 * Makes a tenant's passwordless email sign-in match the repo. ADDED 2026-09-30
 * for the prod rollout (docs/PROD_AUTH0_ROLLOUT.md).
 *
 *   node auth0/scripts/provision-passwordless.mjs <tenant>                      # dry run: every step
 *   node auth0/scripts/provision-passwordless.mjs <tenant> --apply --only conn  # one step
 *   node auth0/scripts/provision-passwordless.mjs meetingmaker --apply --prod --only clients
 *
 * Steps (`--only` takes one or a comma list; prod refuses --apply without it,
 * so every live change is a deliberate, single step):
 *   conn     the `email` connection, from auth0/connections/email.json. Created
 *            when missing; otherwise its options are compared and patched.
 *   clients  enable that connection for the app client. Never disables it for
 *            any other client — extra ones are only reported.
 *   grant    add the passwordless code grant to the app client. Merges; never
 *            removes a grant type.
 *   order    put the post-login bindings in the README order (POST_LOGIN_ORDER
 *            first, everything else after, in its current order).
 *            deploy-actions.sh only appends, so a newly bound Action can land
 *            in the wrong place.
 *
 * `email.from` is deliberately not in the JSON: it is "RecoverySky <address>"
 * with the tenant's SMTP provider default address, and Auth0's built-in sender
 * when the tenant has no provider (dev). A from-address the provider can't send
 * as would silently drop every code email.
 *
 * App client: --client <id>, else EXPO_PUBLIC_AUTH0_CLIENT_ID from eas.json
 * (prod) or .env (any other tenant). It is checked against the tenant before
 * anything else, so a dev id can never be enabled on prod.
 *
 * Credentials: scripts/mgmt-auth.mjs (AUTH0_MGMT_API_TOKEN_PROD/_DEV, else
 * AUTH_MGMT_* from ../api/.env). Never prints a token or secret.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { getMgmtCredentials } from "./mgmt-auth.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "../..")
const ENV_FILE = process.env.ENV_FILE ?? resolve(HERE, "../../../api/.env")
const PROD_TENANTS = new Set(["meetingmaker"])
const OTP_GRANT = "http://auth0.com/oauth/grant-type/passwordless/otp"
// Must match auth0/README.md "Post-login order".
const POST_LOGIN_ORDER = ["Link passwordless identity", "Identities claim"]
const STEPS = ["conn", "clients", "grant", "order"]
const REQUIRED_SCOPES = [
  "read:connections",
  "create:connections",
  "update:connections",
  "read:clients",
  "update:clients",
  "read:actions",
  "update:actions",
]

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const tenant = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.match(/^--(only|client)$/))
const apply = args.includes("--apply")
const only = flag("--only")?.split(",")

function die(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

if (!tenant)
  die(
    "usage: provision-passwordless.mjs <tenant> [--apply [--only conn,clients,grant,order]] [--prod]",
  )
if (only?.some((s) => !STEPS.includes(s))) die(`--only takes ${STEPS.join(", ")}`)
const isProd = PROD_TENANTS.has(tenant)
if (apply && isProd && !args.includes("--prod")) die(`${tenant} is PROD — add --prod to apply`)
if (apply && isProd && !only)
  die("on PROD, --apply needs --only <step>: one deliberate change at a time")
const wants = (step) => !only || only.includes(step)

// ── app client id ───────────────────────────────────────────────────────────
function appClientId() {
  const given = flag("--client")
  if (given) return given
  if (isProd) {
    const eas = readFileSync(resolve(ROOT, "eas.json"), "utf8")
    return eas.match(/"EXPO_PUBLIC_AUTH0_CLIENT_ID":\s*"([^"]+)"/)?.[1]
  }
  const envPath = resolve(ROOT, ".env")
  if (!existsSync(envPath)) return undefined
  return readFileSync(envPath, "utf8").match(/^EXPO_PUBLIC_AUTH0_CLIENT_ID=["']?([^"'\s]+)/m)?.[1]
}
const clientId = appClientId()
if (!clientId) die("no app client id — pass --client <id>")

const desired = JSON.parse(readFileSync(resolve(HERE, "../connections/email.json"), "utf8"))

// ── credentials ─────────────────────────────────────────────────────────────
const { domain, token, source } = await getMgmtCredentials({
  tenant,
  defaultEnvFile: ENV_FILE,
  requiredScopes: REQUIRED_SCOPES,
  die,
})
console.log(
  `Tenant: ${domain}${isProd ? " (PROD)" : ""} — ${apply ? `APPLY ${only?.join(",") ?? "all"}` : "dry run"} (via ${source})`,
)

async function mgmt(method, path, body, { allow404 = false } = {}) {
  const res = await fetch(`https://${domain}/api/v2${path}`, {
    method,
    headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (allow404 && res.status === 404) return undefined
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${text}`)
  return text ? JSON.parse(text) : undefined
}

const client = await mgmt(
  "GET",
  `/clients/${clientId}?fields=client_id,name,grant_types&include_fields=true`,
  undefined,
  { allow404: true },
)
if (!client) die(`app client ${clientId.slice(0, 6)}… does not exist on ${tenant}`)
console.log(`App client: "${client.name}" (${clientId.slice(0, 6)}…)`)

let pending = 0
const report = (state, msg) => {
  if (state !== "=") pending++
  console.log(`${state} ${msg}`)
}

// ── conn ────────────────────────────────────────────────────────────────────
const provider = await mgmt(
  "GET",
  "/emails/provider?fields=enabled,default_from_address&include_fields=true",
  undefined,
  { allow404: true },
)
const from =
  provider?.enabled && provider.default_from_address
    ? `RecoverySky <${provider.default_from_address}>`
    : "RecoverySky <root@auth0.com>"
const fromShown = from.replace(/<[^@>]{0,2}[^@>]*@/, "<…@")
const wantOptions = { ...desired.options, email: { ...desired.options.email, from } }

let [conn] = await mgmt("GET", `/connections?strategy=email&name=${desired.name}`)
const diffs = []
if (conn) {
  const o = conn.options ?? {}
  const cmp = (label, a, b) => JSON.stringify(a) !== JSON.stringify(b) && diffs.push(label)
  cmp("totp", o.totp, wantOptions.totp)
  cmp("disable_signup", o.disable_signup, wantOptions.disable_signup)
  cmp("brute_force_protection", o.brute_force_protection, wantOptions.brute_force_protection)
  for (const k of ["syntax", "subject", "body", "from"])
    cmp(`email.${k}`, o.email?.[k], wantOptions.email[k])
}
if (wants("conn")) {
  if (!conn) report("+", `connection "${desired.name}": create (from ${fromShown})`)
  else if (diffs.length) report("~", `connection "${desired.name}": update ${diffs.join(", ")}`)
  else
    report(
      "=",
      `connection "${desired.name}" matches auth0/connections/email.json (from ${fromShown})`,
    )
}

// ── clients ─────────────────────────────────────────────────────────────────
let enabledIds = []
if (conn) {
  const res = await mgmt("GET", `/connections/${conn.id}/clients`)
  enabledIds = (res.clients ?? []).map((c) => c.client_id)
}
const appEnabled = enabledIds.includes(clientId)
if (wants("clients")) {
  report(
    appEnabled ? "=" : "+",
    `connection enabled for the app client${appEnabled ? "" : ": enable"}`,
  )
  const others = enabledIds.filter((id) => id !== clientId)
  if (others.length)
    console.log(`  ⚠ also enabled for ${others.length} other client(s) — left alone`)
}

// ── grant ───────────────────────────────────────────────────────────────────
const grants = client.grant_types ?? []
const hasOtp = grants.includes(OTP_GRANT)
if (wants("grant"))
  report(hasOtp ? "=" : "+", `app client grant ${hasOtp ? "has" : "add"} passwordless/otp`)

// ── order ───────────────────────────────────────────────────────────────────
const { bindings } = await mgmt("GET", "/actions/triggers/post-login/bindings")
const names = bindings.map((b) => b.display_name)
const listed = POST_LOGIN_ORDER.filter((n) => names.includes(n))
const wantOrder = [...listed, ...names.filter((n) => !POST_LOGIN_ORDER.includes(n))]
const orderOk = JSON.stringify(names) === JSON.stringify(wantOrder)
if (wants("order")) {
  report(
    orderOk ? "=" : "~",
    `post-login order: ${names.join(" → ") || "(empty)"}${orderOk ? "" : `  ⇒  ${wantOrder.join(" → ")}`}`,
  )
  const missing = POST_LOGIN_ORDER.filter((n) => !names.includes(n))
  if (missing.length) console.log(`  ℹ not bound yet: ${missing.join(", ")} (deploy-actions.sh)`)
}

if (!pending) {
  console.log("\nIn sync — nothing to do 💖")
  process.exit(0)
}
if (!apply) {
  console.log(
    `\n${pending} change(s) pending. Re-run with --apply${isProd ? " --prod --only <step>" : ""}.`,
  )
  process.exit(0)
}

// ── apply ───────────────────────────────────────────────────────────────────
if (wants("conn") && !conn) {
  conn = await mgmt("POST", "/connections", {
    name: desired.name,
    strategy: desired.strategy,
    options: wantOptions,
  })
  console.log(`✔ created connection "${desired.name}" (enabled for no client yet)`)
} else if (wants("conn") && diffs.length) {
  // PATCH replaces `options` wholesale, so the tenant's other keys ride along.
  await mgmt("PATCH", `/connections/${conn.id}`, { options: { ...conn.options, ...wantOptions } })
  console.log(`✔ updated connection: ${diffs.join(", ")}`)
}
if (wants("clients") && !appEnabled) {
  if (!conn) die("no email connection yet — run --only conn first")
  await mgmt("PATCH", `/connections/${conn.id}/clients`, [{ client_id: clientId, status: true }])
  console.log("✔ enabled the connection for the app client")
}
if (wants("grant") && !hasOtp) {
  await mgmt("PATCH", `/clients/${clientId}`, { grant_types: [...grants, OTP_GRANT] })
  console.log("✔ added the passwordless/otp grant")
}
if (wants("order") && !orderOk) {
  const byName = new Map(bindings.map((b) => [b.display_name, b]))
  await mgmt("PATCH", "/actions/triggers/post-login/bindings", {
    bindings: wantOrder.map((n) => ({
      ref: { type: "action_id", value: byName.get(n).action.id },
      display_name: n,
    })),
  })
  console.log(`✔ post-login order: ${wantOrder.join(" → ")}`)
}
