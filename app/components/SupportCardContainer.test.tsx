import { act, render } from "@testing-library/react-native"

import { SupportStoreModel, type SupportStore } from "@/models/SupportStore"

import { SupportCardContainer } from "./SupportCardContainer"

// The real store, so the test also proves the container re-renders when a late hydrate lands.

// A holder, because jest's hoisting cannot lift an uninitialised `let`.
const mockStore: { current: SupportStore | null } = { current: null }
jest.mock("@/models", () => ({ useSupportStore: () => mockStore.current }))
jest.mock("@/services/support/supportContactsStorage", () => ({
  loadSupportContacts: jest.fn(),
  saveSupportContacts: jest.fn(async () => true),
  clearSupportContacts: jest.fn(async () => true),
}))
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn() }),
}))
jest.mock("@/components/Toast", () => ({ useToast: () => ({ showToast: jest.fn() }) }))
jest.mock("@/services/tracking", () => ({ trackEvent: jest.fn() }))
jest.mock("@/services/support/phoneContactPicker", () => ({
  isPhoneContactPickerAvailable: () => true,
  pickPhoneContact: jest.fn(),
  PhoneContactPickerError: class extends Error {},
}))
jest.mock("@/services/support/dial", () => ({ openDial: jest.fn() }))
const storage = jest.requireMock<{ loadSupportContacts: jest.Mock }>(
  "@/services/support/supportContactsStorage",
)

const julie = { role: "sponsor", name: "Julie J.", number: "+15550100001" }

// ADDED 2026-11-06 (final review I-3): "Add your sponsor" over a list we could not read is a dead
// end in a crisis and invites the edit that used to overwrite it.
describe("SupportCardContainer while the contacts are unread", () => {
  beforeEach(() => {
    storage.loadSupportContacts.mockReset()
    mockStore.current = SupportStoreModel.create({})
  })

  it("renders nothing when the read failed", async () => {
    storage.loadSupportContacts.mockResolvedValueOnce(null)
    await mockStore.current!.hydrate()
    expect(render(<SupportCardContainer />).toJSON()).toBeNull()
  })

  it("appears when a later read succeeds, without a remount", async () => {
    storage.loadSupportContacts.mockResolvedValueOnce(null)
    await mockStore.current!.hydrate()
    const view = render(<SupportCardContainer />)
    expect(view.toJSON()).toBeNull()
    storage.loadSupportContacts.mockResolvedValueOnce([julie])
    await act(async () => {
      await mockStore.current!.hydrate()
    })
    expect(view.getByText(/support:roleAndName/)).toBeTruthy()
  })

  it("shows the empty card once a read says there is nobody", async () => {
    storage.loadSupportContacts.mockResolvedValueOnce([])
    await mockStore.current!.hydrate()
    expect(render(<SupportCardContainer />).getByText(/support:emptyTitle/)).toBeTruthy()
  })
})
