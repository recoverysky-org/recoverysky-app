import { CommonActions, StackRouter } from "@react-navigation/native"
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
  hydrated: true,
  contacts: [
    { role: "sponsor", name: "Julie J.", number: "+15550100001" },
    { role: "support", name: "Marco", number: "5550100002" },
  ],
  primary: { role: "sponsor", name: "Julie J.", number: "+15550100001" },
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

// ADDED 2026-11-19: the contacts are hidden in the app for now (supportVisibility.ts). The tests
// below exercise the contact list as it works when shown, so they turn it on; the last test pins
// what the hidden state draws. A getter, because the screen reads the flag at render.
let mockContactsEnabled = true
jest.mock("@/services/support/supportVisibility", () => ({
  get SUPPORT_CONTACTS_ENABLED() {
    return mockContactsEnabled
  },
  SUPPORT_HOME_CARD_ENABLED: false,
}))

describe("SupportScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockOpenDial.mockResolvedValue(true)
    mockContactsEnabled = true
  })

  it("hides the contacts and Add while they are switched off, keeping the meeting and 988 rows", () => {
    mockContactsEnabled = false
    const { queryAllByText, queryByText, getByText } = render(<SupportScreen />)
    expect(queryAllByText(/support:roleAndName/)).toHaveLength(0)
    expect(queryByText(/^support:addContact/)).toBeNull()
    expect(getByText(/^support:findLiveMeeting/)).toBeTruthy()
    expect(getByText(/^support:crisisLine/)).toBeTruthy()
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

  // CHANGED 2026-11-06: returns to the existing Main with { pop: true }. Without it the stack
  // router pushes a second Main, and with it a second tab navigator, on top of Support.
  it("Find a live meeting goes to the Meetings tab's Online segment", () => {
    const { getByText } = render(<SupportScreen />)
    fireEvent.press(getByText(/support:findLiveMeeting/))
    expect(mockNavigate).toHaveBeenCalledWith(
      "Main",
      { screen: "Meetings", params: { segment: "live" } },
      { pop: true },
    )
  })

  // ADDED 2026-11-06: the mocked call above cannot show what the option does, so the same call
  // goes through the real router. Mirrors the app stack with Support open over Main.
  it("Find a live meeting leaves one Main in the stack, the existing one", () => {
    const { getByText } = render(<SupportScreen />)
    fireEvent.press(getByText(/support:findLiveMeeting/))
    const [name, params, options] = mockNavigate.mock.calls[0]

    const routeNames = ["Main", "Support"]
    const configs = { routeNames, routeParamList: {}, routeGetIdList: {} }
    const router = StackRouter({})
    const state = {
      ...router.getInitialState(configs),
      index: 1,
      routes: [
        { key: "main-existing", name: "Main" },
        { key: "support-open", name: "Support" },
      ],
    }

    const next = router.getStateForAction(
      state,
      CommonActions.navigate(name, params, options),
      configs,
    )

    expect(next?.index).toBe(0)
    expect(next?.routes).toHaveLength(1)
    expect(next?.routes[0]).toMatchObject({
      key: "main-existing",
      name: "Main",
      params: { screen: "Meetings", params: { segment: "live" } },
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

  // ADDED 2026-11-06 (final review I-3): the crisis paths never depend on reading the keychain.
  describe("while the contacts are unread", () => {
    beforeEach(() => {
      mockStore.hydrated = false
      mockRegion = "US"
    })
    afterEach(() => {
      mockStore.hydrated = true
    })

    it("hides the contacts and the Add row", () => {
      const { queryByText, queryByLabelText, queryAllByLabelText } = render(<SupportScreen />)
      expect(queryByText(/support:roleAndName/)).toBeNull()
      expect(queryAllByLabelText(/support:callA11y/)).toHaveLength(0)
      expect(queryByLabelText(/support:addContact/)).toBeNull()
    })

    it("keeps Find a live meeting and the 988 row", () => {
      const { getByText, getByLabelText } = render(<SupportScreen />)
      expect(getByText(/support:findLiveMeeting/)).toBeTruthy()
      expect(getByText(/support:crisisLine/)).toBeTruthy()
      expect(getByLabelText(/support:crisisCallA11y/)).toBeTruthy()
    })
  })

  it("the sheet acts on the tapped row: move up", () => {
    const { getAllByLabelText, getByText } = render(<SupportScreen />)
    fireEvent.press(getAllByLabelText(/support:moreA11y/)[1])
    fireEvent.press(getByText(/support:moveUp/))
    expect(mockStore.moveUp).toHaveBeenCalledWith(1)
  })
})
