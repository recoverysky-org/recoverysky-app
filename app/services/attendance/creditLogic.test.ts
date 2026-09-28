import { describe, expect, it } from "vitest"

import { MAX_CREDIT_MS, clampCredit } from "./creditLogic"

describe("clampCredit", () => {
  it("passes an ordinary meeting duration through untouched", () => {
    expect(clampCredit(60 * 60 * 1000)).toEqual({ credit: 60 * 60 * 1000, clamped: false })
  })

  it("passes exactly the maximum through untouched", () => {
    expect(clampCredit(MAX_CREDIT_MS)).toEqual({ credit: MAX_CREDIT_MS, clamped: false })
  })

  it("clamps the 37-day timer that overflowed the api's int32 column (RS-034)", () => {
    expect(clampCredit(3_207_443_155)).toEqual({ credit: MAX_CREDIT_MS, clamped: true })
  })

  it("the maximum itself fits a signed 32-bit integer", () => {
    expect(MAX_CREDIT_MS).toBeLessThanOrEqual(2_147_483_647)
  })

  it("a negative interval (clock moved backwards) becomes zero credit and is flagged", () => {
    expect(clampCredit(-5)).toEqual({ credit: 0, clamped: true })
  })

  it("a non-finite interval becomes zero credit and is flagged", () => {
    expect(clampCredit(Number.NaN)).toEqual({ credit: 0, clamped: true })
    expect(clampCredit(Number.POSITIVE_INFINITY)).toEqual({ credit: 0, clamped: true })
  })

  it("zero is zero and not flagged", () => {
    expect(clampCredit(0)).toEqual({ credit: 0, clamped: false })
  })
})
