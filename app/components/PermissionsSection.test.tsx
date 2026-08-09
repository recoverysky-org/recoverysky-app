/**
 * Guards the two non-obvious rules in the Permissions section:
 *  - the non-premium Push row must NOT be a disabled (greyed) Switch — that
 *    presentation was rejected deliberately, because a live-looking control
 *    draws more taps into the subscription funnel.
 *  - tapping it must open the paywall and must NOT change the stored value.
 */
import { fireEvent, render, screen } from "@testing-library/react-native"

import { PermissionsSection } from "./PermissionsSection"

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

    expect(screen.getByTestId("permissions-push-switch").props.disabled).toBeFalsy()
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
})
