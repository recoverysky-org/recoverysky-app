import { act, renderHook } from "@testing-library/react-native"

import { useAddSupportContact } from "./useAddSupportContact"

const mockAdd = jest.fn()
jest.mock("@/models", () => ({ useSupportStore: () => ({ contacts: [], add: mockAdd }) }))
const mockShowToast = jest.fn()
jest.mock("@/components/Toast", () => ({ useToast: () => ({ showToast: mockShowToast }) }))
jest.mock("@/services/tracking", () => ({ trackEvent: jest.fn() }))

let resolvePick: (v: { name: string; number: string } | null) => void = () => {}
const mockPickPhoneContact = jest.fn(
  (): Promise<{ name: string; number: string } | null> =>
    new Promise((resolve) => (resolvePick = resolve)),
)
// Named `mock…` so jest.mock's hoisting lets the factory read it; the test throws the same class
// the hook checks with instanceof.
class mockPickerError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}
jest.mock("@/services/support/phoneContactPicker", () => ({
  isPhoneContactPickerAvailable: () => true,
  pickPhoneContact: () => mockPickPhoneContact(),
  get PhoneContactPickerError() {
    return mockPickerError
  },
}))

describe("useAddSupportContact", () => {
  beforeEach(() => jest.clearAllMocks())

  // CHANGED 2026-11-06 (final review I-4): this used to pin a JS single-flight ("ignores a second
  // Choose"). That gate made the native stale-pick recovery unreachable: a pick whose promise never
  // settled left Choose dead until the app restarted. Native owns single-flight now.
  it("a second Choose reaches the picker while the first is unsettled", async () => {
    const { result } = renderHook(() => useAddSupportContact())
    act(() => {
      void result.current.choose()
    })
    mockPickPhoneContact.mockRejectedValueOnce(new mockPickerError("in_progress"))
    await act(async () => {
      await result.current.choose()
    })
    expect(mockPickPhoneContact).toHaveBeenCalledTimes(2)
  })

  it("stays silent on in_progress: a double tap is not a failure", async () => {
    mockPickPhoneContact.mockRejectedValueOnce(new mockPickerError("in_progress"))
    const { result } = renderHook(() => useAddSupportContact())
    await act(async () => {
      await result.current.choose()
    })
    expect(mockShowToast).not.toHaveBeenCalled()
    expect(result.current.roleSheet.visible).toBe(false)
  })

  it("still toasts on no_picker, no_number and unknown", async () => {
    const { result } = renderHook(() => useAddSupportContact())
    for (const code of ["no_picker", "no_number", "unknown"]) {
      mockShowToast.mockClear()
      mockPickPhoneContact.mockRejectedValueOnce(new mockPickerError(code))
      await act(async () => {
        await result.current.choose()
      })
      expect(mockShowToast).toHaveBeenCalledWith({ tx: "support:couldntOpenPicker", type: "error" })
    }
  })

  it("still toasts on an error that is not the picker's own", async () => {
    mockPickPhoneContact.mockRejectedValueOnce(new Error("boom"))
    const { result } = renderHook(() => useAddSupportContact())
    await act(async () => {
      await result.current.choose()
    })
    expect(mockShowToast).toHaveBeenCalledWith({ tx: "support:couldntOpenPicker", type: "error" })
  })

  it("a stale first pick resolving as a cancel leaves the second pick's sheet open", async () => {
    const { result } = renderHook(() => useAddSupportContact())
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.choose()
    })
    const settleFirst = resolvePick
    let second: Promise<void> = Promise.resolve()
    act(() => {
      second = result.current.choose()
    })
    await act(async () => {
      settleFirst(null) // what the native recovery does with the stale promise
      resolvePick({ name: "Julie J.", number: "+15550100001" })
      await Promise.all([first, second])
    })
    expect(result.current.roleSheet.visible).toBe(true)
  })

  it("opens the role sheet after a pick and adds with the chosen role", async () => {
    mockAdd.mockReturnValue("ok")
    const { result } = renderHook(() => useAddSupportContact())
    let p: Promise<void> = Promise.resolve()
    act(() => {
      p = result.current.choose()
    })
    await act(async () => {
      resolvePick({ name: "Julie J.", number: "+15550100001" })
      await p
    })
    expect(result.current.roleSheet.visible).toBe(true)
    act(() => result.current.roleSheet.onSelect("sponsor"))
    expect(mockAdd).toHaveBeenCalledWith({ name: "Julie J.", number: "+15550100001" }, "sponsor")
    expect(result.current.roleSheet.visible).toBe(false)
  })

  it("toasts on a duplicate", async () => {
    mockAdd.mockReturnValue("duplicate")
    const { result } = renderHook(() => useAddSupportContact())
    let p: Promise<void> = Promise.resolve()
    act(() => {
      p = result.current.choose()
    })
    await act(async () => {
      resolvePick({ name: "J", number: "15550100001" })
      await p
    })
    act(() => result.current.roleSheet.onSelect("friend"))
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ tx: "support:duplicate" }))
  })
})
