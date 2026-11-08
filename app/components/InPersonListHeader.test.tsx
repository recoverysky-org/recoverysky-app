import { fireEvent, render, screen } from "@testing-library/react-native"

import { InPersonListHeader, type InPersonListHeaderProps } from "./InPersonListHeader"

// Same pattern as MapListToggle.test.tsx: resolve against the real `en`
// catalogue so accessibility strings can be asserted by what a screen reader
// actually says. The rest of test/setup.ts (icon + theme mocks) still applies.
jest.mock("react-i18next", () => {
  const en = require("@/i18n/en").default
  const resolve = (key: string, params?: Record<string, string | number>) => {
    const [ns, path] = key.split(":")
    const value = (path ?? "")
      .split(".")
      .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], en[ns])
    if (typeof value !== "string") return key
    return value.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params?.[name] ?? `{{${name}}}`))
  }
  return { useTranslation: () => ({ t: resolve }) }
})

const baseProps: InPersonListHeaderProps = {
  selectedDayLabel: "Mon",
  radiusLabel: "25 mi",
  radiusA11yLabel: "Within 25 miles",
  shortTimeLabel: "Any",
  bannerReason: null,
  canAskAgain: true,
  locationDisabled: false,
  showSpinner: false,
  isRefetching: false,
  onOpenDay: jest.fn(),
  onOpenRadius: jest.fn(),
  onOpenShortTime: jest.fn(),
  onBannerPress: jest.fn(),
  resultCount: 7,
  showMapToggle: false,
  viewMode: "list",
  mapToggleDisabled: false,
  onToggleView: jest.fn(),
  showSortToggle: false,
  sortOrder: "distance",
  onSelectSort: jest.fn(),
  searchMode: "zip",
  onSelectSearchMode: jest.fn(),
  zipInput: "",
  onChangeZipInput: jest.fn(),
  onSubmitZip: jest.fn(),
  zipStatus: "empty",
  onRetryZip: jest.fn(),
}

describe("InPersonListHeader result-count slot", () => {
  it("shows the result count when nothing is loading", () => {
    render(<InPersonListHeader {...baseProps} />)
    expect(screen.getByTestId("result-count")).toBeTruthy()
    expect(screen.queryByTestId("result-count-loading")).toBeNull()
  })

  // The bug this pins (2026-09-05): a day / radius / fellowship change refetches
  // while the previous rows are still on screen. The screen's large first-load
  // spinner is gated on "no rows yet", and RefreshControl can't be relied on
  // for a programmatic reload (no FlatList in map mode, a no-op on web, and a
  // 250 ms offset animation on iOS that a fast fetch beats). So the header
  // itself has to signal the reload, in the one slot both view modes render.
  it("replaces the stale count with a loading indicator while refetching", () => {
    render(<InPersonListHeader {...baseProps} isRefetching />)
    expect(screen.getByTestId("result-count-loading")).toBeTruthy()
    expect(screen.queryByTestId("result-count")).toBeNull()
  })

  it("announces the refetch indicator to screen readers", () => {
    render(<InPersonListHeader {...baseProps} isRefetching />)
    expect(screen.getByLabelText("Loading")).toBeTruthy()
  })

  it("keeps the count slot empty during the first-load spinner", () => {
    // `showSpinner` is the pre-existing "no rows yet" path: the big spinner
    // below the filters owns the loading signal, so the subtitle slot must not
    // add a second one.
    render(<InPersonListHeader {...baseProps} showSpinner />)
    expect(screen.queryByTestId("result-count")).toBeNull()
    expect(screen.queryByTestId("result-count-loading")).toBeNull()
  })
})

describe("InPersonListHeader filters", () => {
  // CHANGED 2026-09-26: Fellowship moved to the shared Meetings filter bar.
  it("no longer renders its own fellowship cell", () => {
    render(<InPersonListHeader {...baseProps} />)
    expect(screen.queryByLabelText(/^Fellowship,/)).toBeNull()
  })
})

describe("InPersonListHeader controls row", () => {
  it("renders the list/map pill when asked, even with the sort pill hidden", () => {
    // Map mode: the sort half is empty, but the way back to the list must
    // still be here.
    render(<InPersonListHeader {...baseProps} showMapToggle viewMode="map" />)
    expect(screen.getByLabelText("Map").props.accessibilityState?.selected).toBe(true)
    expect(screen.getByLabelText("List").props.accessibilityState?.selected).toBe(false)
    expect(screen.queryByLabelText("Distance")).toBeNull()
  })

  it("renders the sort pill alone when the map is switched off", () => {
    // Config kill switch / location off: no map, but the list still sorts.
    render(<InPersonListHeader {...baseProps} showSortToggle />)
    expect(screen.queryByLabelText("Map")).toBeNull()
    expect(screen.getByLabelText("Distance")).toBeTruthy()
  })

  it("flips the view when the inactive list/map half is pressed", () => {
    const onToggleView = jest.fn()
    render(<InPersonListHeader {...baseProps} showMapToggle onToggleView={onToggleView} />)
    fireEvent.press(screen.getByLabelText("Map"))
    expect(onToggleView).toHaveBeenCalledTimes(1)
  })
})

