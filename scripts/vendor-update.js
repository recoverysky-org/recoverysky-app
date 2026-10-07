#!/usr/bin/env node
/**
 * vendor-update — refresh the vendored private packages in vendor/.
 *
 *   npm run vendor:update            # latest published @recoverysky-org/common
 *   npm run vendor:update -- 2.10.0  # an exact version (or any semver range)
 *
 * Why this exists (ADDED 2026-10-07): the private Forgejo registry (git.rso)
 * is intranet-only, so EAS cloud builds died in "Install dependencies" with
 * `ENOTFOUND git.rso`. The private packages are therefore committed as
 * `npm pack` tarballs: common as a `file:` dependency, its private deps
 * (@trex-ts/core, @jenova-marie/ts-rust-result) as `file:` overrides.
 *
 * What it does:
 *   1. Packs the requested common into vendor/.
 *   2. Walks the private dependencies of every packed tarball (recursively).
 *      A vendored version that still satisfies the new range is kept;
 *      otherwise the highest satisfying version is packed. This is the step a
 *      hand bump forgets, and overrides would hide the miss: they force the
 *      old version with no error.
 *   3. Rewrites package.json (common's dependency + the overrides), deletes
 *      tarballs nothing references any more, and runs `npm install`.
 *   4. Fails if package-lock.json still mentions git.rso, because that would
 *      break every cloud build.
 *
 * Needs the intranet (and ~/.npmrc's tokens) because it packs from git.rso.
 * Commits nothing: review, test, add a CHANGELOG Build entry, then commit.
 */
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

// eslint-disable-next-line no-undef -- CommonJS script run by node; eslint's config has no node env for scripts/
const ROOT = path.resolve(__dirname, "..")
const VENDOR = path.join(ROOT, "vendor")
const PKG_JSON = path.join(ROOT, "package.json")
const LOCK = path.join(ROOT, "package-lock.json")
const ROOT_PKG = "@recoverysky-org/common"
// Scopes served only by the intranet registry (see ~/.npmrc). A dependency in
// one of these can never be fetched by EAS cloud, so it must be vendored.
const PRIVATE_SCOPES = ["@recoverysky-org/", "@trex-ts/", "@jenova-marie/", "@dt70s/"]

let semver
try {
  semver = require("semver")
} catch {
  die("semver is not installed — run `npm install` first.")
}

function die(msg) {
  console.error(`\n✖ vendor-update: ${msg}`)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts })
}

const isPrivate = (name) => PRIVATE_SCOPES.some((s) => name.startsWith(s))
const fileSpec = (tgz) => `file:vendor/${tgz}`

