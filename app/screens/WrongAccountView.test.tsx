/**
 * spec 2 §4: the code variant shows the masked-email button and no provider
 * button; the social variants show one provider button and never an email;
 * Cancel is always there; `unknown` with no email shows Cancel only.
 *
 * ADAPTED from the task brief, for the same reason LoginSteps.test.tsx was:
 * under test/setup.ts the `tx` prop resolves to the BARE key with no
 * interpolation (react-i18next has no instance here, so its fallback `t`
 * returns the key), while `translate()` from "@/i18n" IS mocked and echoes its
 * params as JSON. The brief's `getByText("Send code to j***@proton.me")` and
 * `getByText("Sign in with Apple")` can therefore never match. Each button is
 * identified by its testID and its `tx` key, and the masked address is
 * asserted through the accessibility label a screen reader actually speaks.
 *
 * ADAPTED too: the brief imported from "./WrongAccountScreen". That module is
 * the observer shell, and loading it pulls in `@/components/Screen`
 * (react-native-keyboard-controller throws at import time without its native
 * module) and `@/models` → `@/db` → `@/services/sync` →
 * react-native-purchases (ESM, untransformed). The view therefore lives in
 * its own module, exactly as the login steps do, and is imported from there.
 */
import { fireEvent, render, screen } from "@testing-library/react-native"

import { WrongAccountView } from "./WrongAccountView"

// UNSAFE_root.findAll's predicate parameter comes back untyped under
// noImplicitAny and react-test-renderer ships no declarations — same approach
// as LoginSteps.test.tsx. Only `props` is read here.
type TreeNode = { type: unknown; props: Record<string, unknown> }

/**
 * Every string-valued prop on a HOST element: the copy, accessibility labels
 * and children that actually reach the screen. Composite elements are skipped
 * deliberately — the root carries `ownerEmailMasked` as an incoming prop, and
 * the question here is what the view does with it, not what it was handed.
 */
function renderedStrings(): string[] {
  return screen.UNSAFE_root.findAll((node: TreeNode) => typeof node.type === "string").flatMap(
    (node: TreeNode) =>
      Object.values(node.props ?? {}).filter((v): v is string => typeof v === "string"),
  )
}

/** How many Texts in the tree render their copy from this i18n key. */
function txCount(key: string): number {
  return screen.UNSAFE_root.findAll((node: TreeNode) => node.props?.tx === key).length
}

const base = {
  step: "prompt" as const,
  code: "",
  onChangeCode: jest.fn(),
  resendWaitSeconds: 0,
  isBusy: false,
  onSendCode: jest.fn(),
  onVerify: jest.fn(),
  onResend: jest.fn(),
  onProvider: jest.fn(),
  onCancel: jest.fn(),
}

describe("WrongAccountView", () => {
  beforeEach(() => jest.clearAllMocks())

  it("code owner: masked-email button, no provider button, cancel", () => {
    render(<WrongAccountView {...base} proofMethod="code" ownerEmailMasked="j***@proton.me" />)

    expect(screen.getByTestId("wrong-account-send-code").props.accessibilityLabel).toContain(
      "j***@proton.me",
    )
    expect(screen.queryByTestId("wrong-account-provider")).toBeNull()

    fireEvent.press(screen.getByTestId("wrong-account-send-code"))
    expect(base.onSendCode).toHaveBeenCalledTimes(1)
    fireEvent.press(screen.getByTestId("wrong-account-cancel"))
    expect(base.onCancel).toHaveBeenCalledTimes(1)
  })

  it("apple owner: one provider button and no email anywhere", () => {
    render(
      <WrongAccountView
        {...base}
        proofMethod="apple"
        ownerEmailMasked="j***@privaterelay.appleid.com"
      />,
    )

    expect(txCount("wrongAccountScreen:signInWithApple")).toBe(1)
    expect(txCount("wrongAccountScreen:signInWithGoogle")).toBe(0)
    // The whole point of the social variant: an Apple owner's address is a
    // private relay alias they will not recognise, so it is never drawn and
    // never spoken.
    expect(renderedStrings().some((s) => s.includes("privaterelay"))).toBe(false)
    expect(screen.queryByTestId("wrong-account-send-code")).toBeNull()

    fireEvent.press(screen.getByTestId("wrong-account-provider"))
    expect(base.onProvider).toHaveBeenCalledTimes(1)
  })

  it("google owner: one provider button and no email anywhere", () => {
    render(<WrongAccountView {...base} proofMethod="google" ownerEmailMasked="j***@gmail.com" />)

    expect(txCount("wrongAccountScreen:signInWithGoogle")).toBe(1)
    expect(txCount("wrongAccountScreen:signInWithApple")).toBe(0)
    expect(renderedStrings().some((s) => s.includes("gmail"))).toBe(false)
    expect(screen.queryByTestId("wrong-account-send-code")).toBeNull()
  })

  it("unknown owner with no email: cancel only", () => {
    render(<WrongAccountView {...base} proofMethod="unknown" />)

    expect(screen.queryByTestId("wrong-account-send-code")).toBeNull()
    expect(screen.queryByTestId("wrong-account-provider")).toBeNull()
    expect(screen.getByTestId("wrong-account-cancel")).toBeTruthy()
  })

  it("code step renders the shared CodeStep", () => {
    render(
      <WrongAccountView
        {...base}
        proofMethod="code"
        ownerEmailMasked="j***@proton.me"
        step="code"
      />,
    )

    expect(screen.getByTestId("login-code-field")).toBeTruthy()
    expect(screen.getByTestId("wrong-account-cancel")).toBeTruthy()
  })

  it("holds every control down while a request is in flight", () => {
    render(
      <WrongAccountView {...base} proofMethod="code" ownerEmailMasked="j***@proton.me" isBusy />,
    )

    expect(screen.getByTestId("wrong-account-send-code").props.accessibilityState.disabled).toBe(
      true,
    )
    expect(screen.getByTestId("wrong-account-cancel").props.accessibilityState.disabled).toBe(true)
  })

  it("never offers a way to delete or reset local data", () => {
    render(<WrongAccountView {...base} proofMethod="code" ownerEmailMasked="j***@proton.me" />)

    // spec 2 §2.4: the only two exits are proving ownership and Cancel. A
    // "reset this device" affordance here would let a wrong-account signer
    // destroy the owner's records, so its absence is a tested invariant.
    const ids: string[] = screen.UNSAFE_root.findAll(
      (node: TreeNode) => typeof node.props?.testID === "string",
    ).map((node: TreeNode) => node.props.testID as string)
    expect(ids.some((id) => /reset|delete|erase/i.test(id))).toBe(false)
    expect(renderedStrings().some((s) => /wrongAccountScreen:(reset|delete)/.test(s))).toBe(false)
  })
})
