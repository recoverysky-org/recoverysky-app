import { useContext } from "react"
import { render } from "@testing-library/react-native"

import { storage } from "@/utils/storage"

import { ThemeContext, ThemeProvider, type ThemeContextType } from "./context"
import { darkTheme } from "./theme"

/* ThemeProvider in guest mode (spec 2026-09-27-guest-mode-design.md): a guest
 * gets the default look, never the device owner's saved scheme and tint.
 *
 * Mounts the real ThemeProvider, like Text.test.tsx. test/setup.ts replaces
 * `useAppTheme()` with a fixed light theme, so the probe below reads
 * ThemeContext directly to see what the provider itself puts there. MMKV runs
 * on react-native-mmkv's in-memory jest mock, and `storage` is the same
 * instance the provider's `useMMKVString` hooks read. */

// A stub logger keeps the real one's DEBUG lines and flush timers out of this
// test. Everything this graph imports only calls logger.child().
jest.mock("@/utils/logger", () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  return { logger: { child: () => log } }
})

const SAVED_TINT = "#00AA55"

let seen: ThemeContextType | null = null

function Probe() {
  seen = useContext(ThemeContext)
  return null
}

describe("ThemeProvider and guest mode", () => {
  beforeEach(() => {
    seen = null
    storage.clearAll()
    // The device owner's Settings choices: light, with a custom tint.
    storage.set("ignite.themeScheme", "light")
    storage.set("ignite.themeColor", SAVED_TINT)
  })

  afterAll(() => storage.clearAll())

  // Without this case the guest case could pass with no saved values read.
  it("shows the saved scheme and tint when not a guest", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(seen?.themeContext).toBe("light")
    expect(seen?.theme.colors.tint).toBe(SAVED_TINT)
    expect(seen?.themeColor).toBe(SAVED_TINT)
  })

  it("ignores the saved scheme and tint for a guest, and leaves them saved", () => {
    render(
      <ThemeProvider isGuest>
        <Probe />
      </ThemeProvider>,
    )
    // The fresh-install look: dark, with the default tint.
    expect(seen?.themeContext).toBe("dark")
    expect(seen?.theme.colors.tint).toBe(darkTheme.colors.tint)
    expect(seen?.themeColor).toBeUndefined()
    // Only what is shown changes; the owner's choices stay in MMKV.
    expect(storage.getString("ignite.themeScheme")).toBe("light")
    expect(storage.getString("ignite.themeColor")).toBe(SAVED_TINT)
  })

  it("brings the saved look back when guest mode ends, with no remount", () => {
    const { rerender } = render(
      <ThemeProvider isGuest>
        <Probe />
      </ThemeProvider>,
    )
    expect(seen?.themeContext).toBe("dark")
    rerender(
      <ThemeProvider isGuest={false}>
        <Probe />
      </ThemeProvider>,
    )
    expect(seen?.themeContext).toBe("light")
    expect(seen?.theme.colors.tint).toBe(SAVED_TINT)
  })
})
