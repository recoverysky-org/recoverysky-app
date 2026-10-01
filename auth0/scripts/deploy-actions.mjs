#!/usr/bin/env node
/**
 * Sync one tenant's Actions with `auth0/actions/<tenant>/`: the folder is the
 * source of truth (auth0/README.md), this makes the tenant match it.
 *
 *   auth0/scripts/deploy-actions.sh <tenant>                 # dry run: report only
 *   auth0/scripts/deploy-actions.sh <tenant> --apply         # make the changes
 *   auth0/scripts/deploy-actions.sh meetingmaker --apply --prod   # prod needs --prod too
 *
 * For every `*.js` in the tenant folder, identified by its header tags:
 *
 *   @auth0-action   <Action name, exactly as on the tenant>
 *   @auth0-trigger  <trigger id: post-login, credentials-exchange, pre-user-registration, …>
 *   @auth0-runtime  <node22, …>             (optional, default node22)
 *   @auth0-dependency <name>@<version>      (optional, repeatable)
 *   @auth0-secret   <NAME>                  (optional, repeatable — names only)
 *
 * it creates the Action if missing; updates and deploys it when the deployed
 * code, runtime or dependencies differ from the file; and binds it to its
 * trigger when unbound. Anything already in sync is left alone, so a second
 * run is a no-op. The trigger version is the tenant's CURRENT one.
 *
 * Deliberately NOT done:
 * - Deleting or unbinding. An Action on the tenant with no file is reported
 *   as drift; removing it is a human decision.
 * - Reordering bindings. A missing binding is appended at the end, and the
 *   report shows the resulting order — fix the order in the dashboard if the
 *   README's "Post-login order" needs it.
 * - Secret VALUES. They never live in git. A declared secret the tenant lacks
 *   stops that Action (set it in the dashboard, re-run). A NEW Action that
 *   declares secrets can't be created from here at all; the script prints
 *   the dashboard steps to create it (name, trigger, runtime, secrets).
 *
 * Credentials: the Management API client-credentials client in AUTH_MGMT_*
 * (default: ../api/.env next to this checkout; override with ENV_FILE=…). It
 * needs read:actions, create:actions, update:actions. The script refuses to
 * run unless AUTH_MGMT_DOMAIN names the tenant given on the command line.
 * Never prints the secret or the token.
 */
import { Buffer } from "node:buffer"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ACTIONS_DIR = resolve(HERE, "../actions")
const ENV_FILE = process.env.ENV_FILE ?? resolve(HERE, "../../../api/.env")
const PROD_TENANTS = new Set(["meetingmaker"])
const REQUIRED_SCOPES = ["read:actions", "create:actions", "update:actions"]

const args = process.argv.slice(2)
const tenant = args.find((a) => !a.startsWith("--"))
const apply = args.includes("--apply")
const prodOk = args.includes("--prod")

function die(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

if (!tenant) die("usage: deploy-actions.sh <tenant> [--apply] [--prod]")
const folder = join(ACTIONS_DIR, tenant)
if (!existsSync(folder)) die(`no folder ${folder}`)
if (apply && PROD_TENANTS.has(tenant) && !prodOk) die(`${tenant} is PROD — add --prod to apply`)

// ── credentials ─────────────────────────────────────────────────────────────
function readEnv(file) {
  if (!existsSync(file)) die(`env file not found: ${file} (set ENV_FILE=…)`)
  const env = {}
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^(AUTH_MGMT_[A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return env
}
const env = readEnv(ENV_FILE)
const {
  AUTH_MGMT_DOMAIN: domain,
  AUTH_MGMT_CLIENT_ID: clientId,
  AUTH_MGMT_CLIENT_SECRET: secret,
} = env
if (!domain || !clientId || !secret)
  die(`AUTH_MGMT_DOMAIN/_CLIENT_ID/_CLIENT_SECRET missing in ${ENV_FILE}`)
// Hard guard: the credentials must belong to the tenant named on the command line.
if (!domain.startsWith(`${tenant}.`)) die(`AUTH_MGMT_DOMAIN is ${domain}, not the ${tenant} tenant`)
console.log(
  `Tenant: ${domain}${PROD_TENANTS.has(tenant) ? " (PROD)" : ""} — ${apply ? "APPLY" : "dry run"}`,
)

// ── Management API ──────────────────────────────────────────────────────────
const tokenRes = await fetch(`https://${domain}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: secret,
    audience: `https://${domain}/api/v2/`,
  }),
})
if (!tokenRes.ok) die(`token request failed: ${tokenRes.status}`)
const token = (await tokenRes.json()).access_token
const scopes =
  JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).scope?.split(" ") ?? []
