import { describe, expect, it } from "vitest"

import { toLogAttributes } from "./dailyDashLogLogic"

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
