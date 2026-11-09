import { Alert } from "react-native"
import { act, fireEvent, render, waitFor } from "@testing-library/react-native"

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
jest.mock("@/services/support/dial", () => ({ openDial: jest.fn(async () => true) }))
const storage = jest.requireMock<{ loadSupportContacts: jest.Mock }>(
  "@/services/support/supportContactsStorage",
)
const dialModule = jest.requireMock<{ openDial: jest.Mock }>("@/services/support/dial")

const julie = { role: "sponsor", name: "Julie J.", number: "+15550100001" }
const marco = { role: "support", name: "Marco", number: "5550100002" }

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
    // CHANGED 2026-11-08: the empty card's words are the intro, not "Add your sponsor".
    expect(render(<SupportCardContainer />).getByText(/support:emptyIntro/)).toBeTruthy()
  })
})

// ADDED 2026-11-08: the card lists every contact and edits from its header.
describe("SupportCardContainer with contacts", () => {
  beforeEach(async () => {
    storage.loadSupportContacts.mockReset()
    dialModule.openDial.mockClear()
    mockStore.current = SupportStoreModel.create({})
    storage.loadSupportContacts.mockResolvedValueOnce([julie, marco])
    await mockStore.current!.hydrate()
  })
  afterEach(() => jest.restoreAllMocks())

  it("dials the pressed row's number, read from the store", async () => {
    const view = render(<SupportCardContainer />)
    fireEvent.press(view.getAllByLabelText(/support:callA11y/)[1])
    await waitFor(() => expect(dialModule.openDial).toHaveBeenCalledWith("call", marco.number))
  })

  it("edit's trash asks first, and removes that contact only on confirm", () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {})
    const view = render(<SupportCardContainer />)
    fireEvent.press(view.getByLabelText(/support:editA11y/))
    fireEvent.press(view.getAllByLabelText(/support:removeA11y/)[0])

    expect(alert).toHaveBeenCalledTimes(1)
    expect(mockStore.current!.contacts).toHaveLength(2)
    const buttons = alert.mock.calls[0][2] as { style?: string; onPress?: () => void }[]
    act(() => buttons.find((b) => b.style === "destructive")!.onPress!())

    expect(mockStore.current!.contacts).toEqual([marco])
    expect(view.getAllByText(/support:roleAndName/)).toHaveLength(1)
  })
})