const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s))
if (missing.length)
  die(`client lacks ${missing.join(", ")} — grant under Auth0 Management API → Application Access`)

async function mgmt(method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://${domain}/api/v2${path}`, {
      method,
      headers: { "authorization": `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 429 && attempt < 5) {
      await sleep(1000 * (attempt + 1))
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`)
    return text ? JSON.parse(text) : undefined
  }
}

// ── local Actions ───────────────────────────────────────────────────────────
function parseTags(code, file) {
  const one = (tag) => code.match(new RegExp(`@${tag}[ \\t]+(.+)`))?.[1].trim()
  const many = (tag) =>
    [...code.matchAll(new RegExp(`@${tag}[ \\t]+(.+)`, "g"))].map((m) => m[1].trim())
  const name = one("auth0-action")
  const trigger = one("auth0-trigger")
  if (!name || !trigger) die(`${file}: needs @auth0-action and @auth0-trigger header tags`)
  const dependencies = many("auth0-dependency").map((d) => {
    const at = d.lastIndexOf("@")
    if (at <= 0) die(`${file}: bad @auth0-dependency "${d}" (want name@version)`)
    return { name: d.slice(0, at), version: d.slice(at + 1) }
  })
  return {
    file,
    code,
    name,
    trigger,
    runtime: one("auth0-runtime") ?? "node22",
    dependencies,
    secrets: many("auth0-secret"),
  }
}
const local = readdirSync(folder)
  .filter((f) => f.endsWith(".js"))
  .sort()
  .map((f) => parseTags(readFileSync(join(folder, f), "utf8"), f))
const dupes = local.map((a) => a.name).filter((n, i, all) => all.indexOf(n) !== i)
if (dupes.length) die(`duplicate @auth0-action names: ${dupes.join(", ")}`)

// ── remote state ────────────────────────────────────────────────────────────
async function listActions() {
  const out = []
  for (let page = 0; ; page++) {
    const res = await mgmt("GET", `/actions/actions?per_page=100&page=${page}`)
    out.push(...res.actions)
    if (out.length >= res.total || res.actions.length === 0) return out
  }
}
const remote = await listActions()
const triggers = (await mgmt("GET", "/actions/triggers")).triggers
function currentTriggerVersion(id) {
  const t =
    triggers.find((t) => t.id === id && t.status === "CURRENT") ?? triggers.find((t) => t.id === id)
  if (!t) die(`unknown trigger "${id}" on this tenant`)
  return t.version
}

const depKey = (deps) =>
  JSON.stringify([...(deps ?? [])].map(({ name, version }) => `${name}@${version}`).sort())

async function waitBuilt(id) {
  for (let i = 0; i < 60; i++) {
    const a = await mgmt("GET", `/actions/actions/${id}`)
    if (a.status === "built") return
    if (a.status === "failed") throw new Error(`build failed for ${a.name}`)
    await sleep(1000)
  }
  throw new Error(`timed out waiting for build of ${id}`)
}

