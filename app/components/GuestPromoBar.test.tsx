/**
 * GuestPromoBar (ADDED 2026-10-11, guest mode). Guards the two things the bar
 * owes its caller: a Sign in tap reaches `onSignIn` (MeetingsScreen wires it to
 * authStore.exitGuest(), which is how a guest gets back to Login), and the
 * control is announced to VoiceOver/TalkBack as a labelled button.
 *
 * Rendered bare, like PermissionsSection.test.tsx: test/setup.ts mocks `@/i18n`
 * and the theme context, so no providers are needed.
 */
import { fireEvent, render } from "@testing-library/react-native"

import { GuestPromoBar } from "./GuestPromoBar"

describe("GuestPromoBar", () => {
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
})