describe("InPersonListHeader sort pill", () => {
  it("is absent unless the screen asks for it", () => {
    // Map mode and the day-browse fallback both hide it — see the prop comment.
    render(<InPersonListHeader {...baseProps} />)
    expect(screen.queryByLabelText("Distance")).toBeNull()
    expect(screen.queryByLabelText("Start")).toBeNull()
  })

  it("shows both orders with the active one selected", () => {
    render(<InPersonListHeader {...baseProps} showSortToggle sortOrder="start" />)
    expect(screen.getByLabelText("Distance").props.accessibilityState?.selected).toBe(false)
    expect(screen.getByLabelText("Start").props.accessibilityState?.selected).toBe(true)
  })

  it("reports the picked order, and only for the inactive half", () => {
    const onSelectSort = jest.fn()
    render(<InPersonListHeader {...baseProps} showSortToggle onSelectSort={onSelectSort} />)
    fireEvent.press(screen.getByLabelText("Distance"))
    expect(onSelectSort).not.toHaveBeenCalled()
    fireEvent.press(screen.getByLabelText("Start"))
    expect(onSelectSort).toHaveBeenCalledWith("start")
  })
})

// ADDED 2026-11-07 (ZIP search): the GPS | ZIP control and the postal code box.
describe("InPersonListHeader GPS | ZIP control", () => {
  it("renders both choices as tabs with the active one selected", () => {
    render(<InPersonListHeader {...baseProps} searchMode="zip" />)
    const zip = screen.getByRole("tab", { name: "ZIP" })
    const gps = screen.getByRole("tab", { name: "GPS" })
    expect(zip.props.accessibilityState.selected).toBe(true)
    expect(gps.props.accessibilityState.selected).toBe(false)
  })

  it("names the tablist for screen readers", () => {
    render(<InPersonListHeader {...baseProps} />)
    expect(screen.getByLabelText("Search by")).toBeTruthy()
  })

  it("reports a press on GPS", () => {
    const onSelectSearchMode = jest.fn()
    render(<InPersonListHeader {...baseProps} onSelectSearchMode={onSelectSearchMode} />)
    fireEvent.press(screen.getByRole("tab", { name: "GPS" }))
    expect(onSelectSearchMode).toHaveBeenCalledWith("gps")
  })

  it("shows the box in zip mode only", () => {
    const { rerender } = render(<InPersonListHeader {...baseProps} searchMode="zip" />)
    expect(screen.getByPlaceholderText("ZIP or postal code")).toBeTruthy()
    rerender(<InPersonListHeader {...baseProps} searchMode="gps" />)
    expect(screen.queryByPlaceholderText("ZIP or postal code")).toBeNull()
    rerender(<InPersonListHeader {...baseProps} searchMode={null} />)
    expect(screen.queryByPlaceholderText("ZIP or postal code")).toBeNull()
  })

  it("reports typing and submitting", () => {
    const onChangeZipInput = jest.fn()
    const onSubmitZip = jest.fn()
    render(
      <InPersonListHeader
        {...baseProps}
        onChangeZipInput={onChangeZipInput}
        onSubmitZip={onSubmitZip}
      />,
    )
    const box = screen.getByPlaceholderText("ZIP or postal code")
    fireEvent.changeText(box, "90210")
    expect(onChangeZipInput).toHaveBeenCalledWith("90210")
    fireEvent(box, "submitEditing")
    expect(onSubmitZip).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["invalid", "Enter a 5-digit ZIP or a postal code like K1A 0B1."],
    ["notFound", "We couldn't find that ZIP or postal code."],
    ["unavailable", "ZIP search isn't available right now."],
    ["failed", "Couldn't look that up. Tap to try again."],
  ] as const)("shows the message for %s", (zipStatus, message) => {
    render(<InPersonListHeader {...baseProps} zipStatus={zipStatus} />)
    expect(screen.getByText(message)).toBeTruthy()
  })

  it.each(["found", "empty", "looking"] as const)("shows no message for %s", (zipStatus) => {
    render(<InPersonListHeader {...baseProps} zipStatus={zipStatus} />)
    expect(screen.queryByTestId("zip-message")).toBeNull()
  })

  it("retries when the failed message is pressed", () => {
    const onRetryZip = jest.fn()
    render(<InPersonListHeader {...baseProps} zipStatus="failed" onRetryZip={onRetryZip} />)
    fireEvent.press(screen.getByText("Couldn't look that up. Tap to try again."))
    expect(onRetryZip).toHaveBeenCalledTimes(1)
  })

  // A disabled touchable is announced "dimmed" by VoiceOver, which reads as a
  // broken control; the three informational messages are plain text.
  it.each([
    ["invalid", "Enter a 5-digit ZIP or a postal code like K1A 0B1."],
    ["notFound", "We couldn't find that ZIP or postal code."],
    ["unavailable", "ZIP search isn't available right now."],
  ] as const)("announces the %s message as text, not a dimmed button", (zipStatus, message) => {
    render(<InPersonListHeader {...baseProps} zipStatus={zipStatus} />)
    expect(screen.getByTestId("zip-message").props.accessibilityState?.disabled).toBeFalsy()
    expect(screen.queryByRole("button", { name: message })).toBeNull()
  })

  it("makes the failed message a button", () => {
    render(<InPersonListHeader {...baseProps} zipStatus="failed" />)
    expect(
      screen.getByRole("button", { name: "Couldn't look that up. Tap to try again." }),
    ).toBeTruthy()
  })
})
