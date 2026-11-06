import { describe, expect, it } from "vitest"

import {
  buildMyDayTheme,
  contrastRatio,
  DARK_INK,
  onTintFor,
  relativeLuminance,
} from "./myDayTheme"

describe("luminance and contrast", () => {
  it("white is 1, black is 0, their ratio is 21", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5)
    expect(relativeLuminance("#000000")).toBe(0)
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2)
  })
  it("reads #rgb and upper case", () => {
    expect(relativeLuminance("#FFF")).toBeCloseTo(1, 5)
  })
  it("is NaN for anything that is not a hex colour", () => {
    expect(relativeLuminance("rgba(1,2,3,0.5)")).toBeNaN()
    expect(relativeLuminance("#12345")).toBeNaN()
  })
  it("puts the lighter colour on top whichever order it is given", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2)
  })
})

describe("onTintFor (spec D4, §4.6)", () => {
  it("white on the app's electric pink", () => expect(onTintFor("#FF10F0")).toBe("#ffffff"))
  it("dark ink on the Dash's amber", () => expect(onTintFor("#f4a125")).toBe(DARK_INK))
  it("dark ink on a white tint, white on a black one", () => {
    expect(onTintFor("#ffffff")).toBe(DARK_INK)
    expect(onTintFor("#000000")).toBe("#ffffff")
  })
  it("white when the tint is not a hex colour", () =>
    expect(onTintFor("rgba(1,2,3,0.5)")).toBe("#ffffff"))
})

describe("buildMyDayTheme", () => {
  const base = {
    colors: {
      tint: "#22c3a3",
      tintInactive: "#21242c",
      onTint: "#ffffff",
      accent: "#f4a125",
      text: "#f0f2f4",
    },
    spacing: { md: 16 },
    isDark: true,
  } as unknown as import("@daily-dash/my-day").MyDayTheme
  it("replaces the tint pair and onTint, nothing else", () => {
    const built = buildMyDayTheme(base, { tint: "#FF10F0", tintInactive: "#48484A" })
    expect(built.colors.tint).toBe("#FF10F0")
    expect(built.colors.tintInactive).toBe("#48484A")
    expect(built.colors.onTint).toBe("#ffffff")
    expect(built.colors.accent).toBe("#f4a125")
    expect(built.spacing).toBe(base.spacing)
    expect(built.isDark).toBe(true)
  })
})
