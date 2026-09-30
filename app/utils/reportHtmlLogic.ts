/**
 * reportHtmlLogic — prepare a stored attendance-report email body for the
 * in-app WebView viewer (Attendance → Reports).
 *
 * ADDED 2026-09-30. The HTML is the email the API rendered from
 * `api/src/templates/attendance-report.hbs`. That template is built for mail
 * clients: a 1040px container, a fixed-width attendance table, and a
 * `width=device-width, initial-scale=1.0` viewport meta. Android's WebView
 * honours `initial-scale=1.0` literally, so the page opened at 100% with the
 * table and header running off the right edge. Dropping `initial-scale` (and
 * keeping `width=device-width`, so the template's <=620px mobile media query
 * still applies) lets Blink zoom out just enough to fit the content width —
 * the mobile layout, shrunk to fit, pinch-zoom still available.
 *
 * Pure, no `@/` imports, so vitest can reach it (CLAUDE.md, "Test Runner Split").
 */

const VIEWPORT_META = /<meta\s+name=["']viewport["'][^>]*>/i

/** The viewport the viewer wants: device width, no forced initial scale. */
export const FIT_TO_WIDTH_VIEWPORT =
  '<meta name="viewport" content="width=device-width, shrink-to-fit=yes" />'

/**
 * Strip images (the viewer has always removed them — this was the inline
 * `.replace(/<img[^>]*>/gi, "")` it replaced) and, when `fitToWidth`, replace or insert
 * the viewport meta so the page scales down to fit the screen.
 */
export function prepareReportHtml(html: string, opts: { fitToWidth: boolean }): string {
  let out = html.replace(/<img[^>]*>/gi, "")
  if (!opts.fitToWidth) return out
  if (VIEWPORT_META.test(out)) {
    out = out.replace(VIEWPORT_META, FIT_TO_WIDTH_VIEWPORT)
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (head) => `${head}${FIT_TO_WIDTH_VIEWPORT}`)
  } else {
    out = `${FIT_TO_WIDTH_VIEWPORT}${out}`
  }
  return out
}
