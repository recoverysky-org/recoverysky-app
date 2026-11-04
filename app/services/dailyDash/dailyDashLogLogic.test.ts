import { describe, expect, it } from "vitest"

import { toDailyDashAttributes, toLogAttributes } from "./dailyDashLogLogic"

describe("toLogAttributes (spec §4.8; client README 'what a host never logs')", () => {
  it("drops cause and empties, keeps scalars", () => {
    expect(
      toLogAttributes({
        code: "db_open",
        cause: new Error("secret"),
        n: 2,
        ok: true,
        gone: undefined,
      }),
    ).toEqual({ code: "db_open", n: 2, ok: true })
  })
  it("stringifies objects, truncated", () => {
    const out = toLogAttributes({ details: { kind: "x" }, big: "y".repeat(5000) })
    expect(out.details).toBe('{"kind":"x"}')
    expect(String(out.big)).toHaveLength(2000)
  })
})

// ADDED 2026-11-04: the client's child loggers bind module: "api" | "db" |
// "sync" | "session", and per-call attributes override the app child's
// module, so forwarding it would move Daily Dash lines out of their Loki stream.
describe("toDailyDashAttributes (module stays the app's Loki label)", () => {
  it("renames the client's module to ddModule and never forwards module", () => {
    const out = toDailyDashAttributes({
      module: "sync",
      code: "db_open",
      cause: new Error("secret"),
    })
    expect(out).toEqual({ ddModule: "sync", code: "db_open" })
    expect(out).not.toHaveProperty("module")
  })
  it("leaves lines without a module alone", () => {
    expect(toDailyDashAttributes({ host: "recoverysky", n: 1 })).toEqual({
      host: "recoverysky",
      n: 1,
    })
  })
})
