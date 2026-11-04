// Pure theme builder for the My Day tab. No runtime `@/` imports so vitest can load it.
// MyDayTheme is imported as a TYPE only: the package's runtime pulls in React Native.
import type { MyDayTheme } from "@daily-dash/my-day"

/** Parses `#rgb` / `#rrggbb` (any case) into 0-255 channels, or null. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG 2 relative luminance (sRGB linearised). NaN when `hex` is not #rgb/#rrggbb. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return NaN
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, lighter over darker, so argument order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The Dash's light-scheme text colour, used as ink on tints too light for white. */
export const DARK_INK = "#14181f"

/**
 * Text/icon colour to draw on top of a tint. White when it reaches 3:1, which is
 * WCAG's floor for large text and UI components (the app's own electric pink
 * #FF10F0 clears it at 3.19:1); otherwise dark ink. An unparseable tint
 * (rgba(), named colour) gets white, the Dash's own default.
 */
export function onTintFor(tint: string): string {
  const ratio = contrastRatio("#ffffff", tint)
  if (Number.isNaN(ratio) || ratio >= 3) return "#ffffff"
  return DARK_INK
}

/**
 * Lays the host's tint picker over one of the package's looks. Replaces exactly
 * tint, tintInactive and onTint; every other token stays the package's.
 */
export function buildMyDayTheme(
  base: MyDayTheme,
  picker: { tint: string; tintInactive: string },
): MyDayTheme {
  return {
    ...base,
    colors: {
      ...base.colors,
      tint: picker.tint,
      tintInactive: picker.tintInactive,
      onTint: onTintFor(picker.tint),
    },
  }
}
