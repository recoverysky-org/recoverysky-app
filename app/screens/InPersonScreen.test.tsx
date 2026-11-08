import { AppState, type AppStateStatus } from "react-native"
import { act, render } from "@testing-library/react-native"

import { InPersonContent } from "./InPersonScreen"

/* The In-Person segment's location gate in ZIP mode (spec
 * 2026-11-07-in-person-zip-search-design.md, "Switching modes" and "Testing"):
 * ZIP mode never runs `runGate`, on a visit or on a resume. The GPS case is the
 * contrast that proves the gate is wired and the mocks reach it, so the ZIP
 * assertions can't pass just because nothing ever calls it.
 *
 * Every collaborator with I/O is mocked at module level: the two search hooks
 * (their own logic has its own tests), the gate (a spy), the stores, the map
 * (MapLibre's native modules throw under jest) and the popup. The header, the
 * list and the modals are the real ones. */

const mockRunGate = jest.fn(() => Promise.resolve(false))
jest.mock("@/hooks/useLocationGate", () => ({ useLocationGate: () => ({ runGate: mockRunGate }) }))

let mockSearchMode: "gps" | "zip" = "zip"
jest.mock("@/hooks/useInPersonSearchMode", () => ({
  useInPersonSearchMode: () => ({
    mode: mockSearchMode,
    setMode: jest.fn(),
    zipInput: "",
    setZipInput: jest.fn(),
    submitZip: jest.fn(),
    retryZip: jest.fn(),
    zipStatus: "empty",
    zipCenter: null,
    zipCode: null,
  }),
}))

// What the nearby hook reports with no center: "fallback", and in GPS mode
// with location off the "denied" banner (nearbyLogic.resolveBannerReason).
jest.mock("@/hooks/useNearbySchedules", () => ({
  useNearbySchedules: () => ({
    mode: "fallback",
    meetings: [],
    isLoading: false,
    error: null,
    bannerReason: mockSearchMode === "gps" ? "denied" : null,
    selectedDay: 1,
    setSelectedDay: jest.fn(),
    radiusKm: 25,
    setRadiusKm: jest.fn(),
    useMiles: false,
    refresh: jest.fn(() => Promise.resolve()),
    requestLocation: jest.fn(() => Promise.resolve()),
    canAskAgain: true,
    getSearchCenter: () => null,
    hasFix: false,
  }),
}))

// Location off in Settings: the state where the GPS gate would ask.
jest.mock("@/models", () => ({
  useProfileStore: () => ({ locationEnabled: false }),
  useConfigStore: () => ({ mapStyleUrlLight: "", mapStyleUrlDark: "", maintenanceMode: false }),
  useNetworkStore: () => ({ isOffline: false }),
}))

jest.mock("@/context/MeetingFiltersContext", () => ({
  useMeetingFilters: () => ({
    fellowship: "AA",
    language: null,
    setLanguage: jest.fn(),
    reportMeetings: jest.fn(),
  }),
}))
jest.mock("@/components/InPersonMapView", () => ({ InPersonMapView: () => null }))
jest.mock("@/components/InPersonPopup", () => ({ InPersonPopup: () => null }))
jest.mock("@/components/Toast", () => ({ useToast: () => ({ showToast: jest.fn() }) }))
jest.mock("@/db", () => ({
  feedbackCache: { getAll: () => new Map(), subscribe: () => () => {} },
}))
jest.mock("@/hooks/useReminders", () => ({
  useReminderLookup: () => new Map(),
  meetingHasReminder: () => false,
}))
jest.mock("@/navigators/navigationUtilities", () => ({
  usePendingMeetingId: () => undefined,
  peekPendingMeetingId: () => undefined,
  consumePendingMeetingId: jest.fn(),
}))
jest.mock("@/services/api", () => ({ api: { getScheduleByMeetingId: jest.fn() } }))
jest.mock("@/services/tracking", () => ({ trackEvent: jest.fn() }))
jest.mock("@/utils/logger", () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  return { logger: { child: () => log } }
})
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

/** The resume listeners the screen registered, called in order. */
let appStateHandlers: Array<(state: AppStateStatus) => void> = []

function resume() {
  act(() => {
    appStateHandlers.forEach((handler) => handler("background"))
    appStateHandlers.forEach((handler) => handler("active"))
  })
}

describe("InPersonContent location gate", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    appStateHandlers = []
    // Unset under jest, and the listener starts from it (`appState.match`).
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true })
    // Records each listener and drops it on `remove()`, so a listener from an
    // earlier visit (removed when `visible` went false) is not fired again.
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      const listener = handler as (state: AppStateStatus) => void
      appStateHandlers.push(listener)
      return {
        remove: () => {
          appStateHandlers = appStateHandlers.filter((h) => h !== listener)
        },
      } as unknown as ReturnType<typeof AppState.addEventListener>
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("never runs the gate in ZIP mode with location off: visit, re-visit or resume", () => {
    mockSearchMode = "zip"
    const { rerender } = render(<InPersonContent active visible />)
    expect(mockRunGate).not.toHaveBeenCalled()

    // Leave the segment and come back: a new visit.
    rerender(<InPersonContent active visible={false} />)
    rerender(<InPersonContent active visible />)
    expect(mockRunGate).not.toHaveBeenCalled()

    // Background → active while the segment is on screen.
    expect(appStateHandlers).toHaveLength(1)
    resume()
    expect(mockRunGate).not.toHaveBeenCalled()
  })

  it("runs the gate once on a GPS visit with location off", () => {
    mockSearchMode = "gps"
    render(<InPersonContent active visible />)
    expect(mockRunGate).toHaveBeenCalledTimes(1)
  })
})
