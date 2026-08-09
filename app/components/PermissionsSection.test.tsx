/**
 * Guards the two non-obvious rules in the Permissions section:
 *  - the non-premium Push row must NOT be a disabled (greyed) Switch — that
 *    presentation was rejected deliberately, because a live-looking control
 *    draws more taps into the subscription funnel.
 *  - tapping it must open the paywall and must NOT change the stored value.
 *  - CHANGED 2026-08-09: added the "accessibility" describe block below —
 *    pointerEvents="none" blocks touch but not accessibility focus, so a
 *    screen-reader user could still land on the inert Switch. Regression
 *    guard for that finding.
 */
import { fireEvent, render, screen } from "@testing-library/react-native"

import { PermissionsSection } from "./PermissionsSection"

// UNSAFE_root.findAll's predicate parameter comes back untyped under
// noImplicitAny, and react-test-renderer ships no declarations — same
// approach as ScheduleGrid.test.tsx. Only `type` and `props` are read here.
type A11yNode = { type: unknown; props: Record<string, unknown> }

describe("PermissionsSection", () => {
  const baseProps = {
    notificationsEnabled: false,
    locationEnabled: false,
    onNotificationsToggle: jest.fn(),
    onLocationToggle: jest.fn(),
    onNotificationsPaywall: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("routes a non-premium push tap to the paywall, not the toggle", () => {
    render(<PermissionsSection {...baseProps} isPremium={false} />)

    fireEvent.press(screen.getByTestId("permissions-push-row"))

    expect(baseProps.onNotificationsPaywall).toHaveBeenCalledTimes(1)
    expect(baseProps.onNotificationsToggle).not.toHaveBeenCalled()
  })

  it("leaves the non-premium push switch enabled, not greyed", () => {
    render(<PermissionsSection {...baseProps} isPremium={false} />)

    // CHANGED 2026-08-09: the switch is now hidden from the accessibility
    // tree (see the "accessibility" describe block below), which RTL's
    // default queries also skip — includeHiddenElements is required to still
    // reach it here. The assertion itself is unchanged: still-present,
    // still not visually disabled, just inaccessible to focus.
    expect(
      screen.getByTestId("permissions-push-switch", { includeHiddenElements: true }).props.disabled,
    ).toBeFalsy()
  })

  it("toggles normally for a premium user", () => {
    render(<PermissionsSection {...baseProps} isPremium />)

    fireEvent(screen.getByTestId("permissions-push-switch"), "valueChange", true)

    expect(baseProps.onNotificationsToggle).toHaveBeenCalledWith(true)
    expect(baseProps.onNotificationsPaywall).not.toHaveBeenCalled()
  })

  it("toggles location regardless of entitlement", () => {
    render(<PermissionsSection {...baseProps} isPremium={false} />)

    fireEvent(screen.getByTestId("permissions-location-switch"), "valueChange", true)

    expect(baseProps.onLocationToggle).toHaveBeenCalledWith(true)
  })

  describe("accessibility", () => {
    it("hides the non-premium switch from the tree so focus lands on the row", () => {
      render(<PermissionsSection {...baseProps} isPremium={false} />)

      // Both platform flags must be present together — iOS honours
      // accessibilityElementsHidden, Android honours importantForAccessibility.
      const hidden = screen.UNSAFE_root.findAll(
        (node: A11yNode) =>
          typeof node.type === "string" && node.props?.accessibilityElementsHidden === true,
      )
      expect(hidden).toHaveLength(1)
      expect(hidden[0].props.importantForAccessibility).toBe("no-hide-descendants")

      // The Pressable row is what a screen reader actually lands on, so it
      // must carry its own announcement rather than relying on the (now
      // hidden) Switch's accessibilityLabel.
      const row = screen.getByTestId("permissions-push-row")
      expect(row.props.accessibilityLabel).toBe("settingsScreen:upgradeToPro {}")
      expect(row.props.accessibilityHint).toBe("accessibility:doubleTapToUpgrade {}")
    })

    it("leaves the premium switch reachable and unhidden", () => {
      render(<PermissionsSection {...baseProps} isPremium />)

      const hidden = screen.UNSAFE_root.findAll(
        (node: A11yNode) =>
          typeof node.type === "string" && node.props?.accessibilityElementsHidden === true,
      )
      expect(hidden).toHaveLength(0)

      // Premium row has no separate announcement of its own — the Switch
      // (still reachable) speaks for itself via its own accessibilityLabel.
      const row = screen.getByTestId("permissions-push-row")
      expect(row.props.accessibilityLabel).toBeUndefined()
      expect(row.props.accessibilityHint).toBeUndefined()
    })
  })
})
