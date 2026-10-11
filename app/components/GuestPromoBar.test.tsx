/**
 * GuestPromoBar (ADDED 2026-10-11, guest mode). Guards the two things the bar
 * owes its caller: a Sign in tap reaches `onSignIn` (MeetingsScreen wires it to
 * authStore.exitGuest(), which is how a guest gets back to Login), and the
 * control is announced to VoiceOver/TalkBack as a labelled button.
 * Also pins the control's 48 dp touch target and the label's WCAG AA contrast
 * on the pill in both themes (both added 2026-10-11 after review).
 *
 * Rendered bare, like PermissionsSection.test.tsx: test/setup.ts mocks `@/i18n`
 * and the theme context, so no providers are needed.
 */
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native"
import { fireEvent, render } from "@testing-library/react-native"

import { darkTheme, lightTheme } from "@/theme/theme"
import type { Theme } from "@/theme/types"

import { GuestPromoBar } from "./GuestPromoBar"

// test/setup.ts's theme-context mock. It starts on lightTheme; this switches
// what useAppTheme() / themed() resolve against for the next render.
const { __setMockTheme } = jest.requireMock<{
  __setMockTheme: (theme: Theme, themeContext?: "light" | "dark") => void
}>("@/theme/context")

// react-test-renderer ships no declarations; only these fields are read.
type Node = { type: unknown; props: Record<string, unknown>; parent: Node | null }

/** WCAG 2.x relative luminance of a #RGB / #RRGGBB colour. */
function luminance(hex: string): number {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The nearest painted background behind a node: what its text sits on. */
function backgroundBehind(node: Node): string | undefined {
  for (let n = node.parent; n; n = n.parent) {
    if (typeof n.type !== "string") continue
    const bg = StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>)?.backgroundColor
    if (bg) return bg as string
  }
  return undefined
}

describe("GuestPromoBar", () => {
  afterEach(() => __setMockTheme(lightTheme, "light"))

  it("calls onSignIn when the Sign in button is pressed", () => {
    const onSignIn = jest.fn()
    const { getByTestId } = render(<GuestPromoBar onSignIn={onSignIn} />)
    fireEvent.press(getByTestId("guest-sign-in"))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })

  it("exposes the sign-in control as a labelled button", () => {
    const { getByTestId } = render(<GuestPromoBar onSignIn={() => {}} />)
    const button = getByTestId("guest-sign-in")
    expect(button.props.accessibilityRole).toBe("button")
    expect(button.props.accessibilityLabel).toBeTruthy()
  })

  // Material's 48 dp minimum, on the Pressable itself: it is both the touch
  // target and the accessibility node whose bounds a scanner measures.
  it("gives the sign-in control at least a 48 dp touch target", () => {
    const { getByTestId } = render(<GuestPromoBar onSignIn={() => {}} />)
    const style = StyleSheet.flatten(getByTestId("guest-sign-in").props.style)
    expect(style?.minHeight).toBeGreaterThanOrEqual(48)
  })

  // WCAG AA needs 4.5:1 for 16 px / 600 text. The pill is colors.tint in both
  // palettes, so a label colour that flips with the theme can fail in one.
  it.each([
    ["light", lightTheme],
    ["dark", darkTheme],
  ] as const)(
    "keeps the Sign in label at 4.5:1 or better on the pill (%s theme)",
    (name, theme) => {
      __setMockTheme(theme, name)
      const { getByText } = render(<GuestPromoBar onSignIn={() => {}} />)
      const label = getByText("guestPromo:signIn") as unknown as Node
      const color = StyleSheet.flatten(label.props.style as StyleProp<TextStyle>)?.color as string
      const pill = backgroundBehind(label)
      expect(pill).toBe(theme.colors.tint)
      expect(contrast(color, pill as string)).toBeGreaterThanOrEqual(4.5)
    },
  )
})
