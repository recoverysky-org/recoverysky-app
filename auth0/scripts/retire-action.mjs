#!/usr/bin/env node
/**
 * Takes one Action off a tenant, keeping its code. ADDED 2026-09-30 to retire
 * prod's legacy "Create Firebase User" Actions (docs/PROD_AUTH0_ROLLOUT.md).
 *
 *   node auth0/scripts/retire-action.mjs <tenant> "<Action name>"                  # dry run
 *   node auth0/scripts/retire-action.mjs meetingmaker "<Action name>" --apply --prod
 *
 * 1. Saves the DEPLOYED code to auth0/retired/<tenant>/<slug>.js with the same
 *    @auth0-* header deploy-actions.sh reads (secret NAMES only — values never
 *    leave the tenant). Done on the dry run too, so the code can be read before
 *    anything is deleted. Rollback = copy the file into auth0/actions/<tenant>/,
 *    set the secrets in the dashboard, and run deploy-actions.sh.
 * 2. Removes it from every trigger's bindings, keeping the others in order.
 * 3. Deletes the Action.
 *
 * deploy-actions.sh never deletes anything; this is the one deliberate way.
 * Credentials: scripts/mgmt-auth.mjs. Never prints a token or secret.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { getMgmtCredentials } from "./mgmt-auth.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ENV_FILE = process.env.ENV_FILE ?? resolve(HERE, "../../../api/.env")
const PROD_TENANTS = new Set(["meetingmaker"])
const REQUIRED_SCOPES = ["read:actions", "update:actions", "delete:actions"]

const args = process.argv.slice(2)
const [tenant, actionName] = args.filter((a) => !a.startsWith("--"))
const apply = args.includes("--apply")

function die(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

if (!tenant || !actionName)
  die('usage: retire-action.mjs <tenant> "<Action name>" [--apply] [--prod]')
if (apply && PROD_TENANTS.has(tenant) && !args.includes("--prod"))
  die(`${tenant} is PROD — add --prod to apply`)

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
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${text}`)
  return text ? JSON.parse(text) : undefined
}

const { actions } = await mgmt("GET", "/actions/actions?per_page=100")
const action = actions.find((a) => a.name === actionName)
if (!action) die(`no Action named "${actionName}" on ${tenant}`)
const code = action.deployed_version?.code ?? action.code
const triggers = action.supported_triggers.map((t) => t.id)

// ── 1. save ─────────────────────────────────────────────────────────────────
const slug = actionName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
const file = resolve(HERE, "../retired", tenant, `${slug}.js`)
const header = [
  "/**",
  ` * RETIRED ${new Date().toISOString().slice(0, 10)} from ${tenant} by auth0/scripts/retire-action.mjs.`,
  ` * This is the code that was ${action.deployed_version ? "deployed" : "saved (never deployed)"} there. To restore, copy into`,
  ` * auth0/actions/${tenant}/, set the secrets in the dashboard, run deploy-actions.sh.`,
  " *",
  ` * @auth0-action   ${actionName}`,
  ...triggers.map((t) => ` * @auth0-trigger  ${t}`),
  ` * @auth0-runtime  ${action.runtime}`,
  ...(action.dependencies ?? []).map((d) => ` * @auth0-dependency ${d.name}@${d.version}`),
  ...(action.secrets ?? []).map((s) => ` * @auth0-secret   ${s.name}`),
  " */",
  "",
].join("\n")
mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, header + code + (code.endsWith("\n") ? "" : "\n"))
console.log(`✔ saved the code to ${relative(process.cwd(), file)}`)

// ── 2–3. plan ───────────────────────────────────────────────────────────────
const bound = []
for (const t of triggers) {
  const { bindings } = await mgmt("GET", `/actions/triggers/${t}/bindings`)
  if (bindings.some((b) => b.action.id === action.id)) bound.push({ trigger: t, bindings })
}
for (const { trigger, bindings } of bound)
  console.log(`- unbind from ${trigger} (${bindings.map((b) => b.display_name).join(" → ")})`)
console.log(`- delete Action "${actionName}"`)

if (!apply) {
  console.log("\nDry run. Read the saved file, then re-run with --apply.")
  process.exit(0)
}

for (const { trigger, bindings } of bound) {
  const keep = bindings.filter((b) => b.action.id !== action.id)
  await mgmt("PATCH", `/actions/triggers/${trigger}/bindings`, {
    bindings: keep.map((b) => ({
      ref: { type: "action_id", value: b.action.id },
      display_name: b.display_name,
    })),
  })
  console.log(`✔ unbound from ${trigger}`)
}
await mgmt("DELETE", `/actions/actions/${action.id}`)
console.log(`✔ deleted "${actionName}"`)
