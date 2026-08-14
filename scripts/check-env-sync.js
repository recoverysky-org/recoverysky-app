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
 * CHANGED 2026-08-13: the comment above says a drifted `.env` "no longer
 * reaches production" — true, but it left the OTA's ACTUAL source unchecked by
 * anything. `EXPO_PUBLIC_FELLOWSHIPS` was set to `AA,NA,CMA,RD` in `.env` AND
 * `eas.json` on 2026-08-04 while the EAS server-side `production` environment
 * stayed at `AA,NA,CMA`, so every OTA from then on silently shipped an app with
 * Recovery Dharma missing from all five fellowship pickers — while the store
 * binary built from the same commit had it. This script reported IN SYNC the
 * whole time, because it was comparing the two sources that agreed. So it now
 * also diffs `eas.json` against the EAS environment (see EAS CHECK below).
 *
 * WHAT IT CHECKS
 * --------------
 * (1) `.env` vs `eas.json` — merges `eas.json`'s `<profile>` env (walking the
 * `extends` chain, default profile `production`) and compares every
 * `EXPO_PUBLIC_*` key against `.env`:
 *   - MISSING  — key is in eas.json but absent from `.env`          (drift)
 *   - MISMATCH — key is in both but the values differ               (drift)
 *   - EXTRA    — `EXPO_PUBLIC_*` key in `.env` not in eas.json      (warning)
 *
 * (2) EAS CHECK — `eas.json` vs the EAS server-side Environment Variables, via
 * `eas env:list <environment> --format long`. This is the pairing that decides
 * whether a native build and an OTA published from the same commit contain the
 * same config:
 *   - `eas build`  reads the profile's `env` map in `eas.json` (eas-cli says so
 *                  out loud: "The values from the build profile configuration
 *                  will be used" when a key is defined in both places)
 *   - `eas update` reads ONLY the EAS environment named by `--environment`
 *                  (see `release:ota` in package.json) — it does not look at
 *                  `eas.json` at all, and server values beat local `.env`
 * Any difference here means "the OTA ships different config than the binary":
 *   - EAS_MISSING  — key in eas.json, absent from the EAS environment (drift)
 *   - EAS_MISMATCH — key in both, values differ                      (drift)
 *   - EAS_EXTRA    — key on EAS, not in eas.json                     (warning)
 *   - EAS_MASKED   — sensitive/secret var, value not readable        (skipped)
 * The environment name comes from the profile's own `environment` field
 * (walking `extends`), falling back to the profile name.
 *
 * EXIT CODES
 * ----------
 *   0  in sync (no missing, no mismatch; extras are warnings only)
 *   1  drift found (at least one missing or mismatched key, either check)
 *   2  usage / file error (bad flag, unreadable eas.json, missing .env), OR the
 *      EAS environment could not be read (not logged in, offline, no such
 *      environment). Deliberately NOT exit 0: "couldn't check" must never be
 *      reported as "in sync" — that's the failure mode this whole section
 *      exists to prevent. Pass `--no-eas` to skip the EAS check on purpose.
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
 *   --eas-env <name>    EAS environment to diff against (default: the profile's
 *                       `environment` field, else the profile name)
 *   --eas-only          run ONLY check (2). This is what `bump-update.sh` calls:
 *                       check (1) reports expected drift on any dev machine
 *                       (localhost API URL, debug log level), so gating a
 *                       publish on it would block every OTA and train everyone
 *                       to skip the gate.
 *   --no-eas            skip the EAS check entirely (offline / no login)
 *   --help              print this usage
 */

