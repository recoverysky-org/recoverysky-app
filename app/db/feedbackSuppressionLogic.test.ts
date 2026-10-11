// app/db/feedbackSuppressionLogic.test.ts
import { describe, expect, it } from "vitest"

import { createSuppression } from "./feedbackSuppressionLogic"

describe("createSuppression", () => {
  it("is off until a predicate is registered", () => {
    const s = createSuppression()
    expect(s.active()).toBe(false)
  })
  it("follows the registered predicate live", () => {
    const s = createSuppression()
    let guest = true
    s.setWhen(() => guest)
    expect(s.active()).toBe(true)
    guest = false
    expect(s.active()).toBe(false)
  })
  it("fails closed if the predicate throws — never leak owner feedback", () => {
    const s = createSuppression()
    s.setWhen(() => {
      throw new Error("store not ready")
    })
    expect(s.active()).toBe(true)
  })
})
