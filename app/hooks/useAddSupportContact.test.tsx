import { act, renderHook } from "@testing-library/react-native"

import { useAddSupportContact } from "./useAddSupportContact"

const mockAdd = jest.fn()
jest.mock("@/models", () => ({ useSupportStore: () => ({ contacts: [], add: mockAdd }) }))
const mockShowToast = jest.fn()
jest.mock("@/components/Toast", () => ({ useToast: () => ({ showToast: mockShowToast }) }))
jest.mock("@/services/tracking", () => ({ trackEvent: jest.fn() }))

let resolvePick: (v: { name: string; number: string } | null) => void = () => {}
const mockPickPhoneContact = jest.fn(
  () => new Promise<{ name: string; number: string } | null>((resolve) => (resolvePick = resolve)),
)
jest.mock("@/services/support/phoneContactPicker", () => ({
  isPhoneContactPickerAvailable: () => true,
  pickPhoneContact: () => mockPickPhoneContact(),
  PhoneContactPickerError: class extends Error {
    code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  },
}))

describe("useAddSupportContact", () => {
  beforeEach(() => jest.clearAllMocks())

  it("ignores a second Choose while a pick is in flight (Review Focus 5)", async () => {
    const { result } = renderHook(() => useAddSupportContact())
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.choose()
      void result.current.choose()
    })
    expect(mockPickPhoneContact).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolvePick(null)
      await first
    })
    expect(result.current.roleSheet.visible).toBe(false)
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
