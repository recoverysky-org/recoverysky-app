#!/usr/bin/env node
/**
 * check-env-sync.js — verify a local `.env` matches the canonical prod config
 * in `eas.json`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `EXPO_PUBLIC_*` values are inlined into the JS bundle at build/export time.
 * They come from different places depending on the command:
 *   - `eas build`  → the profile's `env` map in `eas.json`
 *   - `eas update` → historically the developer's local `.env` (this bit us:
 *                    a stray dev URL in `.env` shipped in a production OTA).
 *
 * We since moved OTA config to EAS server-side Environment Variables
 * (`eas update --environment production`), so a drifted `.env` no longer
 * reaches production. But keeping `.env` aligned with `eas.json` still:
 *   - catches an INCOMPLETE `.env` (missing a key the app now reads), and
 *   - makes "am I pointed at dev or prod?" explicit instead of a mystery.
 *
 * This is a sanity/CI tool, not a release gate. During normal local dev you
 * WILL see mismatches (localhost API URL, debug log level, etc.) — that's the
 * point: it tells you truthfully whether `.env` currently equals prod.
 *
 * WHAT IT CHECKS
 * --------------
 * Merges `eas.json`'s `<profile>` env (walking the `extends` chain, default
 * profile `production`) and compares every `EXPO_PUBLIC_*` key against `.env`:
 *   - MISSING  — key is in eas.json but absent from `.env`          (drift)
 *   - MISMATCH — key is in both but the values differ               (drift)
 *   - EXTRA    — `EXPO_PUBLIC_*` key in `.env` not in eas.json      (warning)
 *
 * EXIT CODES
 * ----------
 *   0  in sync (no missing, no mismatch; extras are warnings only)
 *   1  drift found (at least one missing or mismatched key)
 *   2  usage / file error (bad flag, unreadable eas.json, missing .env)
 *
 * USAGE
 * -----
 *   node scripts/check-env-sync.js [--profile <name>] [--env-file <path>] [--all]
 *   npm run check:env
 *
 * FLAGS
 *   --profile <name>    eas.json build profile to compare against (default: production)
 *   --env-file <path>   .env file to check (default: ./.env)
 *   --all               compare ALL keys, not just EXPO_PUBLIC_* (includes
 *                       build-only vars like SENTRY_AUTH_TOKEN / EXPO_NO_CAPABILITY_SYNC)
 *   --help              print this usage
 */

const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")

// --- tiny ANSI helpers (respect NO_COLOR and non-TTY) ---
const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const red = (s) => c("31", s)
const green = (s) => c("32", s)
const yellow = (s) => c("33", s)
const bold = (s) => c("1", s)
const dim = (s) => c("2", s)

// --- arg parsing ---
function parseArgs(argv) {
  const opts = { profile: "production", envFile: path.join(ROOT, ".env"), all: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--help" || a === "-h") opts.help = true
    else if (a === "--all") opts.all = true
    else if (a === "--profile") opts.profile = argv[++i]
    else if (a === "--env-file") opts.envFile = path.resolve(argv[++i])
    else {
      console.error(red(`Unknown argument: ${a}`))
      opts.bad = true
    }
  }
  return opts
}

// --- resolve a build profile's env, walking `extends` (base first, child wins) ---
function resolveProfileEnv(build, name, seen = new Set()) {
  const profile = build[name]
  if (!profile) throw new Error(`profile "${name}" not found in eas.json build{}`)
  let inherited = {}
  if (profile.extends && !seen.has(profile.extends)) {
    seen.add(profile.extends)
    inherited = resolveProfileEnv(build, profile.extends, seen)
  }
  return { ...inherited, ...(profile.env || {}) }
}

