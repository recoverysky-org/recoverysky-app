#!/usr/bin/env node
/**
 * Read-only linking diagnostics for the DEV tenant — the checkpoint step in
 * docs/AUTH_LINKING_TESTS.md.
 *
 *   node auth0/scripts/diagnose-linking.mjs              # users + last 60 min of logins
 *   node auth0/scripts/diagnose-linking.mjs --since 15   # minutes of tenant log to show
 *
 * Prints, for each user: the app's log hash of its sub (same algorithm as
 * app/utils/logger/hashUserId.ts — SHA-512, first 16 hex — so the line can be
 * matched to `Syncing Auth0 user to MST store` in the app's logs), the masked
 * email, and every identity. Then the tenant's login events in the window, with
 * each login's connection next to the sub it was issued for: an `email`
 * connection issuing an `auth0|` / `google-oauth2|` / `apple|` sub is the
 * Link passwordless identity Action's setPrimaryUser at work. Each login's
 * Action executions are listed with any error.
 *
 * Changes nothing. Hard-refuses any tenant but bad-bitch-tenant. Credentials:
 * AUTH_MGMT_* from ../api/.env (override with ENV_FILE=…); needs read:users,
 * read:logs, read:actions. Never prints the secret, the token, or a full email.
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.ENV_FILE ?? resolve(HERE, "../../../api/.env")
const args = process.argv.slice(2)
const sinceIdx = args.indexOf("--since")
const sinceMin = sinceIdx >= 0 ? Number(args[sinceIdx + 1]) : 60

// Machine-to-machine noise: our own scripts and the Action's token mint.
const SKIP_TYPES = new Set(["sapi", "seccft", "mgmt_api_read", "fapi"])
const TYPE_LABELS = {
  s: "login OK",
  f: "login FAILED",
  fp: "wrong password",
  fu: "unknown user",
  ss: "signup OK",
  fs: "signup FAILED",
  cls: "code sent",
  fcls: "code send FAILED",
  fcoa: "code wrong/expired",
  sertft: "refresh OK",
  fertft: "refresh FAILED",
  slo: "logout",
  scoa: "code exchange OK",
  sepft: "password grant OK",
  feacft: "code exchange FAILED",
  sdu: "user deleted",
}

function die(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

if (!Number.isFinite(sinceMin) || sinceMin <= 0) die("--since takes a number of minutes")
if (!existsSync(ENV_FILE)) die(`env file not found: ${ENV_FILE} (set ENV_FILE=…)`)
const env = {}
for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
  const m = line.match(/^(AUTH_MGMT_[A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
}
const domain = env.AUTH_MGMT_DOMAIN
if (!domain || !env.AUTH_MGMT_CLIENT_ID || !env.AUTH_MGMT_CLIENT_SECRET)
  die(`AUTH_MGMT_DOMAIN/_CLIENT_ID/_CLIENT_SECRET missing in ${ENV_FILE}`)
// Hard guard: diagnostics on prod would put real users' account shapes on a screen.
if (!domain.startsWith("bad-bitch-tenant.")) die(`REFUSING: ${domain} is not the dev tenant`)

const tokenRes = await fetch(`https://${domain}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_id: env.AUTH_MGMT_CLIENT_ID,
    client_secret: env.AUTH_MGMT_CLIENT_SECRET,
    audience: `https://${domain}/api/v2/`,
  }),
})
if (!tokenRes.ok) die(`token request failed: ${tokenRes.status}`)
const token = (await tokenRes.json()).access_token

async function get(path) {
  const res = await fetch(`https://${domain}/api/v2${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} → ${res.status} ${await res.text()}`)
  return res.json()
}

const hash = (sub) => createHash("sha512").update(sub).digest("hex").slice(0, 16)
const mask = (email) => {
  if (!email) return "-"
  const [local, host] = email.split("@")
  return `${local.slice(0, 2)}…@${host}`
}
const hhmmss = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour12: false })

// ── users ───────────────────────────────────────────────────────────────────
console.log(`Tenant: ${domain} (dev) — read-only\n`)
const users = []
for (let page = 0; ; page++) {
  const batch = await get(
    `/users?per_page=100&page=${page}&fields=user_id,email,created_at,last_login,logins_count,identities&include_fields=true`,
  )
  users.push(...batch)
  if (batch.length < 100) break
}
const hashOf = new Map()
console.log(`USERS (${users.length})`)
for (const u of users.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  hashOf.set(u.user_id, hash(u.user_id))
  console.log(
    `  ${hash(u.user_id)}  ${u.user_id}  ${mask(u.email)}  created ${hhmmss(u.created_at)}` +
      `  logins ${u.logins_count ?? 0}`,
  )
  for (const i of u.identities ?? []) {
    const sub = `${i.provider}|${i.user_id}`
    const tag = sub === u.user_id ? "primary" : "linked "
    console.log(`      ${tag}  ${sub}  (hash ${hash(sub)})`)
  }
}
if (!users.length) console.log("  (none)")

// ── tenant log ──────────────────────────────────────────────────────────────
const from = new Date(Date.now() - sinceMin * 60_000).toISOString()
const logs = await get(
  `/logs?q=${encodeURIComponent(`date:[${from} TO *]`)}&sort=date:1&per_page=100` +
    `&fields=date,type,connection,user_id,description,details&include_fields=true`,
)
const shown = logs.filter((l) => !SKIP_TYPES.has(l.type))
console.log(`\nTENANT LOG — last ${sinceMin} min (${shown.length} events, M2M noise hidden)`)
for (const l of shown) {
  const label = TYPE_LABELS[l.type] ?? l.type
  const sub = l.user_id ?? ""
  const provider = sub.split("|")[0]
  // An email-code login that comes back with a non-email sub = the Action
  // linked it and called setPrimaryUser.
  const viaLink = l.connection === "email" && sub && provider !== "email"
  console.log(
    `  ${hhmmss(l.date)}  ${label.padEnd(18)} conn=${(l.connection ?? "-").padEnd(32)}` +
      ` ${sub ? `${hash(sub)} ${sub}` : ""}${viaLink ? "  ⇐ LINKED into this primary" : ""}` +
      (l.type.startsWith("f") && l.description ? `  — ${l.description}` : ""),
  )
  for (const id of l.details?.actions?.executions ?? []) {
    try {
      const ex = await get(`/actions/executions/${id}`)
      for (const r of ex.results ?? [])
        console.log(
          `      action "${r.action_name}"${r.error ? ` ERROR ${JSON.stringify(r.error)}` : " ok"}`,
        )
    } catch (e) {
      console.log(`      action execution ${id}: ${e.message}`)
    }
  }
}
if (!shown.length) console.log("  (none)")
