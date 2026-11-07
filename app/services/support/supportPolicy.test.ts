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
    // CHANGED 2026-11-06 (Task 8 fix round 1): the call must sit OUTSIDE the steps 1-7 try,
    // after its catch and before the database reset, so a throw from an earlier step cannot skip it.
    const settings = read("screens/SettingsScreen.tsx")
    const call = settings.indexOf("clearSupportContacts()")
    expect(call).toBeGreaterThan(settings.indexOf("Even if some steps fail"))
    expect(call).toBeLessThan(settings.indexOf("resetLocalDatabase("))
    expect(read("utils/devPurge.ts")).toMatch(/clearSupportContacts\(/)
  })
  it("the database overlay Reset calls the injected resetSupportContacts", () => {
    expect(read("db/DatabaseProvider.tsx")).toMatch(/resetSupportContacts\?\.\(\)/)
  })
  it("app.tsx passes resetSupportContacts to DatabaseProvider", () => {
    expect(read("app.tsx")).toMatch(/resetSupportContacts=/)
  })
  // ADDED 2026-11-06 (final review I-3, M-6): init's wiring has no unit test. The loader's branches
  // do (supportLoader.test.ts), so what needs pinning here is that init uses it and retries.
  it("app.tsx loads through createSupportLoader and retries on the active edge", () => {
    const app = read("app.tsx")
    expect(app).toMatch(/createSupportLoader\(\{\s*clearPending: !restoredState/)
    expect(app).toMatch(/nextState === "active" && !supportStore\.hydrated/)
    expect(app).not.toMatch(/if \(!restoredState\) await clearSupportContacts\(\)/)
  })
  it("nothing under app/db imports from services/support", () => {
    const db = files(path.join(appDir, "db")).filter((p) => /\.tsx?$/.test(p))
    expect(
      db.filter((p) => /from\s+["'][^"']*services\/support/.test(readFileSync(p, "utf8"))),
    ).toEqual([])
  })
})

// ADDED 2026-11-06 (final review I-1): a native iOS modal is a presented view controller that
// covers the root view, and ToastProvider renders in the root RN tree, so a modal Support hides
// its own toasts ("That contact is already in your list", "Couldn't open the phone app"). Spans
// the navigator and the screen, so it greps them.
describe("Support route presentation", () => {
  const read = (rel: string) => readFileSync(path.join(repo, "app", rel), "utf8")
  it("registers Support as a plain card with its own header", () => {
    const navigator = read("navigators/AppNavigator.tsx")
    const block = navigator.match(/<Stack\.Screen\s+name="Support"[\s\S]*?\/>/)
    expect(block).not.toBeNull()
    expect(block![0]).not.toMatch(/presentation/)
    expect(block![0]).toMatch(/headerShown: false/)
  })
  it("the screen's close button still goes back", () => {
    expect(read("screens/SupportScreen.tsx")).toMatch(/onPress=\{\(\) => navigation\.goBack\(\)\}/)
  })
})
