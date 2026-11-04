// dailyDashPolicy.test.ts — spec D8 / §4.9: the only Daily Dash sign-out is the local-data reset.
// Our logout never signs Daily Dash out. reset_local_data is called from ONE function,
// resetDailyDashLocalData(), which has two callers: Settings → Delete User Data (step 7b) and the
// database overlay's Reset (injected into DatabaseProvider as a prop from app.tsx). app/db never
// imports the client. The rule spans files no unit test can see, so this greps the app's sources.
// CHANGED 2026-11-04 (final review I-2): the pattern matches ANY argument, including none. A bare
// `.signOut()` (the useSession() handle's default reason is "user") also wipes the database, and
// the old quoted-argument pattern let it through.
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
const app = path.join(__dirname, "..", "..")

describe("Daily Dash sign-out policy (spec D8, §4.4, §4.9)", () => {
  const sources = files(app).filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
  const calls = sources.flatMap((p) =>
    (readFileSync(p, "utf8").match(/\.signOut\([^)]*\)/g) ?? []).map(
      (m) => `${path.relative(app, p)}: ${m}`,
    ),
  )
  it("is called once, with reset_local_data, from resetDailyDashLocalData", () => {
    expect(calls).toEqual([
      'services/dailyDash/resetDailyDashLocalData.ts: .signOut("reset_local_data")',
    ])
  })
  it("app/db never imports the Daily Dash client", () => {
    const db = files(path.join(app, "db")).filter((p) => /\.tsx?$/.test(p))
    expect(db.filter((p) => /@daily-dash\//.test(readFileSync(p, "utf8")))).toEqual([])
  })
})