// ── dashboard instructions ──────────────────────────────────────────────────
// Secret VALUES never live in git, and the Management API can't set a secret
// without its value, so an Action that declares secrets has to be born in the
// dashboard. These print the exact clicks instead of a bare refusal. The
// labels are the dashboard's names for each trigger id; an id not listed here
// prints as-is.
const TRIGGER_LABELS = {
  "post-login": "Login / Post Login",
  "credentials-exchange": "Machine to Machine",
  "pre-user-registration": "Pre User Registration",
  "post-user-registration": "Post User Registration",
  "post-change-password": "Post Change Password",
  "send-phone-message": "Send Phone Message",
}
const runtimeLabel = (r) => r.replace(/^node(\d+)$/, "Node $1")

function secretLines(a, names) {
  return [
    ...names.map((n) => `       • ${n}`),
    `     (where each value comes from: see the header comment in ${tenant}/${a.file})`,
  ]
}

function createInDashboardSteps(a) {
  return [
    `  To create it (tenant ${tenant}):`,
    `   1. Dashboard → Actions → Library → Create Action → Build from scratch`,
    `      Name:     ${a.name}   ← exactly this; the script matches on it`,
    `      Trigger:  ${TRIGGER_LABELS[a.trigger] ?? a.trigger}`,
    `      Runtime:  ${runtimeLabel(a.runtime)}`,
    `   2. Leave the stub code — this script overwrites it.`,
    `   3. 🔑 Secrets → add each of:`,
    ...secretLines(a, a.secrets),
    `   4. Save Draft (no need to Deploy), then re-run this script.`,
    `   5. After --apply, check the trigger order in Actions → Triggers → ${a.trigger}.`,
  ].join("\n")
}

function addSecretsSteps(a, names) {
  return [
    `  Dashboard → Actions → Library → ${a.name} → 🔑 Secrets → add:`,
    ...secretLines(a, names),
    `  Save Draft, then re-run this script.`,
  ].join("\n")
}

// ── reconcile ───────────────────────────────────────────────────────────────
let changes = 0
let failures = 0
const bindingsToAdd = new Map() // trigger → [{ id, name }]

for (const a of local) {
  const existing = remote.find((r) => r.name === a.name)
  try {
    if (existing && !existing.supported_triggers.some((t) => t.id === a.trigger)) {
      throw new Error(
        `exists on the tenant for trigger ${existing.supported_triggers.map((t) => t.id).join(",")}, file says ${a.trigger} — fix by hand`,
      )
    }
    if (existing) {
      const secretNames = (existing.secrets ?? []).map((s) => s.name)
      const lacking = a.secrets.filter((s) => !secretNames.includes(s))
      if (lacking.length)
        throw new Error(
          `tenant lacks secret(s) ${lacking.join(", ")} — set them in the dashboard first\n` +
            addSecretsSteps(a, lacking),
        )
    } else if (a.secrets.length) {
      throw new Error(
        `declares secrets (${a.secrets.join(", ")}), so it can't be created from here\n` +
          createInDashboardSteps(a),
      )
    }

    const deployed = existing?.deployed_version
    const inSync =
      deployed &&
      deployed.code === a.code &&
      deployed.runtime === a.runtime &&
      depKey(deployed.dependencies) === depKey(a.dependencies)

    if (!existing) {
      console.log(`+ ${a.name} (${a.file}): create and deploy`)
      changes++
      if (apply) {
        const created = await mgmt("POST", "/actions/actions", {
          name: a.name,
          supported_triggers: [{ id: a.trigger, version: currentTriggerVersion(a.trigger) }],
          code: a.code,
          runtime: a.runtime,
          dependencies: a.dependencies,
        })
        await waitBuilt(created.id)
        const v = await mgmt("POST", `/actions/actions/${created.id}/deploy`)
        console.log(`  deployed v${v.number}`)
        bindingsToAdd.set(a.trigger, [
          ...(bindingsToAdd.get(a.trigger) ?? []),
          { id: created.id, name: a.name },
        ])
      } else {
        bindingsToAdd.set(a.trigger, [
          ...(bindingsToAdd.get(a.trigger) ?? []),
          { id: "(new)", name: a.name },
        ])
      }
      continue
    }

    if (inSync) {
      console.log(`= ${a.name}: deployed code matches`)
    } else {
      console.log(
        `~ ${a.name} (${a.file}): update and deploy${deployed ? "" : " (never deployed)"}`,
      )
      if (deployed && deployed.runtime !== a.runtime)
        console.log(`  runtime ${deployed.runtime} → ${a.runtime}`)
      if (deployed && depKey(deployed.dependencies) !== depKey(a.dependencies)) {
        console.log(`  dependencies ${depKey(deployed.dependencies)} → ${depKey(a.dependencies)}`)
      }
      if (deployed && deployed.code !== a.code) printDiff(deployed.code, a.code)
      changes++
      if (apply) {
        await mgmt("PATCH", `/actions/actions/${existing.id}`, {
          code: a.code,
          runtime: a.runtime,
          dependencies: a.dependencies,
        })
        await waitBuilt(existing.id)
        const v = await mgmt("POST", `/actions/actions/${existing.id}/deploy`)
        console.log(`  deployed v${v.number}`)
      }
    }
    bindingsToAdd.set(a.trigger, [
      ...(bindingsToAdd.get(a.trigger) ?? []),
      { id: existing.id, name: a.name },
    ])
  } catch (err) {
    failures++
    console.error(`✖ ${a.name}: ${err.message}`)
  }
}