const { spawnSync } = require("child_process")
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
  const opts = {
    profile: "production",
    envFile: path.join(ROOT, ".env"),
    all: false,
    // EAS check is opt-OUT, not opt-in: it guards the source that actually
    // reaches OTA users, so the default run has to cover it.
    eas: true,
    easEnv: null,
    easOnly: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--help" || a === "-h") opts.help = true
    else if (a === "--all") opts.all = true
    else if (a === "--no-eas") opts.eas = false
    else if (a === "--eas-only") opts.easOnly = true
    else if (a === "--eas-env") opts.easEnv = argv[++i]
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

// --- resolve which EAS environment a profile publishes/builds against ---
// The `environment` field is what `eas build` passes to the server and what
// `release:ota` mirrors with `--environment`. Walking `extends` matters because
// a child profile can inherit it from `base`.
function resolveProfileEnvironment(build, name, seen = new Set()) {
  const profile = build[name]
  if (!profile) return null
  if (profile.environment) return profile.environment
  if (profile.extends && !seen.has(profile.extends)) {
    seen.add(profile.extends)
    return resolveProfileEnvironment(build, profile.extends, seen)
  }
  return null
}

// --- read the EAS server-side environment via eas-cli ---
// Uses `--format long` rather than the default short `KEY=value` format: long
// prints an explicit `Visibility` field, which is the only reliable way to tell
// a genuinely-empty value from a masked sensitive/secret one. Short format
// renders both as something we'd have to guess at, and guessing here would mean
// reporting a false MISMATCH on every sensitive var.
//
// Returns { vars: { KEY: { value, visibility } } } or { error: string }.
function fetchEasEnv(envName) {
  const res = spawnSync("npx", ["eas", "env:list", envName, "--format", "long"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    // eas-cli prompts (login, project select) would hang a script run; no TTY
    // on stdin makes it fail fast instead.
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (res.error) return { error: `could not run eas-cli: ${res.error.message}` }
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || "").trim().split("\n").slice(-3).join(" ")
    return { error: `eas env:list exited ${res.status}${detail ? ` — ${detail}` : ""}` }
  }

  // Records are separated by an em-dash rule; fields are `Name<2+ spaces>Value`.
  // A `Value` may legitimately be empty, so match the label with an optional
  // remainder rather than requiring one.
  const vars = {}
  const records = (res.stdout || "").split(/^\s*—+\s*$/m)
  for (const record of records) {
    let name = null
    let value = null
    let visibility = null
    for (const line of record.split("\n")) {
      const m = /^(Name|Value|Visibility)\s{2,}(.*)$/.exec(line)
      if (!m) continue
      if (m[1] === "Name") name = m[2].trim()
      else if (m[1] === "Value") value = m[2]
      else visibility = m[2].trim().toUpperCase()
    }
    // A record with a Name but no Value line is a masked variable: eas-cli
    // omits the field entirely for secrets rather than printing asterisks.
    if (name) vars[name] = { value: value === null ? null : value.trim(), visibility }
  }
  if (Object.keys(vars).length === 0) {
    // An environment with nothing in it is a REAL state, not a parse failure —
    // `preview` and `development` are both empty today, and the honest report
    // for those is "every key MISSING" (an OTA on that channel ships the code's
    // fallbacks), not "unreadable". eas-cli says so explicitly, so key off that
    // rather than on the empty parse, which is also what a format change looks
    // like.
    const sawEnvironment = new RegExp(`^Environment:\\s*${envName}\\s*$`, "m").test(
      res.stdout || "",
    )
    const sawEmptyNotice = /No variables found for this environment/i.test(res.stdout || "")
    if (sawEnvironment && sawEmptyNotice) return { vars: {}, empty: true }
    return {
      error: `no variables parsed from "${envName}" — eas-cli output format may have changed`,
    }
  }
  return { vars }
}

// A value we cannot read cannot be compared. Treating these as drift would make
// SENTRY_AUTH_TOKEN (sensitive) fail every `--all` run forever, and people would
// learn to ignore the whole report.
function isMasked(entry) {
  if (!entry) return false
  if (entry.visibility && entry.visibility !== "PUBLIC") return true
  return entry.value === null || /^\*{3,}$/.test(entry.value)
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
  if (opts.easOnly && !opts.eas) {
    console.error(red(`--eas-only and --no-eas are contradictory — that would check nothing.`))
    process.exit(2)
  }
  if (opts.help) {
    console.log(
      [
        "check-env-sync.js — verify .env and the EAS environment match eas.json",
        "",
        "Usage:",
        "  node scripts/check-env-sync.js [--profile <name>] [--env-file <path>] [--all]",
        "  npm run check:env",
        "",
        "Checks:",
        "  1. .env    vs eas.json[build.<profile>.env]  — what native builds bake in",
        "  2. EAS env vs eas.json[build.<profile>.env]  — what OTAs bake in",
        "",
        "Flags:",
        "  --profile <name>   eas.json build profile to compare (default: production)",
        "  --env-file <path>  .env file to check (default: ./.env)",
        "  --all              compare all keys, not just EXPO_PUBLIC_*",
        "  --eas-env <name>   EAS environment to diff (default: profile's `environment`)",
        "  --eas-only         run ONLY check 2 (the OTA gate — ignores local .env)",
        "  --no-eas           skip the EAS check (offline / not logged in)",
        "  --help             show this help",
        "",
        "Exit: 0 in sync · 1 drift (missing/mismatch) · 2 usage/file error or EAS unreadable",
      ].join("\n"),
    )
    process.exit(0)
  }

  // load eas.json
  const easPath = path.join(ROOT, "eas.json")
  let easEnv
  let easEnvName = opts.easEnv
  try {
    const eas = JSON.parse(fs.readFileSync(easPath, "utf8"))
    easEnv = resolveProfileEnv(eas.build || {}, opts.profile)
    if (!easEnvName) {
      easEnvName = resolveProfileEnvironment(eas.build || {}, opts.profile) || opts.profile
    }
  } catch (err) {
    console.error(red(`Failed to read ${easPath}: ${err.message}`))
    process.exit(2)
  }

  // which keys to compare
  const keep = (k) => opts.all || k.startsWith("EXPO_PUBLIC_")
  const easKeys = Object.keys(easEnv).filter(keep).sort()

  let drift = 0
  let extra = []

  // --- CHECK 1: .env vs eas.json. Skipped under --eas-only, which exists for
  // `bump-update.sh`'s preflight: a developer's `.env` legitimately points at
  // localhost with debug logging, so gating an OTA on it would block every
  // publish from a dev machine and teach everyone to bypass the gate. The EAS
  // check below is the one with production consequences.
  if (!opts.easOnly) {
    if (!fs.existsSync(opts.envFile)) {
      console.error(red(`No env file at ${opts.envFile}`))
      process.exit(2)
    }
    const envVars = parseEnvFile(opts.envFile)
    const envKeys = Object.keys(envVars).filter(keep)

    const missing = [] // in eas.json, not in .env
    const mismatch = [] // in both, values differ
    const ok = [] // in both, equal
    for (const k of easKeys) {
      if (!(k in envVars)) missing.push(k)
      else if (envVars[k] !== easEnv[k]) mismatch.push(k)
      else ok.push(k)
    }
    extra = envKeys.filter((k) => !(k in easEnv)).sort()

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

    drift = missing.length + mismatch.length
  }

  // --- EAS CHECK: eas.json (what builds bake in) vs the EAS environment (what
  // OTAs bake in). See the header block for why this is the pairing that
  // matters and what shipped broken without it.
  let easUnreadable = null
  if (opts.eas) {
    console.log("")
    console.log(
      bold(`env-sync: eas.json[build.${opts.profile}] vs EAS environment "${easEnvName}"`) +
        dim(`  (OTA source)`),
    )
    console.log(dim("─".repeat(60)))
    console.log(dim(`  querying eas-cli…`))

    const remote = fetchEasEnv(easEnvName)
    if (remote.error) {
      easUnreadable = remote.error
      console.log(red(bold(`✗ EAS ENVIRONMENT UNREADABLE`)))
      console.log(`  ${remote.error}`)
      console.log(dim(`  (run \`npx eas login\`, or pass --no-eas to skip this check)`))
    } else {
      if (remote.empty) {
        // eas-cli reports an unknown environment name exactly like a real-but-
        // empty one (exit 0 + "No variables found"), so we cannot tell them
        // apart — say so rather than asserting the environment exists.
        console.log(
          yellow(
            `⚠ EAS environment "${easEnvName}" has no variables (or does not exist — eas-cli\n` +
              `  reports both the same way). An OTA published against it ships the code's\n` +
              `  built-in fallbacks for every key below.`,
          ),
        )
      }
      const easMissing = [] // in eas.json, not on EAS → OTA falls back to the code default
      const easMismatch = [] // both, differ → OTA ships different config than the binary
      const easMasked = [] // sensitive/secret → cannot compare
      const easOk = []
      for (const k of easKeys) {
        const entry = remote.vars[k]
        if (!entry) easMissing.push(k)
        else if (isMasked(entry)) easMasked.push(k)
        else if (entry.value !== easEnv[k]) easMismatch.push(k)
        else easOk.push(k)
      }
      const easExtra = Object.keys(remote.vars)
        .filter(keep)
        .filter((k) => !(k in easEnv))
        .sort()

      if (easMismatch.length) {
        console.log(
          red(bold(`✗ ${easMismatch.length} MISMATCH — OTA would ship a different value`)),
        )
        for (const k of easMismatch) {
          console.log(`  ${red(k)}`)
          console.log(`      eas.json (native build): ${green(easEnv[k])}`)
          console.log(`      EAS "${easEnvName}" (OTA): ${yellow(remote.vars[k].value)}`)
        }
      }
      if (easMissing.length) {
        console.log(red(bold(`✗ ${easMissing.length} MISSING from EAS "${easEnvName}"`)))
        for (const k of easMissing) {
          console.log(`  ${red(k)} = ${green(easEnv[k])} ${dim("(eas.json)")}`)
          console.log(
            dim(
              `      fix: npx eas env:create ${easEnvName} --name ${k} --value "${easEnv[k]}" --visibility plaintext --scope project --non-interactive`,
            ),
          )
        }
      }
      if (easExtra.length) {
        console.log(yellow(bold(`⚠ ${easExtra.length} EXTRA on EAS (not in eas.json)`)))
        for (const k of easExtra)
          console.log(`  ${yellow(k)} = ${dim(remote.vars[k].value ?? "*****")}`)
      }
      if (easMasked.length) {
        console.log(
          dim(`· ${easMasked.length} not comparable (sensitive/secret): ${easMasked.join(", ")}`),
        )
      }
      if (easOk.length) console.log(green(`✓ ${easOk.length} in sync`))

      if (easMismatch.length || easMissing.length) {
        console.log("")
        console.log(
          dim(
            `  Remember: \`eas update\` reads ONLY the EAS environment — not eas.json, not .env.\n` +
              `  Fix the variable, then re-publish, or the OTA ships the stale value.`,
          ),
        )
        console.log(
          dim(
            `  update: npx eas env:update ${easEnvName} --variable-name <KEY> --value "<VALUE>" --visibility plaintext --scope project --non-interactive`,
          ),
        )
      }
      drift += easMismatch.length + easMissing.length
    }
  }

  console.log(dim("─".repeat(60)))
  if (easUnreadable) {
    // Exit 2, not 0: we did not verify the OTA source, so we must not claim it
    // is in sync. `bump-update.sh` treats any non-zero as blocking.
    console.log(red(bold(`✗ COULD NOT VERIFY — EAS environment unreadable`)))
    process.exit(2)
  }
  if (drift === 0) {
    console.log(
      green(bold(`✓ IN SYNC`)) + (extra.length ? yellow(` (with ${extra.length} extra)`) : ""),
    )
    process.exit(0)
  }
  console.log(red(bold(`✗ OUT OF SYNC — ${drift} key(s) differ`)))
  process.exit(1)
}

main()
