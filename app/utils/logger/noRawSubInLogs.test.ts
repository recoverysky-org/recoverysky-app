/**
 * Guard: no log call ships an Auth0 sub raw.
 *
 * ADDED 2026-10-02. Logs carry `hashUserId(sub)` only (CLAUDE.md "Logging"):
 * a sub embeds the Google/Apple account id. The logger hashes its own
 * `userId` context field, but a caller attribute named anything else goes to
 * Loki as written — and six lines did exactly that: the sync owner-switch
 * lines (`previousOwner`, `uid`) and four `uid` attributes in the Api class
 * (reminders, report resend), all fed from `authStore.userId`, which IS the
 * raw sub. Most of those files import `@/`, so no unit test can reach them;
 * this scans the source instead.
 *
 * What it checks: in every `log.*` / `logger.*` call with an inline attribute
 * object, a key that names a user id (see SUB_KEYS) must have a value that
 * goes through `hashUserId(...)` (or a helper whose name says it hashes).
 * Shorthand (`{ uid }`) is always a violation. It is a regex scan, not a
 * parser: it can miss an attribute object built elsewhere and passed by
 * variable. Keep attribute objects inline, or hash before building them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const APP_ROOT = join(__dirname, "..", "..")

// Attribute names that, in this codebase, hold an Auth0 sub. `userId` and
// `user_id` are absent on purpose: the logger reserves and hashes those.
const SUB_KEYS = ["uid", "sub", "ownerSub", "previousOwner", "foreignSub", "acceptedSub"]

// A value counts as hashed when it calls hashUserId or a helper whose name
// says so (e.g. ownerSwitchLogAttributes hashes inside; it is spread, not
// keyed, so it never reaches this check).
const HASHED = /hashUserId\s*\(/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) return []
    return [path]
  })
}

// `log.info("message", { ... })` / `logger.child(...).warn(...)` etc.
const LOG_CALL =
  /\blog(?:ger)?\w*\s*\.\s*(?:debug|info|warn|error)\s*\(\s*(["'`])[\s\S]*?\1\s*,\s*\{([^{}]*)\}/g

function rawSubAttributes(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(LOG_CALL)) {
    const attrs = match[2]
    for (const key of SUB_KEYS) {
      // `key: value` up to the next comma at this depth, or shorthand `key`.
      const keyed = new RegExp(`(?:^|[,\\s])${key}\\s*:\\s*([^,]+)`).exec(attrs)
      if (keyed) {
        if (!HASHED.test(keyed[1])) found.push(`${key}: ${keyed[1].trim()}`)
        continue
      }
      if (new RegExp(`(?:^|[,{\\s])${key}\\s*(?:,|$)`).test(attrs)) found.push(`${key} (shorthand)`)
    }
  }
  return found
}

describe("rawSubAttributes (the scanner itself)", () => {
  it("flags shorthand and unhashed values", () => {
    expect(rawSubAttributes(`log.info("x", { uid })`)).toEqual(["uid (shorthand)"])
    expect(rawSubAttributes(`log.info("x", { reportId: id, uid: params.uid })`)).toEqual([
      "uid: params.uid",
    ])
  })

  it("catches the two sync lines that shipped raw subs (one-line and multi-line)", () => {
    expect(
      rawSubAttributes(`log.info("Account switch — clearing", { previousOwner, uid })`),
    ).toEqual(["uid (shorthand)", "previousOwner (shorthand)"])
    expect(
      rawSubAttributes(`log.error("Failed to clear foreign outbox", {
        previousOwner,
        uid,
        error: String(err),
      })`),
    ).toEqual(["uid (shorthand)", "previousOwner (shorthand)"])
  })

  it("accepts hashed values and ignores keys that only contain a sub-like word", () => {
    expect(rawSubAttributes(`log.info("x", { uid: hashUserId(uid) })`)).toEqual([])
    expect(rawSubAttributes(`log.warn("x", { ownerId: hashUserId(a), subscription: s })`)).toEqual(
      [],
    )
  })
})

describe("app log calls", () => {
  it("never attach an Auth0 sub raw", () => {
    const offenders = sourceFiles(APP_ROOT).flatMap((file) =>
      rawSubAttributes(readFileSync(file, "utf8")).map(
        (hit) => `${relative(APP_ROOT, file)}: ${hit}`,
      ),
    )
    expect(offenders).toEqual([])
  })
})
