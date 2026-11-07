// app/services/support/supportPolicy.test.ts
// Spec D2: the picker needs no contacts permission, so none may exist in the app's native
// config or in the module. Spans files no unit test can see, so it greps them (the pattern
// dailyDashPolicy.test.ts set).
// ADDED 2026-11-06: expo-contacts was rejected for exactly this reason (it adds READ_CONTACTS /
// WRITE_CONTACTS to the merged manifest). A future "just use expo-contacts" or a plugin that
// adds a usage string is meant to fail here. NSContactsUsageDescription was a stale app.json
// key from the old app's invite-friends idea (spec D10); Apple's picker never needs it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const repo = path.join(__dirname, "..", "..", "..")
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
const FORBIDDEN = /READ_CONTACTS|WRITE_CONTACTS|NSContactsUsageDescription/

describe("support contacts permission policy (spec D2)", () => {
  it("the module exists and declares no contacts permission", () => {
    const dir = path.join(repo, "modules", "phone-contact-picker")
    expect(existsSync(dir)).toBe(true)
    const hits = files(dir).filter((p) => FORBIDDEN.test(readFileSync(p, "utf8")))
    expect(hits).toEqual([])
  })
  it("app.json and plugins/ carry no contacts permission or usage string", () => {
    const targets = [path.join(repo, "app.json"), ...files(path.join(repo, "plugins"))]
    const hits = targets.filter((p) => FORBIDDEN.test(readFileSync(p, "utf8")))
    expect(hits).toEqual([])
  })
})

// ADDED 2026-11-06 (spec D4, Task 8): three resets clear the contacts. Spans files no unit test
// can see, so it greps them. app/db must never import the support service (depcruise and D4).
describe("support contacts reset policy (spec D4)", () => {
  const appDir = path.join(repo, "app")
  const read = (rel: string) => readFileSync(path.join(appDir, rel), "utf8")
  it("Settings Delete User Data and the dev purge call clearSupportContacts(", () => {
    expect(read("screens/SettingsScreen.tsx")).toMatch(/clearSupportContacts\(/)
    expect(read("utils/devPurge.ts")).toMatch(/clearSupportContacts\(/)
  })
  it("the database overlay Reset calls the injected resetSupportContacts", () => {
    expect(read("db/DatabaseProvider.tsx")).toMatch(/resetSupportContacts\?\.\(\)/)
  })
  it("app.tsx passes resetSupportContacts to DatabaseProvider", () => {
    expect(read("app.tsx")).toMatch(/resetSupportContacts=/)
  })
  it("nothing under app/db imports from services/support", () => {
    const db = files(path.join(appDir, "db")).filter((p) => /\.tsx?$/.test(p))
    expect(
      db.filter((p) => /from\s+["'][^"']*services\/support/.test(readFileSync(p, "utf8"))),
    ).toEqual([])
  })
})