/** Highest published version of `name` matching `range` (asks the registry). */
function resolveVersion(name, range) {
  let out
  try {
    out = run("npm", ["view", `${name}@${range}`, "version", "--json"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (err) {
    die(`npm view ${name}@${range} failed — are you on the intranet?\n${err.stderr || err.message}`)
  }
  const parsed = JSON.parse(out || "null")
  const versions = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  const best = semver.maxSatisfying(versions, range === "latest" ? "*" : range) ?? versions.at(-1)
  if (!best) die(`no published version of ${name} matches ${range}`)
  return best
}

/** npm pack name@version into vendor/, returning the tarball's file name. */
function pack(name, version) {
  const out = run("npm", ["pack", `${name}@${version}`, "--pack-destination", VENDOR, "--json"], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  const [info] = JSON.parse(out)
  console.log(`  📦 packed ${name}@${version} → vendor/${info.filename}`)
  return info.filename
}

/** package.json inside a vendored tarball. */
function manifestOf(tgz) {
  return JSON.parse(run("tar", ["-xOf", path.join(VENDOR, tgz), "package/package.json"]))
}

/** Currently vendored tarball for `name`, read from a package.json spec. */
function vendoredTgz(spec) {
  const m = typeof spec === "string" && spec.match(/^file:vendor\/(.+\.tgz)$/)
  return m ? m[1] : null
}

// ── main ────────────────────────────────────────────────────────────────────

const requested = process.argv[2] || "latest"
const pkg = JSON.parse(fs.readFileSync(PKG_JSON, "utf8"))
pkg.overrides ??= {}

console.log(`\n🔄 vendor-update: ${ROOT_PKG}@${requested}`)
const rootVersion = resolveVersion(ROOT_PKG, requested)

// name → tarball file name, for everything that should end up vendored.
const chosen = new Map()
chosen.set(ROOT_PKG, pack(ROOT_PKG, rootVersion))

// Walk private deps breadth-first. Overrides are global (one version per
// package), so two different ranges for one package must agree on a version.
const queue = [chosen.get(ROOT_PKG)]
const ranges = new Map() // name → [range, requiredBy][]
while (queue.length) {
  const m = manifestOf(queue.shift())
  const deps = { ...m.dependencies, ...m.peerDependencies, ...m.optionalDependencies }
  for (const [name, range] of Object.entries(deps)) {
    if (!isPrivate(name)) continue
    if (!ranges.has(name)) ranges.set(name, [])
    ranges.get(name).push([range, `${m.name}@${m.version}`])
    if (chosen.has(name)) {
      const have = manifestOf(chosen.get(name)).version
      if (!semver.satisfies(have, range)) {
        die(
          `${name}: ${m.name}@${m.version} needs ${range}, but ${have} was already chosen for ` +
            ranges
              .get(name)
              .map(([r, by]) => `${by} (${r})`)
              .join(", ") +
            ". One override can't satisfy both; publish compatible versions first.",
        )
      }
      continue
    }
    // Keep the currently vendored version when it still satisfies the range.
    const current = vendoredTgz(pkg.overrides[name] ?? pkg.dependencies?.[name])
    if (current && fs.existsSync(path.join(VENDOR, current))) {
      const have = manifestOf(current).version
      if (semver.satisfies(have, range)) {
        console.log(`  ✓ ${name}@${have} still satisfies ${range}`)
        chosen.set(name, current)
        queue.push(current)
        continue
      }
      console.log(
        `  ⚠️  ${name}@${have} does NOT satisfy ${range} (needed by ${m.name}) — repacking`,
      )
    }
    const tgz = pack(name, resolveVersion(name, range))
    chosen.set(name, tgz)
    queue.push(tgz)
  }
}

// Rewrite package.json: common is the one direct dependency; every other
// private package is an override (the app imports none of them directly).
const before = JSON.stringify(pkg)
for (const [name, tgz] of chosen) {
  if (name === ROOT_PKG) pkg.dependencies[name] = fileSpec(tgz)
  else pkg.overrides[name] = fileSpec(tgz)
}
// Drop overrides for private packages nothing depends on any more.
for (const name of Object.keys(pkg.overrides)) {
  if (isPrivate(name) && !chosen.has(name) && vendoredTgz(pkg.overrides[name])) {
    console.log(`  🗑️  dropping override ${name} (no longer a dependency)`)
    delete pkg.overrides[name]
  }
}
if (JSON.stringify(pkg) !== before) {
  fs.writeFileSync(PKG_JSON, JSON.stringify(pkg, null, 2) + "\n")
  console.log("  ✏️  package.json updated")
}

// Delete tarballs nothing references any more.
const keep = new Set(chosen.values())
for (const f of fs.readdirSync(VENDOR)) {
  if (f.endsWith(".tgz") && !keep.has(f)) {
    fs.rmSync(path.join(VENDOR, f))
    console.log(`  🗑️  removed vendor/${f}`)
  }
}

console.log("\n📥 npm install …")
run("npm", ["install"], { stdio: "inherit" })

// The tarballs must still exist after install (one went missing once during
// a relock — see the 2026-10-07 CHANGELOG Build entry).
for (const tgz of keep) {
  if (!fs.existsSync(path.join(VENDOR, tgz))) die(`vendor/${tgz} disappeared during npm install`)
}

const leaks = fs.readFileSync(LOCK, "utf8").match(/git\.rso/g)?.length ?? 0
if (leaks) die(`package-lock.json still references git.rso ${leaks}× — EAS cloud builds will fail.`)

console.log(`
✅ Vendored:
${[...chosen].map(([n, t]) => `   ${n.padEnd(32)} vendor/${t}`).join("\n")}

Next: npm run compile && npm test, add a CHANGELOG Build entry, then
  git add package.json package-lock.json vendor/ && git commit
A common bump is JS-only, so it can ship as an OTA (npm run update).
`)
