/**
 * RootModalScroll is the body of VerifyEmailGate's <Modal>, and that gate is
 * mounted in app.tsx BESIDE <AppNavigator />, not inside a screen. So the one
 * rule this guards is: it must mount with NO navigator above it.
 *
 * ADDED 2026-10-01 after the device pass: the gate used
 * <Screen preset="scroll">, whose useScrollToTop() throws "Couldn't find a
 * route object" outside a navigator — the verify screen crashed on its first
 * real showing, and no test had ever mounted it. Deliberately NO
 * NavigationContainer here: wrapping this test in one would hide exactly
 * that failure.
 */
import { View } from "react-native"
import { render, screen } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { RootModalScroll } from "./RootModalScroll"

jest.mock("react-native-keyboard-controller", () =>
  jest.requireActual("react-native-keyboard-controller/jest"),
)

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

describe("RootModalScroll", () => {
  it("renders its children with no navigator above it", () => {
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootModalScroll>
          <View testID="child" />
        </RootModalScroll>
      </SafeAreaProvider>,
    )
    expect(screen.getByTestId("child")).toBeTruthy()
  })

  it("keeps taps alive while the keyboard is up, and pads the safe area", () => {
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <RootModalScroll>
          <View testID="child" />
        </RootModalScroll>
      </SafeAreaProvider>,
    )
    // Without "handled", the first tap on Send/Verify only dismisses the
    // keyboard and the user has to tap twice.
    expect(screen.getByTestId("root-modal-scroll").props.keyboardShouldPersistTaps).toBe("handled")
    expect(screen.getByTestId("root-modal-frame").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingTop: 47, paddingBottom: 34 })]),
    )
  })
})
