import { describe, expect, it } from "vitest"

import { FIT_TO_WIDTH_VIEWPORT, prepareReportHtml } from "./reportHtmlLogic"

const TEMPLATE_HEAD =
  '<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>r</title></head><body><img src="x.png" alt="logo"><p>hi</p></body></html>'

describe("prepareReportHtml", () => {
  it("strips images either way", () => {
    expect(prepareReportHtml(TEMPLATE_HEAD, { fitToWidth: false })).not.toContain("<img")
    expect(prepareReportHtml(TEMPLATE_HEAD, { fitToWidth: true })).not.toContain("<img")
  })

  it("leaves the viewport alone when not fitting", () => {
    expect(prepareReportHtml(TEMPLATE_HEAD, { fitToWidth: false })).toContain("initial-scale=1.0")
  })

  it("replaces the template's viewport so the page can zoom out to fit", () => {
    const out = prepareReportHtml(TEMPLATE_HEAD, { fitToWidth: true })
    expect(out).not.toContain("initial-scale")
    expect(out).toContain(FIT_TO_WIDTH_VIEWPORT)
    expect(out.match(/name="viewport"/g)).toHaveLength(1)
  })

  it("inserts a viewport into <head> when the body has none", () => {
    const out = prepareReportHtml("<html><head><title>r</title></head><body></body></html>", {
      fitToWidth: true,
    })
    expect(out).toContain(`<head>${FIT_TO_WIDTH_VIEWPORT}<title>`)
  })

  it("prepends a viewport to a bare fragment", () => {
    expect(prepareReportHtml("<p>hi</p>", { fitToWidth: true })).toBe(
      `${FIT_TO_WIDTH_VIEWPORT}<p>hi</p>`,
    )
  })
})
