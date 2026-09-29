/**
 * The three presentational login steps (spec 1 §1, §4.2). They take callbacks
 * only — no store, no SDK — which is what lets this mount them bare, and what
 * lets WrongAccountScreen reuse CodeStep unchanged (spec 2 §2.3).
 *
 * ADAPTED from the task brief: under test/setup.ts the `tx` prop resolves to
 * the bare key with NO interpolation (react-i18next has no instance, so its
 * fallback `t` returns the key), while `translate()` from "@/i18n" IS mocked
 * and echoes its params as JSON. So the brief's `getByText("Send code to
 * j***@proton.me")` can never match. The assertions below reach the masked
 * address the two ways it is actually observable: the accessibility label a
 * screen reader speaks, and the `txOptions` handed to the header Text.
 */
import { Platform } from "react-native"
import { fireEvent, render, screen } from "@testing-library/react-native"

import { ChooseStep, CodeStep, EmailStep } from "./LoginSteps"

// UNSAFE_root.findAll's predicate parameter comes back untyped under
// noImplicitAny and react-test-renderer ships no declarations — same approach
// as PermissionsSection.test.tsx. Only `props` is read here.
type TreeNode = { props: Record<string, unknown> }

/** testIDs of the rendered tree, in render order, so button ORDER is assertable. */
function testIdOrder(): string[] {
  return screen.UNSAFE_root.findAll((node: TreeNode) => typeof node.props?.testID === "string").map(
    (node: TreeNode) => node.props.testID as string,
  )
}

describe("ChooseStep", () => {
  const props = {
    isLoading: false,
    onEmail: jest.fn(),
    onOwnerEmail: jest.fn(),
    onProvider: jest.fn(),
  }
  beforeEach(() => jest.clearAllMocks())

  it("renders the three buttons and routes each tap", () => {
    render(<ChooseStep {...props} />)

    fireEvent.press(screen.getByTestId("login-apple"))
    fireEvent.press(screen.getByTestId("login-google"))
    fireEvent.press(screen.getByTestId("login-email"))

    expect(props.onProvider).toHaveBeenNthCalledWith(1, "apple")
    expect(props.onProvider).toHaveBeenNthCalledWith(2, "google-oauth2")
    expect(props.onEmail).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("login-owner-email")).toBeNull()
  })

  it("puts the platform's own provider first", () => {
    render(<ChooseStep {...props} />)

    const order = testIdOrder()
    const apple = order.indexOf("login-apple")
    const google = order.indexOf("login-google")
    // App Store guideline 4.8 wants Sign in with Apple at least as prominent
    // as any other third-party login; Android has no such rule and leads with
    // the account the device already holds.
    if (Platform.OS === "ios") expect(apple).toBeLessThan(google)
    else expect(google).toBeLessThan(apple)
  })

  it("shows the masked owner button instead of the plain email button when given", () => {
    render(<ChooseStep {...props} ownerEmailMasked="j***@proton.me" />)

    // The mask reaches the user through the spoken label as well as the
    // visible copy; asserting the label covers both without depending on
    // interpolation the test harness does not perform.
    expect(screen.getByTestId("login-owner-email").props.accessibilityLabel).toContain(
      "j***@proton.me",
    )
    fireEvent.press(screen.getByTestId("login-owner-email"))
    expect(props.onOwnerEmail).toHaveBeenCalledTimes(1)

    fireEvent.press(screen.getByTestId("login-use-different-email"))
    expect(props.onEmail).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("login-email")).toBeNull()
  })

  it("disables every way in while a login is in flight", () => {
    render(<ChooseStep {...props} isLoading />)

    for (const id of ["login-apple", "login-google", "login-email"]) {
      expect(screen.getByTestId(id).props.accessibilityState.disabled).toBe(true)
    }
  })
})

