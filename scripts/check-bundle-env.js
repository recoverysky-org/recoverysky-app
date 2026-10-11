#!/usr/bin/env node
/**
 * check-bundle-env.js - after an OTA export, fail if a bundle carries a local
 * EXPO_PUBLIC_* value that the EAS environment does not define.
 *
 * Usage: node scripts/check-bundle-env.js [distDir] [--environment <name>]
 *   distDir defaults to `dist`, where `eas update` exports. The environment
 *   defaults to `production`.
 * Exit:  0 no local-only value in any bundle
 *        1 a bundle carries one (the variable names are printed)
 *        2 nothing was checked (no bundles found, or EAS unreadable)
 * Prints variable NAMES only, never values: the dev API key is one of the
 * values this exists to catch.
 *
 * ADDED 2026-10-11. `eas update --environment production` overlays the EAS
 * production variables on the shell's environment, and direnv loads .env into
 * that shell, so every EXPO_PUBLIC_* that EAS did not define shipped with its
 * local value. OTA 4.11.0-1 showed the Sky Agent tab pointed at the dev agent
 * URL, and EXPO_PUBLIC_AUTH_KEY rode along in every bundle. scripts/eas-prod.sh
 * now strips the shell's values; this is the tripwire for anything that gets
 * around it. bump-update.sh pushes before it publishes, so this runs after the
 * OTA is live: it reports a leak the moment it ships, it cannot stop one.
 */

const fs = require("fs")
const path = require("path")

const { fetchEasEnv, parseEnvFile } = require("./check-env-sync")

// eslint-disable-next-line no-undef -- CommonJS script run by node; eslint's config has no node env for scripts/
const ROOT = path.resolve(__dirname, "..")

/**
 * Shorter values are not searched for. A 2-character "30" turns up somewhere
 * in any multi-megabyte bundle by chance and would fire on every release;
 * every value worth catching (a URL, a key, an id) is longer.
 */
const MIN_VALUE_LENGTH = 6

/**
 * Which local values must not appear in a bundle: EXPO_PUBLIC_* (the only
 * names Expo inlines) that the EAS environment does not define, long enough to
 * search for, and not written literally in app source, since a default
 * hardcoded in code is meant to ship. `local` is [name, value] pairs, so .env
 * and the shell can each contribute a value for one name. Pure, for the test.
 */
function leakCandidates({ local, easNames, sourceText }) {
  const seen = new Set()
  const out = []
  for (const [name, value] of local) {
    if (!name.startsWith("EXPO_PUBLIC_") || easNames.has(name)) continue
    if (typeof value !== "string" || value.length < MIN_VALUE_LENGTH) continue
    if (sourceText.includes(value)) continue
    const key = `${name}=${value}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, value })
  }
  return out
}

/** Each candidate found in a bundle, with the bundles it is in: { name: [labels] }. Pure. */
function findLeaks(candidates, bundles) {
  const leaks = {}
  for (const { name, value } of candidates) {
    // eslint-disable-next-line no-undef -- node global, see ROOT above
    const needle = Buffer.from(value, "utf8")
    for (const [label, bytes] of Object.entries(bundles)) {
      if (!bytes.includes(needle)) continue
      leaks[name] = leaks[name] || []
      if (!leaks[name].includes(label)) leaks[name].push(label)
    }
  }
  return leaks
}

/** Every file under `dir` whose name passes `keep`, skipping node_modules. */
function walk(dir, keep, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(full, keep, out)
    } else if (keep(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** The exported bundles (Hermes .hbc, or .js with bytecode off), keyed `<platform>/<file>`. */
function readBundles(distDir) {
  const jsRoot = path.join(distDir, "_expo", "static", "js")
  const bundles = {}
  for (const file of walk(jsRoot, (n) => n.endsWith(".hbc") || n.endsWith(".js"))) {
    bundles[path.relative(jsRoot, file)] = fs.readFileSync(file)
  }
  return bundles
}

/** The app source a bundle is built from, tests excluded. */
function readSourceText() {
  return walk(path.join(ROOT, "app"), (n) => /\.(ts|tsx|js|jsx)$/.test(n) && !n.includes(".test."))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n")
}

/** Local values: .env plus this shell's EXPO_PUBLIC_*, which direnv fills from .env. */
function readLocal() {
  const local = []
  const envFile = path.join(ROOT, ".env")
  if (fs.existsSync(envFile)) local.push(...Object.entries(parseEnvFile(envFile)))
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("EXPO_PUBLIC_")) local.push([name, value])
  }
  return local
}

function main() {
  const args = process.argv.slice(2)
  let distArg = "dist"
  let environment = "production"
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--environment") environment = args[++i]
    else distArg = args[i]
  }
  const distDir = path.resolve(ROOT, distArg)

  const bundles = readBundles(distDir)
  const labels = Object.keys(bundles)
  if (labels.length === 0) {
    console.error(`check-bundle-env: no bundles under ${distArg}/_expo/static/js, nothing checked`)
    process.exit(2)
  }

  const eas = fetchEasEnv(environment)
  if (eas.error) {
    console.error(
      `check-bundle-env: EAS "${environment}" unreadable (${eas.error}), nothing checked`,
    )
    process.exit(2)
  }

  const candidates = leakCandidates({
    local: readLocal(),
    easNames: new Set(Object.keys(eas.vars)),
    sourceText: readSourceText(),
  })
  const leaks = findLeaks(candidates, bundles)
  const names = Object.keys(leaks).sort()
  if (names.length > 0) {
    console.error(`✗ ${names.length} local-only value(s) found in the exported bundles:`)
    for (const name of names) console.error(`  ${name}  (${leaks[name].join(", ")})`)
    console.error(`  Each is missing from the EAS "${environment}" environment, so the bundle took`)
    console.error(
      `  the local value. Run eas through scripts/eas-prod.sh, or add the variable to EAS.`,
    )
    process.exit(1)
  }
  const checked = new Set(candidates.map((c) => c.name)).size
  console.log(
    `✓ No local-only values in ${labels.length} bundle(s) (${checked} variable(s) checked).`,
  )
  process.exit(0)
}

if (require.main === module) main()

module.exports = { leakCandidates, findLeaks }
