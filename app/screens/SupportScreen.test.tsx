import { fireEvent, render, waitFor } from "@testing-library/react-native"

import { SupportScreen } from "./SupportScreen"

// The library's own jest mock: the screen reads safe-area insets, and the test renders no provider.
jest.mock(
  "react-native-safe-area-context",
  () =>
    jest.requireActual<{ default: unknown }>("react-native-safe-area-context/jest/mock").default,
)

const mockNavigate = jest.fn()
const mockGoBack = jest.fn()
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}))
const mockStore = {
  contacts: [
    { role: "sponsor", name: "Julie J.", number: "+15550100001" },
    { role: "support", name: "Marco", number: "5550100002" },
  ],
  primary: { role: "sponsor", name: "Julie J.", number: "+15550100001" },
  canAdd: true,
  add: jest.fn(),
  remove: jest.fn(),
  moveUp: jest.fn(),
  setRole: jest.fn(),
}
jest.mock("@/models", () => ({ useSupportStore: () => mockStore }))
const mockShowToast = jest.fn()
jest.mock("@/components/Toast", () => ({ useToast: () => ({ showToast: mockShowToast }) }))
const mockTrackEvent = jest.fn()
jest.mock("@/services/tracking", () => ({ trackEvent: (e: string) => mockTrackEvent(e) }))
jest.mock("@/services/support/phoneContactPicker", () => ({
  isPhoneContactPickerAvailable: () => true,
  pickPhoneContact: jest.fn(),
  PhoneContactPickerError: class extends Error {},
}))
let mockRegion: string | null = "US"
jest.mock("@/services/support/deviceRegion", () => ({ getDeviceRegion: () => mockRegion }))
const mockOpenDial = jest.fn()
jest.mock("@/services/support/dial", () => ({
  openDial: (...args: unknown[]) => mockOpenDial(...args),
}))

describe("SupportScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOpenDial.mockResolvedValue(true)
  })

  it("lists contacts by name and never renders a number (spec D1)", () => {
    const { toJSON, getAllByText } = render(<SupportScreen />)
    expect(getAllByText(/support:roleAndName/)).toHaveLength(2)
    const tree = JSON.stringify(toJSON())
    expect(tree).not.toContain("555")
    expect(tree).not.toContain("0100001")
  })

  it("shows the 988 row for the US and hides it elsewhere (spec D5)", () => {
    mockRegion = "US"
    expect(render(<SupportScreen />).queryByText(/support:crisisLine/)).toBeTruthy()
    mockRegion = "GB"
    expect(render(<SupportScreen />).queryByText(/support:crisisLine/)).toBeNull()
    mockRegion = "US"
  })

  it("Find a live meeting goes to the Meetings tab's Online segment", () => {
    const { getByText } = render(<SupportScreen />)
    fireEvent.press(getByText(/support:findLiveMeeting/))
    expect(mockNavigate).toHaveBeenCalledWith("Main", {
      screen: "Meetings",
      params: { segment: "live" },
    })
  })

  it("dials the pressed contact's number and tracks the event name only", async () => {
    const { getAllByLabelText } = render(<SupportScreen />)
    fireEvent.press(getAllByLabelText(/support:callA11y/)[1])
    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledWith("support_call"))
    expect(mockOpenDial).toHaveBeenCalledWith("call", "5550100002")
  })

  it("toasts when the phone app cannot open, without a number", async () => {
    mockOpenDial.mockResolvedValue(false)
    const { getAllByLabelText } = render(<SupportScreen />)
    fireEvent.press(getAllByLabelText(/support:textA11y/)[0])
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled())
    expect(mockShowToast).toHaveBeenCalledWith({ tx: "support:couldntOpenPhone", type: "error" })
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it("dials 988 from the crisis row", async () => {
    const { getByLabelText } = render(<SupportScreen />)
    fireEvent.press(getByLabelText(/support:crisisCallA11y/))
    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledWith("support_crisis_call"))
    expect(mockOpenDial).toHaveBeenCalledWith("call", "988")
  })

  it("the sheet acts on the tapped row: move up", () => {
    const { getAllByLabelText, getByText } = render(<SupportScreen />)
    fireEvent.press(getAllByLabelText(/support:moreA11y/)[1])
    fireEvent.press(getByText(/support:moveUp/))
    expect(mockStore.moveUp).toHaveBeenCalledWith(1)
  })
})
