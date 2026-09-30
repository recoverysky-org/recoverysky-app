/**
 * Guards Settings → Account's method rows: the full email is shown (not
 * masked), an Apple relay address is never shown, and each row is one
 * screen-reader element with a composed label.
 *
 * test/setup.ts mocks translate() as `${key} ${JSON.stringify(params)}` and
 * tx as the bare key, so assertions match keys rather than English copy.
 */
import { render, screen } from "@testing-library/react-native"

import { AccountMethodRow } from "./AccountMethodRow"

describe("AccountMethodRow", () => {
  it("shows the full email and the Active badge for the session's method", () => {
    render(
      <AccountMethodRow
        identity={{ method: "google", email: "jenova.m@gmail.com", hiddenByApple: false }}
        status="active"
      />,
    )
    expect(screen.getByText("jenova.m@gmail.com")).toBeTruthy()
    expect(screen.getByText("settingsScreen:accountActive")).toBeTruthy()
    const row = screen.getByTestId("account-method-active-google")
    expect(row.props.accessible).toBe(true)
    expect(row.props.accessibilityLabel).toContain("settingsScreen:accountActiveA11y")
    expect(row.props.accessibilityLabel).toContain("jenova.m@gmail.com")
  })

  it("says Hidden by Apple instead of a relay address", () => {
    render(
      <AccountMethodRow
        identity={{ method: "apple", email: undefined, hiddenByApple: true }}
        status="linked"
      />,
    )
    expect(screen.getByText(/settingsScreen:accountHiddenByApple/)).toBeTruthy()
    expect(screen.getByText("settingsScreen:accountLinked")).toBeTruthy()
    expect(screen.queryByText(/privaterelay/)).toBeNull()
  })

  it("renders a row with no email when the provider gave none", () => {
    render(
      <AccountMethodRow identity={{ method: "email", hiddenByApple: false }} status="linked" />,
    )
    const row = screen.getByTestId("account-method-linked-email")
    expect(row.props.accessibilityLabel).toContain("settingsScreen:accountLinkedA11y")
    expect(screen.getByText(/settingsScreen:accountMethodEmail/)).toBeTruthy()
  })
})