// Bindings: append the ones that are missing, keep existing order untouched.
for (const [trigger, wanted] of bindingsToAdd) {
  const { bindings } = await mgmt("GET", `/actions/triggers/${trigger}/bindings`)
  const bound = new Set(bindings.map((b) => b.action.id))
  const add = wanted.filter((w) => !bound.has(w.id))
  const order = [...bindings.map((b) => b.display_name ?? b.action.name), ...add.map((w) => w.name)]
  if (add.length === 0) {
    console.log(`= ${trigger} bindings: ${order.join(" → ") || "(none)"}`)
    continue
  }
  console.log(
    `+ ${trigger} bindings: attach ${add.map((w) => w.name).join(", ")} → order ${order.join(" → ")}`,
  )
  changes++
  if (apply) {
    try {
      await mgmt("PATCH", `/actions/triggers/${trigger}/bindings`, {
        bindings: [
          ...bindings.map((b) => ({
            ref: { type: "action_id", value: b.action.id },
            display_name: b.display_name,
          })),
          ...add.map((w) => ({ ref: { type: "action_id", value: w.id }, display_name: w.name })),
        ],
      })
    } catch (err) {
      failures++
      console.error(`✖ ${trigger} bindings: ${err.message}`)
    }
  }
}

// Drift: on the tenant, not in the folder. Reported, never deleted.
const localNames = new Set(local.map((a) => a.name))
for (const r of remote.filter((r) => !localNames.has(r.name))) {
  console.log(
    `? ${r.name}: on the tenant (${r.supported_triggers.map((t) => t.id).join(",")}) but no file — left alone`,
  )
}

console.log(
  failures
    ? `\n${failures} failure(s).`
    : changes === 0
      ? "\nIn sync — nothing to do 💖"
      : apply
        ? `\nApplied ${changes} change(s) 💖`
        : `\n${changes} change(s) pending. Re-run with --apply.`,
)
process.exit(failures ? 1 : 0)

function printDiff(before, after) {
  // The system `diff -u` shows only the changed lines. A hand-rolled
  // prefix/suffix trim printed the whole block between the first and last
  // change, which buried a three-line edit under forty unchanged ones.
  const dir = mkdtempSync(join(tmpdir(), "auth0-action-"))
  try {
    writeFileSync(join(dir, "deployed.js"), before)
    writeFileSync(join(dir, "file.js"), after)
    const out = spawnSync("diff", ["-u", "deployed.js", "file.js"], { cwd: dir, encoding: "utf8" })
    for (const line of (out.stdout || "").split("\n").slice(2)) if (line) console.log(`  ${line}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
