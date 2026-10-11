/**
 * GuestNavigator (ADDED 2026-10-11, guest mode). Guards the bottom inset: in
 * Main the tab bar clears the system navigation bar, but the guest navigator
 * hides its tab bar, so the scene has to clear it itself. Without that, on
 * Android edge-to-edge the Meetings lists draw under the navigation bar.
 *
 * MeetingsScreen is stubbed: this is about the navigator's scene, and the real
 * screen pulls in the stores, the meetings context and the database.
 */
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"
import { NavigationContainer } from "@react-navigation/native"
import { render, screen } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { lightTheme } from "@/theme/theme"

import { GuestNavigator } from "./GuestNavigator"

// The library's own jest mock: SafeAreaProvider hands its initialMetrics
// straight to useSafeAreaInsets(), so the test controls the inset.
jest.mock(
  "react-native-safe-area-context",
  () =>
    jest.requireActual<{ default: unknown }>("react-native-safe-area-context/jest/mock").default,
)

jest.mock("@/screens/MeetingsScreen", () => {
  // require()'d inside the factory: jest.mock() factories are hoisted above
  // the imports and can't close over them (same as test/setup.ts).
  const { createElement } = require("react")
  const { View } = require("react-native")
  return { MeetingsScreen: () => createElement(View, { testID: "meetings-screen-stub" }) }
})

// react-test-renderer ships no declarations; only these fields are read.
type Node = { type: unknown; props: Record<string, unknown>; parent: Node | null }

const BOTTOM_INSET = 34

function renderGuestNavigator() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: BOTTOM_INSET },
      }}
    >
      <NavigationContainer>
        <GuestNavigator />
      </NavigationContainer>
    </SafeAreaProvider>,
  )
}

/** The nearest host ancestor that sets paddingBottom, flattened. */
function paddedAncestorStyle(node: Node) {
  for (let n = node.parent; n; n = n.parent) {
    if (typeof n.type !== "string") continue
    const style = StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>)
    if (style?.paddingBottom !== undefined) return style
  }
  return undefined
}

describe("GuestNavigator", () => {
  it("renders Meetings as its only screen", () => {
    renderGuestNavigator()
    expect(screen.getByTestId("meetings-screen-stub")).toBeTruthy()
  })

  it("pads the Meetings scene by the bottom inset, on the app's background", () => {
    renderGuestNavigator()
    const stub = screen.getByTestId("meetings-screen-stub") as unknown as Node
    const style = paddedAncestorStyle(stub)
    expect(style?.paddingBottom).toBe(BOTTOM_INSET)
    // Main's tab bar paints colors.background; the scene's default would be
    // React Navigation's stock theme colour, a shade off it.
    expect(style?.backgroundColor).toBe(lightTheme.colors.background)
  })
})
