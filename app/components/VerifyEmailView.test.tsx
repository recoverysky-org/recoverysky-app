import { fireEvent, render, screen } from "@testing-library/react-native"

import { VerifyEmailView, type VerifyEmailViewProps } from "./VerifyEmailView"

type TreeNode = { type: unknown; props: Record<string, unknown> }
const txCount = (key: string) =>
  screen.UNSAFE_root.findAll((node: TreeNode) => node.props?.tx === key).length

const base: VerifyEmailViewProps = {
  mode: "skippable",
  skipsLeft: 6,
  step: "review",
  accountEmail: "typo@gmail.comf",
  targetEmail: "typo@gmail.comf",
  newEmail: "",
  onChangeNewEmail: jest.fn(),
  code: "",
  onChangeCode: jest.fn(),
  resendWaitSeconds: 0,
  isBusy: false,
  problem: null,
  onSendToAccount: jest.fn(),
  onSendToNew: jest.fn(),
  onGoToChange: jest.fn(),
  onBackToReview: jest.fn(),
  onVerify: jest.fn(),
  onResend: jest.fn(),
  onNotNow: jest.fn(),
  onWhy: jest.fn(),
  onSupport: jest.fn(),
}

beforeEach(() => jest.clearAllMocks())

describe("VerifyEmailView — review step", () => {
  it("shows the heading and the account's address in full", () => {
    render(<VerifyEmailView {...base} />)
    expect(txCount("verifyEmailScreen:title")).toBe(1)
    expect(screen.getByTestId("verify-email-address").props.children).toBe("typo@gmail.comf")
  })

  it("sends a code, opens the change step, and opens the why link", () => {
    render(<VerifyEmailView {...base} />)
    fireEvent.press(screen.getByTestId("verify-email-send"))
    fireEvent.press(screen.getByTestId("verify-email-change"))
    fireEvent.press(screen.getByTestId("verify-email-why"))
    expect(base.onSendToAccount).toHaveBeenCalledTimes(1)
    expect(base.onGoToChange).toHaveBeenCalledTimes(1)
    expect(base.onWhy).toHaveBeenCalledTimes(1)
  })

  it("offers Not now with the skips left while skippable", () => {
    render(<VerifyEmailView {...base} skipsLeft={3} />)
    fireEvent.press(screen.getByTestId("verify-email-not-now"))
    expect(base.onNotNow).toHaveBeenCalledTimes(1)
    const warning = screen.UNSAFE_root.findAll(
      (node: TreeNode) => node.props?.tx === "verifyEmailScreen:requiredWarning",
    )[0]
    expect(warning.props.txOptions).toEqual({ count: 3 })
  })

  it("has no Not now on the mandatory showing, and offers support instead", () => {
    render(<VerifyEmailView {...base} mode="mandatory" skipsLeft={undefined} />)
    expect(screen.queryByTestId("verify-email-not-now")).toBeNull()
    expect(txCount("verifyEmailScreen:requiredWarning")).toBe(0)
    expect(txCount("verifyEmailScreen:mandatory")).toBe(1)
    fireEvent.press(screen.getByTestId("verify-email-support"))
    expect(base.onSupport).toHaveBeenCalledTimes(1)
  })

  it("disables the controls while busy", () => {
    render(<VerifyEmailView {...base} isBusy />)
    fireEvent.press(screen.getByTestId("verify-email-send"))
    fireEvent.press(screen.getByTestId("verify-email-not-now"))
    expect(base.onSendToAccount).not.toHaveBeenCalled()
    expect(base.onNotNow).not.toHaveBeenCalled()
  })

  it("disables the change link while busy, for touch and for screen readers", () => {
    render(<VerifyEmailView {...base} isBusy />)
    const change = screen.getByTestId("verify-email-change")
    fireEvent.press(change)
    expect(base.onGoToChange).not.toHaveBeenCalled()
    expect(change.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }))
  })
})

describe("VerifyEmailView — other steps", () => {
  it("change step shows the email field, not the account address", () => {
    render(<VerifyEmailView {...base} step="change" newEmail="right@gmail.com" />)
    expect(screen.getByTestId("login-email-field")).toBeTruthy()
    expect(screen.queryByTestId("verify-email-address")).toBeNull()
  })

  it("code step shows the code field and keeps the why link", () => {
    render(<VerifyEmailView {...base} step="code" />)
    expect(screen.getByTestId("login-code-field")).toBeTruthy()
    expect(screen.getByTestId("verify-email-why")).toBeTruthy()
  })

  // CHANGED 2026-10-02 (device pass): this used to assert the code step showed
  // only a masked address. That mask was inherited from Login's CodeStep, but
  // here the whole point is catching a typo, so "We sent a code to j***@…"
  // hid exactly the part the user needed to check.
  it("code step names the address the code went to, in full", () => {
    render(<VerifyEmailView {...base} step="code" targetEmail="right@gmail.com" />)
    const sentTo = screen.UNSAFE_root.findAll(
      (node: TreeNode) => node.props?.tx === "loginScreen:codeSentTo",
    )
    expect(sentTo.length).toBeGreaterThan(0)
    expect(sentTo[0].props.txOptions).toEqual({ email: "right@gmail.com" })
  })
})

describe("VerifyEmailView — problems", () => {
  it.each([
    ["email_in_use", "verifyEmailScreen:errorEmailInUse"],
    ["invalid_code", "verifyEmailScreen:errorInvalidCode"],
    ["code_expired", "verifyEmailScreen:errorCodeExpired"],
    ["too_many_attempts", "verifyEmailScreen:errorTooManyAttempts"],
    ["rate_limited", "verifyEmailScreen:errorRateLimited"],
    ["inactive_recipient", "verifyEmailScreen:errorInactiveRecipient"],
    ["not_password_account", "verifyEmailScreen:errorNotPasswordAccount"],
    ["unavailable", "verifyEmailScreen:errorUnavailable"],
  ] as const)("shows the %s message as an alert", (problem, key) => {
    render(<VerifyEmailView {...base} problem={problem} />)
    expect(txCount(key)).toBe(1)
    expect(screen.getByTestId("verify-email-error").props.accessibilityRole).toBe("alert")
  })

  it("shows no alert when there is no problem", () => {
    render(<VerifyEmailView {...base} />)
    expect(screen.queryByTestId("verify-email-error")).toBeNull()
  })
})