describe("EmailStep", () => {
  const props = {
    email: "",
    onChangeEmail: jest.fn(),
    isSending: false,
    onSend: jest.fn(),
    onBack: jest.fn(),
  }
  beforeEach(() => jest.clearAllMocks())

  it("carries the email autofill hints", () => {
    render(<EmailStep {...props} />)

    const field = screen.getByTestId("login-email-field")
    expect(field.props.textContentType).toBe("emailAddress")
    expect(field.props.autoComplete).toBe("email")
    expect(field.props.keyboardType).toBe("email-address")
  })

  it("disables Send until the address is plausible", () => {
    const { rerender } = render(<EmailStep {...props} email="jenova@" />)
    expect(screen.getByTestId("login-send-code").props.accessibilityState.disabled).toBe(true)

    rerender(<EmailStep {...props} email="jenova@proton.me" />)
    expect(screen.getByTestId("login-send-code").props.accessibilityState.disabled).toBe(false)

    fireEvent.press(screen.getByTestId("login-send-code"))
    expect(props.onSend).toHaveBeenCalledTimes(1)
  })

  it("holds Send down while a code is already being sent", () => {
    render(<EmailStep {...props} email="jenova@proton.me" isSending />)

    expect(screen.getByTestId("login-send-code").props.accessibilityState.disabled).toBe(true)
  })

  it("routes Back", () => {
    render(<EmailStep {...props} />)

    fireEvent.press(screen.getByTestId("login-back"))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })
})

describe("CodeStep", () => {
  const props = {
    emailMasked: "j***@proton.me",
    code: "",
    onChangeCode: jest.fn(),
    isVerifying: false,
    onVerify: jest.fn(),
    resendWaitSeconds: 0,
    onResend: jest.fn(),
    onWrongEmail: jest.fn(),
  }
  beforeEach(() => jest.clearAllMocks())

  it("carries the one-time-code autofill hints and shows the masked address", () => {
    render(<CodeStep {...props} />)

    const field = screen.getByTestId("login-code-field")
    expect(field.props.textContentType).toBe("oneTimeCode")
    expect(field.props.autoComplete).toBe("one-time-code")
    expect(field.props.maxLength).toBe(6)

    // The header is a `tx` Text, so the mask is only observable as the
    // interpolation it was handed (see the file header).
    const header = screen.UNSAFE_root.findAll(
      (node: TreeNode) => node.props?.tx === "loginScreen:codeSentTo",
    )
    expect(header).toHaveLength(1)
    expect(header[0].props.txOptions).toEqual({ email: "j***@proton.me" })
  })

  it("strips anything that is not a digit out of the code", () => {
    render(<CodeStep {...props} />)

    fireEvent.changeText(screen.getByTestId("login-code-field"), "123 456")
    expect(props.onChangeCode).toHaveBeenCalledWith("123456")
  })

  it("disables Verify until six digits are present", () => {
    const { rerender } = render(<CodeStep {...props} code="12345" />)
    expect(screen.getByTestId("login-verify").props.accessibilityState.disabled).toBe(true)

    rerender(<CodeStep {...props} code="123456" />)
    expect(screen.getByTestId("login-verify").props.accessibilityState.disabled).toBe(false)

    fireEvent.press(screen.getByTestId("login-verify"))
    expect(props.onVerify).toHaveBeenCalledTimes(1)
  })

  it("disables Resend during the cooldown and shows the countdown", () => {
    render(<CodeStep {...props} resendWaitSeconds={12} />)

    const resend = screen.getByTestId("login-resend")
    expect(resend.props.accessibilityState.disabled).toBe(true)
    expect(resend.props.accessibilityLabel).toContain("12")

    const countdown = screen.UNSAFE_root.findAll(
      (node: TreeNode) => node.props?.tx === "loginScreen:resendIn",
    )
    expect(countdown).toHaveLength(1)
    expect(countdown[0].props.txOptions).toEqual({ seconds: 12 })
  })

  it("allows Resend once the cooldown has run out", () => {
    render(<CodeStep {...props} />)

    expect(screen.getByTestId("login-resend").props.accessibilityState.disabled).toBe(false)
    fireEvent.press(screen.getByTestId("login-resend"))
    expect(props.onResend).toHaveBeenCalledTimes(1)
  })

  it("routes the wrong-email escape hatch", () => {
    render(<CodeStep {...props} />)

    fireEvent.press(screen.getByTestId("login-wrong-email"))
    expect(props.onWrongEmail).toHaveBeenCalledTimes(1)
  })
})
