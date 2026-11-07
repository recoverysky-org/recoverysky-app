import { describe, expect, it, vi } from "vitest"

import { createMyDayNavigation } from "./myDayNavigation"

describe("createMyDayNavigation", () => {
  it("opens the crisis path on the app's Support screen (support contacts spec D6)", () => {
    const navigate = vi.fn()
    const nav = createMyDayNavigation({ navigate, goBack: vi.fn() })
    nav.openCrisisPath()
    expect(navigate).toHaveBeenCalledWith("Support")
  })

  it("back pops the stack", () => {
    const goBack = vi.fn()
    createMyDayNavigation({ navigate: vi.fn(), goBack }).back()
    expect(goBack).toHaveBeenCalledTimes(1)
  })
})