// --- parse a .env file into { KEY: value } ---
// Handles `export KEY=`, surrounding quotes, and trailing ` # comment` on
// unquoted values. Deliberately simple — good enough for this project's vars.
function parseEnvFile(file) {
  const text = fs.readFileSync(file, "utf8")
  const out = {}
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    let key = line.slice(0, eq).trim()
    if (key.startsWith("export ")) key = key.slice("export ".length).trim()
    let value = line.slice(eq + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted) {
      value = value.slice(1, -1)
    } else {
      // strip an inline comment on an unquoted value (space + '#')
      const hash = value.indexOf(" #")
      if (hash !== -1) value = value.slice(0, hash).trim()
    }
    out[key] = value
  }
  return out
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.bad) process.exit(2)
  if (opts.help) {
    console.log(
      [
        "check-env-sync.js — verify a local .env matches eas.json prod config",
        "",
        "Usage:",
        "  node scripts/check-env-sync.js [--profile <name>] [--env-file <path>] [--all]",
        "  npm run check:env",
        "",
        "Flags:",
        "  --profile <name>   eas.json build profile to compare (default: production)",
        "  --env-file <path>  .env file to check (default: ./.env)",
        "  --all              compare all keys, not just EXPO_PUBLIC_*",
        "  --help             show this help",
        "",
        "Exit: 0 in sync · 1 drift (missing/mismatch) · 2 usage/file error",
      ].join("\n"),
    )
    process.exit(0)
  }

  // load eas.json
  const easPath = path.join(ROOT, "eas.json")
  let easEnv
  try {
    const eas = JSON.parse(fs.readFileSync(easPath, "utf8"))
    easEnv = resolveProfileEnv(eas.build || {}, opts.profile)
  } catch (err) {
    console.error(red(`Failed to read ${easPath}: ${err.message}`))
    process.exit(2)
  }

  // load .env
  if (!fs.existsSync(opts.envFile)) {
    console.error(red(`No env file at ${opts.envFile}`))
    process.exit(2)
  }
  const envVars = parseEnvFile(opts.envFile)

  // which keys to compare
  const keep = (k) => opts.all || k.startsWith("EXPO_PUBLIC_")
  const easKeys = Object.keys(easEnv).filter(keep).sort()
  const envKeys = Object.keys(envVars).filter(keep)

  const missing = [] // in eas.json, not in .env
  const mismatch = [] // in both, values differ
  const ok = [] // in both, equal
  for (const k of easKeys) {
    if (!(k in envVars)) missing.push(k)
    else if (envVars[k] !== easEnv[k]) mismatch.push(k)
    else ok.push(k)
  }
  const extra = envKeys.filter((k) => !(k in easEnv)).sort()

  // report
  const rel = path.relative(ROOT, opts.envFile) || opts.envFile
  console.log(
    bold(`env-sync: ${rel} vs eas.json[build.${opts.profile}]`) +
      dim(`  (${opts.all ? "all keys" : "EXPO_PUBLIC_* only"})`),
  )
  console.log(dim("─".repeat(60)))

  if (mismatch.length) {
    console.log(red(bold(`✗ ${mismatch.length} MISMATCH`)))
    for (const k of mismatch) {
      console.log(`  ${red(k)}`)
      console.log(`      eas.json: ${green(easEnv[k])}`)
      console.log(`      ${rel}: ${yellow(envVars[k])}`)
    }
  }
  if (missing.length) {
    console.log(red(bold(`✗ ${missing.length} MISSING from ${rel}`)))
    for (const k of missing) console.log(`  ${red(k)} = ${green(easEnv[k])} ${dim("(eas.json)")}`)
  }
  if (extra.length) {
    console.log(yellow(bold(`⚠ ${extra.length} EXTRA in ${rel} (not in eas.json)`)))
    for (const k of extra) console.log(`  ${yellow(k)} = ${dim(envVars[k])}`)
  }
  if (ok.length) console.log(green(`✓ ${ok.length} in sync`))

  console.log(dim("─".repeat(60)))
  const drift = missing.length + mismatch.length
  if (drift === 0) {
    console.log(green(bold(`✓ IN SYNC`)) + (extra.length ? yellow(` (with ${extra.length} extra)`) : ""))
    process.exit(0)
  }
  console.log(red(bold(`✗ OUT OF SYNC — ${drift} key(s) differ`)))
  process.exit(1)
}

main()
